const COMMANDS: &[&str] = &[
    "sign_up",
    "sign_in_with_password",
    "sign_in_with_otp",
    "verify_otp",
    "start_oauth_flow",
    "cancel_oauth_flow",
    "sign_out",
    "get_session",
    "get_user",
    "refresh_session",
    "reset_password_for_email",
    "update_user",
    "get_identities",
    "link_identity",
    "unlink_identity",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
