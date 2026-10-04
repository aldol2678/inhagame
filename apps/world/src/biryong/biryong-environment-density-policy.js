const freezePlacement = (kind, x, z, scale = 1, yaw = 0) =>
  Object.freeze({ kind, x, z, scale, yaw });

export const BIRYONG_ENVIRONMENT_DENSITY_VERSION = "biryong.visual.density.p0c.v1";

export const BIRYONG_ENVIRONMENT_DENSITY_TIERS = Object.freeze({
  low: Object.freeze({ base: true, medium: false, high: false }),
  medium: Object.freeze({ base: true, medium: true, high: false }),
  high: Object.freeze({ base: true, medium: true, high: true })
});

export const BIRYONG_ENVIRONMENT_BASE = Object.freeze([
  freezePlacement("tree", -26, 8, 1.00, 12),
  freezePlacement("tree", 26, 14, 0.92, -18),
  freezePlacement("tree", -31, 45, 1.08, 24),
  freezePlacement("tree", 31, 52, 0.96, -11),
  freezePlacement("shrub", -18, 24, 0.85, 0),
  freezePlacement("shrub", 18, 28, 0.78, 0),
  freezePlacement("shrub", -21, 60, 0.92, 0),
  freezePlacement("shrub", 21, 64, 0.82, 0),
  freezePlacement("shrub", -27, 82, 0.90, 0),
  freezePlacement("shrub", 27, 88, 0.86, 0),
  freezePlacement("rock", -22, -6, 0.90, 18),
  freezePlacement("rock", 23, 34, 0.72, -22),
  freezePlacement("rock", -34, 70, 1.05, 7),
  freezePlacement("rock", 36, 96, 0.88, -12),
  freezePlacement("lantern", -8.5, 38, 1.00, 0),
  freezePlacement("lantern", 8.5, 38, 1.00, 180),
  freezePlacement("marker", -12, 50, 0.95, 8)
]);

export const BIRYONG_ENVIRONMENT_MEDIUM = Object.freeze([
  freezePlacement("tree", -36, 22, 0.94, 7),
  freezePlacement("tree", 38, 28, 1.04, -23),
  freezePlacement("tree", -40, 65, 1.10, 16),
  freezePlacement("tree", 42, 72, 0.98, -8),
  freezePlacement("tree", -46, 100, 1.14, 18),
  freezePlacement("tree", 47, 108, 1.06, -17),
  freezePlacement("shrub", -24, 36, 0.78, 0),
  freezePlacement("shrub", 25, 42, 0.84, 0),
  freezePlacement("shrub", -33, 56, 0.92, 0),
  freezePlacement("shrub", 34, 61, 0.80, 0),
  freezePlacement("shrub", -38, 84, 0.88, 0),
  freezePlacement("shrub", 39, 90, 0.96, 0),
  freezePlacement("shrub", -44, 112, 0.82, 0),
  freezePlacement("shrub", 45, 118, 0.90, 0),
  freezePlacement("rock", -29, 18, 0.68, -14),
  freezePlacement("rock", 32, 48, 0.82, 20),
  freezePlacement("rock", -42, 91, 0.76, -8),
  freezePlacement("rock", 44, 116, 0.92, 15),
  freezePlacement("lantern", -8.5, 58, 1.00, 0),
  freezePlacement("lantern", 8.5, 58, 1.00, 180),
  freezePlacement("lantern", -9, 78, 1.00, 0),
  freezePlacement("lantern", 9, 78, 1.00, 180),
  freezePlacement("marker", 14, 54, 0.88, -12),
  freezePlacement("marker", -16, 92, 1.02, 11)
]);

export const BIRYONG_ENVIRONMENT_HIGH = Object.freeze([
  freezePlacement("tree", -50, 38, 1.08, 11),
  freezePlacement("tree", 52, 44, 1.12, -15),
  freezePlacement("tree", -53, 76, 1.00, 21),
  freezePlacement("tree", 54, 82, 0.96, -9),
  freezePlacement("tree", -57, 116, 1.16, 13),
  freezePlacement("tree", 58, 123, 1.10, -19),
  freezePlacement("shrub", -48, 55, 0.86, 0),
  freezePlacement("shrub", 49, 61, 0.94, 0),
  freezePlacement("shrub", -51, 94, 0.88, 0),
  freezePlacement("shrub", 52, 100, 0.82, 0),
  freezePlacement("shrub", -60, 105, 0.92, 0),
  freezePlacement("shrub", 60, 110, 0.90, 0),
  freezePlacement("rock", -55, 24, 0.82, 8),
  freezePlacement("rock", 55, 68, 0.76, -16),
  freezePlacement("rock", -58, 126, 0.96, 12),
  freezePlacement("rock", 59, 128, 0.88, -10),
  freezePlacement("lantern", -9, 98, 1.00, 0),
  freezePlacement("lantern", 9, 98, 1.00, 180),
  freezePlacement("marker", 18, 108, 0.94, -8)
]);

export function biryongEnvironmentDensityPolicy(tier = "medium") {
  const resolvedTier = Object.hasOwn(BIRYONG_ENVIRONMENT_DENSITY_TIERS, tier) ? tier : "medium";
  const gates = BIRYONG_ENVIRONMENT_DENSITY_TIERS[resolvedTier];
  const placements = [
    ...(gates.base ? BIRYONG_ENVIRONMENT_BASE : []),
    ...(gates.medium ? BIRYONG_ENVIRONMENT_MEDIUM : []),
    ...(gates.high ? BIRYONG_ENVIRONMENT_HIGH : [])
  ];
  return Object.freeze({
    version: BIRYONG_ENVIRONMENT_DENSITY_VERSION,
    tier: resolvedTier,
    placements: Object.freeze(placements),
    counts: Object.freeze({
      base: gates.base ? BIRYONG_ENVIRONMENT_BASE.length : 0,
      medium: gates.medium ? BIRYONG_ENVIRONMENT_MEDIUM.length : 0,
      high: gates.high ? BIRYONG_ENVIRONMENT_HIGH.length : 0,
      total: placements.length
    })
  });
}
