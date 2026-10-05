export const NIGHT_LIGHT_BUDGET = Object.freeze({
  low: 0,
  medium: 2,
  high: 4
});

export const NIGHT_LIGHT_MAX_DISTANCE = 38;

export function nightLightBudget(tier) {
  return Object.hasOwn(NIGHT_LIGHT_BUDGET, tier) ? NIGHT_LIGHT_BUDGET[tier] : NIGHT_LIGHT_BUDGET.medium;
}

export function lampHeadPosition(lamp) {
  const p = lamp.frame.at(0, -lamp.side * 0.93);
  return Object.freeze({ x: p.x, y: lamp.height + 0.055, z: p.z });
}

export function nearestNightLampIndices(lamps, position, limit, maxDistance = NIGHT_LIGHT_MAX_DISTANCE) {
  const count = Math.max(0, Math.floor(limit));
  if (!count || !position) return [];
  const maxD2 = maxDistance * maxDistance;
  return lamps
    .map((lamp, index) => {
      const head = lamp.head ?? lampHeadPosition(lamp);
      const dx = head.x - position.x;
      const dz = head.z - position.z;
      return { index, d2: dx * dx + dz * dz };
    })
    .filter(item => item.d2 <= maxD2)
    .sort((a, b) => a.d2 - b.d2 || a.index - b.index)
    .slice(0, count)
    .map(item => item.index);
}
