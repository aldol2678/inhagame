// Bump revision when shared schedules, anchors, speeds or route semantics change.
export const NPC_SCHEDULE_REVISION = 'ng2-campus-life-v3';
export const NPC_WORLD_EPOCH_MS = Date.UTC(2026, 0, 1);

// Canonical cadence: five shared periods, each 15 real minutes.
// One complete INHA WORLD day is therefore 75 real minutes.
export const NPC_WORLD_PERIOD_MINUTES = 15;
export const NPC_WORLD_PERIOD_MS = NPC_WORLD_PERIOD_MINUTES * 60_000;
export const NPC_WORLD_PERIODS = Object.freeze(['morning', 'class_time', 'lunch', 'evening', 'night']);
export const NPC_WORLD_CYCLE_MINUTES = NPC_WORLD_PERIOD_MINUTES * NPC_WORLD_PERIODS.length;
export const NPC_WORLD_CYCLE_MS = NPC_WORLD_PERIOD_MS * NPC_WORLD_PERIODS.length;

export function worldTimePayload(serverNowMs = Date.now()) {
  return { revision: NPC_SCHEDULE_REVISION, serverNowMs, epochMs: NPC_WORLD_EPOCH_MS,
    periodMs: NPC_WORLD_PERIOD_MS, periods: [...NPC_WORLD_PERIODS] };
}
export function validWorldTime(value) {
  return value?.revision === NPC_SCHEDULE_REVISION &&
    Number.isSafeInteger(value.serverNowMs) && value.serverNowMs >= NPC_WORLD_EPOCH_MS &&
    value.epochMs === NPC_WORLD_EPOCH_MS && value.periodMs === NPC_WORLD_PERIOD_MS &&
    JSON.stringify(value.periods) === JSON.stringify(NPC_WORLD_PERIODS);
}
export function worldScheduleAt(serverNowMs) {
  if (!Number.isFinite(serverNowMs) || serverNowMs < NPC_WORLD_EPOCH_MS) throw new Error('Invalid world time');
  const elapsedMs = serverNowMs - NPC_WORLD_EPOCH_MS;
  const slot = Math.floor(elapsedMs / NPC_WORLD_PERIOD_MS);
  const index = slot % NPC_WORLD_PERIODS.length;
  return { slot, index, period: NPC_WORLD_PERIODS[index],
    offsetSeconds: (elapsedMs % NPC_WORLD_PERIOD_MS) / 1000,
    cycleSeconds: (elapsedMs % NPC_WORLD_CYCLE_MS) / 1000 };
}
