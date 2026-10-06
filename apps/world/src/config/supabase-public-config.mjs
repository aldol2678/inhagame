/**
 * P1-C A5 — PUBLIC CLIENT Supabase config (not service_role).
 * Env / global override first; baked default for private deploys.
 * Clean snapshot export replaces BAKED_* with placeholders.
 */
const fromEnv = () => {
  const env = (typeof process !== 'undefined' && process.env) ? process.env : {};
  const meta = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || meta.VITE_SUPABASE_URL || '';
  const publishableKey =
    env.SUPABASE_PUBLISHABLE_KEY ||
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    meta.VITE_SUPABASE_PUBLISHABLE_KEY ||
    '';
  if (url && publishableKey) return { url, publishableKey };
  return null;
};

const fromGlobal = () => {
  const g = globalThis.__INHAGAME_PUBLIC_SUPABASE__;
  if (g && g.url && g.publishableKey) return { url: g.url, publishableKey: g.publishableKey };
  return null;
};

const BAKED_PRIVATE_DEFAULT = {
  url: "http://127.0.0.1:54321",
  publishableKey: "sb_publishable_PUBLIC_PLACEHOLDER",
};

export function getPublicSupabaseConfig() {
  return fromEnv() || fromGlobal() || BAKED_PRIVATE_DEFAULT;
}

export const SUPABASE_URL = getPublicSupabaseConfig().url;
export const SUPABASE_PUBLISHABLE_KEY = getPublicSupabaseConfig().publishableKey;

if (typeof globalThis !== 'undefined') {
  globalThis.__INHAGAME_PUBLIC_SUPABASE__ = getPublicSupabaseConfig();
}
