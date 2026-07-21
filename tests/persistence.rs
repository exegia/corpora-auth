//! US2 tests: session persistence and startup restore (FR-005, FR-007).

mod common;

use common::*;
use serde_json::json;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, ResponseTemplate};

#[tokio::test]
async fn session_persisted_on_sign_in_and_deleted_on_sign_out() {
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
        .sign_in_with_password("user@example.com", "pw")
        .await
        .unwrap();
    let raw = h.store.raw().expect("persisted");
    assert!(raw.contains("at1"));

    h.core.sign_out().await.unwrap();
    assert!(
        h.store.raw().is_none(),
        "sign-out must delete stored material (FR-007)"
    );
}

#[tokio::test]
async fn corrupt_stored_payload_restores_as_signed_out_without_panic() {
    let (_server, h) = mock_gotrue().await;
    h.store.set_raw("{definitely-not json%%%");
    h.core.restore().await;
    assert!(h.core.session().await.is_none());
    assert!(event_log(&h).is_empty());
}

#[tokio::test]
async fn fresh_stored_session_restores_without_any_network_call() {
    // No mocks mounted: any request would 404 and the restore would degrade.
    let (_server, h) = mock_gotrue().await;
    h.store.set_raw(stored_session_json("stored-at", 3600));
    h.core.restore().await;

    let session = h.core.session().await.expect("restored");
    assert_eq!(session.access_token, "stored-at");
    assert_eq!(event_log(&h), vec![("SIGNED_IN".to_string(), true)]);
}

#[tokio::test]
async fn near_expiry_stored_session_is_refreshed_on_restore() {
    let (server, h) = mock_gotrue().await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/token"))
        .and(query_param("grant_type", "refresh_token"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(gotrue_session("fresh-at", "fresh-rt", 3600)),
        )
        .mount(&server)
        .await;

    h.store.set_raw(stored_session_json("stale-at", 30)); // inside 60s buffer
    h.core.restore().await;

    let session = h.core.session().await.expect("restored");
    assert_eq!(session.access_token, "fresh-at");
    assert!(
        h.store.raw().unwrap().contains("fresh-at"),
        "new session persisted"
    );
}

#[tokio::test]
async fn revoked_refresh_token_on_restore_clears_and_stays_signed_out() {
    let (server, h) = mock_gotrue().await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/token"))
        .and(query_param("grant_type", "refresh_token"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({
            "code": 400, "error_code": "refresh_token_not_found",
            "msg": "Invalid Refresh Token: Refresh Token Not Found"
        })))
        .mount(&server)
        .await;

    h.store.set_raw(stored_session_json("stale-at", 30));
    h.core.restore().await;

    assert!(h.core.session().await.is_none());
    assert!(
        h.store.raw().is_none(),
        "revoked session material must be cleared"
    );
    assert!(
        event_log(&h).is_empty(),
        "no SIGNED_IN for a rejected restore"
    );
}

#[tokio::test]
async fn offline_restore_with_unexpired_token_stays_signed_in() {
    // Spec offline edge case: network failure + unexpired access token
    // must keep the user signed in on the stored session.
    let h = offline_harness();
    h.store.set_raw(stored_session_json("stale-but-valid", 30)); // needs refresh, not expired
    h.core.restore().await;

    let session = h
        .core
        .session()
        .await
        .expect("stale session restored offline");
    assert_eq!(session.access_token, "stale-but-valid");
    assert_eq!(event_log(&h), vec![("SIGNED_IN".to_string(), true)]);
}

#[tokio::test]
async fn offline_restore_with_expired_token_is_signed_out_but_keeps_material() {
    let h = offline_harness();
    h.store.set_raw(stored_session_json("expired-at", -120));
    h.core.restore().await;

    assert!(h.core.session().await.is_none());
    assert!(
        h.store.raw().is_some(),
        "material kept so a later online launch can retry the refresh"
    );
}
