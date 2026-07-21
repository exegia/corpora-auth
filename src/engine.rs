//! `AuthEngine` — the single wrapper around `supabase-lib-rs` (research R1).
//!
//! No supabase-lib-rs types escape this module: commands and state code only
//! see `crate::models` / `crate::error` types, so the underlying crate can be
//! swapped without touching anything else.
//!
//! The engine also owns a thin GoTrue REST helper for the operations the
//! crate does not implement: email/recovery OTP verification, phone OTP
//! requests, and the PKCE code exchange (research R2).

use chrono::{DateTime, TimeZone, Utc};
use serde::Deserialize;
use serde_json::json;

use crate::error::{classify_auth_text, Error, ErrorKind, Result};
use crate::models::{Identity, Session, SignUpResult, SignUpStatus, User};

pub struct AuthEngine {
    client: supabase::Client,
    rest: RestClient,
}

pub enum OtpTarget {
    Email(String),
    Phone(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OtpKind {
    Email,
    Sms,
    Recovery,
}

impl OtpKind {
    fn as_str(&self) -> &'static str {
        match self {
            OtpKind::Email => "email",
            OtpKind::Sms => "sms",
            OtpKind::Recovery => "recovery",
        }
    }
}

impl AuthEngine {
    pub fn new(url: &str, publishable_key: &str) -> Result<Self> {
        let client = supabase::Client::new(url, publishable_key)
            .map_err(|e| Error::configuration(format!("failed to construct client: {e}")))?;
        Ok(Self {
            client,
            rest: RestClient::new(url, publishable_key)?,
        })
    }

    pub async fn sign_up(
        &self,
        email: &str,
        password: &str,
        data: Option<serde_json::Value>,
    ) -> Result<(SignUpResult, Option<Session>)> {
        let resp = self
            .client
            .auth()
            .sign_up_with_email_password_and_data(email, password, data, None)
            .await?;
        match resp.session {
            Some(s) => {
                let session: Session = s.into();
                Ok((
                    SignUpResult {
                        status: SignUpStatus::SignedIn,
                        session: Some(session.sanitized()),
                    },
                    Some(session),
                ))
            }
            None => Ok((
                SignUpResult {
                    status: SignUpStatus::PendingConfirmation,
                    session: None,
                },
                None,
            )),
        }
    }

    pub async fn sign_in_with_password(&self, email: &str, password: &str) -> Result<Session> {
        let resp = self
            .client
            .auth()
            .sign_in_with_email_and_password(email, password)
            .await?;
        resp.session
            .map(Into::into)
            .ok_or_else(|| Error::unknown("sign-in response contained no session"))
    }

    /// Requests a magic link / one-time code (email) or SMS code (phone).
    pub async fn request_otp(&self, target: &OtpTarget, redirect_to: Option<String>) -> Result<()> {
        match target {
            OtpTarget::Email(email) => {
                self.client
                    .auth()
                    .sign_in_with_magic_link(email, redirect_to, None)
                    .await?;
                Ok(())
            }
            // The crate has no phone-OTP *request*; use GoTrue's /otp directly.
            OtpTarget::Phone(phone) => self.rest.request_phone_otp(phone).await,
        }
    }

    /// Verifies a one-time code. Email/recovery verification is not supported
    /// by the crate (phone-only signature), so all verification goes through
    /// GoTrue's `/verify` for uniform behavior.
    pub async fn verify_otp(
        &self,
        target: &OtpTarget,
        token: &str,
        kind: OtpKind,
    ) -> Result<Session> {
        let session = self.rest.verify_otp(target, token, kind).await?;
        self.adopt(&session).await;
        Ok(session)
    }

    pub async fn sign_out(&self) -> Result<()> {
        self.client.auth().sign_out().await?;
        Ok(())
    }

    pub async fn refresh_session(&self) -> Result<Session> {
        let resp = self.client.auth().refresh_session().await?;
        resp.session
            .map(Into::into)
            .ok_or_else(|| Error::session_expired("refresh returned no session"))
    }

    pub async fn reset_password_for_email(
        &self,
        email: &str,
        redirect_to: Option<String>,
    ) -> Result<()> {
        self.client
            .auth()
            .reset_password_for_email_with_redirect(email, redirect_to)
            .await?;
        Ok(())
    }

    /// Direct REST: the crate parses GoTrue's bare-user response into its
    /// `{user, session}` envelope and always loses the result.
    pub async fn update_user(
        &self,
        access_token: &str,
        email: Option<String>,
        password: Option<String>,
        data: Option<serde_json::Value>,
    ) -> Result<User> {
        self.rest
            .update_user(access_token, email, password, data)
            .await
    }

    /// Seeds the underlying client with a session (restore, OAuth exchange),
    /// so subsequent refresh/sign-out/update calls are authenticated.
    pub async fn adopt(&self, session: &Session) {
        if let Err(e) = self.client.auth().set_session(session.to_supabase()).await {
            tracing::warn!("failed to seed engine session: {e}");
        }
    }

    pub async fn forget(&self) {
        if let Err(e) = self.client.auth().clear_session().await {
            tracing::debug!("clear_session: {e}");
        }
    }

    /// Builds the `/authorize` URL for a PKCE OAuth flow (research R2).
    pub fn authorize_url(
        &self,
        provider: &str,
        scopes: Option<&[String]>,
        redirect_to: &str,
        code_challenge: &str,
    ) -> String {
        self.rest
            .authorize_url(provider, scopes, redirect_to, code_challenge)
    }

    /// Exchanges a PKCE auth code for a session and adopts it.
    pub async fn exchange_pkce_code(&self, code: &str, verifier: &str) -> Result<Session> {
        let session = self.rest.exchange_pkce(code, verifier).await?;
        self.adopt(&session).await;
        Ok(session)
    }

    // -- identity management (feature 003; crate has no support — REST only) --

    /// Reads the user's identities off `GET /auth/v1/user` (there is no
    /// dedicated list endpoint). Returns the refreshed user too.
    pub async fn get_identities(&self, access_token: &str) -> Result<(User, Vec<Identity>)> {
        self.rest
            .get_user_identities(access_token)
            .await
            .map_err(manual_linking_hint)
    }

    /// Fetches the provider authorize URL for linking an identity to the
    /// current (bearer-authenticated) account.
    pub async fn link_authorize_url(
        &self,
        access_token: &str,
        provider: &str,
        scopes: Option<&[String]>,
        redirect_to: &str,
        code_challenge: &str,
    ) -> Result<String> {
        self.rest
            .link_authorize_url(access_token, provider, scopes, redirect_to, code_challenge)
            .await
            .map_err(manual_linking_hint)
    }

    pub async fn unlink_identity(&self, access_token: &str, identity_id: &str) -> Result<()> {
        self.rest
            .unlink_identity(access_token, identity_id)
            .await
            .map_err(manual_linking_hint)
    }
}

/// Makes the `manual_linking_disabled` failure actionable (FR edge case).
fn manual_linking_hint(mut e: Error) -> Error {
    if e.kind == ErrorKind::Configuration && e.message.contains("manual_linking_disabled") {
        e.message.push_str(
            " — enable manual identity linking on the project: \
             [auth] enable_manual_linking = true in supabase/config.toml (local), \
             GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=true (self-hosted), \
             or the Authentication settings toggle in the dashboard",
        );
    }
    e
}

// ---------------------------------------------------------------------------
// Direct GoTrue REST (the crate's gaps only)
// ---------------------------------------------------------------------------

struct RestClient {
    http: reqwest::Client,
    base: String,
    key: String,
}

/// GoTrue session response; `expires_at` is optional on some endpoints.
#[derive(Deserialize)]
struct WireSession {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    expires_at: Option<i64>,
    token_type: String,
    user: WireUser,
}

#[derive(Deserialize)]
struct WireUser {
    id: String,
    email: Option<String>,
    phone: Option<String>,
    email_confirmed_at: Option<DateTime<Utc>>,
    phone_confirmed_at: Option<DateTime<Utc>>,
    last_sign_in_at: Option<DateTime<Utc>>,
    created_at: Option<DateTime<Utc>>,
    updated_at: Option<DateTime<Utc>>,
    #[serde(default)]
    user_metadata: serde_json::Value,
    #[serde(default)]
    app_metadata: serde_json::Value,
}

#[derive(Deserialize)]
struct WireIdentity {
    identity_id: String,
    id: String,
    provider: String,
    email: Option<String>,
    created_at: Option<DateTime<Utc>>,
    last_sign_in_at: Option<DateTime<Utc>>,
}

impl WireIdentity {
    fn into_identity(self) -> Identity {
        Identity {
            identity_id: self.identity_id,
            provider_subject: self.id,
            provider: self.provider,
            email: self.email,
            created_at: self.created_at,
            last_sign_in_at: self.last_sign_in_at,
        }
    }
}

#[derive(Deserialize)]
struct WireUserWithIdentities {
    #[serde(flatten)]
    user: WireUser,
    #[serde(default)]
    identities: Vec<WireIdentity>,
}

impl WireUserWithIdentities {
    fn split(self) -> (User, Vec<Identity>) {
        let identities = self
            .identities
            .into_iter()
            .map(WireIdentity::into_identity)
            .collect();
        let u = self.user;
        let user = User {
            id: u.id,
            email: u.email,
            phone: u.phone,
            email_confirmed_at: u.email_confirmed_at,
            phone_confirmed_at: u.phone_confirmed_at,
            last_sign_in_at: u.last_sign_in_at,
            created_at: u.created_at,
            updated_at: u.updated_at,
            user_metadata: u.user_metadata,
            app_metadata: u.app_metadata,
        };
        (user, identities)
    }
}

impl WireSession {
    fn into_session(self) -> Session {
        let expires_at = self
            .expires_at
            .and_then(|t| Utc.timestamp_opt(t, 0).single())
            .unwrap_or_else(|| Utc::now() + chrono::Duration::seconds(self.expires_in));
        Session {
            access_token: self.access_token,
            refresh_token: self.refresh_token,
            expires_at,
            token_type: self.token_type,
            user: User {
                id: self.user.id,
                email: self.user.email,
                phone: self.user.phone,
                email_confirmed_at: self.user.email_confirmed_at,
                phone_confirmed_at: self.user.phone_confirmed_at,
                last_sign_in_at: self.user.last_sign_in_at,
                created_at: self.user.created_at,
                updated_at: self.user.updated_at,
                user_metadata: self.user.user_metadata,
                app_metadata: self.user.app_metadata,
            },
        }
    }
}

impl RestClient {
    fn new(base: &str, key: &str) -> Result<Self> {
        let http = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| Error::configuration(format!("failed to build http client: {e}")))?;
        Ok(Self {
            http,
            base: base.trim_end_matches('/').to_string(),
            key: key.to_string(),
        })
    }

    async fn request_phone_otp(&self, phone: &str) -> Result<()> {
        let resp = self
            .http
            .post(format!("{}/auth/v1/otp", self.base))
            .header("apikey", &self.key)
            .json(&json!({ "phone": phone }))
            .send()
            .await?;
        Self::ok_or_classified(resp).await?;
        Ok(())
    }

    async fn verify_otp(&self, target: &OtpTarget, token: &str, kind: OtpKind) -> Result<Session> {
        let mut body = json!({ "token": token, "type": kind.as_str() });
        match target {
            OtpTarget::Email(email) => body["email"] = json!(email),
            OtpTarget::Phone(phone) => body["phone"] = json!(phone),
        }
        let resp = self
            .http
            .post(format!("{}/auth/v1/verify", self.base))
            .header("apikey", &self.key)
            .json(&body)
            .send()
            .await?;
        let resp = Self::ok_or_classified(resp).await?;
        let wire: WireSession = resp
            .json()
            .await
            .map_err(|e| Error::unknown(format!("unexpected verify response: {e}")))?;
        Ok(wire.into_session())
    }

    fn authorize_url(
        &self,
        provider: &str,
        scopes: Option<&[String]>,
        redirect_to: &str,
        code_challenge: &str,
    ) -> String {
        let mut url = url::Url::parse(&format!("{}/auth/v1/authorize", self.base))
            .expect("base url validated at startup");
        {
            let mut q = url.query_pairs_mut();
            q.append_pair("provider", provider);
            q.append_pair("redirect_to", redirect_to);
            q.append_pair("code_challenge", code_challenge);
            q.append_pair("code_challenge_method", "s256");
            q.append_pair("flow_type", "pkce");
            if let Some(scopes) = scopes.filter(|s| !s.is_empty()) {
                q.append_pair("scopes", &scopes.join(" "));
            }
        }
        url.to_string()
    }

    async fn update_user(
        &self,
        access_token: &str,
        email: Option<String>,
        password: Option<String>,
        data: Option<serde_json::Value>,
    ) -> Result<User> {
        let mut body = serde_json::Map::new();
        if let Some(e) = email {
            body.insert("email".into(), json!(e));
        }
        if let Some(p) = password {
            body.insert("password".into(), json!(p));
        }
        if let Some(d) = data {
            body.insert("data".into(), d);
        }
        let resp = self
            .http
            .put(format!("{}/auth/v1/user", self.base))
            .header("apikey", &self.key)
            .header("Authorization", format!("Bearer {access_token}"))
            .json(&serde_json::Value::Object(body))
            .send()
            .await?;
        let resp = Self::ok_or_classified(resp).await?;
        let wire: WireUser = resp
            .json()
            .await
            .map_err(|e| Error::unknown(format!("unexpected user response: {e}")))?;
        Ok(User {
            id: wire.id,
            email: wire.email,
            phone: wire.phone,
            email_confirmed_at: wire.email_confirmed_at,
            phone_confirmed_at: wire.phone_confirmed_at,
            last_sign_in_at: wire.last_sign_in_at,
            created_at: wire.created_at,
            updated_at: wire.updated_at,
            user_metadata: wire.user_metadata,
            app_metadata: wire.app_metadata,
        })
    }

    async fn get_user_identities(&self, access_token: &str) -> Result<(User, Vec<Identity>)> {
        let resp = self
            .http
            .get(format!("{}/auth/v1/user", self.base))
            .header("apikey", &self.key)
            .header("Authorization", format!("Bearer {access_token}"))
            .send()
            .await?;
        let resp = Self::ok_or_classified(resp).await?;
        let wire: WireUserWithIdentities = resp
            .json()
            .await
            .map_err(|e| Error::unknown(format!("unexpected user response: {e}")))?;
        Ok(wire.split())
    }

    async fn link_authorize_url(
        &self,
        access_token: &str,
        provider: &str,
        scopes: Option<&[String]>,
        redirect_to: &str,
        code_challenge: &str,
    ) -> Result<String> {
        let mut url = url::Url::parse(&format!("{}/auth/v1/user/identities/authorize", self.base))
            .expect("base url validated at startup");
        {
            let mut q = url.query_pairs_mut();
            q.append_pair("provider", provider);
            q.append_pair("redirect_to", redirect_to);
            q.append_pair("code_challenge", code_challenge);
            q.append_pair("code_challenge_method", "s256");
            q.append_pair("skip_http_redirect", "true");
            if let Some(scopes) = scopes.filter(|s| !s.is_empty()) {
                q.append_pair("scopes", &scopes.join(" "));
            }
        }
        let resp = self
            .http
            .get(url)
            .header("apikey", &self.key)
            .header("Authorization", format!("Bearer {access_token}"))
            .send()
            .await?;
        let resp = Self::ok_or_classified(resp).await?;
        #[derive(Deserialize)]
        struct AuthorizeResponse {
            url: String,
        }
        let body: AuthorizeResponse = resp
            .json()
            .await
            .map_err(|e| Error::unknown(format!("unexpected authorize response: {e}")))?;
        Ok(body.url)
    }

    async fn unlink_identity(&self, access_token: &str, identity_id: &str) -> Result<()> {
        let resp = self
            .http
            .delete(format!(
                "{}/auth/v1/user/identities/{identity_id}",
                self.base
            ))
            .header("apikey", &self.key)
            .header("Authorization", format!("Bearer {access_token}"))
            .send()
            .await?;
        Self::ok_or_classified(resp).await?;
        Ok(())
    }

    async fn exchange_pkce(&self, code: &str, verifier: &str) -> Result<Session> {
        let resp = self
            .http
            .post(format!("{}/auth/v1/token?grant_type=pkce", self.base))
            .header("apikey", &self.key)
            .json(&json!({ "auth_code": code, "code_verifier": verifier }))
            .send()
            .await?;
        let resp = Self::ok_or_classified(resp).await?;
        let wire: WireSession = resp
            .json()
            .await
            .map_err(|e| Error::unknown(format!("unexpected token response: {e}")))?;
        Ok(wire.into_session())
    }

    async fn ok_or_classified(resp: reqwest::Response) -> Result<reqwest::Response> {
        if resp.status().is_success() {
            return Ok(resp);
        }
        let status = resp.status();
        let retry_after = resp
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        let body = resp.text().await.unwrap_or_default();
        let kind = if status.as_u16() == 429 {
            ErrorKind::RateLimited
        } else {
            classify_auth_text(&body)
        };
        let mut err = Error::new(kind, format!("gotrue {status}: {body}"));
        err.retry_after_secs = retry_after;
        Err(err)
    }
}
