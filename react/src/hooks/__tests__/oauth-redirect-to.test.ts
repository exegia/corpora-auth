import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configureWeb,
  linkIdentity as webLinkIdentity,
  signInWithOAuth as webSignInWithOAuth,
} from "@exegia/plugin-supabase-auth/web";
import {
  linkIdentity as tauriLinkIdentity,
  signInWithOAuth as tauriSignInWithOAuth,
} from "@exegia/plugin-supabase-auth/tauri";

/**
 * `redirectTo` on the OAuth bindings, both surfaces of the parity contract:
 *
 * - **web** — the option must reach GoTrue as `options.redirectTo`, because
 *   that is the only way a multi-environment SPA (localhost dev + production
 *   domain) can pick its post-callback landing page per call. Without it,
 *   GoTrue always returns the browser to the project's Site URL.
 * - **tauri** — the option must be *accepted* (the root entry types every
 *   binding against `typeof import("@/tauri")`, so a web-only option has to
 *   exist there too) and *ignored*: the plugin owns the redirect via its
 *   loopback listener, and `redirectTo` must never enter the IPC payload.
 */

// -- web surface --------------------------------------------------------------

/** The GoTrue wire shape `toSession` / `toUser` need to map a session. */
const supabaseSession = {
  access_token: "access-token",
  token_type: "bearer",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: "user-1",
    email: "ada@example.com",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    user_metadata: {},
    app_metadata: {},
  },
};

type AuthChangeCallback = (event: string, session: unknown) => void;

/**
 * A fake GoTrueClient covering exactly what the redirect-flow bindings touch:
 * the OAuth starters, the identity list, and the event stream the bindings
 * wait on to settle in-page.
 */
function makeFakeGoTrue() {
  const listeners: AuthChangeCallback[] = [];
  const client = {
    signInWithOAuth: vi.fn(async () => ({
      data: { provider: "google", url: "https://example.test/authorize" },
      error: null,
    })),
    linkIdentity: vi.fn(async () => ({
      data: { provider: "google", url: "https://example.test/authorize" },
      error: null,
    })),
    getUserIdentities: vi.fn(async () => ({
      data: { identities: [] },
      error: null,
    })),
    onAuthStateChange: vi.fn((cb: AuthChangeCallback) => {
      listeners.push(cb);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
  };
  const emit = (event: string, session: unknown) => {
    for (const cb of [...listeners]) cb(event, session);
  };
  return { client, emit };
}

function configureWithFake() {
  const fake = makeFakeGoTrue();
  configureWeb({ client: fake.client } as unknown as Parameters<typeof configureWeb>[0]);
  return fake;
}

describe("web: redirectTo is forwarded to GoTrue", () => {
  it("signInWithOAuth passes options.redirectTo through", async () => {
    const { client, emit } = configureWithFake();

    const pending = webSignInWithOAuth({
      provider: "google",
      scopes: ["email"],
      redirectTo: "http://localhost:5173/auth/callback?next=%2Fprojects",
    });
    await vi.waitFor(() => expect(client.signInWithOAuth).toHaveBeenCalled());
    emit("SIGNED_IN", supabaseSession);
    await pending;

    expect(client.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        scopes: "email",
        redirectTo: "http://localhost:5173/auth/callback?next=%2Fprojects",
      },
    });
  });

  it("signInWithOAuth leaves options.redirectTo undefined when omitted", async () => {
    const { client, emit } = configureWithFake();

    const pending = webSignInWithOAuth({ provider: "google" });
    await vi.waitFor(() => expect(client.signInWithOAuth).toHaveBeenCalled());
    emit("SIGNED_IN", supabaseSession);
    await pending;

    expect(client.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { scopes: undefined, redirectTo: undefined },
    });
  });

  it("linkIdentity passes options.redirectTo through", async () => {
    const { client, emit } = configureWithFake();

    const pending = webLinkIdentity({
      provider: "github",
      redirectTo: "https://app.example.com/settings/identities",
    });
    await vi.waitFor(() => expect(client.linkIdentity).toHaveBeenCalled());
    emit("USER_UPDATED", supabaseSession);
    await expect(pending).resolves.toEqual([]);

    expect(client.linkIdentity).toHaveBeenCalledWith({
      provider: "github",
      options: {
        scopes: undefined,
        redirectTo: "https://app.example.com/settings/identities",
      },
    });
  });
});

// -- tauri surface ------------------------------------------------------------

type TauriInternals = { __TAURI_INTERNALS__?: { invoke: unknown } };

afterEach(() => {
  delete (window as unknown as TauriInternals).__TAURI_INTERNALS__;
});

/** Installs a stubbed IPC bridge and returns the spy `invoke` lands on. */
function stubTauriInvoke(result: unknown) {
  const invoke = vi.fn(async (..._args: unknown[]) => result);
  (window as unknown as TauriInternals).__TAURI_INTERNALS__ = { invoke };
  return invoke;
}

describe("tauri: redirectTo is accepted but never enters the IPC payload", () => {
  it("signInWithOAuth drops redirectTo from the invoke args", async () => {
    const invoke = stubTauriInvoke({
      accessToken: "access-token",
      expiresAt: "2026-01-01T01:00:00Z",
      tokenType: "bearer",
      user: {},
    });

    await tauriSignInWithOAuth({
      provider: "google",
      scopes: ["email"],
      redirectTo: "http://localhost:5173/auth/callback",
    });

    expect(invoke).toHaveBeenCalledWith(
      "plugin:supabase-auth|start_oauth_flow",
      { provider: "google", scopes: ["email"] },
      undefined,
    );
    const payload = invoke.mock.calls[0]?.[1] as Record<string, unknown>;
    expect("redirectTo" in payload).toBe(false);
  });

  it("linkIdentity drops redirectTo from the invoke args", async () => {
    const invoke = stubTauriInvoke([]);

    await tauriLinkIdentity({
      provider: "github",
      redirectTo: "https://app.example.com/settings/identities",
    });

    expect(invoke).toHaveBeenCalledWith(
      "plugin:supabase-auth|link_identity",
      { provider: "github", scopes: undefined },
      undefined,
    );
    const payload = invoke.mock.calls[0]?.[1] as Record<string, unknown>;
    expect("redirectTo" in payload).toBe(false);
  });
});
