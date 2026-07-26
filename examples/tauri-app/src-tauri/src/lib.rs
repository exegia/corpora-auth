use tauri_plugin_supabase_auth::SupabaseAuthExt;

/// Proves backend (Rust-side) access to the auth state (FR-002/FR-003):
/// returns the signed-in email as seen from Rust, not from the webview.
#[tauri::command]
async fn whoami_from_rust(app: tauri::AppHandle) -> Option<String> {
    app.supabase_auth().user().await.and_then(|u| u.email)
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

    builder
        .plugin(tauri_plugin_supabase_auth::init())
        .invoke_handler(tauri::generate_handler![whoami_from_rust])
        .setup(|app| {
            // Rust-side auth event subscription (FR-004 backend parity).
            app.supabase_auth().on_auth_state_change(|payload| {
                eprintln!("[rust] auth event: {:?}", payload.event);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
