//! Third-party sign-in via system browser (FR-010, research R2):
//! PKCE against GoTrue + one-shot localhost loopback callback server.
//!
//! Flow: generate PKCE verifier/challenge → bind an ephemeral 127.0.0.1
//! server on a configured port → open the `/authorize?flow_type=pkce` URL in
//! the system browser → capture `?code=...` on the loopback redirect →
//! exchange it (`grant_type=pkce`) with the verifier → hand the session to
//! `AuthCore`. Abandoned flows time out; cancellation shuts the server down.

use std::sync::Arc;

use base64::Engine as _;
use rand::RngCore;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Notify;

use crate::error::{Error, Result};
use crate::models::Session;
use crate::state::AuthCore;

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

pub fn generate_pkce() -> Pkce {
    let mut bytes = [0u8; 48];
    rand::thread_rng().fill_bytes(&mut bytes);
    let verifier = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    let digest = Sha256::digest(verifier.as_bytes());
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest);
    Pkce {
        verifier,
        challenge,
    }
}

/// Runs the complete OAuth round-trip. `open_browser` is injected so tests
/// can drive the flow without a real browser.
pub async fn run_flow(
    core: &AuthCore,
    provider: &str,
    scopes: Option<Vec<String>>,
    cancel: Arc<Notify>,
    open_browser: impl FnOnce(String) -> Result<()>,
) -> Result<Session> {
    let pkce = generate_pkce();
    let expected_state = random_state();

    // One-shot loopback server on the first available configured port.
    let (listener, port) = bind_loopback(&core.config.callback_ports).await?;
    let redirect = format!("http://127.0.0.1:{port}/callback");

    let mut url = url::Url::parse(&core.engine.authorize_url(
        provider,
        scopes.as_deref(),
        &redirect,
        &pkce.challenge,
    ))
    .map_err(|e| Error::unknown(format!("authorize url: {e}")))?;
    url.query_pairs_mut().append_pair("state", &expected_state);

    open_browser(url.to_string())?;

    let timeout = std::time::Duration::from_secs(core.config.flow_timeout_secs as u64);
    let code = tokio::select! {
        r = capture_code(listener, &expected_state) => r?,
        _ = cancel.notified() => {
            return Err(Error::oauth_interrupted("OAuth flow cancelled"));
        }
        _ = tokio::time::sleep(timeout) => {
            return Err(Error::oauth_interrupted(format!(
                "OAuth flow timed out after {}s (browser round-trip not completed)",
                timeout.as_secs()
            )));
        }
    };

    core.engine.exchange_pkce_code(&code, &pkce.verifier).await
}

fn random_state() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

async fn bind_loopback(ports: &[u16]) -> Result<(TcpListener, u16)> {
    for port in ports {
        match TcpListener::bind(("127.0.0.1", *port)).await {
            Ok(l) => return Ok((l, *port)),
            Err(e) => tracing::debug!("callback port {port} unavailable: {e}"),
        }
    }
    Err(Error::configuration(format!(
        "supabase-auth: none of the configured oauth.callbackPorts {ports:?} could be bound"
    )))
}

/// Accepts connections until one carries a valid callback. Rejects unexpected
/// paths and state mismatches rather than consuming them as the one-shot.
async fn capture_code(listener: TcpListener, expected_state: &str) -> Result<String> {
    loop {
        let (mut stream, _) = listener
            .accept()
            .await
            .map_err(|e| Error::unknown(format!("callback server accept: {e}")))?;

        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).await.unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);

        let Some(target) = request
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
        else {
            respond(&mut stream, 400, "Bad request").await;
            continue;
        };

        let Ok(url) = url::Url::parse(&format!("http://127.0.0.1{target}")) else {
            respond(&mut stream, 400, "Bad request").await;
            continue;
        };
        if url.path() != "/callback" {
            respond(&mut stream, 404, "Not found").await;
            continue;
        }

        let mut code = None;
        let mut state = None;
        let mut provider_error = None;
        for (k, v) in url.query_pairs() {
            match k.as_ref() {
                "code" => code = Some(v.into_owned()),
                "state" => state = Some(v.into_owned()),
                "error" | "error_description" => provider_error = Some(v.into_owned()),
                _ => {}
            }
        }

        if let Some(err) = provider_error {
            respond(
                &mut stream,
                200,
                "Sign-in was not completed. You can close this window.",
            )
            .await;
            return Err(Error::oauth_interrupted(format!(
                "provider returned an error: {err}"
            )));
        }
        if state.as_deref() != Some(expected_state) {
            tracing::warn!("oauth callback state mismatch; ignoring request");
            respond(&mut stream, 400, "State mismatch").await;
            continue;
        }
        let Some(code) = code else {
            respond(&mut stream, 400, "Missing code").await;
            continue;
        };

        respond(
            &mut stream,
            200,
            "Signed in. You can close this window and return to the app.",
        )
        .await;
        return Ok(code);
    }
}

async fn respond(stream: &mut tokio::net::TcpStream, status: u16, body: &str) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "",
    };
    let html = format!(
        "<!doctype html><html><body style=\"font-family:system-ui;padding:2rem\"><p>{body}</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}",
        html.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_is_s256_of_verifier() {
        let p = generate_pkce();
        let digest = Sha256::digest(p.verifier.as_bytes());
        let expected = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest);
        assert_eq!(p.challenge, expected);
        // RFC 7636: verifier must be 43..=128 chars.
        assert!((43..=128).contains(&p.verifier.len()));
    }
}
