export const PURPOSEFUL_BEHAVIOR_PROFILES = Object.freeze({
  STANDARD_ROAMER: Object.freeze({
    id: 'STANDARD_ROAMER',
    speedMultiplier: 1,
    animationPace: 1,
    motionEnergy: 1
  }),
  LONG_STAY_SITTER: Object.freeze({
    id: 'LONG_STAY_SITTER',
    speedMultiplier: 0.85,
    animationPace: 0.8,
    motionEnergy: 0.7
  }),
  AMENITY_SEEKER: Object.freeze({
    id: 'AMENITY_SEEKER',
    speedMultiplier: 1.05,
    animationPace: 1.05,
    motionEnergy: 1.05
  }),
  ACTIVE_PROMOTER: Object.freeze({
    id: 'ACTIVE_PROMOTER',
    speedMultiplier: 1.15,
    animationPace: 1.15,
    motionEnergy: 1.2
  })
});

export const PURPOSEFUL_BEHAVIOR_BY_NPC = Object.freeze({
  'INKYUNG-NPC-003': 'STANDARD_ROAMER',
  'INKYUNG-NPC-004': 'STANDARD_ROAMER',
  'INKYUNG-NPC-005': 'STANDARD_ROAMER',
  'INKYUNG-NPC-006': 'STANDARD_ROAMER',
  'INKYUNG-NPC-007': 'AMENITY_SEEKER',
  'INKYUNG-NPC-008': 'STANDARD_ROAMER',
  'INKYUNG-NPC-009': 'LONG_STAY_SITTER',
  'INKYUNG-NPC-010': 'STANDARD_ROAMER',
  'INKYUNG-NPC-011': 'ACTIVE_PROMOTER',
  'INKYUNG-NPC-012': 'AMENITY_SEEKER',
  'INKYUNG-NPC-013': 'LONG_STAY_SITTER',
  'INKYUNG-NPC-014': 'STANDARD_ROAMER',
  'INKYUNG-NPC-015': 'STANDARD_ROAMER',
  'INKYUNG-NPC-016': 'AMENITY_SEEKER',
  'INKYUNG-NPC-017': 'LONG_STAY_SITTER',
  'INKYUNG-NPC-018': 'LONG_STAY_SITTER',
  'INKYUNG-NPC-019': 'STANDARD_ROAMER',
  'INKYUNG-NPC-020': 'LONG_STAY_SITTER'
});

export function purposefulBehaviorForNpc(id) {
  const explicit = PURPOSEFUL_BEHAVIOR_BY_NPC[id];
  const number = Number(String(id).slice(-3)) || 0;
  const fallbackIds = ['STANDARD_ROAMER', 'AMENITY_SEEKER', 'LONG_STAY_SITTER', 'STANDARD_ROAMER'];
  const profileId = explicit ?? fallbackIds[number % fallbackIds.length];
  const profile = PURPOSEFUL_BEHAVIOR_PROFILES[profileId];
  if (!profile) throw new Error(`Missing purposeful behavior profile for ${id}`);
  return profile;
}
