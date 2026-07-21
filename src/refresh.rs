//! Background session refresh (FR-006, research R3).
//!
//! The supabase crate's own background refresh is an unimplemented stub, so
//! the plugin owns this: a single task that sleeps until
//! `expires_at - refreshBufferSecs`, refreshes, and re-arms. Every state
//! transition pings `refresh_notify`, so the task always re-evaluates against
//! the current state — it can never act on a session that was signed out.

use std::sync::Arc;

use crate::error::ErrorKind;
use crate::state::AuthCore;

const NETWORK_RETRY: std::time::Duration = std::time::Duration::from_secs(30);

pub fn spawn(core: Arc<AuthCore>) {
    if !core.config.auto_refresh {
        tracing::debug!("autoRefresh disabled; background refresh task not started");
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            let deadline = core.session().await.map(|s| {
                s.expires_at - chrono::Duration::seconds(core.config.refresh_buffer_secs as i64)
            });

            match deadline {
                None => {
                    // Nothing to refresh; wait for a transition.
                    core.refresh_notify.notified().await;
                }
                Some(deadline) => {
                    let wait = (deadline - chrono::Utc::now())
                        .to_std()
                        .unwrap_or(std::time::Duration::ZERO);
                    tokio::select! {
                        _ = tokio::time::sleep(wait) => {
                            match core.refresh().await {
                                Ok(_) => tracing::debug!("session refreshed in background"),
                                Err(e) if e.kind == ErrorKind::Network => {
                                    tracing::info!("refresh failed (network); retrying in {NETWORK_RETRY:?}");
                                    tokio::select! {
                                        _ = tokio::time::sleep(NETWORK_RETRY) => {}
                                        _ = core.refresh_notify.notified() => {}
                                    }
                                }
                                Err(e) => {
                                    // refresh() already cleared state and emitted SIGNED_OUT.
                                    tracing::info!("session terminated by refresh failure: {e}");
                                }
                            }
                        }
                        _ = core.refresh_notify.notified() => {
                            // State changed; loop and re-evaluate.
                        }
                    }
                }
            }
        }
    });
}
