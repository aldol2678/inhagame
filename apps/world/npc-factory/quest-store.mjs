import { SUPABASE_URL } from '../src/online/world-online.js';
import { isQuestRewardResult } from './quest-reward-shape.mjs';
import { QUEST_ID, QUEST_EVENTS, nextQuestStage } from './quest-contract.mjs';
import { MAIN2_QUEST_ID, MAIN2_QUEST_EVENTS, nextMain2QuestStage } from './main2-quest-contract.mjs';
import { MAIN3_QUEST_ID, MAIN3_QUEST_EVENTS, nextMain3QuestStage } from './main3-quest-contract.mjs';
import {
  MCM_2026_EVENT_ID,
  MCM_2026_EVENT_ACTIONS,
  advanceLocalMcm2026State,
  createLocalMcm2026State
} from './mcm-2026-event-contract.mjs';

export function createLocalQuestStore() {
  const stages = new Map();
  const mcmStates = new Map();
  const key = (userId, questId) => `${userId}:${questId}`;
  return async (userId, event, questId = QUEST_ID) => {
    if (questId === QUEST_ID) {
      if (!QUEST_EVENTS.includes(event)) throw Error('INVALID_QUEST_EVENT');
      const stage = nextQuestStage(stages.get(key(userId, questId)) ?? 0, event);
      if (stage) stages.set(key(userId, questId), stage);
      return { quest_id: QUEST_ID, stage };
    }
    if (questId === MAIN2_QUEST_ID) {
      if (!MAIN2_QUEST_EVENTS.includes(event)) throw Error('INVALID_QUEST_EVENT');
      const available = (stages.get(key(userId, QUEST_ID)) ?? 0) === 5;
      const stage = nextMain2QuestStage(stages.get(key(userId, questId)) ?? 0, event, { available });
      if (stage) stages.set(key(userId, questId), stage);
      return { quest_id: MAIN2_QUEST_ID, stage, available };
    }
    if (questId === MAIN3_QUEST_ID) {
      if (!MAIN3_QUEST_EVENTS.includes(event)) throw Error('INVALID_QUEST_EVENT');
      const available = (stages.get(key(userId, MAIN2_QUEST_ID)) ?? 0) === 9;
      const stage = nextMain3QuestStage(stages.get(key(userId, questId)) ?? 0, event, { available });
      if (stage) stages.set(key(userId, questId), stage);
      return { quest_id: MAIN3_QUEST_ID, stage, available };
    }
    if (questId === MCM_2026_EVENT_ID) {
      if (!MCM_2026_EVENT_ACTIONS.includes(event)) throw Error('INVALID_QUEST_EVENT');
      const k = key(userId, questId);
      const next = advanceLocalMcm2026State(mcmStates.get(k) ?? createLocalMcm2026State(), event);
      mcmStates.set(k, next);
      return next;
    }
    throw Error('INVALID_QUEST_EVENT');
  };
}

export function createSupabaseQuestStore({ serviceRoleKey, fetcher = fetch, supabaseUrl = SUPABASE_URL }) {
  if (!serviceRoleKey) throw Error('QUEST_STORE_CONFIG_REQUIRED');
  return async (userId, event, questId = QUEST_ID) => {
    const main1 = questId === QUEST_ID;
    const main2 = questId === MAIN2_QUEST_ID;
    const main3 = questId === MAIN3_QUEST_ID;
    const mcm = questId === MCM_2026_EVENT_ID;
    const validEvent = main1 ? QUEST_EVENTS.includes(event)
      : main2 ? MAIN2_QUEST_EVENTS.includes(event)
        : main3 ? MAIN3_QUEST_EVENTS.includes(event)
          : mcm ? MCM_2026_EVENT_ACTIONS.includes(event) : false;
    if (!validEvent) throw Error('INVALID_QUEST_EVENT');
    const rpc = main1 ? 'advance_world_quest_v1'
      : main2 ? 'advance_world_navigation_quest_v1'
        : main3 ? 'advance_world_first_style_quest_v1' : 'advance_mcm_2026_event_v1';
    const response = await fetcher(`${supabaseUrl}/rest/v1/rpc/${rpc}`, {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user: userId, p_event: event })
    });
    if (!response.ok) throw Error('QUEST_STORE_UNAVAILABLE');
    const result = await response.json();
    if (mcm) {
      if (result?.eventId !== MCM_2026_EVENT_ID || typeof result?.eventState !== 'string' ||
          typeof result?.progress?.stage !== 'string' || !Array.isArray(result?.progress?.investigated))
        throw Error('QUEST_STORE_UNAVAILABLE');
      return result;
    }
    const maxStage = main1 ? 5 : main2 ? 9 : 4;
    if (result?.quest_id !== questId || !Number.isInteger(result.stage) ||
        result.stage < 0 || result.stage > maxStage ||
        ((main2 || main3) && typeof result.available !== 'boolean'))
      throw Error('QUEST_STORE_UNAVAILABLE');
    // M3.1 has no Reward. Main 1 / Main 2 keep their existing completion Reward contract.
    if (result.reward != null) {
      const rewardAllowed = (main1 && result.stage === 5) || (main2 && result.stage === 9);
      if (!rewardAllowed || !isQuestRewardResult(result.reward)) throw Error('QUEST_STORE_UNAVAILABLE');
    }
    // P04: a lost completing response must not require another grant. The old `reward`
    // field stays completing-call-only; older clients safely ignore this additive receipt.
    // Do not replay on status: returning accounts must not emit a new first_reward event.
    if (main1 && result.stage === 5 && result.reward == null && event === 'talk_001') {
      const key = `grant:quest.first_campus:${userId}`;
      try {
        const receiptResponse = await fetcher(`${supabaseUrl}/rest/v1/rpc/world_reward_get_result_v1`, {
          method: 'POST', signal: AbortSignal.timeout(2000),
          headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json' },
          body: JSON.stringify({ p_idempotency_key: key })
        });
        const receipt = receiptResponse.ok ? await receiptResponse.json() : null;
        if (isQuestRewardResult(receipt) && receipt.rewardId === 'reward.quest.first_campus' &&
            receipt.replayed === true && receipt.userId === userId && receipt.idempotencyKey === key &&
            typeof receipt.rewardTransactionId === 'string' && receipt.rewardTransactionId.length > 0) {
          return { ...result, rewardReceipt: {
            rewardId: receipt.rewardId, rewardVersion: receipt.rewardVersion,
            rewardTransactionId: receipt.rewardTransactionId, status: receipt.status,
            replayed: receipt.replayed, completedAt: receipt.completedAt,
            entries: receipt.entries.map(({ grantType, targetId, requested, granted, status, reason }) =>
              ({ grantType, targetId, requested, granted, status, reason }))
          } };
        }
      } catch { /* Keep known quest progress when optional receipt readback is unavailable. */ }
      // No receipt (including pre-reward legacy completions) is never a reason to grant/backfill.
    }
    return result;
  };
}
