//! Shared harness for contract tests: wiremock GoTrue + AuthCore factory.
#![allow(dead_code)] // each test binary uses a different subset of helpers

use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri_plugin_supabase_auth::ceremony::{Availability, CeremonyOutcome, CeremonyProvider};
use tauri_plugin_supabase_auth::config::{SessionPersistence, ValidatedConfig};
use tauri_plugin_supabase_auth::engine::AuthEngine;
use tauri_plugin_supabase_auth::models::{AuthChangePayload, Session};
use tauri_plugin_supabase_auth::persistence::{MemoryStore, SessionStore};
use tauri_plugin_supabase_auth::state::AuthCore;
use wiremock::MockServer;

pub struct Harness {
    pub core: Arc<AuthCore>,
    pub store: Arc<MemoryStore>,
    pub events: Arc<Mutex<Vec<AuthChangePayload>>>,
}

/// `SessionStore` view over a shared `MemoryStore` so tests can inspect it.
pub struct SharedStore(pub Arc<MemoryStore>);

impl SessionStore for SharedStore {
    fn load(&self) -> Option<Session> {
        self.0.load()
    }
    fn save(&self, session: &Session) {
        self.0.save(session)
    }
    fn clear(&self) {
        self.0.clear()
    }
}

pub fn config_for(url: &str) -> ValidatedConfig {
    ValidatedConfig {
        url: url.trim_end_matches('/').to_string(),
        publishable_key: "test-anon-key".into(),
        session_persistence: SessionPersistence::None, // store is injected directly
        auto_refresh: false,                           // refresh task not under test
        refresh_buffer_secs: 60,
        callback_ports: vec![0], // unused unless a test overrides
        flow_timeout_secs: 300,
        passkey_origin: None,
    }
}

pub fn harness_for(url: &str) -> Harness {
    let store = Arc::new(MemoryStore::new());
    let engine = AuthEngine::new(url, "test-anon-key").expect("engine");
    let core = Arc::new(AuthCore::new(
        engine,
        config_for(url),
        Box::new(SharedStore(store.clone())),
    ));
    let events: Arc<Mutex<Vec<AuthChangePayload>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    core.on_auth_state_change(move |p| sink.lock().unwrap().push(p.clone()));
    Harness {
        core,
        store,
        events,
    }
}

pub async fn mock_gotrue() -> (MockServer, Harness) {
    let server = MockServer::start().await;
    let h = harness_for(&server.uri());
    (server, h)
}

/// A harness pointing at a closed port: every request is a connect error.
pub fn offline_harness() -> Harness {
    harness_for("http://127.0.0.1:9") // discard port; nothing listens
}

/// GoTrue user object (snake_case wire shape).
pub fn gotrue_user() -> Value {
    json!({
        "id": "11111111-2222-3333-4444-555555555555",
        "email": "user@example.com",
        "phone": null,
        "email_confirmed_at": "2026-07-20T10:00:00Z",
        "phone_confirmed_at": null,
        "created_at": "2026-07-20T10:00:00Z",
        "updated_at": "2026-07-20T10:00:00Z",
        "last_sign_in_at": "2026-07-20T10:00:00Z",
        "app_metadata": { "provider": "email" },
        "user_metadata": {},
        "aud": "authenticated",
        "role": "authenticated"
    })
}

/// GoTrue session response (what /token, /signup-with-autoconfirm, /verify return).
pub fn gotrue_session(access_token: &str, refresh_token: &str, expires_in_secs: i64) -> Value {
    json!({
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": expires_in_secs,
        "expires_at": chrono::Utc::now().timestamp() + expires_in_secs,
        "refresh_token": refresh_token,
        "user": gotrue_user()
    })
}

/// GoTrue identity object as it appears on `user.identities` (snake_case).
/// Note: `id` is the provider subject; `identity_id` is the row UUID.
pub fn gotrue_identity(provider: &str, identity_id: &str) -> Value {
    json!({
        "identity_id": identity_id,
        "id": format!("{provider}-subject-1"),
        "user_id": "11111111-2222-3333-4444-555555555555",
        "provider": provider,
        "identity_data": { "sub": format!("{provider}-subject-1"), "email": "user@example.com" },
        "email": "user@example.com",
        "created_at": "2026-07-20T10:00:00Z",
        "updated_at": "2026-07-20T10:00:00Z",
        "last_sign_in_at": "2026-07-20T10:00:00Z"
    })
}

/// `GET /auth/v1/user` response body carrying the given identities.
pub fn gotrue_user_with_identities(identities: &[Value]) -> Value {
    let mut user = gotrue_user();
    user["identities"] = json!(identities);
    user
}

/// `GET /auth/v1/user/identities/authorize` JSON response (skip_http_redirect).
pub fn gotrue_authorize_response(provider_url: &str) -> Value {
    json!({ "url": provider_url })
}

/// Plugin-format (camelCase) session JSON as the stores persist it.
pub fn stored_session_json(access_token: &str, expires_in_secs: i64) -> String {
    json!({
        "accessToken": access_token,
        "refreshToken": "stored-refresh-token",
        "expiresAt": (chrono::Utc::now() + chrono::Duration::seconds(expires_in_secs))
            .to_rfc3339(),
        "tokenType": "bearer",
        "user": {
            "id": "11111111-2222-3333-4444-555555555555",
            "email": "user@example.com",
            "phone": null,
            "emailConfirmedAt": null,
            "phoneConfirmedAt": null,
            "lastSignInAt": null,
            "createdAt": "2026-07-20T10:00:00Z",
            "updatedAt": "2026-07-20T10:00:00Z",
            "userMetadata": {},
            "appMetadata": {}
        }
    })
    .to_string()
}

// -- passkeys (feature 004) ---------------------------------------------------

/// `POST /passkeys/registration/options` response: bare go-webauthn
/// `PublicKeyCredentialCreationOptions` (NOT `{"publicKey": ...}`-wrapped).
pub fn gotrue_registration_options(challenge_id: &str) -> Value {
    json!({
        "challenge_id": challenge_id,
        "options": {
            "rp": { "id": "example.com", "name": "Example" },
            "user": {
                "id": "MTExMTExMTEtMjIyMi0zMzMzLTQ0NDQtNTU1NTU1NTU1NTU1",
                "name": "user@example.com",
                "displayName": "user@example.com"
            },
            "challenge": "dGVzdC1jaGFsbGVuZ2UtYnl0ZXM",
            "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }],
            "timeout": 300000,
            "excludeCredentials": [],
            "authenticatorSelection": {
                "residentKey": "required",
                "userVerification": "preferred"
            },
            "attestation": "none"
        },
        "expires_at": chrono::Utc::now().timestamp() + 300
    })
}

/// `POST /passkeys/authentication/options` response (discoverable: empty
/// allowCredentials).
pub fn gotrue_authentication_options(challenge_id: &str) -> Value {
    json!({
        "challenge_id": challenge_id,
        "options": {
            "challenge": "dGVzdC1hdXRoLWNoYWxsZW5nZQ",
            "timeout": 300000,
            "rpId": "example.com",
            "allowCredentials": [],
            "userVerification": "preferred"
        },
        "expires_at": chrono::Utc::now().timestamp() + 300
    })
}

/// GoTrue `PasskeyListItem` (also the registration-verify response shape).
pub fn gotrue_passkey(id: &str, friendly_name: Option<&str>) -> Value {
    let mut v = json!({
        "id": id,
        "created_at": "2026-07-21T10:00:00Z",
        "last_used_at": null
    });
    if let Some(name) = friendly_name {
        v["friendly_name"] = json!(name);
    }
    v
}

/// GoTrue error body with an `error_code`, as `ok_or_classified` sees it.
pub fn gotrue_error(error_code: &str, msg: &str) -> Value {
    json!({ "code": 400, "error_code": error_code, "msg": msg })
}

/// Fixture WebAuthn credential JSON, shaped like `navigator.credentials`
/// output. Content is opaque to the plugin (passed through verbatim).
pub fn fixture_credential(kind: &str) -> String {
    json!({
        "id": "dGVzdC1jcmVkLWlk",
        "rawId": "dGVzdC1jcmVkLWlk",
        "type": "public-key",
        "response": if kind == "create" {
            json!({
                "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0",
                "attestationObject": "b2JqZWN0"
            })
        } else {
            json!({
                "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0",
                "authenticatorData": "ZGF0YQ",
                "signature": "c2ln",
                "userHandle": "MTExMTExMTEtMjIyMi0zMzMzLTQ0NDQtNTU1NTU1NTU1NTU1"
            })
        }
    })
    .to_string()
}

/// Deterministic, scriptable ceremony provider (research R9): headless
/// stand-in for the OS prompt. Records the options it received.
pub struct SoftwareCeremony {
    pub availability: Availability,
    pub create_outcome: CeremonyOutcome,
    pub get_outcome: CeremonyOutcome,
    pub seen_options: Arc<Mutex<Vec<(String, String)>>>, // (op, options_json)
}

impl SoftwareCeremony {
    /// Completes both ceremonies with fixture credentials.
    pub fn completing() -> Self {
        Self {
            availability: Availability::Available,
            create_outcome: CeremonyOutcome::Completed(fixture_credential("create")),
            get_outcome: CeremonyOutcome::Completed(fixture_credential("get")),
            seen_options: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// User dismisses every prompt.
    pub fn cancelling() -> Self {
        Self {
            create_outcome: CeremonyOutcome::Cancelled,
            get_outcome: CeremonyOutcome::Cancelled,
            ..Self::completing()
        }
    }

    pub fn install(self, h: &Harness) -> Arc<Mutex<Vec<(String, String)>>> {
        let seen = self.seen_options.clone();
        h.core.set_ceremony_provider(Arc::new(self));
        seen
    }
}

impl CeremonyProvider for SoftwareCeremony {
    fn availability(&self) -> Availability {
        self.availability.clone()
    }
    fn create(&self, options_json: &str) -> CeremonyOutcome {
        self.seen_options
            .lock()
            .unwrap()
            .push(("create".into(), options_json.to_string()));
        self.create_outcome.clone()
    }
    fn get(&self, options_json: &str) -> CeremonyOutcome {
        self.seen_options
            .lock()
            .unwrap()
            .push(("get".into(), options_json.to_string()));
        self.get_outcome.clone()
    }
}

/// Events captured so far, as (event-name, has-session) pairs for easy asserts.
pub fn event_log(h: &Harness) -> Vec<(String, bool)> {
    h.events
        .lock()
        .unwrap()
        .iter()
        .map(|p| {
            (
                serde_json::to_value(p.event)
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .to_string(),
                p.session.is_some(),
            )
        })
        .collect()
}
