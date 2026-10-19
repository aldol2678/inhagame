import { SUPABASE_URL } from '../src/online/world-online.js';
import { supabaseServerHeaders } from './supabase-server-key.mjs';

export function createNpcAiQuota({ serviceRoleKey, fetcher = fetch } = {}) {
  if (!serviceRoleKey) throw Error('NPC_AI_QUOTA_CREDENTIAL_REQUIRED');
  return async userId => {
    const response = await fetcher(`${SUPABASE_URL}/rest/v1/rpc/claim_world_npc_ai_call_v1`, {
      method: 'POST', signal: AbortSignal.timeout(5000),
      // Same server credential on apikey (and Bearer only for a legacy JWT); the old mix of a
      // publishable apikey with a service_role Bearer is undefined for sb_secret_ keys.
      headers: supabaseServerHeaders(serviceRoleKey, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ p_user: userId })
    });
    if (!response.ok) throw Error('NPC_AI_QUOTA_UNAVAILABLE');
    const result = await response.json();
    if (result === 'USER_LIMIT') throw Error('PILOT_USER_DAILY_LIMIT');
    if (result === 'GLOBAL_LIMIT') throw Error('PILOT_GLOBAL_DAILY_LIMIT');
    if (result !== 'OK') throw Error('NPC_AI_QUOTA_UNAVAILABLE');
  };
}
