//! SC-006 lifecycle E2E: register → sign in → restart-restore → reset
//! password → sign out, against a REAL Supabase stack (`supabase start`).
//!
//! Ignored by default; enable by setting the stack's URL and anon key:
//! `SUPABASE_E2E_URL=http://127.0.0.1:54321 SUPABASE_E2E_KEY=<anon> \
//!    cargo test --test e2e_lifecycle -- --ignored`
//! Requires the local stack's inbucket/mailpit for the recovery email; the
//! reset step is exercised via the recovery-request endpoint only (code
//! redemption needs mailbox scraping, covered by quickstart Scenario 4).

mod common;

use std::sync::Arc;

use common::SharedStore;
use tauri_plugin_supabase_auth::config::{SessionPersistence, ValidatedConfig};
use tauri_plugin_supabase_auth::engine::AuthEngine;
use tauri_plugin_supabase_auth::persistence::MemoryStore;
use tauri_plugin_supabase_auth::state::AuthCore;

fn env_config() -> Option<(String, String)> {
    Some((
        std::env::var("SUPABASE_E2E_URL").ok()?,
        std::env::var("SUPABASE_E2E_KEY").ok()?,
    ))
}

fn build_core(url: &str, key: &str, store: Arc<MemoryStore>) -> Arc<AuthCore> {
    let config = ValidatedConfig {
        url: url.trim_end_matches('/').to_string(),
        publishable_key: key.to_string(),
        session_persistence: SessionPersistence::None,
        auto_refresh: false,
        refresh_buffer_secs: 60,
        callback_ports: vec![43823],
        flow_timeout_secs: 60,
        passkey_origin: None,
    };
    let engine = AuthEngine::new(url, key).unwrap();
    Arc::new(AuthCore::new(engine, config, Box::new(SharedStore(store))))
}

#[tokio::test]
#[ignore = "needs a live Supabase stack (SUPABASE_E2E_URL / SUPABASE_E2E_KEY)"]
async fn full_lifecycle_against_live_stack() {
    let Some((url, key)) = env_config() else {
        panic!("set SUPABASE_E2E_URL and SUPABASE_E2E_KEY to run the E2E");
    };

    let email = format!(
        "e2e-{}@example.com",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let password = "e2e-password-123!";
    let store = Arc::new(MemoryStore::new());

    // Register (local stack autoconfirms by default).
    let core = build_core(&url, &key, store.clone());
    let result = core.sign_up(&email, password, None).await.unwrap();
    eprintln!("sign_up status: {:?}", result.status);

    // Sign in.
    let session = core.sign_in_with_password(&email, password).await.unwrap();
    assert_eq!(session.user.email.as_deref(), Some(email.as_str()));
    assert!(store.raw().is_some(), "session persisted");

    // "Restart": a brand-new core sharing only the persisted store.
    let core2 = build_core(&url, &key, store.clone());
    core2.restore().await;
    let restored = core2.session().await.expect("restart-restore (SC-004)");
    assert_eq!(restored.user.email.as_deref(), Some(email.as_str()));

    // Identity management smoke (feature 003): an email registration
    // carries exactly one identity, provider "email".
    let identities = core2.get_identities().await.unwrap();
    assert_eq!(identities.len(), 1, "email signup yields one identity");
    assert_eq!(identities[0].provider, "email");

    // Passkey management smoke (feature 004): with passkeys enabled the list
    // is empty for a fresh user; with them disabled the error is the
    // actionable configuration kind (FR-010). Ceremony-dependent flows are
    // covered by the quickstart native smoke checklist.
    match core2.list_passkeys().await {
        Ok(passkeys) => assert!(passkeys.is_empty(), "fresh user has no passkeys"),
        Err(e) => {
            assert_eq!(
                e.kind,
                tauri_plugin_supabase_auth::error::ErrorKind::Configuration,
                "unexpected passkey list failure: {e:?}"
            );
            eprintln!(
                "passkeys disabled on this stack; smoke skipped: {}",
                e.message
            );
        }
    }

    // Refresh works against the live stack.
    let refreshed = core2.refresh().await.unwrap();
    assert_ne!(refreshed.access_token, session.access_token);

    // Password recovery request is accepted.
    core2.reset_password_for_email(&email, None).await.unwrap();

    // Sign out terminates the session and clears the store.
    core2.sign_out().await.unwrap();
    assert!(core2.session().await.is_none());
    assert!(store.raw().is_none());
}
