//! Desktop implementation: the managed `SupabaseAuth` handle exposing the
//! full Rust-side API (FR-002 backend access). Rust callers receive full
//! sessions (including refresh tokens); the sanitization boundary is in
//! `commands.rs`.

use std::sync::Arc;

use tauri::{AppHandle, Runtime};

use crate::engine::{OtpKind, OtpTarget};
use crate::error::Result;
use crate::models::{AuthChangePayload, Session, SignUpResult, User};
use crate::state::{AuthCore, ListenerHandle};

pub struct SupabaseAuth<R: Runtime> {
    #[allow(dead_code)]
    app: AppHandle<R>,
    core: Arc<AuthCore>,
}

impl<R: Runtime> SupabaseAuth<R> {
    pub(crate) fn new(app: AppHandle<R>, core: Arc<AuthCore>) -> Self {
        Self { app, core }
    }

    pub(crate) fn core(&self) -> &Arc<AuthCore> {
        &self.core
    }

    // -- Rust-side API (mirrors the command surface) -------------------------

    pub async fn sign_up(
        &self,
        email: &str,
        password: &str,
        data: Option<serde_json::Value>,
    ) -> Result<SignUpResult> {
        self.core.sign_up(email, password, data).await
    }

    pub async fn sign_in_with_password(&self, email: &str, password: &str) -> Result<Session> {
        self.core.sign_in_with_password(email, password).await
    }

    pub async fn sign_in_with_otp(
        &self,
        target: OtpTarget,
        redirect_to: Option<String>,
    ) -> Result<()> {
        self.core.request_otp(target, redirect_to).await
    }

    pub async fn verify_otp(
        &self,
        target: OtpTarget,
        token: &str,
        kind: OtpKind,
    ) -> Result<Session> {
        self.core.verify_otp(target, token, kind).await
    }

    pub async fn sign_out(&self) -> Result<()> {
        self.core.sign_out().await
    }

    pub async fn session(&self) -> Option<Session> {
        self.core.session().await
    }

    pub async fn user(&self) -> Option<User> {
        self.core.user().await
    }

    pub async fn refresh_session(&self) -> Result<Session> {
        self.core.refresh().await
    }

    pub async fn reset_password_for_email(
        &self,
        email: &str,
        redirect_to: Option<String>,
    ) -> Result<()> {
        self.core.reset_password_for_email(email, redirect_to).await
    }

    pub async fn update_user(
        &self,
        email: Option<String>,
        password: Option<String>,
        data: Option<serde_json::Value>,
    ) -> Result<User> {
        self.core.update_user(email, password, data).await
    }

    /// Registers a Rust-side auth state listener.
    pub fn on_auth_state_change<F>(&self, cb: F) -> ListenerHandle
    where
        F: Fn(&AuthChangePayload) + Send + Sync + 'static,
    {
        self.core.on_auth_state_change(cb)
    }

    pub fn remove_auth_listener(&self, handle: ListenerHandle) {
        self.core.remove_listener(handle)
    }

    /// Runs the full OAuth round-trip (system browser + loopback + PKCE).
    pub async fn start_oauth_flow(
        &self,
        provider: &str,
        scopes: Option<Vec<String>>,
    ) -> Result<Session> {
        let cancel = self.core.begin_oauth(provider).await?;
        let result = crate::oauth::run_flow(&self.core, provider, scopes, cancel, |url| {
            open::that_detached(&url).map_err(|e| {
                crate::error::Error::oauth_interrupted(format!("failed to open browser: {e}"))
            })
        })
        .await;
        match result {
            Ok(session) => self.core.complete_oauth(session).await,
            Err(e) => {
                self.core.abort_oauth().await;
                Err(e)
            }
        }
    }

    pub async fn cancel_oauth_flow(&self) {
        self.core.abort_oauth().await;
    }
}
