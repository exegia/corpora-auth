//! Feature 004 contract tests: passkey registration (US1), sign-in (US2),
//! supplied-ceremony / two-step surface (US4), and management (US3) against a
//! mocked GoTrue, with the software ceremony provider standing in for the OS
//! prompt (research R9).

mod common;

use common::*;
use serde_json::json;
use tauri_plugin_supabase_auth::ceremony::Availability;
use tauri_plugin_supabase_auth::error::ErrorKind;
use tauri_plugin_supabase_auth::models::PasskeyFlowStatus;
use tauri_plugin_supabase_auth::persistence::SessionStore;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn signed_in(server: &MockServer, h: &Harness) {
    Mock::given(method("POST"))
        .and(path("/auth/v1/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(gotrue_session("at0", "rt0", 3600)))
        .up_to_n_times(1)
        .mount(server)
        .await;
    h.core
        .sign_in_with_password("user@example.com", "pw")
        .await
        .unwrap();
    h.events.lock().unwrap().clear(); // start each test from a clean log
}

fn passkeys_changed_count(h: &Harness) -> usize {
    event_log(h)
        .iter()
        .filter(|(e, _)| e == "PASSKEYS_CHANGED")
        .count()
}

// ---------------------------------------------------------------------------
// US1: register a passkey
// ---------------------------------------------------------------------------

#[tokio::test]
async fn register_happy_path_via_software_ceremony() {
    let (server, h) = mock_gotrue().await;
    signed_in(&server, &h).await;
    let seen = SoftwareCeremony::completing().install(&h);

    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/registration/options"))
        .and(header("authorization", "Bearer at0"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(gotrue_registration_options("ch-reg-1")),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/registration/verify"))
        .and(header("authorization", "Bearer at0"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(gotrue_passkey("pk-1", Some("iCloud Keychain"))),
        )
        .mount(&server)
        .await;

    let result = h.core.register_passkey().await.unwrap();
    assert_eq!(result.status, PasskeyFlowStatus::Completed);
    let passkey = result.passkey.unwrap();
    assert_eq!(passkey.id, "pk-1");
    // Server-derived name (research R3) — no name was sent.
    assert_eq!(passkey.friendly_name.as_deref(), Some("iCloud Keychain"));

    // Ceremony received the server options verbatim.
    {
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].0, "create");
        assert!(seen[0].1.contains("pubKeyCredParams"));
    }

    // Verify request carried {challenge_id, credential} and NO name field.
    let verify_req = server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .find(|r| r.url.path().ends_with("/registration/verify"))
        .expect("verify request");
    let body: serde_json::Value = serde_json::from_slice(&verify_req.body).unwrap();
    assert_eq!(body["challenge_id"], "ch-reg-1");
    assert_eq!(body["credential"]["type"], "public-key");
    assert!(body.get("friendly_name").is_none());

    assert_eq!(passkeys_changed_count(&h), 1);
}

#[tokio::test]
async fn register_cancelled_is_a_status_not_an_error() {
    let (server, h) = mock_gotrue().await;
    signed_in(&server, &h).await;
    SoftwareCeremony::cancelling().install(&h);

    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/registration/options"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(gotrue_registration_options("ch-reg-2")),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/registration/verify"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0) // cancellation never reaches the server
        .mount(&server)
        .await;

    let result = h.core.register_passkey().await.unwrap();
    assert_eq!(result.status, PasskeyFlowStatus::Cancelled);
    assert!(result.passkey.is_none());
    assert_eq!(passkeys_changed_count(&h), 0); // SC-003: no event, no error
}

#[tokio::test]
async fn register_challenge_expired_then_retry_succeeds() {
    let (server, h) = mock_gotrue().await;
    signed_in(&server, &h).await;
    SoftwareCeremony::completing().install(&h);

    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/registration/options"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(gotrue_registration_options("ch-reg-3")),
        )
        .mount(&server)
        .await;
    // First verify: expired. Second: success.
    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/registration/verify"))
        .respond_with(ResponseTemplate::new(400).set_body_json(gotrue_error(
            "webauthn_challenge_expired",
            "Challenge has expired",
        )))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/registration/verify"))
        .respond_with(ResponseTemplate::new(200).set_body_json(gotrue_passkey("pk-2", None)))
        .mount(&server)
        .await;

    let err = h.core.register_passkey().await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::PasskeyChallengeExpired);

    // Immediate retry with a fresh options round-trip succeeds (US1-AS4).
    let result = h.core.register_passkey().await.unwrap();
    assert_eq!(result.status, PasskeyFlowStatus::Completed);
}

#[tokio::test]
async fn register_duplicate_and_limit_map_to_verification_failed() {
    for (code, needle) in [
        ("webauthn_credential_exists", "already"),
        ("too_many_passkeys", "Maximum number"),
    ] {
        let (server, h) = mock_gotrue().await;
        signed_in(&server, &h).await;
        SoftwareCeremony::completing().install(&h);

        Mock::given(method("POST"))
            .and(path("/auth/v1/passkeys/registration/options"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(gotrue_registration_options("ch")),
            )
            .mount(&server)
            .await;
        let msg = match code {
            "webauthn_credential_exists" => "Credential already registered",
            _ => "Maximum number of passkeys reached",
        };
        Mock::given(method("POST"))
            .and(path("/auth/v1/passkeys/registration/verify"))
            .respond_with(ResponseTemplate::new(422).set_body_json(gotrue_error(code, msg)))
            .mount(&server)
            .await;

        let err = h.core.register_passkey().await.unwrap_err();
        assert_eq!(err.kind, ErrorKind::PasskeyVerificationFailed, "{code}");
        assert!(err.message.contains(needle), "{code}: {}", err.message);
    }
}

#[tokio::test]
async fn register_passkeys_disabled_is_configuration_despite_404() {
    let (server, h) = mock_gotrue().await;
    signed_in(&server, &h).await;
    SoftwareCeremony::completing().install(&h);

    // GoTrue answers HTTP 404 with error_code passkey_disabled (research R4).
    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/registration/options"))
        .respond_with(
            ResponseTemplate::new(404)
                .set_body_json(gotrue_error("passkey_disabled", "Passkeys are disabled")),
        )
        .mount(&server)
        .await;

    let err = h.core.register_passkey().await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::Configuration);
    assert!(
        err.message.contains("GOTRUE_PASSKEY_ENABLED"),
        "actionable message expected, got: {}",
        err.message
    );
}

#[tokio::test]
async fn register_insufficient_aal_maps_to_permission_denied() {
    let (server, h) = mock_gotrue().await;
    signed_in(&server, &h).await;
    SoftwareCeremony::completing().install(&h);

    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/registration/options"))
        .respond_with(ResponseTemplate::new(403).set_body_json(gotrue_error(
            "insufficient_aal",
            "AAL2 session is required to manage passkeys when MFA is enabled",
        )))
        .mount(&server)
        .await;

    let err = h.core.register_passkey().await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::PermissionDenied);
}

#[tokio::test]
async fn register_requires_signed_in() {
    let (_server, h) = mock_gotrue().await;
    SoftwareCeremony::completing().install(&h);
    let err = h.core.register_passkey().await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::SessionExpired);
}

#[tokio::test]
async fn register_without_ceremony_fails_fast_with_no_rest_call() {
    let (server, h) = mock_gotrue().await;
    signed_in(&server, &h).await;
    // No provider installed.
    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/registration/options"))
        .respond_with(ResponseTemplate::new(200))
        .expect(0)
        .mount(&server)
        .await;

    let err = h.core.register_passkey().await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::PasskeyUnsupported);
}

// ---------------------------------------------------------------------------
// US2: sign in with a passkey
// ---------------------------------------------------------------------------

async fn mount_auth_options(server: &MockServer, challenge_id: &str) {
    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/authentication/options"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(gotrue_authentication_options(challenge_id)),
        )
        .mount(server)
        .await;
}

#[tokio::test]
async fn sign_in_happy_path_adopts_session_and_emits_signed_in() {
    let (server, h) = mock_gotrue().await;
    let seen = SoftwareCeremony::completing().install(&h);

    mount_auth_options(&server, "ch-auth-1").await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/authentication/verify"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(gotrue_session("pk-at", "pk-rt", 3600)),
        )
        .mount(&server)
        .await;

    let result = h.core.sign_in_with_passkey().await.unwrap();
    assert_eq!(result.status, PasskeyFlowStatus::Completed);
    assert!(result.session.is_some()); // sanitized: type carries no refresh token

    // Anonymous options call: no Authorization header (research R1).
    let opts_req = server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .find(|r| r.url.path().ends_with("/authentication/options"))
        .unwrap();
    assert!(!opts_req.headers.contains_key("authorization"));

    // Session adopted exactly like any other method (FR-002/FR-003).
    assert_eq!(h.core.session().await.unwrap().access_token, "pk-at");
    assert!(h.store.load().is_some());
    assert_eq!(event_log(&h), vec![("SIGNED_IN".to_string(), true)]);

    let seen = seen.lock().unwrap();
    assert_eq!(seen[0].0, "get");
    assert!(seen[0].1.contains("allowCredentials"));
}

#[tokio::test]
async fn sign_in_cancelled_stays_signed_out() {
    let (server, h) = mock_gotrue().await;
    SoftwareCeremony::cancelling().install(&h);

    mount_auth_options(&server, "ch-auth-2").await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/authentication/verify"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;

    let result = h.core.sign_in_with_passkey().await.unwrap();
    assert_eq!(result.status, PasskeyFlowStatus::Cancelled);
    assert!(h.core.session().await.is_none());
    assert!(event_log(&h).is_empty());
}

#[tokio::test]
async fn sign_in_verification_failed_suggests_stale_passkey() {
    let (server, h) = mock_gotrue().await;
    SoftwareCeremony::completing().install(&h);

    mount_auth_options(&server, "ch-auth-3").await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/authentication/verify"))
        .respond_with(ResponseTemplate::new(400).set_body_json(gotrue_error(
            "webauthn_verification_failed",
            "WebAuthn verification failed",
        )))
        .mount(&server)
        .await;

    let err = h.core.sign_in_with_passkey().await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::PasskeyVerificationFailed);
    assert!(h.core.session().await.is_none());
}

#[tokio::test]
async fn sign_in_consumed_challenge_maps_to_expired() {
    let (server, h) = mock_gotrue().await;
    SoftwareCeremony::completing().install(&h);

    mount_auth_options(&server, "ch-auth-4").await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/authentication/verify"))
        .respond_with(ResponseTemplate::new(400).set_body_json(gotrue_error(
            "webauthn_challenge_not_found",
            "Challenge not found or already used",
        )))
        .mount(&server)
        .await;

    let err = h.core.sign_in_with_passkey().await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::PasskeyChallengeExpired);
}

#[tokio::test]
async fn sign_in_rate_limited_carries_retry_after() {
    let (server, h) = mock_gotrue().await;
    SoftwareCeremony::completing().install(&h);

    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/authentication/options"))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("retry-after", "17")
                .set_body_json(gotrue_error(
                    "over_request_rate_limit",
                    "Rate limit exceeded",
                )),
        )
        .mount(&server)
        .await;

    let err = h.core.sign_in_with_passkey().await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::RateLimited);
    assert_eq!(err.retry_after_secs, Some(17));
}

#[tokio::test]
async fn sign_in_unconfirmed_email_guard_passes_through() {
    let (server, h) = mock_gotrue().await;
    SoftwareCeremony::completing().install(&h);

    mount_auth_options(&server, "ch-auth-5").await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/authentication/verify"))
        .respond_with(
            ResponseTemplate::new(403)
                .set_body_json(gotrue_error("email_not_confirmed", "Email not confirmed")),
        )
        .mount(&server)
        .await;

    let err = h.core.sign_in_with_passkey().await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::EmailNotConfirmed);
}

/// SC-006: a passkey-adopted session passes the same lifecycle motions as a
/// password session — refresh, then sign-out, clearing everything.
#[tokio::test]
async fn passkey_session_lifecycle_parity() {
    let (server, h) = mock_gotrue().await;
    SoftwareCeremony::completing().install(&h);

    mount_auth_options(&server, "ch-auth-6").await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/authentication/verify"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(gotrue_session("pk-at", "pk-rt", 3600)),
        )
        .mount(&server)
        .await;
    h.core.sign_in_with_passkey().await.unwrap();

    // Refresh (the supabase crate drives POST /token?grant_type=refresh_token).
    Mock::given(method("POST"))
        .and(path("/auth/v1/token"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(gotrue_session("pk-at2", "pk-rt2", 3600)),
        )
        .mount(&server)
        .await;
    let refreshed = h.core.refresh().await.unwrap();
    assert_eq!(refreshed.access_token, "pk-at2");

    // Sign-out clears state and store.
    Mock::given(method("POST"))
        .and(path("/auth/v1/logout"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;
    h.core.sign_out().await.unwrap();
    assert!(h.core.session().await.is_none());
    assert!(h.store.load().is_none());

    let names: Vec<String> = event_log(&h).into_iter().map(|(e, _)| e).collect();
    assert_eq!(names, vec!["SIGNED_IN", "TOKEN_REFRESHED", "SIGNED_OUT"]);
}

// ---------------------------------------------------------------------------
// US4: supplied ceremony, two-step surface, capability
// ---------------------------------------------------------------------------

#[tokio::test]
async fn capability_reflects_provider_tiers() {
    let (_server, h) = mock_gotrue().await;

    // No provider anywhere (built-ins are installed by the plugin, not here).
    let cap = h.core.passkey_capability();
    assert!(!cap.usable);
    assert_eq!(cap.reason.as_deref(), Some("unsupportedPlatform"));

    // Built-in tier installed → usable.
    h.core
        .set_builtin_ceremony(std::sync::Arc::new(SoftwareCeremony::completing()));
    assert!(h.core.passkey_capability().usable);

    // Provider present but reporting unavailable → honest reason (SC-004).
    let unavailable = SoftwareCeremony {
        availability: Availability::Unavailable("associatedDomainsMissing".into()),
        ..SoftwareCeremony::completing()
    };
    h.core
        .set_ceremony_provider(std::sync::Arc::new(unavailable));
    let cap = h.core.passkey_capability();
    assert!(!cap.usable);
    assert_eq!(cap.reason.as_deref(), Some("associatedDomainsMissing"));
}

#[tokio::test]
async fn supplied_provider_beats_builtin() {
    let (server, h) = mock_gotrue().await;
    signed_in(&server, &h).await;

    // Built-in would COMPLETE; the supplied one cancels. If precedence is
    // wrong, the flow completes and this test fails.
    h.core
        .set_builtin_ceremony(std::sync::Arc::new(SoftwareCeremony::completing()));
    let supplied_seen = SoftwareCeremony::cancelling().install(&h);

    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/registration/options"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(gotrue_registration_options("ch-prec")),
        )
        .mount(&server)
        .await;

    let result = h.core.register_passkey().await.unwrap();
    assert_eq!(result.status, PasskeyFlowStatus::Cancelled);
    assert_eq!(supplied_seen.lock().unwrap().len(), 1); // supplied ran
}

#[tokio::test]
async fn two_step_registration_equals_one_shot() {
    let (server, h) = mock_gotrue().await;
    signed_in(&server, &h).await;
    // NO ceremony provider: the "app" runs its own (US4-AS1).

    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/registration/options"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(gotrue_registration_options("ch-2step")),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/registration/verify"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(gotrue_passkey("pk-9", Some("YubiKey 5"))),
        )
        .mount(&server)
        .await;

    let challenge = h.core.passkey_registration_options().await.unwrap();
    assert_eq!(challenge.challenge_id, "ch-2step");
    // Options passed through verbatim for the app's ceremony.
    assert!(challenge.options.get("pubKeyCredParams").is_some());
    assert!(challenge.expires_at > 0);

    let credential: serde_json::Value =
        serde_json::from_str(&fixture_credential("create")).unwrap();
    let passkey = h
        .core
        .passkey_registration_verify(&challenge.challenge_id, &credential)
        .await
        .unwrap();
    assert_eq!(passkey.id, "pk-9");
    assert_eq!(passkeys_changed_count(&h), 1); // same event as one-shot
}

#[tokio::test]
async fn two_step_authentication_equals_one_shot() {
    let (server, h) = mock_gotrue().await;

    mount_auth_options(&server, "ch-2step-auth").await;
    Mock::given(method("POST"))
        .and(path("/auth/v1/passkeys/authentication/verify"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(gotrue_session("2s-at", "2s-rt", 3600)),
        )
        .mount(&server)
        .await;

    let challenge = h.core.passkey_authentication_options().await.unwrap();
    let credential: serde_json::Value = serde_json::from_str(&fixture_credential("get")).unwrap();
    let session = h
        .core
        .passkey_authentication_verify(&challenge.challenge_id, &credential)
        .await
        .unwrap();
    assert_eq!(session.access_token, "2s-at");
    assert_eq!(h.core.session().await.unwrap().access_token, "2s-at");
    assert!(h.store.load().is_some());
    assert_eq!(event_log(&h), vec![("SIGNED_IN".to_string(), true)]);
}

#[tokio::test]
async fn two_step_registration_requires_signed_in() {
    let (_server, h) = mock_gotrue().await;
    let err = h.core.passkey_registration_options().await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::SessionExpired);
}

// ---------------------------------------------------------------------------
// US3: manage passkeys
// ---------------------------------------------------------------------------

#[tokio::test]
async fn list_maps_optional_fields() {
    let (server, h) = mock_gotrue().await;
    signed_in(&server, &h).await;

    let mut named = gotrue_passkey("pk-a", Some("Work MacBook"));
    named["last_used_at"] = json!("2026-07-21T09:00:00Z");
    Mock::given(method("GET"))
        .and(path("/auth/v1/passkeys"))
        .and(header("authorization", "Bearer at0"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!([named, gotrue_passkey("pk-b", None)])),
        )
        .mount(&server)
        .await;

    let passkeys = h.core.list_passkeys().await.unwrap();
    assert_eq!(passkeys.len(), 2);
    assert_eq!(passkeys[0].friendly_name.as_deref(), Some("Work MacBook"));
    assert!(passkeys[0].last_used_at.is_some());
    assert!(passkeys[1].friendly_name.is_none());
    assert!(passkeys[1].last_used_at.is_none());
}

#[tokio::test]
async fn rename_patches_and_announces() {
    let (server, h) = mock_gotrue().await;
    signed_in(&server, &h).await;

    Mock::given(method("PATCH"))
        .and(path("/auth/v1/passkeys/pk-a"))
        .and(header("authorization", "Bearer at0"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(gotrue_passkey("pk-a", Some("Work MacBook"))),
        )
        .mount(&server)
        .await;

    let renamed = h.core.rename_passkey("pk-a", "Work MacBook").await.unwrap();
    assert_eq!(renamed.friendly_name.as_deref(), Some("Work MacBook"));

    let req = server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .find(|r| r.method.as_str() == "PATCH")
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&req.body).unwrap();
    assert_eq!(body, json!({ "friendly_name": "Work MacBook" }));

    assert_eq!(passkeys_changed_count(&h), 1);
}

#[tokio::test]
async fn rename_validates_length_before_any_http() {
    let (server, h) = mock_gotrue().await;
    signed_in(&server, &h).await;

    Mock::given(method("PATCH"))
        .and(path("/auth/v1/passkeys/pk-a"))
        .respond_with(ResponseTemplate::new(200))
        .expect(0)
        .mount(&server)
        .await;

    for bad in ["", "   ", &"x".repeat(121)] {
        let err = h.core.rename_passkey("pk-a", bad).await.unwrap_err();
        assert!(
            err.message.contains("between 1 and 120"),
            "got: {}",
            err.message
        );
    }
    // 120 chars exactly is allowed client-side (server mock not mounted for
    // success here; the expect(0) above only guards the invalid cases).
    assert_eq!(passkeys_changed_count(&h), 0);
}

#[tokio::test]
async fn delete_announces_and_allows_deleting_the_last_passkey() {
    let (server, h) = mock_gotrue().await;
    signed_in(&server, &h).await;

    // The server has NO last-passkey guardrail (research R4): deleting the
    // only passkey succeeds — the confirmation warning is kit-side.
    Mock::given(method("DELETE"))
        .and(path("/auth/v1/passkeys/pk-last"))
        .and(header("authorization", "Bearer at0"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    h.core.delete_passkey("pk-last").await.unwrap();
    assert_eq!(passkeys_changed_count(&h), 1);
    // Session untouched.
    assert!(h.core.session().await.is_some());
}

#[tokio::test]
async fn delete_unknown_id_surfaces_not_found_message() {
    let (server, h) = mock_gotrue().await;
    signed_in(&server, &h).await;

    // 404 with error_code validation_failed, message "Passkey not found"
    // (research R4 correction — no dedicated code).
    Mock::given(method("DELETE"))
        .and(path("/auth/v1/passkeys/pk-gone"))
        .respond_with(
            ResponseTemplate::new(404)
                .set_body_json(gotrue_error("validation_failed", "Passkey not found")),
        )
        .mount(&server)
        .await;

    let err = h.core.delete_passkey("pk-gone").await.unwrap_err();
    assert!(err.message.contains("Passkey not found"), "{}", err.message);
    assert_eq!(passkeys_changed_count(&h), 0);
}

#[tokio::test]
async fn management_requires_signed_in() {
    let (_server, h) = mock_gotrue().await;
    for err in [
        h.core.list_passkeys().await.unwrap_err(),
        h.core.rename_passkey("pk", "Name").await.unwrap_err(),
        h.core.delete_passkey("pk").await.unwrap_err(),
    ] {
        assert_eq!(err.kind, ErrorKind::SessionExpired);
    }
}
