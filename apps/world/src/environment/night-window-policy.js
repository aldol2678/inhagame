const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export const NIGHT_WINDOW_TIER_POLICY = Object.freeze({
  low: Object.freeze({
    spacing: 5.8,
    maxFloors: 4,
    litRatio: 0.44,
    maxWindows: 220
  }),
  medium: Object.freeze({
    spacing: 4.2,
    maxFloors: 6,
    litRatio: 0.58,
    maxWindows: 440
  }),
  high: Object.freeze({
    spacing: 3.2,
    maxFloors: 8,
    litRatio: 0.66,
    maxWindows: 720
  })
});

export const NIGHT_WINDOW_COLORS = Object.freeze({
  warm: Object.freeze([1.00, 0.72, 0.36]),
  cool: Object.freeze([0.66, 0.79, 1.00])
});

export function nightWindowTierPolicy(tier) {
  return Object.hasOwn(NIGHT_WINDOW_TIER_POLICY, tier)
    ? NIGHT_WINDOW_TIER_POLICY[tier]
    : NIGHT_WINDOW_TIER_POLICY.medium;
}

export function nightWindowGlowFactor(artificialLightFactor) {
  const input = clamp01(artificialLightFactor);
  if (input <= 0.07) return 0;
  if (input >= 1) return 1;
  return Math.pow(clamp01((input - 0.07) / 0.93), 0.92);
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashUnit(value) {
  return hashString(value) / 0xffffffff;
}

function ringArea(ring) {
  return ring.reduce(
    (sum, point, index) => {
      const next = ring[(index + 1) % ring.length];
      return sum + point.x * next.z - next.x * point.z;
    },
    0
  );
}

function normalizeBuilding(building) {
  const rings = Array.isArray(building?.rings)
    ? building.rings
    : Array.isArray(building?.vertices)
      ? [building.vertices]
      : [];
  return {
    id: String(building?.id ?? 'building'),
    rings,
    height: Math.max(2.6, Number(building?.height) || 10),
    floors: Number(building?.floors) || 0
  };
}

export function nightWindowLayout(buildings, tier = 'medium') {
  const policy = nightWindowTierPolicy(tier);
  const result = [];

  for (const source of buildings ?? []) {
    if (result.length >= policy.maxWindows) break;
    // A replacement landmark can supply panes from its actual render source.
    // Preserve the existing tier budget/determinism without projecting its old footprint.
    if(Array.isArray(source.windows)){
      for(const [index,pane] of source.windows.entries()){
        if(result.length>=policy.maxWindows)break;
        if(hashUnit(`${source.id}:source:${index}`)<=policy.litRatio)result.push(pane);
      }
      continue;
    }
    const building = normalizeBuilding(source);
    const inferredFloors = Math.max(1, Math.floor((building.height - 1.2) / 2.35));
    const floors = Math.min(policy.maxFloors, building.floors || inferredFloors);

    for (let ringIndex = 0; ringIndex < building.rings.length; ringIndex++) {
      const ring = building.rings[ringIndex];
      if (!Array.isArray(ring) || ring.length < 3) continue;
      const area = ringArea(ring);

      for (let edgeIndex = 0; edgeIndex < ring.length; edgeIndex++) {
        if (result.length >= policy.maxWindows) break;
        const a = ring[edgeIndex], b = ring[(edgeIndex + 1) % ring.length];
        const dx = b.x - a.x, dz = b.z - a.z;
        const length = Math.hypot(dx, dz);
        if (length < 3) continue;

        const tx = dx / length, tz = dz / length;
        const nx = (area > 0 ? dz : -dz) / length;
        const nz = (area > 0 ? -dx : dx) / length;
        const bays = Math.max(1, Math.floor(length / policy.spacing));
        const bayWidth = Math.min(1.75, Math.max(0.82, length / bays * 0.52));
        const windowHeight = Math.min(1.15, Math.max(0.78, building.height / Math.max(3, floors * 2.2)));

        for (let floor = 0; floor < floors; floor++) {
          const y = 1.45 + floor * ((building.height - 2.0) / Math.max(1, floors));
          if (y + windowHeight / 2 >= building.height - 0.45) continue;

          for (let bay = 0; bay < bays; bay++) {
            if (result.length >= policy.maxWindows) break;
            const key = `${building.id}:${ringIndex}:${edgeIndex}:${floor}:${bay}`;
            if (hashUnit(key) > policy.litRatio) continue;

            const u = (bay + 0.5) / bays;
            const cool = hashUnit(`${key}:tone`) > 0.82;
            result.push(Object.freeze({
              buildingId: building.id,
              x: a.x + dx * u + nx * 0.125,
              y,
              z: a.z + dz * u + nz * 0.125,
              tx,
              tz,
              nx,
              nz,
              width: bayWidth,
              height: windowHeight,
              tone: cool ? 'cool' : 'warm'
            }));
          }
        }
      }
    }
  }

  return Object.freeze(result);
}
