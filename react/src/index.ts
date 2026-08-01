// Hooks
export * from "./hooks/use-auth";
export * from "./hooks/use-session";
export * from "./hooks/use-onboarding";
export * from "./hooks/use-onboarding-flow";
export * from "./hooks/use-identities";
export * from "./hooks/use-passkeys";

// Convenience re-export from the bindings package
export type {
  Identity,
  Passkey,
  PasskeyCapability,
} from "@exegia/plugin-supabase-auth";

// Lib
export * from "./lib/error-messages";
export * from "./lib/schemas";
export * from "./lib/onboarding";
