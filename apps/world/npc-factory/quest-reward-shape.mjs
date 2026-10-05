// P1c: only the call that completes the first walk carries `reward` (the server Reward result, never
// computed here). Its minimal shape is checked so a malformed payload never reaches the player.
const REWARD_STATUSES = new Set(['SUCCESS', 'PARTIAL_SUCCESS']);
const ENTRY_STATUSES = new Set(['GRANTED', 'SKIPPED']);
export function isQuestRewardResult(reward) {
  return Boolean(reward) && typeof reward === 'object' && !Array.isArray(reward) &&
    typeof reward.rewardId === 'string' && REWARD_STATUSES.has(reward.status) &&
    typeof reward.replayed === 'boolean' && Array.isArray(reward.entries) && reward.entries.length > 0 &&
    reward.entries.every(entry => entry && typeof entry === 'object' &&
      typeof entry.grantType === 'string' && typeof entry.targetId === 'string' &&
      ENTRY_STATUSES.has(entry.status) && Number.isSafeInteger(entry.granted) && entry.granted >= 0);
}
