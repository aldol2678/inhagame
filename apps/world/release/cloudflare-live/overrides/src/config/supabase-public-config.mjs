// Supabase removed in 2026-11-23 restore (Workers+Neon decision, 2026-11-11).
// Guest/local mode only: no URL/key, so world-online / clients get a null client
// and fall back to offline behaviour by design. Do not re-add a real config here.
export function getPublicSupabaseConfig() {
  return { url: "", publishableKey: "" };
}

export const SUPABASE_URL = "";
export const SUPABASE_PUBLISHABLE_KEY = "";
