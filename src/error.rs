//! Structured, distinguishable error categories (FR-011).
//!
//! Every command rejects with `{ kind, message, retryAfterSecs? }`. `message`
//! is developer-oriented; user-facing strings live in the UI kit.

use serde::Serialize;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    InvalidCredentials,
    EmailAlreadyRegistered,
    EmailNotConfirmed,
    OtpExpired,
    Network,
    Configuration,
    SessionExpired,
    OauthFlowInterrupted,
    RateLimited,
    PermissionDenied,
    /// Linking: the identity is already attached to a different account.
    IdentityAlreadyLinked,
    /// Unlinking: refused because it would remove the last sign-in method.
    LastSignInMethod,
    /// Passkeys: the server challenge expired or was already consumed —
    /// retry with a fresh attempt.
    PasskeyChallengeExpired,
    /// Passkeys: credential verification rejected (bad assertion, duplicate
    /// credential, or per-user limit reached — the message distinguishes).
    PasskeyVerificationFailed,
    /// Passkeys: no ceremony can run here (platform unsupported / no
    /// provider). Never produced by the server.
    PasskeyUnsupported,
    Unknown,
}

#[derive(Debug, Clone, thiserror::Error, Serialize)]
#[serde(rename_all = "camelCase")]
#[error("{kind:?}: {message}")]
pub struct Error {
    pub kind: ErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_secs: Option<u64>,
}

impl Error {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            retry_after_secs: None,
        }
    }

    pub fn configuration(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Configuration, message)
    }

    pub fn network(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Network, message)
    }

    pub fn oauth_interrupted(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::OauthFlowInterrupted, message)
    }

    pub fn session_expired(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::SessionExpired, message)
    }

    pub fn unknown(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Unknown, message)
    }
}

/// Classifies a GoTrue error body (or free-form auth error text) into a kind.
///
/// The supabase crate surfaces GoTrue failures as `Error::Auth { message }`
/// where `message` is usually the raw JSON body, e.g.
/// `{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}`.
pub(crate) fn classify_auth_text(text: &str) -> ErrorKind {
    let t = text.to_ascii_lowercase();
    if t.contains("invalid_credentials")
        || t.contains("invalid login credentials")
        || t.contains("invalid_grant")
    {
        ErrorKind::InvalidCredentials
    // Passkey codes come before the email checks: "credential already
    // registered" must not hit the generic "already registered" branch.
    } else if t.contains("webauthn_challenge_expired") || t.contains("webauthn_challenge_not_found")
    {
        ErrorKind::PasskeyChallengeExpired
    } else if t.contains("webauthn_verification_failed")
        || t.contains("webauthn_credential_exists")
        || t.contains("webauthn_credential_not_found")
        || t.contains("too_many_passkeys")
    {
        ErrorKind::PasskeyVerificationFailed
    } else if t.contains("user_already_exists")
        || t.contains("email_exists")
        || t.contains("already registered")
        || t.contains("already been registered")
    {
        ErrorKind::EmailAlreadyRegistered
    } else if t.contains("email_not_confirmed") || t.contains("email not confirmed") {
        ErrorKind::EmailNotConfirmed
    } else if t.contains("otp_expired")
        || t.contains("otp_disabled")
        || t.contains("token has expired or is invalid")
    {
        ErrorKind::OtpExpired
    } else if t.contains("identity_already_exists") {
        ErrorKind::IdentityAlreadyLinked
    } else if t.contains("single_identity_not_deletable")
        || t.contains("email_conflict_identity_not_deletable")
        || t.contains("at least 1 identity after unlinking")
    {
        ErrorKind::LastSignInMethod
    } else if t.contains("manual_linking_disabled") {
        ErrorKind::Configuration
    } else if t.contains("passkey_disabled") {
        // NOTE: GoTrue answers HTTP 404 here — classification must key on the
        // error code, never the status (research R4).
        ErrorKind::Configuration
    } else if t.contains("insufficient_aal")
        || t.contains("no_authorization")
        || t.contains("not_admin")
    {
        ErrorKind::PermissionDenied
    } else if t.contains("refresh_token_not_found")
        || t.contains("refresh token not found")
        || t.contains("session_expired")
        || t.contains("invalid refresh token")
        || t.contains("refresh_token_already_used")
    {
        ErrorKind::SessionExpired
    } else if t.contains("over_request_rate_limit")
        || t.contains("over_email_send_rate_limit")
        || t.contains("over_sms_send_rate_limit")
        || t.contains("rate limit")
    {
        ErrorKind::RateLimited
    } else {
        ErrorKind::Unknown
    }
}

impl From<supabase::error::Error> for Error {
    fn from(e: supabase::error::Error) -> Self {
        use supabase::error::Error as E;
        match e {
            E::Auth { message, .. } => Error::new(classify_auth_text(&message), message),
            E::Http {
                message, source, ..
            } => {
                let transport = source
                    .as_ref()
                    .map(|s| s.is_connect() || s.is_timeout() || s.is_request())
                    .unwrap_or(false);
                if transport {
                    Error::network(message)
                } else {
                    Error::new(classify_auth_text(&message), message)
                }
            }
            E::Network { message, .. } => Error::network(message),
            E::RateLimit { message, .. } => Error::new(ErrorKind::RateLimited, message),
            E::Config { message } => Error::configuration(message),
            E::InvalidInput { message } => Error::unknown(message),
            E::PermissionDenied { message, .. } => Error::new(ErrorKind::PermissionDenied, message),
            E::Json(e) => Error::unknown(format!("unexpected response shape: {e}")),
            other => Error::unknown(other.to_string()),
        }
    }
}

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        if e.is_connect() || e.is_timeout() || e.is_request() {
            Error::network(e.to_string())
        } else {
            Error::unknown(e.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorization_codes_classify_as_permission_denied() {
        // Kept in lockstep with guest-js/src/web.ts's error mapping: the web
        // bindings classify these GoTrue codes as permissionDenied too.
        for body in [
            r#"{"code":401,"error_code":"no_authorization","msg":"This endpoint requires a Bearer token"}"#,
            r#"{"code":403,"error_code":"not_admin","msg":"User not allowed"}"#,
            r#"{"code":403,"error_code":"insufficient_aal","msg":"AAL2 required"}"#,
        ] {
            assert_eq!(classify_auth_text(body), ErrorKind::PermissionDenied);
        }
    }
}
