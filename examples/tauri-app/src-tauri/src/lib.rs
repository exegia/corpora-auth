use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::RunEvent;
use tauri_plugin_supabase_auth::SupabaseAuthExt;

/// Proves backend (Rust-side) access to the auth state (FR-002/FR-003):
/// returns the signed-in email as seen from Rust, not from the webview.
#[tauri::command]
async fn whoami_from_rust(app: tauri::AppHandle) -> Option<String> {
    app.supabase_auth().user().await.and_then(|u| u.email)
}

/// Opens a URL in the OS default browser, for the error screen's "copy the
/// report and open Claude" affordance.
///
/// Allow-listed rather than open-ended: a command that hands any string to the
/// shell's URL opener is a way to launch arbitrary schemes (`file://`, custom
/// app handlers) from whatever ends up in the webview.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    const ALLOWED: &[&str] = &["https://claude.ai/new"];
    if !ALLOWED.contains(&url.as_str()) {
        return Err(format!("refusing to open a non-allow-listed URL: {url}"));
    }
    open::that(&url).map_err(|e| e.to_string())
}

pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // Automation bridge for `make dev-mcp` / the tauri-mcp CLI. Debug-only, and
    // bound to loopback so nothing on the network can drive the app.
    //
    // The plugin scans upward from the base port, so if 9223 is taken it lands
    // on 9224 and the CLI must be pointed there too; `make dev-mcp MCP_PORT=N`
    // sets MCP_BRIDGE_PORT to keep both sides in sync.
    #[cfg(debug_assertions)]
    {
        let base_port = std::env::var("MCP_BRIDGE_PORT")
            .ok()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(9223);
        builder = builder.plugin(
            tauri_plugin_mcp_bridge::Builder::new()
                .bind_address("127.0.0.1")
                .base_port(base_port)
                .build(),
        );
    }

    let app = builder
        .plugin(tauri_plugin_supabase_auth::init())
        .invoke_handler(tauri::generate_handler![whoami_from_rust, open_external])
        .setup(|app| {
            // Rust-side auth event subscription (FR-004 backend parity).
            app.supabase_auth().on_auth_state_change(|payload| {
                eprintln!("[rust] auth event: {:?}", payload.event);
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Sign out silently on quit, so each launch of the demo starts clean.
    //
    // This has to run on the *async* runtime rather than blocking the main
    // thread: AuthCore serializes every mutation through one mutex held across
    // the network await, and the background refresh task pings it on each
    // transition — a `block_on` here can sit behind an in-flight refresh and
    // wedge the exit. So: veto the first exit, sign out on a task, then exit
    // for real. The flag makes the second ExitRequested fall through instead
    // of looping.
    let signing_out = Arc::new(AtomicBool::new(false));
    app.run(move |handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            if signing_out.swap(true, Ordering::SeqCst) {
                return; // already draining — let this one through
            }
            api.prevent_exit();
            let handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                // Local-first: state clears even with the network down, so a
                // dead Supabase never turns quitting into a hang.
                if let Err(e) = handle.supabase_auth().sign_out().await {
                    eprintln!("[rust] sign-out on quit failed: {e}");
                }
                handle.exit(0);
            });
        }
    });
}
