// Server-only Supabase credential selection, shared by the Vercel API functions and the
// Cloud Run NPC AI container (apps/world/Dockerfile copies npc-factory/).
//
// Order: SUPABASE_SECRET_KEY (new `sb_secret_...` key) first, then the legacy
// SUPABASE_SERVICE_ROLE_KEY JWT as a fallback so production keeps working until the env
// cutover. Unsetting SUPABASE_SECRET_KEY rolls back to the legacy key.
//
// Header rule (https://supabase.com/docs/guides/api/api-keys, "Known limitations"):
// publishable/secret keys are not JWTs and go on the `apikey` header only. A legacy JWT keeps
// the previous `apikey` + `Authorization: Bearer` pair.
//
// Never log or embed the key value: errors carry only fixed codes and env names.

export const SUPABASE_SECRET_KEY_ENV = 'SUPABASE_SECRET_KEY';
export const SUPABASE_LEGACY_SERVICE_ROLE_KEY_ENV = 'SUPABASE_SERVICE_ROLE_KEY';
export const SUPABASE_SERVER_KEY_REQUIRED = 'SUPABASE_SERVER_KEY_REQUIRED';
export const SUPABASE_SERVER_KEY_INVALID = 'SUPABASE_SERVER_KEY_INVALID';

const SECRET_PREFIX = 'sb_secret_';
const PUBLISHABLE_PREFIX = 'sb_publishable_';

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isSupabaseSecretKey(key) {
  return typeof key === 'string' && key.startsWith(SECRET_PREFIX);
}

/**
 * Pick the server credential from an env object. Returns `{ key, source }` where `source` is
 * the env *name* that supplied it (safe to log), or `null` when neither is set.
 * A publishable key in a server slot is a misconfiguration and throws.
 */
export function readSupabaseServerKey(env = process.env) {
  for (const name of [SUPABASE_SECRET_KEY_ENV, SUPABASE_LEGACY_SERVICE_ROLE_KEY_ENV]) {
    const key = clean(env?.[name]);
    if (!key) continue;
    if (key.startsWith(PUBLISHABLE_PREFIX) || /\s/u.test(key)) throw Error(SUPABASE_SERVER_KEY_INVALID);
    return { key, source: name };
  }
  return null;
}

/** Like readSupabaseServerKey but fails closed with a fixed error code when nothing is set. */
export function requireSupabaseServerKey(env = process.env) {
  const selected = readSupabaseServerKey(env);
  if (!selected) throw Error(SUPABASE_SERVER_KEY_REQUIRED);
  return selected.key;
}

/**
 * Headers for a server-to-Supabase REST/RPC call made with the server credential.
 * `sb_secret_...` -> `apikey` only. Anything else (legacy service_role JWT) -> `apikey` + Bearer.
 */
export function supabaseServerHeaders(key, extra = {}) {
  const value = clean(key);
  if (!value) throw Error(SUPABASE_SERVER_KEY_REQUIRED);
  const headers = Object.fromEntries(Object.entries(extra)
    .filter(([name]) => !/^(apikey|authorization)$/iu.test(name)));
  if (isSupabaseSecretKey(value)) return { ...headers, apikey: value };
  return { ...headers, apikey: value, Authorization: `Bearer ${value}` };
}
