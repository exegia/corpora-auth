//! Tauri command handlers — thin: parse args → `AuthCore` → sanitized return.
//! Exposure of each command is governed by the permission model (FR-013).

use tauri::{AppHandle, Runtime, State};

use crate::desktop::SupabaseAuth;
use crate::engine::{OtpKind, OtpTarget};
use crate::error::{Error, Result};
use crate::models::{SanitizedSession, SignUpResult, User};

fn otp_target(email: Option<String>, phone: Option<String>) -> Result<OtpTarget> {
    match (email, phone) {
        (Some(e), None) => Ok(OtpTarget::Email(e)),
        (None, Some(p)) => Ok(OtpTarget::Phone(p)),
        _ => Err(Error::unknown("provide exactly one of 'email' or 'phone'")),
    }
}

fn otp_kind(s: &str) -> Result<OtpKind> {
    match s {
        "email" => Ok(OtpKind::Email),
        "sms" => Ok(OtpKind::Sms),
        "recovery" => Ok(OtpKind::Recovery),
        other => Err(Error::unknown(format!(
            "invalid otp type {other:?} (expected \"email\", \"sms\" or \"recovery\")"
        ))),
    }
}

#[tauri::command]
pub async fn sign_up<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, SupabaseAuth<R>>,
    email: String,
    password: String,
    data: Option<serde_json::Value>,
) -> Result<SignUpResult> {
    state.core().sign_up(&email, &password, data).await
}

#[tauri::command]
pub async fn sign_in_with_password<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, SupabaseAuth<R>>,
    email: String,
    password: String,
) -> Result<SanitizedSession> {
    state
        .core()
        .sign_in_with_password(&email, &password)
        .await
        .map(|s| s.sanitized())
}

#[tauri::command]
pub async fn sign_in_with_otp<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, SupabaseAuth<R>>,
    email: Option<String>,
    phone: Option<String>,
    redirect_to: Option<String>,
) -> Result<()> {
    state
        .core()
        .request_otp(otp_target(email, phone)?, redirect_to)
        .await
}

#[tauri::command]
pub async fn verify_otp<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, SupabaseAuth<R>>,
    email: Option<String>,
    phone: Option<String>,
    token: String,
    otp_type: String,
) -> Result<SanitizedSession> {
    state
        .core()
        .verify_otp(otp_target(email, phone)?, &token, otp_kind(&otp_type)?)
        .await
        .map(|s| s.sanitized())
}

#[tauri::command]
pub async fn start_oauth_flow<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, SupabaseAuth<R>>,
    provider: String,
    scopes: Option<Vec<String>>,
) -> Result<SanitizedSession> {
    state
        .start_oauth_flow(&provider, scopes)
        .await
        .map(|s| s.sanitized())
}

#[tauri::command]
pub async fn cancel_oauth_flow<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, SupabaseAuth<R>>,
) -> Result<()> {
    state.core().abort_oauth().await;
    Ok(())
}

#[tauri::command]
pub async fn sign_out<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, SupabaseAuth<R>>,
) -> Result<()> {
    state.core().sign_out().await
}

#[tauri::command]
pub async fn get_session<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, SupabaseAuth<R>>,
) -> Result<Option<SanitizedSession>> {
    Ok(state.core().sanitized_session().await)
}

#[tauri::command]
pub async fn get_user<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, SupabaseAuth<R>>,
) -> Result<Option<User>> {
    Ok(state.core().user().await)
}

#[tauri::command]
pub async fn refresh_session<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, SupabaseAuth<R>>,
) -> Result<SanitizedSession> {
    state.core().refresh().await.map(|s| s.sanitized())
}

#[tauri::command]
pub async fn reset_password_for_email<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, SupabaseAuth<R>>,
    email: String,
    redirect_to: Option<String>,
) -> Result<()> {
    state
        .core()
        .reset_password_for_email(&email, redirect_to)
        .await
}

#[tauri::command]
pub async fn update_user<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, SupabaseAuth<R>>,
    email: Option<String>,
    password: Option<String>,
    data: Option<serde_json::Value>,
) -> Result<User> {
    state.core().update_user(email, password, data).await
}
