// Hooks
export * from "./hooks/use-auth";
export * from "./hooks/use-session";
export * from "./hooks/use-onboarding";
export * from "./hooks/use-onboarding-flow";
export * from "./hooks/use-identities";
export * from "./hooks/use-passkeys";

// The read side of the imperative surface, for guards that run outside React
// (router loaders, middleware). Unlike `authActions`, these are the bindings
// themselves: `getSession` *rejects* on failure rather than resolving to an
// AuthResult — catch it, or a transport blip escapes your guard.
export {
  getSession,
  onAuthStateChange,
} from "@exegia/plugin-supabase-auth";

// Convenience re-exports from the bindings package
export type {
  AuthChangePayload,
  AuthError,
  AuthErrorKind,
  Identity,
  Passkey,
  PasskeyCapability,
  Session,
  User,
} from "@exegia/plugin-supabase-auth";

// Hook prop/result types (`./types`). The bindings re-exports above stay
// authoritative for the names both surfaces declare (AuthError, User, …):
// explicit named exports take precedence over star exports.
export * from "./types";

// Lib
export * from "./lib/error-messages";
export * from "./lib/schemas";
export * from "./lib/onboarding";
