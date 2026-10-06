import { SUPABASE_URL } from '../src/config/supabase-public-config.mjs';
import {
  NPC_AFFINITY_EVENT,
  NPC_RELATIONSHIP_REGISTRY,
  resolveNpcAffinityDelta
} from './npc-player-relationship-registry.mjs';
import { NPC_RELATIONSHIP_DIALOGUE_EVENT } from './npc-player-relationship-client.mjs';

const RESPONSE_STATUS = new Set(['APPLIED','ALREADY_PROCESSED','ALREADY_MET']);

const kstDay = date => new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

function requestSpec(userId, npcId, event, now) {
  const rule = NPC_RELATIONSHIP_REGISTRY.get(npcId);
  if (!rule) throw Error('NPC_RELATIONSHIP_NPC_NOT_ALLOWED');
  if (event === NPC_RELATIONSHIP_DIALOGUE_EVENT.OPEN) {
    return Object.freeze({
      eventType: NPC_AFFINITY_EVENT.FIRST_MEETING,
      occurrence: 1,
      delta: resolveNpcAffinityDelta(npcId, {
        eventType: NPC_AFFINITY_EVENT.FIRST_MEETING,
        occurrence: 1
      }),
      sourceRef: 'dialogue:first_meeting',
      idempotencyKey: `campus-npc-rel:${userId}:${npcId}:first`,
      definitionVersion: rule.definitionVersion
    });
  }
  if (event === NPC_RELATIONSHIP_DIALOGUE_EVENT.TOPIC) {
    const day = kstDay(now);
    return Object.freeze({
      eventType: NPC_AFFINITY_EVENT.MEANINGFUL_DIALOGUE,
      occurrence: 1,
      delta: resolveNpcAffinityDelta(npcId, {
        eventType: NPC_AFFINITY_EVENT.MEANINGFUL_DIALOGUE,
        occurrence: 1
      }),
      sourceRef: `dialogue:meaningful:${day}`,
      idempotencyKey: `campus-npc-rel:${userId}:${npcId}:dialogue:${day}`,
      definitionVersion: rule.definitionVersion
    });
  }
  throw Error('INVALID_NPC_RELATIONSHIP_DIALOGUE_EVENT');
}

export function createSupabaseNpcRelationshipStore({
  serviceRoleKey,
  fetcher = fetch,
  supabaseUrl = SUPABASE_URL,
  now = () => new Date()
} = {}) {
  if (!serviceRoleKey) throw Error('NPC_RELATIONSHIP_STORE_CONFIG_REQUIRED');
  return async (userId, npcId, event) => {
    const spec = requestSpec(userId, npcId, event, now());
    if (!Number.isInteger(spec.delta) || spec.delta === 0)
      throw Error('NPC_RELATIONSHIP_RULE_UNAVAILABLE');
    const response = await fetcher(`${supabaseUrl}/rest/v1/rpc/world_campus_npc_relationship_apply_v1`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_user: userId,
        p_npc_id: npcId,
        p_definition_version: spec.definitionVersion,
        p_event_type: spec.eventType,
        p_signal: null,
        p_occurrence: spec.occurrence,
        p_requested_delta: spec.delta,
        p_source_type: 'DIALOGUE',
        p_source_ref: spec.sourceRef,
        p_idempotency_key: spec.idempotencyKey
      })
    });
    if (!response.ok) throw Error('NPC_RELATIONSHIP_STORE_UNAVAILABLE');
    const result = await response.json();
    if (!RESPONSE_STATUS.has(result?.status) ||
        result?.relationship?.npcId !== npcId ||
        !Number.isInteger(result.relationship.affinity) ||
        result.relationship.affinity < 0 || result.relationship.affinity > 100 ||
        typeof result.relationship.tier !== 'string')
      throw Error('NPC_RELATIONSHIP_STORE_UNAVAILABLE');
    return result;
  };
}

export { kstDay as npcRelationshipKstDay };
