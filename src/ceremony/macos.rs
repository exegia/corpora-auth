//! macOS built-in WebAuthn ceremony (feature 004 T024, research R6).
//!
//! Runs the platform passkey prompt through
//! `ASAuthorizationPlatformPublicKeyCredentialProvider` (macOS 13+). The OS
//! builds `clientDataJSON` itself — the asserted origin comes from the app's
//! Associated Domains binding (`webcredentials:<rp-id>` entitlement + AASA
//! file on the RP-ID domain), not from plugin config, so `passkeys.origin`
//! is not used on this platform.
//!
//! `create`/`get` are called on a blocking thread (FR-014: no timeout spans
//! the prompt). The AuthenticationServices controller is main-thread-only, so
//! the prompt is dispatched to the main queue and the calling thread parks on
//! a channel until the delegate fires.

use std::cell::RefCell;
use std::sync::mpsc;

use base64::Engine as _;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2::{
    define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly,
};
use objc2_app_kit::NSApplication;
use objc2_authentication_services::{
    ASAuthorization, ASAuthorizationController, ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding, ASAuthorizationError,
    ASAuthorizationPlatformPublicKeyCredentialAssertion,
    ASAuthorizationPlatformPublicKeyCredentialProvider,
    ASAuthorizationPlatformPublicKeyCredentialRegistration,
    ASAuthorizationPublicKeyCredentialAssertion, ASAuthorizationPublicKeyCredentialRegistration,
    ASAuthorizationRequest, ASPresentationAnchor, ASPublicKeyCredential,
};
use objc2_foundation::{
    NSArray, NSData, NSError, NSObject, NSObjectProtocol, NSOperatingSystemVersion, NSProcessInfo,
    NSString,
};
use serde::Deserialize;
use serde_json::json;

use super::{Availability, CeremonyOutcome, CeremonyProvider};

/// FR-015: entitlement/AASA problems surface as `ASAuthorizationError.Failed`
/// at ceremony time — point the app owner at the prerequisites checklist.
const SETUP_GUIDANCE: &str = "If this persists, verify the app is signed with the Associated \
     Domains entitlement (webcredentials:<rp-id>) and the RP ID domain serves an \
     apple-app-site-association file authorizing this app (see the passkey prerequisites \
     checklist).";

// --- server options (bare go-webauthn shapes, research R1) -----------------

#[derive(Deserialize)]
struct CreationOptions {
    rp: RpEntity,
    user: UserEntity,
    challenge: String,
}

#[derive(Deserialize)]
struct RpEntity {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserEntity {
    id: String,
    name: Option<String>,
    display_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestOptions {
    rp_id: String,
    challenge: String,
}

/// go-webauthn emits base64url-no-pad; accept padded/standard defensively.
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

fn ns_data(bytes: &[u8]) -> Retained<NSData> {
    NSData::with_bytes(bytes)
}

fn data_b64(data: &NSData) -> String {
    b64_encode(&data.to_vec())
}

// --- delegate --------------------------------------------------------------

/// What one prompt resolves to, sent from the main-thread delegate back to
/// the parked worker. `Err` carries the `ASAuthorizationError` code and text.
type PromptResult = Result<String, (isize, String)>;

struct DelegateIvars {
    tx: RefCell<Option<mpsc::Sender<PromptResult>>>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "SupabaseAuthPasskeyCeremonyDelegate"]
    #[ivars = DelegateIvars]
    struct CeremonyDelegate;

    unsafe impl NSObjectProtocol for CeremonyDelegate {}

    unsafe impl ASAuthorizationControllerDelegate for CeremonyDelegate {
        #[unsafe(method(authorizationController:didCompleteWithAuthorization:))]
        fn did_complete_with_authorization(
            &self,
            controller: &ASAuthorizationController,
            authorization: &ASAuthorization,
        ) {
            self.finish(controller, credential_json(authorization));
        }

        #[unsafe(method(authorizationController:didCompleteWithError:))]
        fn did_complete_with_error(&self, controller: &ASAuthorizationController, error: &NSError) {
            self.finish(
                controller,
                Err((error.code(), error.localizedDescription().to_string())),
            );
        }
    }

    unsafe impl ASAuthorizationControllerPresentationContextProviding for CeremonyDelegate {
        #[unsafe(method_id(presentationAnchorForAuthorizationController:))]
        fn presentation_anchor(
            &self,
            _controller: &ASAuthorizationController,
        ) -> Retained<ASPresentationAnchor> {
            presentation_anchor(self.mtm())
        }
    }
);

impl CeremonyDelegate {
    fn new(mtm: MainThreadMarker, tx: mpsc::Sender<PromptResult>) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(DelegateIvars {
            tx: RefCell::new(Some(tx)),
        });
        unsafe { msg_send![super(this), init] }
    }

    fn finish(&self, controller: &ASAuthorizationController, result: PromptResult) {
        if let Some(tx) = self.ivars().tx.borrow_mut().take() {
            let _ = tx.send(result);
        }
        release_session(controller);
    }
}

/// The prompt's presentation anchor: the frontmost app window. AppKit calls
/// this on the main thread; an off-screen fallback keeps the API contract
/// (non-optional return) satisfiable in windowless states.
fn presentation_anchor(mtm: MainThreadMarker) -> Retained<ASPresentationAnchor> {
    let app = NSApplication::sharedApplication(mtm);
    let window = app
        .keyWindow()
        .or_else(|| app.mainWindow())
        .or_else(|| app.windows().firstObject());
    match window {
        Some(window) => {
            // NSWindow -> NSResponder -> NSObject (ASPresentationAnchor is
            // aliased to NSObject in the generated bindings).
            Retained::into_super(Retained::into_super(window))
        }
        None => NSObject::new(),
    }
}

// --- in-flight session bookkeeping -----------------------------------------

/// The controller weak-references its delegate, so both must stay alive until
/// the delegate fires. All access happens on the main thread.
type Session = (
    Retained<ASAuthorizationController>,
    Retained<CeremonyDelegate>,
);

thread_local! {
    static SESSIONS: RefCell<Vec<Session>> = const { RefCell::new(Vec::new()) };
}

fn retain_session(session: Session) {
    SESSIONS.with(|sessions| sessions.borrow_mut().push(session));
}

fn release_session(controller: &ASAuthorizationController) {
    SESSIONS.with(|sessions| {
        sessions
            .borrow_mut()
            .retain(|(held, _)| &**held != controller);
    });
}

// --- credential serialization (WebAuthn JSON the server parses, R1) --------

fn credential_json(authorization: &ASAuthorization) -> PromptResult {
    let credential = unsafe { authorization.credential() };
    let credential: &AnyObject = (*credential).as_ref();
    if let Some(registration) =
        credential.downcast_ref::<ASAuthorizationPlatformPublicKeyCredentialRegistration>()
    {
        let attestation = unsafe { registration.rawAttestationObject() }.ok_or((
            ASAuthorizationError::Failed.0,
            "the platform authenticator returned no attestation object".to_string(),
        ))?;
        let id = data_b64(unsafe { &registration.credentialID() });
        Ok(json!({
            "id": id,
            "rawId": id,
            "type": "public-key",
            "authenticatorAttachment": "platform",
            "clientExtensionResults": {},
            "response": {
                "clientDataJSON": data_b64(unsafe { &registration.rawClientDataJSON() }),
                "attestationObject": data_b64(&attestation),
            },
        })
        .to_string())
    } else if let Some(assertion) =
        credential.downcast_ref::<ASAuthorizationPlatformPublicKeyCredentialAssertion>()
    {
        let id = data_b64(unsafe { &assertion.credentialID() });
        Ok(json!({
            "id": id,
            "rawId": id,
            "type": "public-key",
            "authenticatorAttachment": "platform",
            "clientExtensionResults": {},
            "response": {
                "clientDataJSON": data_b64(unsafe { &assertion.rawClientDataJSON() }),
                "authenticatorData": data_b64(unsafe { &assertion.rawAuthenticatorData() }),
                "signature": data_b64(unsafe { &assertion.signature() }),
                "userHandle": data_b64(unsafe { &assertion.userID() }),
            },
        })
        .to_string())
    } else {
        Err((
            ASAuthorizationError::InvalidResponse.0,
            "authorization completed with a non-passkey credential".to_string(),
        ))
    }
}

// --- provider ---------------------------------------------------------------

enum PromptKind {
    Register {
        rp_id: String,
        challenge: Vec<u8>,
        user_name: String,
        user_id: Vec<u8>,
    },
    Authenticate {
        rp_id: String,
        challenge: Vec<u8>,
    },
}

/// Built-in macOS ceremony. Stateless: the RP ID rides in on the server's
/// options JSON for every prompt.
pub struct MacOsCeremony;

impl MacOsCeremony {
    pub fn new() -> Self {
        Self
    }

    fn run(&self, kind: PromptKind) -> CeremonyOutcome {
        if let Availability::Unavailable(reason) = self.availability() {
            return CeremonyOutcome::Unsupported(reason);
        }
        let (tx, rx) = mpsc::channel::<PromptResult>();
        dispatch2::DispatchQueue::main().exec_async(move || {
            let mtm = MainThreadMarker::new()
                .expect("dispatch main queue closures run on the main thread");
            let rp_id = match &kind {
                PromptKind::Register { rp_id, .. } | PromptKind::Authenticate { rp_id, .. } => {
                    NSString::from_str(rp_id)
                }
            };
            let provider = unsafe {
                ASAuthorizationPlatformPublicKeyCredentialProvider::initWithRelyingPartyIdentifier(
                    ASAuthorizationPlatformPublicKeyCredentialProvider::alloc(),
                    &rp_id,
                )
            };
            let request: Retained<ASAuthorizationRequest> = match kind {
                PromptKind::Register {
                    challenge,
                    user_name,
                    user_id,
                    ..
                } => Retained::into_super(unsafe {
                    provider.createCredentialRegistrationRequestWithChallenge_name_userID(
                        &ns_data(&challenge),
                        &NSString::from_str(&user_name),
                        &ns_data(&user_id),
                    )
                }),
                PromptKind::Authenticate { challenge, .. } => Retained::into_super(unsafe {
                    provider.createCredentialAssertionRequestWithChallenge(&ns_data(&challenge))
                }),
            };
            let delegate = CeremonyDelegate::new(mtm, tx);
            let controller = unsafe {
                ASAuthorizationController::initWithAuthorizationRequests(
                    ASAuthorizationController::alloc(),
                    &NSArray::from_retained_slice(&[request]),
                )
            };
            unsafe {
                controller.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
                controller
                    .setPresentationContextProvider(Some(ProtocolObject::from_ref(&*delegate)));
                controller.performRequests();
            }
            retain_session((controller, delegate));
        });
        // FR-014: block without any timeout — the server challenge TTL is the
        // effective ceiling; the user may sit on the Touch ID prompt.
        match rx.recv() {
            Ok(Ok(credential)) => CeremonyOutcome::Completed(credential),
            Ok(Err((code, message))) => map_error(code, &message),
            Err(_) => CeremonyOutcome::Unsupported(
                "the passkey prompt ended without a response from the system".to_string(),
            ),
        }
    }
}

impl Default for MacOsCeremony {
    fn default() -> Self {
        Self::new()
    }
}

fn map_error(code: isize, message: &str) -> CeremonyOutcome {
    match ASAuthorizationError(code) {
        // User dismissed the prompt: first-class non-error outcome (FR-009).
        ASAuthorizationError::Canceled => CeremonyOutcome::Cancelled,
        // `Failed` is where missing entitlement / AASA mismatch lands.
        ASAuthorizationError::Failed | ASAuthorizationError::Unknown => {
            CeremonyOutcome::Unsupported(format!("{message} {SETUP_GUIDANCE}"))
        }
        ASAuthorizationError::DeviceNotConfiguredForPasskeyCreation => {
            CeremonyOutcome::Unsupported(format!(
                "{message} Enable iCloud Keychain (or another passkey-capable authenticator) on \
                 this Mac to save passkeys."
            ))
        }
        _ => CeremonyOutcome::Unsupported(message.to_string()),
    }
}

impl CeremonyProvider for MacOsCeremony {
    fn availability(&self) -> Availability {
        let floor = NSOperatingSystemVersion {
            majorVersion: 13,
            minorVersion: 0,
            patchVersion: 0,
        };
        if NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(floor) {
            Availability::Available
        } else {
            Availability::Unavailable("passkeys require macOS 13 or later".to_string())
        }
    }

    fn create(&self, options_json: &str) -> CeremonyOutcome {
        let options: CreationOptions = match serde_json::from_str(options_json) {
            Ok(options) => options,
            Err(e) => {
                return CeremonyOutcome::Unsupported(format!(
                    "could not parse the server's registration options: {e}"
                ))
            }
        };
        let Some(challenge) = b64_decode(&options.challenge) else {
            return CeremonyOutcome::Unsupported(
                "the server's registration challenge is not valid base64url".to_string(),
            );
        };
        let Some(user_id) = b64_decode(&options.user.id) else {
            return CeremonyOutcome::Unsupported(
                "the server's user handle is not valid base64url".to_string(),
            );
        };
        let user_name = options
            .user
            .name
            .or(options.user.display_name)
            .unwrap_or_default();
        self.run(PromptKind::Register {
            rp_id: options.rp.id,
            challenge,
            user_name,
            user_id,
        })
    }

    fn get(&self, options_json: &str) -> CeremonyOutcome {
        let options: RequestOptions = match serde_json::from_str(options_json) {
            Ok(options) => options,
            Err(e) => {
                return CeremonyOutcome::Unsupported(format!(
                    "could not parse the server's authentication options: {e}"
                ))
            }
        };
        let Some(challenge) = b64_decode(&options.challenge) else {
            return CeremonyOutcome::Unsupported(
                "the server's authentication challenge is not valid base64url".to_string(),
            );
        };
        self.run(PromptKind::Authenticate {
            rp_id: options.rp_id,
            challenge,
        })
    }
}
