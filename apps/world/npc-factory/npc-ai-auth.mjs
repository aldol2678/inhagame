import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../src/config/supabase-public-config.js';

export async function verifyNpcAiUser(authorization, fetcher = fetch) {
  const match = /^Bearer ([A-Za-z0-9._~-]{20,4096})$/.exec(authorization ?? '');
  if (!match) return null;
  const response = await fetcher(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${match[1]}` },
    signal: AbortSignal.timeout(5000)
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw Error('AUTH_UNAVAILABLE');
  const user = await response.json();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(user?.id ?? '') &&
    user.is_anonymous === false ? user.id : null;
}
