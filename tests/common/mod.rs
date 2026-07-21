//! Shared harness for contract tests: wiremock GoTrue + AuthCore factory.
#![allow(dead_code)] // each test binary uses a different subset of helpers

use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
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
