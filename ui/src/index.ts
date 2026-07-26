// Blocks
export * from "./blocks";

// Hooks
export * from "./hooks/use-auth";
export * from "./hooks/use-session";
export * from "./hooks/use-onboarding";
export * from "./hooks/use-onboarding-flow";
export * from "./hooks/use-identities";
export * from "./hooks/use-passkeys";

// Convenience re-export from the bindings package
export type { Identity, Passkey, PasskeyCapability } from "@exegia/plugin-supabase-auth";

// Lib
export * from "./lib/error-messages";
export * from "./lib/schemas";
export * from "./lib/onboarding";
export { cn } from "./lib/utils";

// Components (coss primitives)
export * from "./components/ui/alert";
export * from "./components/ui/button";
export * from "./components/ui/card";
export * from "./components/ui/field";
export * from "./components/ui/form";
export * from "./components/ui/input";
export * from "./components/ui/label";
export * from "./components/ui/otp-field";
export * from "./components/ui/separator";
export * from "./components/ui/spinner";
