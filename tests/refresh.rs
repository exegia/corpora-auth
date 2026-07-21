//! US2 tests: session refresh — manual, background task, and the
//! sign-out-vs-refresh race (FR-006 + spec consistency edge case).

mod common;

use std::sync::Arc;

use common::*;
use serde_json::json;
use tauri_plugin_supabase_auth::engine::AuthEngine;
use tauri_plugin_supabase_auth::error::ErrorKind;
use tauri_plugin_supabase_auth::persistence::MemoryStore;
use tauri_plugin_supabase_auth::state::AuthCore;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, ResponseTemplate};

async fn signed_in_harness(server: &wiremock::MockServer, h: &Harness) {
    Mock::given(method("POST"))
        .and(path("/auth/v1/token"))
        .and(query_param("grant_type", "password"))
        .respond_with(ResponseTemplate::new(200).set_body_json(gotrue_session("at0", "rt0", 3600)))
        .mount(server)
        .await;
    h.core
        .sign_in_with_password("user@example.com", "pw")
        .await
        .unwrap();
}

#[tokio::test]
async fn manual_refresh_rotates_tokens_persists_and_emits() {
    let (server, h) = mock_gotrue().await;
    signed_in_harness(&server, &h).await;

    Mock::given(method("POST"))
        .and(path("/auth/v1/token"))
        .and(query_param("grant_type", "refresh_token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(gotrue_session("at1", "rt1", 3600)))
        .mount(&server)
        .await;

    let refreshed = h.core.refresh().await.unwrap();
    assert_eq!(refreshed.access_token, "at1");
    assert!(
        h.store.raw().unwrap().contains("at1"),
        "refreshed session persisted"
    );
    assert_eq!(
        event_log(&h),
        vec![
            ("SIGNED_IN".to_string(), true),
            ("TOKEN_REFRESHED".to_string(), true)
        ]
    );
}

#[tokio::test]
async fn terminal_refresh_failure_clears_state_and_emits_signed_out() {
    let (server, h) = mock_gotrue().await;
    signed_in_harness(&server, &h).await;

    Mock::given(method("POST"))
        .and(path("/auth/v1/token"))
        .and(query_param("grant_type", "refresh_token"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({
            "code": 400, "error_code": "refresh_token_already_used",
            "msg": "Invalid Refresh Token: Already Used"
        })))
        .mount(&server)
        .await;

    let err = h.core.refresh().await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::SessionExpired);
    assert!(h.core.session().await.is_none());
    assert!(h.store.raw().is_none());
    assert_eq!(event_log(&h).last().unwrap().0, "SIGNED_OUT");
}

#[tokio::test]
async fn network_refresh_failure_keeps_current_session() {
    // Signed in on a fresh stored session, but every endpoint is unreachable.
    let h = offline_harness();
    h.store.set_raw(stored_session_json("at0", 3600));
    h.core.restore().await; // fresh session: restores without a network call

    let err = h.core.refresh().await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::Network, "message: {}", err.message);
    let session = h
        .core
        .session()
        .await
        .expect("session must survive a network blip");
    assert_eq!(session.access_token, "at0");
    assert!(h.store.raw().is_some());
}

#[tokio::test]
async fn sign_out_racing_refresh_always_ends_signed_out() {
    let (server, h) = mock_gotrue().await;
    signed_in_harness(&server, &h).await;

    // Slow refresh: sign-out arrives while it is in flight.
    Mock::given(method("POST"))
        .and(path("/auth/v1/token"))
        .and(query_param("grant_type", "refresh_token"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(gotrue_session("at1", "rt1", 3600))
                .set_delay(std::time::Duration::from_millis(300)),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/logout"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let core = h.core.clone();
    let refresh_task = tokio::spawn(async move { core.refresh().await });
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    h.core.sign_out().await.unwrap();
    let _ = refresh_task.await.unwrap();

    // Single-writer guarantee: whatever interleaving occurred, the final
    // state is fully signed out and the store is empty.
    assert!(h.core.session().await.is_none());
    assert!(h.store.raw().is_none());
    assert_eq!(event_log(&h).last().unwrap().0, "SIGNED_OUT");
}

#[tokio::test]
async fn background_task_refreshes_before_expiry() {
    let server = wiremock::MockServer::start().await;
    // Config with auto-refresh on and a short buffer, session expiring soon.
    let store = Arc::new(MemoryStore::new());
    let mut config = config_for(&server.uri());
    config.auto_refresh = true;
    config.refresh_buffer_secs = 1;
    let engine = AuthEngine::new(&server.uri(), "test-anon-key").unwrap();
    let core = Arc::new(AuthCore::new(
        engine,
        config,
        Box::new(SharedStore(store.clone())),
    ));

    Mock::given(method("POST"))
        .and(path("/auth/v1/token"))
        .and(query_param("grant_type", "password"))
        .respond_with(ResponseTemplate::new(200).set_body_json(gotrue_session("at0", "rt0", 2)))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/token"))
        .and(query_param("grant_type", "refresh_token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(gotrue_session("at1", "rt1", 3600)))
        .expect(1..)
        .mount(&server)
        .await;

    tauri_plugin_supabase_auth::refresh::spawn(core.clone());
    core.sign_in_with_password("user@example.com", "pw")
        .await
        .unwrap();

    // Token expires in 2s with a 1s buffer: the task must refresh within ~3s.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        if let Some(s) = core.session().await {
            if s.access_token == "at1" {
                break;
            }
        }
        assert!(
            std::time::Instant::now() < deadline,
            "background refresh did not happen"
        );
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}
