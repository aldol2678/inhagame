export const ASSET_CANARY_EVENT = Object.freeze({
  SELECTED: "asset_canary_selected",
  ACTIVE: "asset_canary_active",
  ROLLBACK: "asset_canary_rollback",
  FAILURE: "asset_canary_failure"
});

const TARGET = "induck_v3";

export function createAssetCanaryTelemetry({
  track = (eventType, surface, target) =>
    globalThis.window?.InhaHubTelemetry?.track?.(eventType, surface, target) ?? null
} = {}) {
  const sent = new Set();

  function emit(eventType) {
    if (!Object.values(ASSET_CANARY_EVENT).includes(eventType) || sent.has(eventType)) return false;
    sent.add(eventType);
    try { track(eventType, "campus", TARGET); } catch {}
    return true;
  }

  return Object.freeze({
    selected: () => emit(ASSET_CANARY_EVENT.SELECTED),
    active: () => emit(ASSET_CANARY_EVENT.ACTIVE),
    rollback: () => emit(ASSET_CANARY_EVENT.ROLLBACK),
    failure: () => emit(ASSET_CANARY_EVENT.FAILURE),
    status: () => Object.freeze({ sent: Object.freeze([...sent]) })
  });
}
