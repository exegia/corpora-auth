/**
 * Supabase settings for the browser demo.
 *
 * Bun inlines `BUN_PUBLIC_*` variables into the client bundle — the dev server
 * through `env = "BUN_PUBLIC_*"` in `bunfig.toml`, the production build through
 * the matching `env` option in `build.ts`. Any other prefix stays server-side
 * and reads as `undefined` here, so the names below must keep it.
 *
 * There is deliberately no fallback to the local stack: a silent default is how
 * you end up demoing against the wrong project. `make supabase-up` prints both
 * values, and the README lists the local-stack ones to paste.
 */
export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

function required(name: string, value: string | undefined): string {
  if (value && value.trim() !== "") return value;
  throw new Error(
    `${name} is not set. The web demo needs both BUN_PUBLIC_SUPABASE_URL and ` +
      `BUN_PUBLIC_SUPABASE_ANON_KEY — put them in examples/web-app/.env.local ` +
      `(see the README for the local-stack values) and restart the dev server.`,
  );
}

export function readSupabaseConfig(): SupabaseConfig {
  return {
    url: required(
      "BUN_PUBLIC_SUPABASE_URL",
      process.env.BUN_PUBLIC_SUPABASE_URL,
    ),
    anonKey: required(
      "BUN_PUBLIC_SUPABASE_ANON_KEY",
      process.env.BUN_PUBLIC_SUPABASE_ANON_KEY,
    ),
  };
}
