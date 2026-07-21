//! US1 contract tests: email/password lifecycle against a mocked GoTrue.

mod common;

use common::*;
use serde_json::json;
use tauri_plugin_supabase_auth::error::ErrorKind;
use tauri_plugin_supabase_auth::models::SignUpStatus;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, ResponseTemplate};

#[tokio::test]
async fn sign_up_with_autoconfirm_signs_in() {
    let (server, h) = mock_gotrue().await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/signup"))
        .respond_with(ResponseTemplate::new(200).set_body_json(gotrue_session("at1", "rt1", 3600)))
        .mount(&server)
        .await;

    let result = h
        .core
        .sign_up("user@example.com", "hunter22", None)
        .await
        .unwrap();
    assert_eq!(result.status, SignUpStatus::SignedIn);
    assert!(result.session.is_some());

    // State, persistence, and events all reflect the sign-in (FR-001, FR-004).
    assert!(h.core.session().await.is_some());
    assert!(h.store.raw().is_some(), "session must be persisted");
    assert_eq!(event_log(&h), vec![("SIGNED_IN".to_string(), true)]);
}

#[tokio::test]
async fn sign_up_requiring_confirmation_reports_pending() {
    let (server, h) = mock_gotrue().await;
    // Confirmation-required projects return a bare user object (no tokens).
    Mock::given(method("POST"))
        .and(path("/auth/v1/signup"))
        .respond_with(ResponseTemplate::new(200).set_body_json(gotrue_user()))
        .mount(&server)
        .await;

    let result = h
        .core
        .sign_up("user@example.com", "hunter22", None)
        .await
        .unwrap();
    assert_eq!(result.status, SignUpStatus::PendingConfirmation);
    assert!(result.session.is_none());
    assert!(h.core.session().await.is_none());
    assert!(event_log(&h).is_empty(), "no SIGNED_IN until confirmed");
}

#[tokio::test]
async fn sign_up_existing_email_is_categorized_without_enumeration() {
    let (server, h) = mock_gotrue().await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/signup"))
        .respond_with(ResponseTemplate::new(422).set_body_json(json!({
            "code": 422, "error_code": "user_already_exists",
            "msg": "User already registered"
        })))
        .mount(&server)
        .await;

    let err = h
        .core
        .sign_up("user@example.com", "hunter22", None)
        .await
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::EmailAlreadyRegistered);
}

#[tokio::test]
async fn sign_in_success_exposes_identity_and_emits() {
    let (server, h) = mock_gotrue().await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/token"))
        .and(query_param("grant_type", "password"))
        .respond_with(ResponseTemplate::new(200).set_body_json(gotrue_session("at1", "rt1", 3600)))
        .mount(&server)
        .await;

    let session = h
        .core
        .sign_in_with_password("user@example.com", "hunter22")
        .await
        .unwrap();
    assert_eq!(session.user.email.as_deref(), Some("user@example.com"));

    let user = h
        .core
        .user()
        .await
        .expect("current user available on demand (FR-003)");
    assert_eq!(user.id, "11111111-2222-3333-4444-555555555555");
    assert_eq!(event_log(&h), vec![("SIGNED_IN".to_string(), true)]);

    // The webview-facing shape must never contain the refresh token.
    let sanitized = serde_json::to_value(h.core.sanitized_session().await.unwrap()).unwrap();
    assert!(sanitized.get("refreshToken").is_none());
    assert!(!sanitized.to_string().contains("rt1"));
}

#[tokio::test]
async fn sign_in_wrong_password_maps_to_invalid_credentials() {
    let (server, h) = mock_gotrue().await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/token"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({
            "code": 400, "error_code": "invalid_credentials",
            "msg": "Invalid login credentials"
        })))
        .mount(&server)
        .await;

    let err = h
        .core
        .sign_in_with_password("user@example.com", "wrong")
        .await
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::InvalidCredentials);
    assert!(h.core.session().await.is_none(), "no session on failure");
    assert!(event_log(&h).is_empty());
}

#[tokio::test]
async fn sign_out_clears_state_store_and_emits() {
    let (server, h) = mock_gotrue().await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(gotrue_session("at1", "rt1", 3600)))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/logout"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    h.core
        .sign_in_with_password("user@example.com", "hunter22")
        .await
        .unwrap();
    h.core.sign_out().await.unwrap();

    assert!(h.core.session().await.is_none());
    assert!(h.core.user().await.is_none());
    assert!(
        h.store.raw().is_none(),
        "stored session must be deleted (FR-007)"
    );
    assert_eq!(
        event_log(&h),
        vec![
            ("SIGNED_IN".to_string(), true),
            ("SIGNED_OUT".to_string(), false)
        ]
    );
}

#[tokio::test]
async fn offline_sign_in_fails_fast_with_network_kind() {
    let h = offline_harness();
    let started = std::time::Instant::now();
    let err = h
        .core
        .sign_in_with_password("user@example.com", "pw")
        .await
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::Network);
    assert!(
        started.elapsed() < std::time::Duration::from_secs(16),
        "must fail within the operation budget (SC-003), took {:?}",
        started.elapsed()
    );
}
