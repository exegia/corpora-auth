use tauri_plugin_supabase_auth::SupabaseAuthExt;

/// Proves backend (Rust-side) access to the auth state (FR-002/FR-003):
/// returns the signed-in email as seen from Rust, not from the webview.
#[tauri::command]
async fn whoami_from_rust(app: tauri::AppHandle) -> Option<String> {
    app.supabase_auth().user().await.and_then(|u| u.email)
}

pub fn run() {
    tauri::Builder::default()
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
