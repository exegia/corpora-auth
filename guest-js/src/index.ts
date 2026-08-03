/**
 * Runtime-dispatching root entry for `@exegia/plugin-supabase-auth`.
 *
 * The same import specifier has to work inside a Tauri webview (IPC bindings,
 * `@tauri-apps/api`) and in a plain browser (`@supabase/auth-js`). Every
 * binding below is a thin wrapper that lazily `import()`s whichever module the
 * current runtime needs, exactly once, so a web bundle never pulls in
 * `@tauri-apps/api` and a Tauri bundle never pulls in `@supabase/auth-js`.
 *
 * Per-function documentation lives on the subpath modules (`/tauri`, `/web`);
 * both surfaces are signature-identical, and typing this file against
 * `typeof import("@/tauri")` is what keeps them that way. The web-only
 * `configureWeb` is deliberately NOT re-exported here — import it from
 * `@exegia/plugin-supabase-auth/web`.
 */

export * from "@/types";
export { isAuthError } from "@/constant";

type Bindings = typeof import("@/tauri");

let impl: Promise<Bindings> | undefined;

function bindings(): Promise<Bindings> {
  impl ??= ("__TAURI_INTERNALS__" in globalThis
    ? import("@/tauri")
    : import("@/web")) as Promise<Bindings>;
  return impl;
}

export const signUp: Bindings["signUp"] = (...a) =>
  bindings().then((m) => m.signUp(...a));

export const signInWithPassword: Bindings["signInWithPassword"] = (...a) =>
  bindings().then((m) => m.signInWithPassword(...a));

export const signInWithOtp: Bindings["signInWithOtp"] = (...a) =>
  bindings().then((m) => m.signInWithOtp(...a));

export const verifyOtp: Bindings["verifyOtp"] = (...a) =>
  bindings().then((m) => m.verifyOtp(...a));

export const signInWithOAuth: Bindings["signInWithOAuth"] = (...a) =>
  bindings().then((m) => m.signInWithOAuth(...a));

export const cancelOAuthFlow: Bindings["cancelOAuthFlow"] = (...a) =>
  bindings().then((m) => m.cancelOAuthFlow(...a));

export const signOut: Bindings["signOut"] = (...a) =>
  bindings().then((m) => m.signOut(...a));

export const getSession: Bindings["getSession"] = (...a) =>
  bindings().then((m) => m.getSession(...a));

export const getUser: Bindings["getUser"] = (...a) =>
  bindings().then((m) => m.getUser(...a));

export const refreshSession: Bindings["refreshSession"] = (...a) =>
  bindings().then((m) => m.refreshSession(...a));

export const resetPasswordForEmail: Bindings["resetPasswordForEmail"] = (
  ...a
) => bindings().then((m) => m.resetPasswordForEmail(...a));

export const updateUser: Bindings["updateUser"] = (...a) =>
  bindings().then((m) => m.updateUser(...a));

export const getIdentities: Bindings["getIdentities"] = (...a) =>
  bindings().then((m) => m.getIdentities(...a));

export const linkIdentity: Bindings["linkIdentity"] = (...a) =>
  bindings().then((m) => m.linkIdentity(...a));

export const unlinkIdentity: Bindings["unlinkIdentity"] = (...a) =>
  bindings().then((m) => m.unlinkIdentity(...a));

export const getPasskeyCapability: Bindings["getPasskeyCapability"] = (...a) =>
  bindings().then((m) => m.getPasskeyCapability(...a));

export const registerPasskey: Bindings["registerPasskey"] = (...a) =>
  bindings().then((m) => m.registerPasskey(...a));

export const signInWithPasskey: Bindings["signInWithPasskey"] = (...a) =>
  bindings().then((m) => m.signInWithPasskey(...a));

export const listPasskeys: Bindings["listPasskeys"] = (...a) =>
  bindings().then((m) => m.listPasskeys(...a));

export const renamePasskey: Bindings["renamePasskey"] = (...a) =>
  bindings().then((m) => m.renamePasskey(...a));

export const deletePasskey: Bindings["deletePasskey"] = (...a) =>
  bindings().then((m) => m.deletePasskey(...a));

export const passkeyRegistrationOptions: Bindings["passkeyRegistrationOptions"] =
  (...a) => bindings().then((m) => m.passkeyRegistrationOptions(...a));

export const passkeyRegistrationVerify: Bindings["passkeyRegistrationVerify"] =
  (...a) => bindings().then((m) => m.passkeyRegistrationVerify(...a));

export const passkeyAuthenticationOptions: Bindings["passkeyAuthenticationOptions"] =
  (...a) => bindings().then((m) => m.passkeyAuthenticationOptions(...a));

export const passkeyAuthenticationVerify: Bindings["passkeyAuthenticationVerify"] =
  (...a) => bindings().then((m) => m.passkeyAuthenticationVerify(...a));

export const onAuthStateChange: Bindings["onAuthStateChange"] = (...a) =>
  bindings().then((m) => m.onAuthStateChange(...a));
