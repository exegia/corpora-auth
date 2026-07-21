//! `AuthCore` — the single source of truth for authentication state.
//!
//! All session mutations (sign-in, sign-up, sign-out, refresh, restore, OAuth
//! completion) serialize through one `tokio::sync::Mutex`, held across the
//! network await. This single-writer design is what guarantees the spec's
//! consistency edge case: a sign-out racing an in-flight refresh always ends
//! fully signed out — the refresh re-checks state under the lock and can never
//! resurrect a terminated session.
//!
//! `AuthCore` is deliberately independent of Tauri: events go to registered
//! listener callbacks (the plugin registers one that forwards to
//! `AppHandle::emit`), which keeps the whole state machine testable with
//! wiremock alone.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tokio::sync::{Mutex, Notify};

use crate::config::ValidatedConfig;
use crate::engine::{AuthEngine, OtpKind, OtpTarget};
use crate::error::{Error, ErrorKind, Result};
use crate::models::{
    AuthChangeEvent, AuthChangePayload, SanitizedSession, Session, SignUpResult, SignUpStatus, User,
};
use crate::persistence::SessionStore;

/// Network budget per auth operation — SC-003: no indefinite waits.
pub const OP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

#[allow(clippy::large_enum_variant)] // one live value; size is irrelevant
pub enum AuthState {
    SignedOut,
    SignedIn(Session),
    PendingConfirmation {
        email: String,
    },
    OAuthInFlight {
        provider: String,
        cancel: Arc<Notify>,
    },
}

type Listener = Box<dyn Fn(&AuthChangePayload) + Send + Sync>;

pub struct AuthCore {
    pub(crate) engine: AuthEngine,
    pub(crate) config: ValidatedConfig,
    store: Box<dyn SessionStore>,
    state: Mutex<AuthState>,
    listeners: std::sync::Mutex<Vec<(u64, Listener)>>,
    next_listener_id: AtomicU64,
    /// Wakes the background refresh task after every state transition.
    pub(crate) refresh_notify: Notify,
}

pub struct ListenerHandle(pub u64);

impl AuthCore {
    pub fn new(engine: AuthEngine, config: ValidatedConfig, store: Box<dyn SessionStore>) -> Self {
        Self {
            engine,
            config,
            store,
            state: Mutex::new(AuthState::SignedOut),
            listeners: std::sync::Mutex::new(Vec::new()),
            next_listener_id: AtomicU64::new(1),
            refresh_notify: Notify::new(),
        }
    }

    // -- listeners ----------------------------------------------------------

    pub fn on_auth_state_change<F>(&self, cb: F) -> ListenerHandle
    where
        F: Fn(&AuthChangePayload) + Send + Sync + 'static,
    {
        let id = self.next_listener_id.fetch_add(1, Ordering::Relaxed);
        self.listeners.lock().unwrap().push((id, Box::new(cb)));
        ListenerHandle(id)
    }

    pub fn remove_listener(&self, handle: ListenerHandle) {
        self.listeners
            .lock()
            .unwrap()
            .retain(|(id, _)| *id != handle.0);
    }

    fn emit(&self, event: AuthChangeEvent, session: Option<&Session>) {
        let payload = AuthChangePayload {
            event,
            session: session.map(|s| s.sanitized()),
        };
        for (_, cb) in self.listeners.lock().unwrap().iter() {
            cb(&payload);
        }
    }

    // -- reads ---------------------------------------------------------------

    pub async fn session(&self) -> Option<Session> {
        match &*self.state.lock().await {
            AuthState::SignedIn(s) => Some(s.clone()),
            _ => None,
        }
    }

    pub async fn sanitized_session(&self) -> Option<SanitizedSession> {
        self.session().await.map(|s| s.sanitized())
    }

    pub async fn user(&self) -> Option<User> {
        self.session().await.map(|s| s.user)
    }

    // -- transitions ---------------------------------------------------------

    pub async fn sign_up(
        &self,
        email: &str,
        password: &str,
        data: Option<serde_json::Value>,
    ) -> Result<SignUpResult> {
        let mut state = self.state.lock().await;
        let (result, session) = with_timeout(self.engine.sign_up(email, password, data)).await?;
        match session {
            Some(session) => {
                self.store.save(&session);
                self.emit(AuthChangeEvent::SignedIn, Some(&session));
                *state = AuthState::SignedIn(session);
            }
            None => {
                debug_assert_eq!(result.status, SignUpStatus::PendingConfirmation);
                *state = AuthState::PendingConfirmation {
                    email: email.to_string(),
                };
            }
        }
        drop(state);
        self.refresh_notify.notify_waiters();
        Ok(result)
    }

    pub async fn sign_in_with_password(&self, email: &str, password: &str) -> Result<Session> {
        let mut state = self.state.lock().await;
        let session = with_timeout(self.engine.sign_in_with_password(email, password)).await?;
        self.store.save(&session);
        self.emit(AuthChangeEvent::SignedIn, Some(&session));
        *state = AuthState::SignedIn(session.clone());
        drop(state);
        self.refresh_notify.notify_waiters();
        Ok(session)
    }

    pub async fn request_otp(&self, target: OtpTarget, redirect_to: Option<String>) -> Result<()> {
        // No state transition; no lock needed.
        with_timeout(self.engine.request_otp(&target, redirect_to)).await
    }

    pub async fn verify_otp(
        &self,
        target: OtpTarget,
        token: &str,
        kind: OtpKind,
    ) -> Result<Session> {
        let mut state = self.state.lock().await;
        let session = with_timeout(self.engine.verify_otp(&target, token, kind)).await?;
        self.store.save(&session);
        // A recovery verification signals "prompt the user for a new password".
        let event = if kind == OtpKind::Recovery {
            AuthChangeEvent::PasswordRecovery
        } else {
            AuthChangeEvent::SignedIn
        };
        self.emit(event, Some(&session));
        *state = AuthState::SignedIn(session.clone());
        drop(state);
        self.refresh_notify.notify_waiters();
        Ok(session)
    }

    /// Sign-out is local-first: server revocation is attempted, but local
    /// state and stored material are cleared regardless of network outcome.
    pub async fn sign_out(&self) -> Result<()> {
        let mut state = self.state.lock().await;
        if let AuthState::OAuthInFlight { cancel, .. } = &*state {
            cancel.notify_waiters();
        }
        let was_signed_in = matches!(&*state, AuthState::SignedIn(_));
        if let AuthState::SignedIn(current) = &*state {
            self.engine.adopt(current).await;
            if let Err(e) = with_timeout(self.engine.sign_out()).await {
                tracing::warn!("server sign-out failed (clearing locally anyway): {e}");
            }
        }
        self.engine.forget().await;
        self.store.clear();
        *state = AuthState::SignedOut;
        if was_signed_in {
            self.emit(AuthChangeEvent::SignedOut, None);
        }
        drop(state);
        self.refresh_notify.notify_waiters();
        Ok(())
    }

    /// Manual/background refresh. Terminal (non-network) failures clear the
    /// session; network failures keep the current session untouched.
    pub async fn refresh(&self) -> Result<Session> {
        let mut state = self.state.lock().await;
        let AuthState::SignedIn(current) = &*state else {
            return Err(Error::session_expired("no active session to refresh"));
        };
        self.engine.adopt(current).await;
        match with_timeout(self.engine.refresh_session()).await {
            Ok(session) => {
                self.store.save(&session);
                self.emit(AuthChangeEvent::TokenRefreshed, Some(&session));
                *state = AuthState::SignedIn(session.clone());
                drop(state);
                self.refresh_notify.notify_waiters();
                Ok(session)
            }
            Err(e) if e.kind == ErrorKind::Network => Err(e),
            Err(e) => {
                self.engine.forget().await;
                self.store.clear();
                *state = AuthState::SignedOut;
                self.emit(AuthChangeEvent::SignedOut, None);
                drop(state);
                self.refresh_notify.notify_waiters();
                Err(Error::session_expired(format!(
                    "session refresh rejected: {}",
                    e.message
                )))
            }
        }
    }

    /// Startup restore (US2). Restore rules per data-model.md:
    /// missing/corrupt/revoked → signed-out; network failure with an unexpired
    /// access token → signed in on the stored session (offline edge case).
    pub async fn restore(&self) {
        let Some(stored) = self.store.load() else {
            return;
        };
        let mut state = self.state.lock().await;
        self.engine.adopt(&stored).await;

        let needs_refresh = stored.expires_at
            <= chrono::Utc::now()
                + chrono::Duration::seconds(self.config.refresh_buffer_secs as i64);
        if !needs_refresh {
            self.emit(AuthChangeEvent::SignedIn, Some(&stored));
            *state = AuthState::SignedIn(stored);
            drop(state);
            self.refresh_notify.notify_waiters();
            return;
        }

        match with_timeout(self.engine.refresh_session()).await {
            Ok(session) => {
                self.store.save(&session);
                self.emit(AuthChangeEvent::SignedIn, Some(&session));
                *state = AuthState::SignedIn(session);
            }
            Err(e) if e.kind == ErrorKind::Network && !stored.is_expired() => {
                tracing::info!("offline at startup; restoring stored session as-is");
                self.emit(AuthChangeEvent::SignedIn, Some(&stored));
                *state = AuthState::SignedIn(stored);
            }
            Err(e) if e.kind == ErrorKind::Network => {
                // Expired and unreachable: signed out for now, but the stored
                // material stays so a later launch with connectivity can retry.
                tracing::info!("stored session expired and network unreachable: {e}");
                self.engine.forget().await;
                *state = AuthState::SignedOut;
            }
            Err(e) => {
                tracing::info!("stored session rejected on restore; clearing: {e}");
                self.engine.forget().await;
                self.store.clear();
                *state = AuthState::SignedOut;
            }
        }
        drop(state);
        self.refresh_notify.notify_waiters();
    }

    pub async fn reset_password_for_email(
        &self,
        email: &str,
        redirect_to: Option<String>,
    ) -> Result<()> {
        with_timeout(self.engine.reset_password_for_email(email, redirect_to)).await
    }

    pub async fn update_user(
        &self,
        email: Option<String>,
        password: Option<String>,
        data: Option<serde_json::Value>,
    ) -> Result<User> {
        let mut state = self.state.lock().await;
        let AuthState::SignedIn(current) = &*state else {
            return Err(Error::session_expired(
                "update_user requires a signed-in session",
            ));
        };
        let token = current.access_token.clone();
        let user = with_timeout(self.engine.update_user(&token, email, password, data)).await?;
        if let AuthState::SignedIn(s) = &mut *state {
            s.user = user.clone();
            self.store.save(s);
        }
        Ok(user)
    }

    // -- OAuth state hooks (flow logic lives in oauth.rs) --------------------

    /// Enters `OAuthInFlight`; returns the cancel handle the flow must watch.
    pub async fn begin_oauth(&self, provider: &str) -> Result<Arc<Notify>> {
        let mut state = self.state.lock().await;
        if matches!(&*state, AuthState::OAuthInFlight { .. }) {
            return Err(Error::oauth_interrupted(
                "an OAuth flow is already in progress; cancel it first",
            ));
        }
        let cancel = Arc::new(Notify::new());
        *state = AuthState::OAuthInFlight {
            provider: provider.to_string(),
            cancel: cancel.clone(),
        };
        Ok(cancel)
    }

    /// Completes a flow. Rejects if the flow was cancelled meanwhile.
    pub async fn complete_oauth(&self, session: Session) -> Result<Session> {
        let mut state = self.state.lock().await;
        if !matches!(&*state, AuthState::OAuthInFlight { .. }) {
            return Err(Error::oauth_interrupted("OAuth flow was cancelled"));
        }
        self.store.save(&session);
        self.emit(AuthChangeEvent::SignedIn, Some(&session));
        *state = AuthState::SignedIn(session.clone());
        drop(state);
        self.refresh_notify.notify_waiters();
        Ok(session)
    }

    /// Aborts an in-flight flow (explicit cancel, timeout, or failure).
    pub async fn abort_oauth(&self) {
        let mut state = self.state.lock().await;
        if let AuthState::OAuthInFlight { cancel, .. } = &*state {
            cancel.notify_waiters();
            *state = AuthState::SignedOut;
        }
    }
}

async fn with_timeout<T>(fut: impl std::future::Future<Output = Result<T>>) -> Result<T> {
    match tokio::time::timeout(OP_TIMEOUT, fut).await {
        Ok(r) => r,
        Err(_) => Err(Error::network("operation timed out")),
    }
}
