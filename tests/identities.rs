//! Feature 003 contract tests: identity management (US1 link, US2 list,
//! US3 unlink) against a mocked GoTrue.

mod common;

use std::sync::Arc;

use common::*;
use serde_json::json;
use tauri_plugin_supabase_auth::error::ErrorKind;
use tauri_plugin_supabase_auth::oauth::{self, FlowKind};
use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn signed_in(server: &MockServer, h: &Harness) {
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

fn link_harness(url: &str, ports: Vec<u16>, timeout_secs: u32) -> Harness {
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

// ---------------------------------------------------------------------------
// US2: list identities
// ---------------------------------------------------------------------------

#[tokio::test]
async fn get_identities_maps_fields_and_refreshes_user() {
    let (server, h) = mock_gotrue().await;
    signed_in(&server, &h).await;

    let mut user = gotrue_user_with_identities(&[
        gotrue_identity("email", "aaaaaaaa-0000-0000-0000-000000000001"),
        gotrue_identity("github", "bbbbbbbb-0000-0000-0000-000000000002"),
    ]);
    user["email"] = json!("fresh@example.com"); // server-side change to observe
    Mock::given(method("GET"))
        .and(path("/auth/v1/user"))
        .and(header("authorization", "Bearer at0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(user))
        .mount(&server)
        .await;

    let identities = h.core.get_identities().await.unwrap();
    assert_eq!(identities.len(), 2);
    let github = identities.iter().find(|i| i.provider == "github").unwrap();
    assert_eq!(github.identity_id, "bbbbbbbb-0000-0000-0000-000000000002");
    assert_eq!(github.provider_subject, "github-subject-1");
    assert_eq!(github.email.as_deref(), Some("user@example.com"));
    assert!(github.created_at.is_some());

    // In-state user refreshed from the same response (FR-002).
    assert_eq!(
        h.core.user().await.unwrap().email.as_deref(),
        Some("fresh@example.com")
    );
}

#[tokio::test]
async fn get_identities_requires_signed_in() {
    let (_server, h) = mock_gotrue().await;
    let err = h.core.get_identities().await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::SessionExpired);
}

#[tokio::test]
async fn get_identities_offline_fails_fast_with_network_kind() {
    let h = offline_harness();
    h.store.set_raw(stored_session_json("at0", 3600));
    h.core.restore().await;
    let err = h.core.get_identities().await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::Network);
}

// ---------------------------------------------------------------------------
// US1: link identity
// ---------------------------------------------------------------------------

#[tokio::test]
async fn link_flow_attaches_identity_to_same_user_and_emits() {
    let server = MockServer::start().await;
    let h = link_harness(&server.uri(), vec![43951, 43952], 30);
    signed_in(&server, &h).await;

    // Authenticated authorize hop returns the provider URL as JSON.
    Mock::given(method("GET"))
        .and(path("/auth/v1/user/identities/authorize"))
        .and(header("authorization", "Bearer at0"))
        .and(query_param("provider", "github"))
        .and(query_param("skip_http_redirect", "true"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(gotrue_authorize_response("https://github.test/consent")),
        )
        .expect(1)
        .mount(&server)
        .await;
    // PKCE exchange returns a session for the SAME user carrying the new identity.
    Mock::given(method("POST"))
        .and(path("/auth/v1/token"))
        .and(query_param("grant_type", "pkce"))
        .respond_with(ResponseTemplate::new(200).set_body_json(gotrue_session("at1", "rt1", 3600)))
        .expect(1)
        .mount(&server)
        .await;

    let user_before = h.core.user().await.unwrap().id;
    let (access_token, cancel) = h.core.begin_link().await.unwrap();
    let (url_tx, url_rx) = tokio::sync::oneshot::channel::<String>();
    tokio::spawn(async move {
        let provider_url = url_rx.await.unwrap();
        assert_eq!(provider_url, "https://github.test/consent");
        // The "browser": GoTrue's callback redirects to the loopback with a code.
        // We don't know the port here; probe both configured ports.
        let client = reqwest::Client::new();
        for port in [43951u16, 43952] {
            if client
                .get(format!("http://127.0.0.1:{port}/callback?code=link-code"))
                .send()
                .await
                .is_ok()
            {
                break;
            }
        }
    });

    let session = oauth::run_flow(
        &h.core,
        "github",
        None,
        FlowKind::Link { access_token },
        cancel,
        move |url| {
            url_tx.send(url).unwrap();
            Ok(())
        },
    )
    .await
    .unwrap();
    let session = h.core.complete_link(session).await.unwrap();

    assert_eq!(
        session.user.id, user_before,
        "link must keep the same user (SC-006)"
    );
    assert!(
        h.core.session().await.is_some(),
        "session uninterrupted (US1-AS5)"
    );
    assert_eq!(event_log(&h).last().unwrap().0, "IDENTITIES_CHANGED");
    assert!(
        h.store.raw().unwrap().contains("at1"),
        "refreshed session persisted"
    );
}

#[tokio::test]
async fn link_requires_signed_in_session() {
    let (_server, h) = mock_gotrue().await;
    let err = h.core.begin_link().await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::SessionExpired);
}

#[tokio::test]
async fn link_conflict_maps_to_identity_already_linked_and_leaves_state_untouched() {
    let server = MockServer::start().await;
    let h = link_harness(&server.uri(), vec![43961], 30);
    signed_in(&server, &h).await;

    Mock::given(method("GET"))
        .and(path("/auth/v1/user/identities/authorize"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(gotrue_authorize_response("https://github.test/consent")),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/token"))
        .and(query_param("grant_type", "pkce"))
        .respond_with(ResponseTemplate::new(422).set_body_json(json!({
            "code": 422, "error_code": "identity_already_exists",
            "msg": "Identity is already linked to another user"
        })))
        .mount(&server)
        .await;

    let (access_token, cancel) = h.core.begin_link().await.unwrap();
    let (url_tx, url_rx) = tokio::sync::oneshot::channel::<String>();
    tokio::spawn(async move {
        let _ = url_rx.await;
        let _ = reqwest::Client::new()
            .get("http://127.0.0.1:43961/callback?code=conflicting-code")
            .send()
            .await;
    });

    let err = oauth::run_flow(
        &h.core,
        "github",
        None,
        FlowKind::Link { access_token },
        cancel,
        move |url| {
            url_tx.send(url).unwrap();
            Ok(())
        },
    )
    .await
    .unwrap_err();
    h.core.abort_link().await;

    assert_eq!(err.kind, ErrorKind::IdentityAlreadyLinked);
    let session = h
        .core
        .session()
        .await
        .expect("current account unchanged (FR-005)");
    assert_eq!(session.access_token, "at0");
    assert_eq!(
        event_log(&h).last().unwrap().0,
        "SIGNED_IN",
        "no identity event"
    );
}

#[tokio::test]
async fn abandoned_link_times_out_and_permits_fresh_attempt() {
    let server = MockServer::start().await;
    let h = link_harness(&server.uri(), vec![43971], 1); // 1s timeout
    signed_in(&server, &h).await;
    Mock::given(method("GET"))
        .and(path("/auth/v1/user/identities/authorize"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(gotrue_authorize_response("https://github.test/consent")),
        )
        .mount(&server)
        .await;

    let (access_token, cancel) = h.core.begin_link().await.unwrap();
    let err = oauth::run_flow(
        &h.core,
        "github",
        None,
        FlowKind::Link { access_token },
        cancel,
        |_url| Ok(()),
    )
    .await
    .unwrap_err();
    h.core.abort_link().await;

    assert_eq!(err.kind, ErrorKind::OauthFlowInterrupted);
    assert!(
        h.core.session().await.is_some(),
        "session survives abandonment (FR-006)"
    );
    assert!(h.core.begin_link().await.is_ok(), "fresh attempt possible");
}

#[tokio::test]
async fn manual_linking_disabled_maps_to_configuration_with_guidance() {
    let (server, h) = mock_gotrue().await;
    signed_in(&server, &h).await;
    Mock::given(method("GET"))
        .and(path("/auth/v1/user/identities/authorize"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({
            "code": 400, "error_code": "manual_linking_disabled",
            "msg": "Manual linking is disabled"
        })))
        .mount(&server)
        .await;

    let (access_token, cancel) = h.core.begin_link().await.unwrap();
    let err = oauth::run_flow(
        &h.core,
        "github",
        None,
        FlowKind::Link { access_token },
        cancel,
        |_url| Ok(()),
    )
    .await
    .unwrap_err();
    h.core.abort_link().await;

    assert_eq!(err.kind, ErrorKind::Configuration);
    assert!(
        err.message.contains("enable_manual_linking"),
        "message must name the setting, got: {}",
        err.message
    );
}

// ---------------------------------------------------------------------------
// US3: unlink identity
// ---------------------------------------------------------------------------

#[tokio::test]
async fn unlink_deletes_by_identity_id_refreshes_and_emits() {
    let (server, h) = mock_gotrue().await;
    signed_in(&server, &h).await;

    Mock::given(method("DELETE"))
        .and(path(
            "/auth/v1/user/identities/bbbbbbbb-0000-0000-0000-000000000002",
        ))
        .and(header("authorization", "Bearer at0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/auth/v1/user"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(gotrue_user_with_identities(&[
                gotrue_identity("email", "aaaaaaaa-0000-0000-0000-000000000001"),
            ])),
        )
        .mount(&server)
        .await;

    let identities = h
        .core
        .unlink_identity("bbbbbbbb-0000-0000-0000-000000000002")
        .await
        .unwrap();
    assert_eq!(identities.len(), 1);
    assert_eq!(identities[0].provider, "email");
    assert!(
        h.core.session().await.is_some(),
        "session survives unlink (US3-AS4)"
    );
    assert_eq!(event_log(&h).last().unwrap().0, "IDENTITIES_CHANGED");
}

#[tokio::test]
async fn unlink_last_identity_maps_to_last_sign_in_method() {
    let (server, h) = mock_gotrue().await;
    signed_in(&server, &h).await;
    Mock::given(method("DELETE"))
        .and(path(
            "/auth/v1/user/identities/aaaaaaaa-0000-0000-0000-000000000001",
        ))
        .respond_with(ResponseTemplate::new(422).set_body_json(json!({
            "code": 422, "error_code": "single_identity_not_deletable",
            "msg": "User must have at least 1 identity after unlinking"
        })))
        .mount(&server)
        .await;

    let err = h
        .core
        .unlink_identity("aaaaaaaa-0000-0000-0000-000000000001")
        .await
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::LastSignInMethod);
    assert!(h.core.session().await.is_some());
}

#[tokio::test]
async fn unlink_email_conflict_also_maps_to_last_sign_in_method() {
    let (server, h) = mock_gotrue().await;
    signed_in(&server, &h).await;
    Mock::given(method("DELETE"))
        .and(path(
            "/auth/v1/user/identities/aaaaaaaa-0000-0000-0000-000000000001",
        ))
        .respond_with(ResponseTemplate::new(422).set_body_json(json!({
            "code": 422, "error_code": "email_conflict_identity_not_deletable",
            "msg": "Unable to unlink identity due to email conflict"
        })))
        .mount(&server)
        .await;

    let err = h
        .core
        .unlink_identity("aaaaaaaa-0000-0000-0000-000000000001")
        .await
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::LastSignInMethod);
}

#[tokio::test]
async fn unlink_requires_signed_in() {
    let (_server, h) = mock_gotrue().await;
    let err = h.core.unlink_identity("whatever").await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::SessionExpired);
}
