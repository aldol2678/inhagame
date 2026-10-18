// Uses only the public Supabase SDK and the same-origin signed-in session.
// Never embed an operator allowlist or a service/convert secret in the browser.
let client;
export async function getEditorModelConvertToken({
  sdk = globalThis.supabase,
  config = globalThis.__INHAGAME_PUBLIC_SUPABASE__
} = {}) {
  if (!sdk?.createClient || !config?.url || !config?.publishableKey ||
      !/^https:\/\/[a-z0-9-]+\.supabase\.co$/iu.test(config.url) ||
      !config.publishableKey.startsWith("sb_publishable_")) {
    throw new Error("E_MODEL_CONVERT_AUTH_UNAVAILABLE");
  }
  client ??= sdk.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error("E_MODEL_CONVERT_AUTH_UNAVAILABLE");
  const session = data?.session;
  if (!session?.access_token || session.user?.is_anonymous !== false) {
    throw new Error("E_MODEL_CONVERT_LOGIN_REQUIRED");
  }
  return session.access_token;
}
