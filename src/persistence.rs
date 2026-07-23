//! Session persistence backends (FR-007).
//!
//! Sessions are stored only in per-user private locations. Any read failure —
//! missing entry, corrupt payload, permission problem — is treated as "no
//! stored session" (signed-out), never an error surfaced to the user.

use std::path::PathBuf;

use crate::models::Session;

pub trait SessionStore: Send + Sync {
    /// Returns the stored session, or `None` when absent/unreadable/corrupt.
    fn load(&self) -> Option<Session>;
    /// Persists the session. Failures are logged, not fatal.
    fn save(&self, session: &Session);
    /// Removes any stored session material.
    fn clear(&self);
}

/// OS credential store (macOS Keychain / Windows Credential Manager / Linux
/// Secret Service) via the `keyring` crate. Default backend.
pub struct KeychainStore {
    service: String,
}

impl KeychainStore {
    /// `identifier` should be the app identifier so multiple apps on one
    /// machine keep separate sessions.
    pub fn new(identifier: &str) -> Self {
        Self {
            service: format!("tauri-plugin-supabase-auth:{identifier}"),
        }
    }

    fn entry(&self) -> Option<keyring::Entry> {
        match keyring::Entry::new(&self.service, "session") {
            Ok(e) => Some(e),
            Err(e) => {
                tracing::warn!("keychain unavailable: {e}");
                None
            }
        }
    }
}

impl SessionStore for KeychainStore {
    fn load(&self) -> Option<Session> {
        let raw = self.entry()?.get_password().ok()?;
        match serde_json::from_str(&raw) {
            Ok(s) => Some(s),
            Err(e) => {
                tracing::warn!("stored session is corrupt; treating as signed-out: {e}");
                None
            }
        }
    }

    fn save(&self, session: &Session) {
        let Some(entry) = self.entry() else { return };
        match serde_json::to_string(session) {
            Ok(raw) => {
                if let Err(e) = entry.set_password(&raw) {
                    tracing::warn!("failed to persist session to keychain: {e}");
                }
            }
            Err(e) => tracing::warn!("failed to serialize session: {e}"),
        }
    }

    fn clear(&self) {
        if let Some(entry) = self.entry() {
            // NoEntry is fine; anything else is worth a log line.
            if let Err(e) = entry.delete_credential() {
                if !matches!(e, keyring::Error::NoEntry) {
                    tracing::warn!("failed to clear keychain session: {e}");
                }
            }
        }
    }
}

/// Private file in the app's data directory with 0600 permissions. Fallback
/// for environments without a secret service (headless Linux, CI).
pub struct FileStore {
    path: PathBuf,
}

impl FileStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            path: app_data_dir.join("supabase-auth-session.json"),
        }
    }

    /// Owner-only (0600) on unix; a no-op elsewhere — Windows inherits the
    /// per-user ACL of the app-data directory the file already lives in.
    #[cfg(unix)]
    fn restrict_permissions(&self) {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600));
    }

    #[cfg(not(unix))]
    fn restrict_permissions(&self) {}
}

impl SessionStore for FileStore {
    fn load(&self) -> Option<Session> {
        let raw = std::fs::read_to_string(&self.path).ok()?;
        match serde_json::from_str(&raw) {
            Ok(s) => Some(s),
            Err(e) => {
                tracing::warn!("stored session file is corrupt; treating as signed-out: {e}");
                None
            }
        }
    }

    fn save(&self, session: &Session) {
        let Ok(raw) = serde_json::to_string(session) else {
            return;
        };
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        // Both arms call a real function on every platform. Inlining the
        // cfg(unix) block here instead leaves the Ok arm empty on Windows
        // (clippy::single_match), and an early return on the Err side becomes
        // the function tail there (clippy::needless_return).
        match std::fs::write(&self.path, &raw) {
            Ok(()) => self.restrict_permissions(),
            Err(e) => tracing::warn!("failed to persist session file: {e}"),
        }
    }

    fn clear(&self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Persistence disabled (`sessionPersistence: "none"`).
pub struct NoneStore;

impl SessionStore for NoneStore {
    fn load(&self) -> Option<Session> {
        None
    }
    fn save(&self, _session: &Session) {}
    fn clear(&self) {}
}

/// In-memory store for tests.
#[derive(Default)]
pub struct MemoryStore {
    inner: std::sync::Mutex<Option<String>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Test helper: put raw (possibly corrupt) content in the store.
    pub fn set_raw(&self, raw: impl Into<String>) {
        *self.inner.lock().unwrap() = Some(raw.into());
    }

    pub fn raw(&self) -> Option<String> {
        self.inner.lock().unwrap().clone()
    }
}

impl SessionStore for MemoryStore {
    fn load(&self) -> Option<Session> {
        let raw = self.inner.lock().unwrap().clone()?;
        serde_json::from_str(&raw).ok()
    }

    fn save(&self, session: &Session) {
        *self.inner.lock().unwrap() = Some(serde_json::to_string(session).unwrap());
    }

    fn clear(&self) {
        *self.inner.lock().unwrap() = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corrupt_file_reads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileStore::new(dir.path().to_path_buf());
        std::fs::write(dir.path().join("supabase-auth-session.json"), b"{not json").unwrap();
        assert!(store.load().is_none());
    }

    #[cfg(unix)]
    #[test]
    fn file_store_writes_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let store = FileStore::new(dir.path().to_path_buf());
        let session: Session =
            serde_json::from_value(crate::test_fixtures::session_json("t", 3600)).unwrap();
        store.save(&session);
        let mode = std::fs::metadata(dir.path().join("supabase-auth-session.json"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
