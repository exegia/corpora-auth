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
        let result = crate::oauth::run_flow(
            &self.core,
            provider,
            scopes,
            crate::oauth::FlowKind::SignIn,
            cancel,
            |url| {
                open::that_detached(&url).map_err(|e| {
                    crate::error::Error::oauth_interrupted(format!("failed to open browser: {e}"))
                })
            },
        )
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

    // -- identity management (feature 003) -----------------------------------

    pub async fn identities(&self) -> Result<Vec<crate::models::Identity>> {
        self.core.get_identities().await
    }

    /// Links a provider identity to the current account: authenticated
    /// authorize → system browser → loopback → PKCE exchange (same user).
    /// Returns the refreshed identity list.
    pub async fn link_identity(
        &self,
        provider: &str,
        scopes: Option<Vec<String>>,
    ) -> Result<Vec<crate::models::Identity>> {
        let (access_token, cancel) = self.core.begin_link().await?;
        let result = crate::oauth::run_flow(
            &self.core,
            provider,
            scopes,
            crate::oauth::FlowKind::Link { access_token },
            cancel,
            |url| {
                open::that_detached(&url).map_err(|e| {
                    crate::error::Error::oauth_interrupted(format!("failed to open browser: {e}"))
                })
            },
        )
        .await;
        match result {
            Ok(session) => {
                self.core.complete_link(session).await?;
                self.core.get_identities().await
            }
            Err(e) => {
                // The account and current session are untouched (FR-006);
                // only the transient flow state is cleared.
                self.core.abort_link().await;
                Err(e)
            }
        }
    }

    pub async fn unlink_identity(&self, identity_id: &str) -> Result<Vec<crate::models::Identity>> {
        self.core.unlink_identity(identity_id).await
    }

    // -- passkeys (feature 004) -----------------------------------------------

    pub fn passkey_capability(&self) -> crate::models::PasskeyCapability {
        self.core.passkey_capability()
    }

    /// Full registration round-trip: challenge → OS prompt → verify.
    pub async fn register_passkey(&self) -> Result<crate::models::PasskeyRegistrationResult> {
        self.core.register_passkey().await
    }

    /// Full discoverable sign-in round-trip. Rust callers get the full
    /// session inside the result via `session()` afterwards; the result
    /// itself carries the sanitized shape.
    pub async fn sign_in_with_passkey(&self) -> Result<crate::models::PasskeySignInResult> {
        self.core.sign_in_with_passkey().await
    }

    pub async fn list_passkeys(&self) -> Result<Vec<crate::models::Passkey>> {
        self.core.list_passkeys().await
    }

    pub async fn rename_passkey(
        &self,
        passkey_id: &str,
        friendly_name: &str,
    ) -> Result<crate::models::Passkey> {
        self.core.rename_passkey(passkey_id, friendly_name).await
    }

    pub async fn delete_passkey(&self, passkey_id: &str) -> Result<()> {
        self.core.delete_passkey(passkey_id).await
    }

    // Two-step surface (app-supplied ceremony, US4).

    pub async fn passkey_registration_options(&self) -> Result<crate::models::PasskeyChallenge> {
        self.core.passkey_registration_options().await
    }

    pub async fn passkey_registration_verify(
        &self,
        challenge_id: &str,
        credential: &serde_json::Value,
    ) -> Result<crate::models::Passkey> {
        self.core
            .passkey_registration_verify(challenge_id, credential)
            .await
    }

    pub async fn passkey_authentication_options(&self) -> Result<crate::models::PasskeyChallenge> {
        self.core.passkey_authentication_options().await
    }

    pub async fn passkey_authentication_verify(
        &self,
        challenge_id: &str,
        credential: &serde_json::Value,
    ) -> Result<Session> {
        self.core
            .passkey_authentication_verify(challenge_id, credential)
            .await
    }
}
