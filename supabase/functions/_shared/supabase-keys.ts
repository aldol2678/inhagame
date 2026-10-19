// Supabase API key selection for Edge Functions.
//
// The hosted runtime injects SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS as JSON
// dictionaries keyed by key name ({"default": "sb_secret_..."}), see
// https://supabase.com/docs/guides/functions/secrets ("Default secrets"). The legacy
// SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY JWTs stay as a fallback until the legacy keys
// are disabled. Errors carry fixed codes only; key values are never logged or returned.

type EnvReader = (name: string) => string | undefined;

const readEnv: EnvReader = (name) => Deno.env.get(name);

export const SUPABASE_SECRET_KEY_REQUIRED = "SUPABASE_SECRET_KEY_REQUIRED";
export const SUPABASE_PUBLISHABLE_KEY_REQUIRED = "SUPABASE_PUBLISHABLE_KEY_REQUIRED";

/** Value for `name` in a JSON key dictionary env, or "" when absent or malformed. */
export function keyFromJsonEnv(raw: string | undefined, name = "default"): string {
  if (!raw) return "";
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
    const value = (parsed as Record<string, unknown>)[name];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function pick(
  env: EnvReader,
  jsonName: string,
  legacyName: string,
  keyName: string,
  missing: string,
): string {
  const key = keyFromJsonEnv(env(jsonName), keyName) || String(env(legacyName) ?? "").trim();
  if (!key) throw new Error(missing);
  return key;
}

/** Admin (RLS-bypassing) key: SUPABASE_SECRET_KEYS[keyName], else SUPABASE_SERVICE_ROLE_KEY. */
export function supabaseSecretKey(keyName = "default", env: EnvReader = readEnv): string {
  return pick(env, "SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY", keyName,
    SUPABASE_SECRET_KEY_REQUIRED);
}

/** Public (RLS-respecting) key: SUPABASE_PUBLISHABLE_KEYS[keyName], else SUPABASE_ANON_KEY. */
export function supabasePublishableKey(keyName = "default", env: EnvReader = readEnv): string {
  return pick(env, "SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY", keyName,
    SUPABASE_PUBLISHABLE_KEY_REQUIRED);
}
