//! Pluggable WebAuthn ceremony seam (feature 004, research R5).
//!
//! The plugin owns every server round-trip; only the OS credential prompt is
//! delegated. The webview cannot run WebAuthn on macOS (WKWebView gates
//! `navigator.credentials` behind the Apple-approved-browser entitlement), so
//! the prompt runs natively behind this trait. Precedence: an app-supplied
//! provider (via `PluginBuilder::ceremony_provider`) beats the built-in for
//! the target OS; with neither, passkeys report unusable (FR-006–FR-008).
//!
//! Providers may block: they are invoked on a blocking thread, and no network
//! timeout spans the prompt (FR-014) — the server's challenge TTL is the
//! effective ceiling.

use std::sync::Arc;

#[cfg(target_os = "macos")]
mod macos;

/// Can this provider run a prompt on this device, right now?
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Availability {
    Available,
    /// Machine-readable reason, surfaced through `PasskeyCapability.reason`.
    Unavailable(String),
}

/// Result of one credential prompt. `Completed` carries the raw WebAuthn
/// credential JSON (`navigator.credentials.create()`/`get()` shape) passed to
/// the server verbatim. `Cancelled` is a first-class non-error outcome
/// (FR-009).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CeremonyOutcome {
    Completed(String),
    Cancelled,
    Unsupported(String),
}

/// The OS credential prompt. `options` is the server's WebAuthn options JSON
/// (bare `PublicKeyCredential{Creation,Request}Options`, research R1), passed
/// through verbatim — implementations parse what they need.
pub trait CeremonyProvider: Send + Sync {
    fn availability(&self) -> Availability;
    /// Registration prompt (`navigator.credentials.create()` equivalent).
    fn create(&self, options_json: &str) -> CeremonyOutcome;
    /// Authentication prompt (`navigator.credentials.get()` equivalent).
    fn get(&self, options_json: &str) -> CeremonyOutcome;
}

/// The built-in provider for the compile target, if one exists. Constructed
/// at plugin init with the configured asserted origin (research R8) and
/// installed as the fallback tier — an app-supplied provider always wins.
/// macOS ignores `origin`: the OS derives it from the app's Associated
/// Domains binding. Windows (which does assert the configured origin) lands
/// in T025; Linux has no platform authenticator and always resolves to
/// `None` (FR-007).
#[allow(unused_variables)]
pub fn builtin_provider(origin: Option<&str>) -> Option<Arc<dyn CeremonyProvider>> {
    #[cfg(target_os = "macos")]
    {
        Some(Arc::new(macos::MacOsCeremony::new()))
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}
