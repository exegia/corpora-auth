//! US5 tests: passwordless sign-in via magic link / one-time code (FR-009).

mod common;

use common::*;
use serde_json::json;
use tauri_plugin_supabase_auth::engine::{OtpKind, OtpTarget};
use tauri_plugin_supabase_auth::error::ErrorKind;
use wiremock::matchers::{body_partial_json, method, path};
use wiremock::{Mock, ResponseTemplate};

#[tokio::test]
async fn email_otp_request_hits_magiclink_endpoint() {
    let (server, h) = mock_gotrue().await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/magiclink"))
        .and(body_partial_json(json!({ "email": "user@example.com" })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
        .expect(1)
        .mount(&server)
        .await;

    h.core
        .request_otp(OtpTarget::Email("user@example.com".into()), None)
        .await
        .unwrap();
}

#[tokio::test]
async fn phone_otp_request_hits_otp_endpoint() {
    let (server, h) = mock_gotrue().await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/otp"))
        .and(body_partial_json(json!({ "phone": "+15555550123" })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
        .expect(1)
        .mount(&server)
        .await;

    h.core
        .request_otp(OtpTarget::Phone("+15555550123".into()), None)
        .await
        .unwrap();
}

#[tokio::test]
async fn email_otp_verification_signs_in() {
    let (server, h) = mock_gotrue().await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/verify"))
        .and(body_partial_json(json!({
            "type": "email", "email": "user@example.com", "token": "654321"
        })))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(gotrue_session("otp-at", "otp-rt", 3600)),
        )
        .mount(&server)
        .await;

    let session = h
        .core
        .verify_otp(
            OtpTarget::Email("user@example.com".into()),
            "654321",
            OtpKind::Email,
        )
        .await
        .unwrap();
    assert_eq!(session.access_token, "otp-at");
    assert_eq!(event_log(&h), vec![("SIGNED_IN".to_string(), true)]);
    assert!(
        h.store.raw().is_some(),
        "OTP session persisted like any other"
    );
}

#[tokio::test]
async fn expired_or_used_code_maps_to_otp_expired() {
    let (server, h) = mock_gotrue().await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/verify"))
        .respond_with(ResponseTemplate::new(403).set_body_json(json!({
            "code": 403, "error_code": "otp_expired",
            "msg": "Token has expired or is invalid"
        })))
        .mount(&server)
        .await;

    let err = h
        .core
        .verify_otp(
            OtpTarget::Email("user@example.com".into()),
            "000000",
            OtpKind::Email,
        )
        .await
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::OtpExpired);
    assert!(h.core.session().await.is_none());
}
