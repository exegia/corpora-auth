//! Serde models crossing the plugin boundary (commands, events, Rust API).
//!
//! Wire format is camelCase JSON. `Session` is the full session available to
//! Rust callers; `SanitizedSession` is what crosses into the webview and never
//! carries the refresh token.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub email_confirmed_at: Option<DateTime<Utc>>,
    pub phone_confirmed_at: Option<DateTime<Utc>>,
    pub last_sign_in_at: Option<DateTime<Utc>>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub user_metadata: serde_json::Value,
    #[serde(default)]
    pub app_metadata: serde_json::Value,
}

impl From<supabase::auth::User> for User {
    fn from(u: supabase::auth::User) -> Self {
        Self {
            id: u.id.to_string(),
            email: u.email,
            phone: u.phone,
            email_confirmed_at: u.email_confirmed_at,
            phone_confirmed_at: u.phone_confirmed_at,
            last_sign_in_at: u.last_sign_in_at,
            created_at: Some(u.created_at),
            updated_at: Some(u.updated_at),
            user_metadata: u.user_metadata,
            app_metadata: u.app_metadata,
        }
    }
}

/// Full session; only exposed to Rust-side consumers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: DateTime<Utc>,
    pub token_type: String,
    pub user: User,
}

impl Session {
    pub fn sanitized(&self) -> SanitizedSession {
        SanitizedSession {
            access_token: self.access_token.clone(),
            expires_at: self.expires_at,
            token_type: self.token_type.clone(),
            user: self.user.clone(),
        }
    }

    pub fn is_expired(&self) -> bool {
        self.expires_at <= Utc::now()
    }

    pub(crate) fn to_supabase(&self) -> supabase::auth::Session {
        supabase::auth::Session {
            access_token: self.access_token.clone(),
            refresh_token: self.refresh_token.clone(),
            expires_in: (self.expires_at - Utc::now()).num_seconds().max(0),
            expires_at: self.expires_at,
            token_type: self.token_type.clone(),
            user: supabase_user_roundtrip(&self.user),
        }
    }
}

impl From<supabase::auth::Session> for Session {
    fn from(s: supabase::auth::Session) -> Self {
        Self {
            access_token: s.access_token,
            refresh_token: s.refresh_token,
            expires_at: s.expires_at,
            token_type: s.token_type,
            user: s.user.into(),
        }
    }
}

// The supabase crate's `User` has non-optional created_at/updated_at and a Uuid
// id; when converting back (only needed to seed the crate's internal session on
// restore) missing values fall back to sensible zero values.
fn supabase_user_roundtrip(u: &User) -> supabase::auth::User {
    supabase::auth::User {
        id: u.id.parse().unwrap_or_default(),
        email: u.email.clone(),
        phone: u.phone.clone(),
        email_confirmed_at: u.email_confirmed_at,
        phone_confirmed_at: u.phone_confirmed_at,
        created_at: u.created_at.unwrap_or(DateTime::UNIX_EPOCH),
        updated_at: u.updated_at.unwrap_or(DateTime::UNIX_EPOCH),
        last_sign_in_at: u.last_sign_in_at,
        app_metadata: u.app_metadata.clone(),
        user_metadata: u.user_metadata.clone(),
        aud: String::new(),
        role: None,
    }
}

/// Session shape sent to the webview: no refresh token.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SanitizedSession {
    pub access_token: String,
    pub expires_at: DateTime<Utc>,
    pub token_type: String,
    pub user: User,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthChangeEvent {
    #[serde(rename = "SIGNED_IN")]
    SignedIn,
    #[serde(rename = "SIGNED_OUT")]
    SignedOut,
    #[serde(rename = "TOKEN_REFRESHED")]
    TokenRefreshed,
    #[serde(rename = "PASSWORD_RECOVERY")]
    PasswordRecovery,
    #[serde(rename = "IDENTITIES_CHANGED")]
    IdentitiesChanged,
    #[serde(rename = "PASSKEYS_CHANGED")]
    PasskeysChanged,
}

/// One sign-in method attached to the account (feature 003). Mapped from the
/// GoTrue identity object; note GoTrue's confusing wire naming — its `id` is
/// the provider-specific subject, while `identity_id` is the row key used for
/// unlinking. The raw `identity_data` claims blob is deliberately not exposed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub identity_id: String,
    pub provider_subject: String,
    pub provider: String,
    pub email: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub last_sign_in_at: Option<DateTime<Utc>>,
}

/// A passkey registered on the account (feature 004). Mapped from GoTrue's
/// `PasskeyListItem`; the server never exposes credential/public-key material.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Passkey {
    pub id: String,
    /// Auto-derived from the authenticator AAGUID at registration; user-set
    /// afterwards via rename (1–120 chars).
    pub friendly_name: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub last_used_at: Option<DateTime<Utc>>,
}

/// Whether passkey prompts can run on this device (FR-008). Reflects ceremony
/// availability only — project configuration problems surface as
/// `configuration` errors at call time (research R7).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyCapability {
    pub usable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Challenge material for the two-step (app-supplied ceremony) surface.
/// `options` is the server's WebAuthn options JSON, passed through verbatim.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyChallenge {
    pub challenge_id: String,
    pub options: serde_json::Value,
    /// Unix seconds; the server consumes the challenge exactly once.
    pub expires_at: i64,
}

/// User cancellation of the OS prompt is a status, never an error (FR-009).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PasskeyFlowStatus {
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyRegistrationResult {
    pub status: PasskeyFlowStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passkey: Option<Passkey>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PasskeySignInResult {
    pub status: PasskeyFlowStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<SanitizedSession>,
}

/// Payload of the `supabase-auth://auth-state-changed` event.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthChangePayload {
    pub event: AuthChangeEvent,
    pub session: Option<SanitizedSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SignUpResult {
    pub status: SignUpStatus,
    pub session: Option<SanitizedSession>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SignUpStatus {
    SignedIn,
    PendingConfirmation,
}
