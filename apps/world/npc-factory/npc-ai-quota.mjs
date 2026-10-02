import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../src/online/world-online.js';

export function createNpcAiQuota({ serviceRoleKey, fetcher = fetch } = {}) {
  if (!serviceRoleKey) throw Error('NPC_AI_QUOTA_CREDENTIAL_REQUIRED');
  return async userId => {
    const response = await fetcher(`${SUPABASE_URL}/rest/v1/rpc/claim_world_npc_ai_call_v1`, {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user: userId })
    });
    if (!response.ok) throw Error('NPC_AI_QUOTA_UNAVAILABLE');
    const result = await response.json();
    if (result === 'USER_LIMIT') throw Error('PILOT_USER_DAILY_LIMIT');
    if (result === 'GLOBAL_LIMIT') throw Error('PILOT_GLOBAL_DAILY_LIMIT');
    if (result !== 'OK') throw Error('NPC_AI_QUOTA_UNAVAILABLE');
  };
}
