//! Supabase authentication plugin for Tauri v2 desktop apps.
//!
//! Exposes the full authentication lifecycle (email/password, magic link/OTP,
//! third-party OAuth via PKCE + system browser, password recovery, persistent
//! auto-refreshing sessions) to both Rust and webview code.
//!
//! Configuration lives under `plugins.supabase-auth` in `tauri.conf.json` and
//! is validated at startup — malformed configuration aborts app launch with an
//! actionable message rather than failing at first sign-in (FR-012).

use std::sync::Arc;

use tauri::{
    plugin::{Builder, TauriPlugin},
    Emitter, Manager, Runtime,
};

mod commands;
mod desktop;

pub mod ceremony;
pub mod config;
pub mod error;
pub mod models;
pub mod persistence;

// Internal machinery, public for integration tests and advanced embedding.
#[doc(hidden)]
pub mod engine;
#[doc(hidden)]
pub mod oauth;
#[doc(hidden)]
pub mod refresh;
#[doc(hidden)]
pub mod state;

pub use ceremony::{Availability, CeremonyOutcome, CeremonyProvider};
pub use config::{PluginConfig, SessionPersistence, ValidatedConfig};
pub use desktop::SupabaseAuth;
pub use engine::{OtpKind, OtpTarget};
pub use error::{Error, ErrorKind, Result};
pub use models::{
    AuthChangeEvent, AuthChangePayload, Passkey, PasskeyCapability, PasskeyChallenge,
    PasskeyFlowStatus, PasskeyRegistrationResult, PasskeySignInResult, SanitizedSession, Session,
    SignUpResult, SignUpStatus, User,
};
pub use state::ListenerHandle;

/// Event emitted to the webview on every auth state transition (FR-004).
pub const AUTH_CHANGED_EVENT: &str = "supabase-auth://auth-state-changed";

/// Extension trait giving Rust code access to the plugin (`app.supabase_auth()`).
pub trait SupabaseAuthExt<R: Runtime> {
    fn supabase_auth(&self) -> &SupabaseAuth<R>;
}

impl<R: Runtime, T: Manager<R>> SupabaseAuthExt<R> for T {
    fn supabase_auth(&self) -> &SupabaseAuth<R> {
        self.state::<SupabaseAuth<R>>().inner()
    }
}

/// Initializes the plugin with defaults. Configuration is read from
/// `tauri.conf.json`. To supply a custom passkey ceremony, use
/// [`PluginBuilder::ceremony_provider`] instead.
pub fn init<R: Runtime>() -> TauriPlugin<R, PluginConfig> {
    PluginBuilder::new().build()
}

/// Plugin builder for optional extension points (feature 004).
#[derive(Default)]
pub struct PluginBuilder {
    ceremony: Option<Arc<dyn ceremony::CeremonyProvider>>,
}

impl PluginBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Supplies a WebAuthn ceremony provider. Takes precedence over the
    /// built-in provider for the target OS (FR-006).
    pub fn ceremony_provider(
        mut self,
        provider: impl ceremony::CeremonyProvider + 'static,
    ) -> Self {
        self.ceremony = Some(Arc::new(provider));
        self
    }

    pub fn build<R: Runtime>(self) -> TauriPlugin<R, PluginConfig> {
        let supplied_ceremony = self.ceremony;
        Builder::<R, PluginConfig>::new("supabase-auth")
            .invoke_handler(tauri::generate_handler![
                commands::sign_up,
                commands::sign_in_with_password,
                commands::sign_in_with_otp,
                commands::verify_otp,
                commands::start_oauth_flow,
                commands::cancel_oauth_flow,
                commands::sign_out,
                commands::get_session,
                commands::get_user,
                commands::refresh_session,
                commands::reset_password_for_email,
                commands::update_user,
                commands::get_identities,
                commands::link_identity,
                commands::unlink_identity,
                commands::get_passkey_capability,
                commands::register_passkey,
                commands::sign_in_with_passkey,
                commands::list_passkeys,
                commands::rename_passkey,
                commands::delete_passkey,
                commands::passkey_registration_options,
                commands::passkey_registration_verify,
                commands::passkey_authentication_options,
                commands::passkey_authentication_verify,
            ])
            .setup(move |app, api| {
                let config = api.config().clone().validate()?;

                let store: Box<dyn persistence::SessionStore> = match config.session_persistence {
                    SessionPersistence::Keychain => {
                        Box::new(persistence::KeychainStore::new(&app.config().identifier))
                    }
                    SessionPersistence::File => {
                        let dir = app.path().app_data_dir().map_err(|e| {
                            Error::configuration(format!(
                            "supabase-auth: cannot resolve app data dir for file persistence: {e}"
                        ))
                        })?;
                        Box::new(persistence::FileStore::new(dir))
                    }
                    SessionPersistence::None => Box::new(persistence::NoneStore),
                };

                let engine = engine::AuthEngine::new(&config.url, &config.publishable_key)?;
                let core = Arc::new(state::AuthCore::new(engine, config, store));
                if let Some(provider) = supplied_ceremony {
                    core.set_ceremony_provider(provider);
                }
                if let Some(builtin) =
                    ceremony::builtin_provider(core.config.passkey_origin.as_deref())
                {
                    core.set_builtin_ceremony(builtin);
                }

                // Forward every transition to the webview (FR-004).
                let emitter = app.clone();
                core.on_auth_state_change(move |payload| {
                    if let Err(e) = emitter.emit(AUTH_CHANGED_EVENT, payload.clone()) {
                        tracing::warn!("failed to emit auth event: {e}");
                    }
                });

                // Restore any persisted session (US2), then keep it fresh (FR-006).
                let restore_core = core.clone();
                tauri::async_runtime::spawn(async move {
                    restore_core.restore().await;
                });
                refresh::spawn(core.clone());

                app.manage(SupabaseAuth::new(app.clone(), core));
                Ok(())
            })
            .build()
    }
}

#[cfg(test)]
pub(crate) mod test_fixtures {
    use serde_json::json;

    /// Raw camelCase session JSON as persisted by the stores.
    pub fn session_json(access_token: &str, expires_in_secs: i64) -> serde_json::Value {
        json!({
            "accessToken": access_token,
            "refreshToken": "refresh-token",
            "expiresAt": (chrono::Utc::now() + chrono::Duration::seconds(expires_in_secs))
                .to_rfc3339(),
            "tokenType": "bearer",
            "user": {
                "id": "00000000-0000-0000-0000-000000000001",
                "email": "user@example.com",
                "phone": null,
                "emailConfirmedAt": null,
                "phoneConfirmedAt": null,
                "lastSignInAt": null,
                "createdAt": chrono::Utc::now().to_rfc3339(),
                "updatedAt": chrono::Utc::now().to_rfc3339(),
                "userMetadata": {},
                "appMetadata": {}
            }
        })
    }
}
