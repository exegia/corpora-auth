//! US4 tests: password recovery and account management (FR-008).
//!
//! Capability-set rejection (FR-013) is enforced by the Tauri permission
//! layer, not plugin code; it is exercised manually via quickstart Scenario 4
//! (removing `supabase-auth:allow-update-user` from the example capabilities).

mod common;

use common::*;
use serde_json::json;
use tauri_plugin_supabase_auth::engine::{OtpKind, OtpTarget};
use tauri_plugin_supabase_auth::error::ErrorKind;
use wiremock::matchers::{body_partial_json, header, method, path};
use wiremock::{Mock, ResponseTemplate};

#[tokio::test]
async fn reset_password_hits_recover_endpoint() {
    let (server, h) = mock_gotrue().await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/recover"))
        .and(body_partial_json(json!({ "email": "user@example.com" })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
        .expect(1)
        .mount(&server)
        .await;

    h.core
        .reset_password_for_email("user@example.com", None)
        .await
        .unwrap();
    // Mock::expect(1) verifies the contract on drop.
}

#[tokio::test]
async fn recovery_code_verification_establishes_session_and_emits_password_recovery() {
    let (server, h) = mock_gotrue().await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/verify"))
        .and(body_partial_json(json!({
            "type": "recovery", "email": "user@example.com", "token": "123456"
        })))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(gotrue_session("rec-at", "rec-rt", 3600)),
        )
        .mount(&server)
        .await;

    let session = h
        .core
        .verify_otp(
            OtpTarget::Email("user@example.com".into()),
            "123456",
            OtpKind::Recovery,
        )
        .await
        .unwrap();
    assert_eq!(session.access_token, "rec-at");
    assert_eq!(event_log(&h), vec![("PASSWORD_RECOVERY".to_string(), true)]);
    assert!(
        h.core.session().await.is_some(),
        "recovery session usable for password update"
    );
}

#[tokio::test]
async fn update_user_requires_signed_in_state() {
    let (_server, h) = mock_gotrue().await;
    let err = h
        .core
        .update_user(None, Some("newpassword".into()), None)
        .await
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::SessionExpired);
}

#[tokio::test]
async fn update_user_sends_bearer_and_returns_updated_user() {
    let (server, h) = mock_gotrue().await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(gotrue_session("at0", "rt0", 3600)))
        .mount(&server)
        .await;
    h.core
        .sign_in_with_password("user@example.com", "pw")
        .await
        .unwrap();

    let mut updated = gotrue_user();
    updated["email"] = json!("new@example.com");
    Mock::given(method("PUT"))
        .and(path("/auth/v1/user"))
        .and(header("authorization", "Bearer at0"))
        .and(body_partial_json(json!({ "email": "new@example.com" })))
        .respond_with(ResponseTemplate::new(200).set_body_json(updated))
        .expect(1)
        .mount(&server)
        .await;

    let user = h
        .core
        .update_user(Some("new@example.com".into()), None, None)
        .await
        .unwrap();
    assert_eq!(user.email.as_deref(), Some("new@example.com"));

    // The in-state session now carries the updated identity.
    assert_eq!(
        h.core.user().await.unwrap().email.as_deref(),
        Some("new@example.com")
    );
}
