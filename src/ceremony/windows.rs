//! Windows built-in WebAuthn ceremony (feature 004 T025, research R6).
//!
//! Drives the Windows Hello / security-key prompt through `webauthn.dll`
//! (`WebAuthNAuthenticatorMakeCredential` / `GetAssertion`, Windows 10 19H1+).
//! Unlike macOS, Windows has no OS-level origin binding: the app constructs
//! `clientDataJSON` itself and asserts the configured `passkeys.origin`
//! (research R8) — GoTrue verifies it against `GOTRUE_WEBAUTHN_RP_ORIGINS`.
//!
//! The DLL is loaded dynamically (`LoadLibraryW`): on pre-19H1 systems the
//! probe fails and `availability()` reports `Unavailable` instead of the
//! process failing to load. The calls themselves block until the user
//! completes or dismisses the system dialog, which matches the blocking
//! `CeremonyProvider` contract (FR-014: no timeout of ours spans the prompt).

use std::sync::OnceLock;

use base64::Engine as _;
use serde::Deserialize;
use serde_json::json;
use windows_sys::core::{HRESULT, PCWSTR};
use windows_sys::Win32::Foundation::{HMODULE, HWND, NTE_USER_CANCELLED};
use windows_sys::Win32::Networking::WindowsWebServices::{
    WEBAUTHN_ASSERTION, WEBAUTHN_ATTESTATION_CONVEYANCE_PREFERENCE_ANY,
    WEBAUTHN_ATTESTATION_CONVEYANCE_PREFERENCE_DIRECT,
    WEBAUTHN_ATTESTATION_CONVEYANCE_PREFERENCE_INDIRECT,
    WEBAUTHN_ATTESTATION_CONVEYANCE_PREFERENCE_NONE, WEBAUTHN_AUTHENTICATOR_ATTACHMENT_ANY,
    WEBAUTHN_AUTHENTICATOR_ATTACHMENT_CROSS_PLATFORM, WEBAUTHN_AUTHENTICATOR_ATTACHMENT_PLATFORM,
    WEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS,
    WEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS_VERSION_4,
    WEBAUTHN_AUTHENTICATOR_MAKE_CREDENTIAL_OPTIONS,
    WEBAUTHN_AUTHENTICATOR_MAKE_CREDENTIAL_OPTIONS_VERSION_3, WEBAUTHN_CLIENT_DATA,
    WEBAUTHN_CLIENT_DATA_CURRENT_VERSION, WEBAUTHN_COSE_CREDENTIAL_PARAMETER,
    WEBAUTHN_COSE_CREDENTIAL_PARAMETERS, WEBAUTHN_COSE_CREDENTIAL_PARAMETER_CURRENT_VERSION,
    WEBAUTHN_CREDENTIAL_ATTESTATION, WEBAUTHN_CREDENTIAL_TYPE_PUBLIC_KEY,
    WEBAUTHN_HASH_ALGORITHM_SHA_256, WEBAUTHN_RP_ENTITY_INFORMATION,
    WEBAUTHN_RP_ENTITY_INFORMATION_CURRENT_VERSION, WEBAUTHN_USER_ENTITY_INFORMATION,
    WEBAUTHN_USER_ENTITY_INFORMATION_CURRENT_VERSION, WEBAUTHN_USER_VERIFICATION_REQUIREMENT_ANY,
    WEBAUTHN_USER_VERIFICATION_REQUIREMENT_DISCOURAGED,
    WEBAUTHN_USER_VERIFICATION_REQUIREMENT_PREFERRED,
    WEBAUTHN_USER_VERIFICATION_REQUIREMENT_REQUIRED,
};
use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows_sys::Win32::UI::WindowsAndMessaging::{GetDesktopWindow, GetForegroundWindow};

use super::{Availability, CeremonyOutcome, CeremonyProvider};

/// `HRESULT_FROM_WIN32(ERROR_CANCELLED)`: the dialog was dismissed.
const HR_ERROR_CANCELLED: HRESULT = 0x8007_04C7_u32 as _;
/// `HRESULT_FROM_WIN32(ERROR_TIMEOUT)`: the dialog timed out unanswered.
const HR_ERROR_TIMEOUT: HRESULT = 0x8007_05B4_u32 as _;

// --- dynamically loaded webauthn.dll ---------------------------------------

type GetApiVersionNumberFn = unsafe extern "system" fn() -> u32;
type MakeCredentialFn = unsafe extern "system" fn(
    HWND,
    *const WEBAUTHN_RP_ENTITY_INFORMATION,
    *const WEBAUTHN_USER_ENTITY_INFORMATION,
    *const WEBAUTHN_COSE_CREDENTIAL_PARAMETERS,
    *const WEBAUTHN_CLIENT_DATA,
    *const WEBAUTHN_AUTHENTICATOR_MAKE_CREDENTIAL_OPTIONS,
    *mut *mut WEBAUTHN_CREDENTIAL_ATTESTATION,
) -> HRESULT;
type GetAssertionFn = unsafe extern "system" fn(
    HWND,
    PCWSTR,
    *const WEBAUTHN_CLIENT_DATA,
    *const WEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS,
    *mut *mut WEBAUTHN_ASSERTION,
) -> HRESULT;
type FreeCredentialAttestationFn =
    unsafe extern "system" fn(*const WEBAUTHN_CREDENTIAL_ATTESTATION);
type FreeAssertionFn = unsafe extern "system" fn(*const WEBAUTHN_ASSERTION);
type GetErrorNameFn = unsafe extern "system" fn(HRESULT) -> PCWSTR;

struct WebAuthnApi {
    api_version: u32,
    make_credential: MakeCredentialFn,
    get_assertion: GetAssertionFn,
    free_credential_attestation: FreeCredentialAttestationFn,
    free_assertion: FreeAssertionFn,
    get_error_name: Option<GetErrorNameFn>,
}

// Raw fn pointers into a library we never unload.
unsafe impl Send for WebAuthnApi {}
unsafe impl Sync for WebAuthnApi {}

fn api() -> Option<&'static WebAuthnApi> {
    static API: OnceLock<Option<WebAuthnApi>> = OnceLock::new();
    API.get_or_init(load_api).as_ref()
}

fn load_api() -> Option<WebAuthnApi> {
    let name = wide("webauthn.dll");
    // The module stays loaded for the process lifetime; fn pointers into it
    // are therefore valid forever.
    let module: HMODULE = unsafe { LoadLibraryW(name.as_ptr()) };
    if module.is_null() {
        return None;
    }
    type RawSym = unsafe extern "system" fn() -> isize;
    unsafe fn sym(module: HMODULE, name: &[u8]) -> Option<RawSym> {
        unsafe { GetProcAddress(module, name.as_ptr()) }
    }
    macro_rules! required {
        ($ty:ty, $name:literal) => {
            // SAFETY: transmuting a GetProcAddress result to the documented
            // signature of the named export.
            unsafe { std::mem::transmute::<RawSym, $ty>(sym(module, $name)?) }
        };
    }
    let get_api_version = required!(GetApiVersionNumberFn, b"WebAuthNGetApiVersionNumber\0");
    Some(WebAuthnApi {
        api_version: unsafe { get_api_version() },
        make_credential: required!(MakeCredentialFn, b"WebAuthNAuthenticatorMakeCredential\0"),
        get_assertion: required!(GetAssertionFn, b"WebAuthNAuthenticatorGetAssertion\0"),
        free_credential_attestation: required!(
            FreeCredentialAttestationFn,
            b"WebAuthNFreeCredentialAttestation\0"
        ),
        free_assertion: required!(FreeAssertionFn, b"WebAuthNFreeAssertion\0"),
        get_error_name: unsafe { sym(module, b"WebAuthNGetErrorName\0") }
            .map(|f| unsafe { std::mem::transmute::<RawSym, GetErrorNameFn>(f) }),
    })
}

// --- helpers ----------------------------------------------------------------

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn b64_decode(value: &str) -> Option<Vec<u8>> {
    let engine = &base64::engine::general_purpose::URL_SAFE_NO_PAD;
    engine
        .decode(value.trim_end_matches('='))
        .ok()
        .or_else(|| base64::engine::general_purpose::STANDARD.decode(value).ok())
}

fn b64_encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// # Safety
/// `ptr` must point to `len` readable bytes (or be ignored when `len == 0`).
unsafe fn slice_b64(ptr: *const u8, len: u32) -> String {
    if ptr.is_null() || len == 0 {
        String::new()
    } else {
        b64_encode(unsafe { std::slice::from_raw_parts(ptr, len as usize) })
    }
}

fn hwnd() -> HWND {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_null() {
        unsafe { GetDesktopWindow() }
    } else {
        hwnd
    }
}

fn error_message(api: &WebAuthnApi, hr: HRESULT) -> String {
    let name = api
        .get_error_name
        .map(|f| unsafe { f(hr) })
        .filter(|p| !p.is_null())
        .map(|p| {
            let mut len = 0;
            while unsafe { *p.add(len) } != 0 {
                len += 1;
            }
            String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(p, len) })
        })
        .unwrap_or_default();
    if name.is_empty() {
        format!("WebAuthn call failed (HRESULT {hr:#010x})")
    } else {
        format!("WebAuthn call failed: {name} (HRESULT {hr:#010x})")
    }
}

fn map_error(api: &WebAuthnApi, hr: HRESULT) -> CeremonyOutcome {
    match hr {
        // User dismissed the prompt — first-class non-error outcome (FR-009).
        // An unanswered dialog timing out is treated the same way.
        NTE_USER_CANCELLED | HR_ERROR_CANCELLED | HR_ERROR_TIMEOUT => CeremonyOutcome::Cancelled,
        _ => CeremonyOutcome::Unsupported(error_message(api, hr)),
    }
}

fn user_verification(value: Option<&str>) -> u32 {
    match value {
        Some("required") => WEBAUTHN_USER_VERIFICATION_REQUIREMENT_REQUIRED,
        Some("preferred") => WEBAUTHN_USER_VERIFICATION_REQUIREMENT_PREFERRED,
        Some("discouraged") => WEBAUTHN_USER_VERIFICATION_REQUIREMENT_DISCOURAGED,
        _ => WEBAUTHN_USER_VERIFICATION_REQUIREMENT_ANY,
    }
}

// --- server options (bare go-webauthn shapes, research R1) -----------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreationOptions {
    rp: RpEntity,
    user: UserEntity,
    /// Kept verbatim (base64url) — echoed into `clientDataJSON` so the server
    /// sees exactly the challenge it issued.
    challenge: String,
    #[serde(default)]
    pub_key_cred_params: Vec<CredParam>,
    timeout: Option<u32>,
    attestation: Option<String>,
    #[serde(default)]
    authenticator_selection: AuthenticatorSelection,
}

#[derive(Deserialize)]
struct RpEntity {
    id: String,
    name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserEntity {
    id: String,
    name: Option<String>,
    display_name: Option<String>,
}

#[derive(Deserialize)]
struct CredParam {
    alg: i32,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AuthenticatorSelection {
    authenticator_attachment: Option<String>,
    require_resident_key: Option<bool>,
    resident_key: Option<String>,
    user_verification: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestOptions {
    rp_id: String,
    challenge: String,
    timeout: Option<u32>,
    user_verification: Option<String>,
}

// --- provider ---------------------------------------------------------------

/// Built-in Windows ceremony. Holds the configured asserted origin; without
/// it the provider reports unavailable (the kit then hides passkey UI rather
/// than failing mid-prompt).
pub struct WindowsCeremony {
    origin: Option<String>,
}

impl WindowsCeremony {
    pub fn new(origin: Option<&str>) -> Self {
        Self {
            origin: origin.map(str::to_string),
        }
    }

    /// The origin, or the `Unsupported` outcome explaining its absence.
    fn asserted_origin(&self) -> Result<&str, CeremonyOutcome> {
        self.origin.as_deref().ok_or_else(|| {
            CeremonyOutcome::Unsupported(
                "the built-in Windows ceremony needs 'passkeys.origin' in the plugin config \
                 (an origin listed in the project's GOTRUE_WEBAUTHN_RP_ORIGINS)"
                    .to_string(),
            )
        })
    }
}

impl CeremonyProvider for WindowsCeremony {
    fn availability(&self) -> Availability {
        if self.origin.is_none() {
            return Availability::Unavailable(
                "passkeys.origin is not configured for the built-in Windows ceremony".to_string(),
            );
        }
        match api() {
            Some(api) if api.api_version >= 1 => Availability::Available,
            _ => Availability::Unavailable(
                "passkeys require Windows 10 version 1903 or later (webauthn.dll not available)"
                    .to_string(),
            ),
        }
    }

    fn create(&self, options_json: &str) -> CeremonyOutcome {
        let origin = match self.asserted_origin() {
            Ok(origin) => origin,
            Err(outcome) => return outcome,
        };
        let Some(api) = api() else {
            return CeremonyOutcome::Unsupported(
                "passkeys require Windows 10 version 1903 or later (webauthn.dll not available)"
                    .to_string(),
            );
        };
        let options: CreationOptions = match serde_json::from_str(options_json) {
            Ok(options) => options,
            Err(e) => {
                return CeremonyOutcome::Unsupported(format!(
                    "could not parse the server's registration options: {e}"
                ))
            }
        };
        let Some(user_id) = b64_decode(&options.user.id) else {
            return CeremonyOutcome::Unsupported(
                "the server's user handle is not valid base64url".to_string(),
            );
        };

        let client_data_json = json!({
            "type": "webauthn.create",
            "challenge": options.challenge,
            "origin": origin,
            "crossOrigin": false,
        })
        .to_string();

        // Owned wide/byte buffers must outlive the raw pointers below.
        let rp_id = wide(&options.rp.id);
        let rp_name = wide(options.rp.name.as_deref().unwrap_or(&options.rp.id));
        let user_name = wide(
            options
                .user
                .name
                .as_deref()
                .or(options.user.display_name.as_deref())
                .unwrap_or(""),
        );
        let user_display_name = wide(
            options
                .user
                .display_name
                .as_deref()
                .or(options.user.name.as_deref())
                .unwrap_or(""),
        );
        let mut user_id = user_id;
        let mut client_data_bytes = client_data_json.into_bytes();

        let rp = WEBAUTHN_RP_ENTITY_INFORMATION {
            dwVersion: WEBAUTHN_RP_ENTITY_INFORMATION_CURRENT_VERSION,
            pwszId: rp_id.as_ptr(),
            pwszName: rp_name.as_ptr(),
            pwszIcon: std::ptr::null(),
        };
        let user = WEBAUTHN_USER_ENTITY_INFORMATION {
            dwVersion: WEBAUTHN_USER_ENTITY_INFORMATION_CURRENT_VERSION,
            cbId: user_id.len() as u32,
            pbId: user_id.as_mut_ptr(),
            pwszName: user_name.as_ptr(),
            pwszIcon: std::ptr::null(),
            pwszDisplayName: user_display_name.as_ptr(),
        };
        let mut cose_params: Vec<WEBAUTHN_COSE_CREDENTIAL_PARAMETER> = options
            .pub_key_cred_params
            .iter()
            .map(|p| WEBAUTHN_COSE_CREDENTIAL_PARAMETER {
                dwVersion: WEBAUTHN_COSE_CREDENTIAL_PARAMETER_CURRENT_VERSION,
                pwszCredentialType: WEBAUTHN_CREDENTIAL_TYPE_PUBLIC_KEY,
                lAlg: p.alg,
            })
            .collect();
        if cose_params.is_empty() {
            // ES256 and RS256, the WebAuthn defaults go-webauthn accepts.
            cose_params.extend([-7, -257].map(|alg| WEBAUTHN_COSE_CREDENTIAL_PARAMETER {
                dwVersion: WEBAUTHN_COSE_CREDENTIAL_PARAMETER_CURRENT_VERSION,
                pwszCredentialType: WEBAUTHN_CREDENTIAL_TYPE_PUBLIC_KEY,
                lAlg: alg,
            }));
        }
        let cose = WEBAUTHN_COSE_CREDENTIAL_PARAMETERS {
            cCredentialParameters: cose_params.len() as u32,
            pCredentialParameters: cose_params.as_mut_ptr(),
        };
        let client_data = WEBAUTHN_CLIENT_DATA {
            dwVersion: WEBAUTHN_CLIENT_DATA_CURRENT_VERSION,
            cbClientDataJSON: client_data_bytes.len() as u32,
            pbClientDataJSON: client_data_bytes.as_mut_ptr(),
            pwszHashAlgId: WEBAUTHN_HASH_ALGORITHM_SHA_256,
        };

        let selection = &options.authenticator_selection;
        let resident = selection.require_resident_key.unwrap_or(false)
            || matches!(selection.resident_key.as_deref(), Some("required"));
        let attachment = match selection.authenticator_attachment.as_deref() {
            Some("platform") => WEBAUTHN_AUTHENTICATOR_ATTACHMENT_PLATFORM,
            Some("cross-platform") => WEBAUTHN_AUTHENTICATOR_ATTACHMENT_CROSS_PLATFORM,
            _ => WEBAUTHN_AUTHENTICATOR_ATTACHMENT_ANY,
        };
        let attestation = match options.attestation.as_deref() {
            Some("none") => WEBAUTHN_ATTESTATION_CONVEYANCE_PREFERENCE_NONE,
            Some("indirect") => WEBAUTHN_ATTESTATION_CONVEYANCE_PREFERENCE_INDIRECT,
            Some("direct") => WEBAUTHN_ATTESTATION_CONVEYANCE_PREFERENCE_DIRECT,
            _ => WEBAUTHN_ATTESTATION_CONVEYANCE_PREFERENCE_ANY,
        };
        // VERSION_3: supported by every DLL since 19H1; later fields unused.
        let make_options = WEBAUTHN_AUTHENTICATOR_MAKE_CREDENTIAL_OPTIONS {
            dwVersion: WEBAUTHN_AUTHENTICATOR_MAKE_CREDENTIAL_OPTIONS_VERSION_3,
            dwTimeoutMilliseconds: options.timeout.unwrap_or(0),
            dwAuthenticatorAttachment: attachment,
            bRequireResidentKey: resident.into(),
            dwUserVerificationRequirement: user_verification(
                selection.user_verification.as_deref(),
            ),
            dwAttestationConveyancePreference: attestation,
            ..Default::default()
        };

        let mut attestation_ptr: *mut WEBAUTHN_CREDENTIAL_ATTESTATION = std::ptr::null_mut();
        let hr = unsafe {
            (api.make_credential)(
                hwnd(),
                &rp,
                &user,
                &cose,
                &client_data,
                &make_options,
                &mut attestation_ptr,
            )
        };
        if hr != 0 || attestation_ptr.is_null() {
            return map_error(api, hr);
        }
        let result = unsafe {
            let attestation = &*attestation_ptr;
            let id = slice_b64(attestation.pbCredentialId, attestation.cbCredentialId);
            json!({
                "id": id,
                "rawId": id,
                "type": "public-key",
                "clientExtensionResults": {},
                "response": {
                    "clientDataJSON": b64_encode(&client_data_bytes),
                    "attestationObject": slice_b64(
                        attestation.pbAttestationObject,
                        attestation.cbAttestationObject,
                    ),
                },
            })
            .to_string()
        };
        unsafe { (api.free_credential_attestation)(attestation_ptr) };
        CeremonyOutcome::Completed(result)
    }

    fn get(&self, options_json: &str) -> CeremonyOutcome {
        let origin = match self.asserted_origin() {
            Ok(origin) => origin,
            Err(outcome) => return outcome,
        };
        let Some(api) = api() else {
            return CeremonyOutcome::Unsupported(
                "passkeys require Windows 10 version 1903 or later (webauthn.dll not available)"
                    .to_string(),
            );
        };
        let options: RequestOptions = match serde_json::from_str(options_json) {
            Ok(options) => options,
            Err(e) => {
                return CeremonyOutcome::Unsupported(format!(
                    "could not parse the server's authentication options: {e}"
                ))
            }
        };

        let client_data_json = json!({
            "type": "webauthn.get",
            "challenge": options.challenge,
            "origin": origin,
            "crossOrigin": false,
        })
        .to_string();
        let rp_id = wide(&options.rp_id);
        let mut client_data_bytes = client_data_json.into_bytes();
        let client_data = WEBAUTHN_CLIENT_DATA {
            dwVersion: WEBAUTHN_CLIENT_DATA_CURRENT_VERSION,
            cbClientDataJSON: client_data_bytes.len() as u32,
            pbClientDataJSON: client_data_bytes.as_mut_ptr(),
            pwszHashAlgId: WEBAUTHN_HASH_ALGORITHM_SHA_256,
        };
        // VERSION_4: supported by every DLL since 19H1; later fields unused.
        // Empty CredentialList = discoverable-credential flow, which is how
        // GoTrue issues authentication options (no allowCredentials).
        let get_options = WEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS {
            dwVersion: WEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS_VERSION_4,
            dwTimeoutMilliseconds: options.timeout.unwrap_or(0),
            dwAuthenticatorAttachment: WEBAUTHN_AUTHENTICATOR_ATTACHMENT_ANY,
            dwUserVerificationRequirement: user_verification(options.user_verification.as_deref()),
            ..Default::default()
        };

        let mut assertion_ptr: *mut WEBAUTHN_ASSERTION = std::ptr::null_mut();
        let hr = unsafe {
            (api.get_assertion)(
                hwnd(),
                rp_id.as_ptr(),
                &client_data,
                &get_options,
                &mut assertion_ptr,
            )
        };
        if hr != 0 || assertion_ptr.is_null() {
            return map_error(api, hr);
        }
        let result = unsafe {
            let assertion = &*assertion_ptr;
            let id = slice_b64(assertion.Credential.pbId, assertion.Credential.cbId);
            let user_handle = slice_b64(assertion.pbUserId, assertion.cbUserId);
            let mut response = json!({
                "clientDataJSON": b64_encode(&client_data_bytes),
                "authenticatorData": slice_b64(
                    assertion.pbAuthenticatorData,
                    assertion.cbAuthenticatorData,
                ),
                "signature": slice_b64(assertion.pbSignature, assertion.cbSignature),
            });
            // Present for resident (discoverable) credentials; GoTrue uses it
            // to locate the user.
            if !user_handle.is_empty() {
                response["userHandle"] = json!(user_handle);
            }
            json!({
                "id": id,
                "rawId": id,
                "type": "public-key",
                "clientExtensionResults": {},
                "response": response,
            })
            .to_string()
        };
        unsafe { (api.free_assertion)(assertion_ptr) };
        CeremonyOutcome::Completed(result)
    }
}
