// Reads the same-origin INHAGAME member session (public SDK + publishable config only) so the
// FBX converter can verify the caller server-side. Never put a service or converter secret here.
// Returns null when signed out, a guest, or the SDK/config is missing; the server then answers 401.
let client = null;

export async function getEditorModelConvertToken({
  sdk = globalThis.supabase,
  config = globalThis.__INHAGAME_PUBLIC_SUPABASE__
} = {}) {
  if (!sdk?.createClient || !config?.url || !config?.publishableKey) return null;
  client ??= sdk.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  const { data, error } = await client.auth.getSession();
  const session = data?.session;
  return !error && session?.access_token && session.user?.is_anonymous !== true ? session.access_token : null;
}

export function resetEditorModelConvertAuthForTest() {
  client = null;
}
