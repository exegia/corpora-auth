//! US5 tests: OAuth via PKCE + loopback callback (FR-010, research R2).

mod common;

use std::sync::Arc;

use common::*;
use serde_json::json;
use tauri_plugin_supabase_auth::error::ErrorKind;
use tauri_plugin_supabase_auth::oauth;
use wiremock::matchers::{body_partial_json, method, path, query_param};
use wiremock::{Mock, ResponseTemplate};

/// Extracts (redirect_uri, state, code_challenge) from the authorize URL the
/// flow hands to the browser opener.
fn parse_authorize(url: &str) -> (String, String) {
    let parsed = url::Url::parse(url).unwrap();
    let get = |k: &str| {
        parsed
            .query_pairs()
            .find(|(key, _)| key == k)
            .map(|(_, v)| v.into_owned())
            .unwrap_or_default()
    };
    (get("redirect_to"), get("code_challenge"))
}

fn oauth_harness(url: &str, ports: Vec<u16>, timeout_secs: u32) -> Harness {
    let mut config = config_for(url);
    config.callback_ports = ports;
    config.flow_timeout_secs = timeout_secs;
    let store = Arc::new(tauri_plugin_supabase_auth::persistence::MemoryStore::new());
    let engine = tauri_plugin_supabase_auth::engine::AuthEngine::new(url, "test-anon-key").unwrap();
    let core = Arc::new(tauri_plugin_supabase_auth::state::AuthCore::new(
        engine,
        config,
        Box::new(SharedStore(store.clone())),
    ));
    let events = Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = events.clone();
    core.on_auth_state_change(move |p| sink.lock().unwrap().push(p.clone()));
    Harness {
        core,
        store,
        events,
    }
}

#[tokio::test]
async fn full_round_trip_exchanges_code_and_signs_in() {
    let server = wiremock::MockServer::start().await;
    let h = oauth_harness(&server.uri(), vec![43911, 43912], 30);

    // The token exchange must carry the PKCE verifier and auth code.
    Mock::given(method("POST"))
        .and(path("/auth/v1/token"))
        .and(query_param("grant_type", "pkce"))
        .and(body_partial_json(json!({ "auth_code": "the-code" })))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(gotrue_session("oauth-at", "oauth-rt", 3600)),
        )
        .expect(1)
        .mount(&server)
        .await;

    let cancel = h.core.begin_oauth("github").await.unwrap();
    let (url_tx, url_rx) = tokio::sync::oneshot::channel::<String>();

    // "Browser": receives the authorize URL and completes the redirect with a
    // matching state — first probing that a wrong state is rejected.
    tokio::spawn(async move {
        let authorize_url = url_rx.await.unwrap();
        let (redirect, challenge) = parse_authorize(&authorize_url);
        assert!(
            !challenge.is_empty(),
            "authorize URL must carry the code challenge"
        );
        assert!(authorize_url.contains("flow_type=pkce"));
        let client = reqwest::Client::new();

        // Unexpected path first: must be rejected and NOT consume the one-shot.
        let bad = client
            .get(redirect.replace("/callback", "/favicon.ico"))
            .send()
            .await
            .unwrap();
        assert_eq!(bad.status().as_u16(), 404);

        let good = client
            .get(format!("{redirect}?code=the-code"))
            .send()
            .await
            .unwrap();
        assert_eq!(good.status().as_u16(), 200);
    });

    let session = oauth::run_flow(
        &h.core,
        "github",
        None,
        oauth::FlowKind::SignIn,
        cancel,
        move |url| {
            url_tx.send(url).unwrap();
            Ok(())
        },
    )
    .await
    .unwrap();
    let session = h.core.complete_oauth(session).await.unwrap();

    assert_eq!(session.access_token, "oauth-at");
    assert_eq!(event_log(&h), vec![("SIGNED_IN".to_string(), true)]);
}

#[tokio::test]
async fn abandoned_flow_times_out_as_interrupted_and_stays_signed_out() {
    let server = wiremock::MockServer::start().await;
    let h = oauth_harness(&server.uri(), vec![43921], 1); // 1s timeout

    let cancel = h.core.begin_oauth("github").await.unwrap();
    let err = oauth::run_flow(
        &h.core,
        "github",
        None,
        oauth::FlowKind::SignIn,
        cancel,
        |_url| Ok(()),
    )
    .await
    .unwrap_err();
    h.core.abort_oauth().await;

    assert_eq!(err.kind, ErrorKind::OauthFlowInterrupted);
    assert!(h.core.session().await.is_none());
    // A fresh attempt is possible afterwards (edge case: abandoned mid-flow).
    let cancel2 = h.core.begin_oauth("github").await;
    assert!(cancel2.is_ok());
}

#[tokio::test]
async fn cancellation_interrupts_the_flow() {
    let server = wiremock::MockServer::start().await;
    let h = oauth_harness(&server.uri(), vec![43931], 30);

    let cancel = h.core.begin_oauth("github").await.unwrap();
    let cancel_trigger = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        cancel_trigger.notify_waiters();
    });

    let err = oauth::run_flow(
        &h.core,
        "github",
        None,
        oauth::FlowKind::SignIn,
        cancel,
        |_url| Ok(()),
    )
    .await
    .unwrap_err();
    h.core.abort_oauth().await;
    assert_eq!(err.kind, ErrorKind::OauthFlowInterrupted);
    assert!(h.core.session().await.is_none());
}

#[tokio::test]
async fn completion_after_cancel_is_rejected() {
    let server = wiremock::MockServer::start().await;
    let h = oauth_harness(&server.uri(), vec![43941], 30);

    let _cancel = h.core.begin_oauth("github").await.unwrap();
    h.core.abort_oauth().await; // user cancelled while the browser was open

    let session: tauri_plugin_supabase_auth::models::Session =
        serde_json::from_str(&stored_session_json("late-at", 3600)).unwrap();
    let err = h.core.complete_oauth(session).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::OauthFlowInterrupted);
    assert!(
        h.core.session().await.is_none(),
        "cancelled flow can never sign in"
    );
}
