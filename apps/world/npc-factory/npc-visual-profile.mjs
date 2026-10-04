// INHA WORLD · NPC Visual Factory P0-A
// Runtime-owned visual profile contract. It enriches the legacy flat roster visual
// without changing NPC identity, schedule, dialogue, quest, AI, or navigation authority.

export const NPC_VISUAL_PROFILE_VERSION = 1;

export const NPC_VISUAL_ENUMS = Object.freeze({
  bodyType: Object.freeze(['slim', 'average', 'broad', 'soft']),
  faceShape: Object.freeze(['oval', 'round', 'angular', 'soft']),
  brow: Object.freeze(['soft', 'straight', 'arched', 'bold']),
  eye: Object.freeze(['default', 'round', 'narrow', 'bright']),
  hairStyle: Object.freeze(['long', 'bob', 'ponytail', 'bun', 'short', 'sidepart', 'curly', 'medium']),
  outfitStyle: Object.freeze(['cardigan', 'jacket', 'shirt', 'coat', 'hoodie', 'sweater']),
  accessory: Object.freeze(['sketchbook', 'glasses', 'apron', 'badge', 'backpack', 'headphones', 'book', 'messenger', 'scarf']),
  motionStyle: Object.freeze(['calm', 'focused', 'lively', 'steady']),
  tier: Object.freeze(['hero', 'resident', 'crowd'])
});

const enumSet = key => new Set(NPC_VISUAL_ENUMS[key]);
const sets = Object.fromEntries(Object.keys(NPC_VISUAL_ENUMS).map(key => [key, enumSet(key)]));
const hexColor = /^#[0-9a-f]{6}$/i;
const finiteBetween = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;

export function validateNpcVisualProfile(profile) {
  if (!profile || profile.schema_version !== NPC_VISUAL_PROFILE_VERSION) {
    throw new Error('NPC visual profile version mismatch');
  }
  if (!sets.bodyType.has(profile.body?.type) ||
      !finiteBetween(profile.body?.height, .9, 1.1) ||
      !finiteBetween(profile.body?.shoulder, .88, 1.12) ||
      !finiteBetween(profile.body?.build, .88, 1.12)) {
    throw new Error('Invalid NPC visual body profile');
  }
  if (!sets.faceShape.has(profile.face?.shape) ||
      !sets.brow.has(profile.face?.brow) ||
      !sets.eye.has(profile.face?.eye) ||
      ![0, 1, 2, 3].includes(profile.face?.skin_tone)) {
    throw new Error('Invalid NPC visual face profile');
  }
  if (!sets.hairStyle.has(profile.hair?.style) || !hexColor.test(profile.hair?.color ?? '')) {
    throw new Error('Invalid NPC visual hair profile');
  }
  if (!sets.outfitStyle.has(profile.outfit?.style) ||
      ![profile.outfit?.color, profile.outfit?.accent_color].every(color => hexColor.test(color ?? ''))) {
    throw new Error('Invalid NPC visual outfit profile');
  }
  if (!Array.isArray(profile.accessories) || profile.accessories.length < 1 ||
      profile.accessories.length > 2 || profile.accessories.some(item => !sets.accessory.has(item))) {
    throw new Error('Invalid NPC visual accessories');
  }
  if (!sets.motionStyle.has(profile.motion?.style) ||
      !finiteBetween(profile.motion?.walk_speed_scale, .85, 1.15) ||
      !finiteBetween(profile.motion?.gesture_level, 0, 1)) {
    throw new Error('Invalid NPC visual motion profile');
  }
  if (!sets.tier.has(profile.tier)) throw new Error('Invalid NPC visual tier');
  return profile;
}
