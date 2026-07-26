//! Plugin configuration (`plugins.supabase-auth` in tauri.conf.json).
//!
//! Deserialization is lenient (all fields optional / defaulted) so that
//! `validate()` can produce actionable, field-naming diagnostics instead of a
//! generic serde error (FR-012).

use serde::Deserialize;

use crate::error::{Error, Result};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginConfig {
    pub url: Option<String>,
    pub publishable_key: Option<String>,
    #[serde(default)]
    pub session_persistence: SessionPersistence,
    #[serde(default = "default_true")]
    pub auto_refresh: bool,
    #[serde(default = "default_refresh_buffer")]
    pub refresh_buffer_secs: u32,
    #[serde(default)]
    pub oauth: OAuthConfig,
    #[serde(default)]
    pub passkeys: PasskeyConfig,
}

impl Default for PluginConfig {
    fn default() -> Self {
        Self {
            url: None,
            publishable_key: None,
            session_persistence: SessionPersistence::default(),
            auto_refresh: default_true(),
            refresh_buffer_secs: default_refresh_buffer(),
            oauth: OAuthConfig::default(),
            passkeys: PasskeyConfig::default(),
        }
    }
}

/// Passkey (WebAuthn) settings — feature 004, research R8.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasskeyConfig {
    /// Origin the built-in native ceremonies assert in `clientDataJSON`,
    /// e.g. `https://yourdomain.com`. Must be listed in the project's
    /// `GOTRUE_WEBAUTHN_RP_ORIGINS`. Only required when a built-in ceremony
    /// is used; app-supplied ceremonies handle their own origin.
    pub origin: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionPersistence {
    #[default]
    Keychain,
    File,
    None,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OAuthConfig {
    #[serde(default = "default_callback_ports")]
    pub callback_ports: Vec<u16>,
    #[serde(default = "default_flow_timeout")]
    pub flow_timeout_secs: u32,
}

impl Default for OAuthConfig {
    fn default() -> Self {
        Self {
            callback_ports: default_callback_ports(),
            flow_timeout_secs: default_flow_timeout(),
        }
    }
}

fn default_true() -> bool {
    true
}
fn default_refresh_buffer() -> u32 {
    60
}
fn default_callback_ports() -> Vec<u16> {
    vec![43823, 43824, 43825]
}
fn default_flow_timeout() -> u32 {
    300
}

/// Configuration after startup validation; all invariants hold.
#[derive(Debug, Clone)]
pub struct ValidatedConfig {
    pub url: String,
    pub publishable_key: String,
    pub session_persistence: SessionPersistence,
    pub auto_refresh: bool,
    pub refresh_buffer_secs: u32,
    pub callback_ports: Vec<u16>,
    pub flow_timeout_secs: u32,
    pub passkey_origin: Option<String>,
}

impl PluginConfig {
    pub fn validate(self) -> Result<ValidatedConfig> {
        let url = self.url.filter(|u| !u.trim().is_empty()).ok_or_else(|| {
            Error::configuration(
                "supabase-auth: missing required config 'url' — set plugins.supabase-auth.url \
                 in tauri.conf.json to your Supabase project URL (https://<project>.supabase.co)",
            )
        })?;
        let parsed = url::Url::parse(&url).map_err(|e| {
            Error::configuration(format!(
                "supabase-auth: 'url' is not a valid URL (got {url:?}): {e}"
            ))
        })?;
        if parsed.scheme() != "https" && parsed.scheme() != "http" {
            return Err(Error::configuration(format!(
                "supabase-auth: 'url' must be an http(s) URL (got {url:?})"
            )));
        }
        // Loopback development stacks are the only sanctioned use of plain http.
        if parsed.scheme() == "http" {
            let host = parsed.host_str().unwrap_or_default();
            if host != "localhost" && host != "127.0.0.1" && host != "[::1]" {
                return Err(Error::configuration(format!(
                    "supabase-auth: 'url' must use https for non-local hosts (got {url:?})"
                )));
            }
        }

        let publishable_key = self
            .publishable_key
            .filter(|k| !k.trim().is_empty())
            .ok_or_else(|| {
                Error::configuration(
                    "supabase-auth: missing required config 'publishableKey' — set \
                 plugins.supabase-auth.publishableKey to your project's publishable (anon) key. \
                 Never use the service-role key here.",
                )
            })?;

        if self.refresh_buffer_secs == 0 {
            return Err(Error::configuration(
                "supabase-auth: 'refreshBufferSecs' must be greater than 0",
            ));
        }
        if self.oauth.flow_timeout_secs == 0 {
            return Err(Error::configuration(
                "supabase-auth: 'oauth.flowTimeoutSecs' must be greater than 0",
            ));
        }
        if self.oauth.callback_ports.is_empty() {
            return Err(Error::configuration(
                "supabase-auth: 'oauth.callbackPorts' must list at least one port",
            ));
        }
        if let Some(p) = self.oauth.callback_ports.iter().find(|p| **p < 1024) {
            return Err(Error::configuration(format!(
                "supabase-auth: 'oauth.callbackPorts' entries must be >= 1024 (got {p})"
            )));
        }

        let passkey_origin = match self.passkeys.origin.filter(|o| !o.trim().is_empty()) {
            None => None,
            Some(origin) => {
                let parsed = url::Url::parse(&origin).map_err(|e| {
                    Error::configuration(format!(
                        "supabase-auth: 'passkeys.origin' is not a valid URL (got {origin:?}): {e}"
                    ))
                })?;
                if parsed.scheme() != "https" && parsed.scheme() != "http" {
                    return Err(Error::configuration(format!(
                        "supabase-auth: 'passkeys.origin' must be an http(s) origin (got {origin:?})"
                    )));
                }
                Some(origin.trim_end_matches('/').to_string())
            }
        };

        Ok(ValidatedConfig {
            url: url.trim_end_matches('/').to_string(),
            publishable_key,
            session_persistence: self.session_persistence,
            auto_refresh: self.auto_refresh,
            refresh_buffer_secs: self.refresh_buffer_secs,
            callback_ports: self.oauth.callback_ports,
            flow_timeout_secs: self.oauth.flow_timeout_secs,
            passkey_origin,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> PluginConfig {
        PluginConfig {
            url: Some("https://proj.supabase.co".into()),
            publishable_key: Some("anon-key".into()),
            ..Default::default()
        }
    }

    #[test]
    fn valid_config_passes_with_defaults() {
        let v = base().validate().unwrap();
        assert_eq!(v.url, "https://proj.supabase.co");
        assert!(v.auto_refresh);
        assert_eq!(v.refresh_buffer_secs, 60);
        assert_eq!(v.callback_ports, vec![43823, 43824, 43825]);
        assert_eq!(v.session_persistence, SessionPersistence::Keychain);
    }

    #[test]
    fn missing_url_names_the_field() {
        let mut c = base();
        c.url = None;
        let err = c.validate().unwrap_err();
        assert_eq!(err.kind, crate::error::ErrorKind::Configuration);
        assert!(err.message.contains("'url'"), "message: {}", err.message);
    }

    #[test]
    fn malformed_url_is_rejected_with_value_in_message() {
        let mut c = base();
        c.url = Some("htp://nope".into());
        let err = c.validate().unwrap_err();
        assert!(err.message.contains("htp://nope"));
    }

    #[test]
    fn missing_key_names_the_field() {
        let mut c = base();
        c.publishable_key = Some("  ".into());
        let err = c.validate().unwrap_err();
        assert!(err.message.contains("publishableKey"));
    }

    #[test]
    fn plain_http_only_for_loopback() {
        let mut c = base();
        c.url = Some("http://127.0.0.1:54321".into());
        assert!(c.clone().validate().is_ok());
        c.url = Some("http://example.com".into());
        assert!(c.validate().is_err());
    }

    #[test]
    fn zero_refresh_buffer_rejected() {
        let mut c = base();
        c.refresh_buffer_secs = 0;
        assert!(c.validate().is_err());
    }
}
