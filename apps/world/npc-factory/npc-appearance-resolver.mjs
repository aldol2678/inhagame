// INHA WORLD · NPC Visual Factory P0-B/C
// Deterministic appearance resolver for the current 48-person campus population.
// The returned object keeps every legacy field required by dev-human-avatar.mjs.

import { NPC_VISUAL_ENUMS, NPC_VISUAL_PROFILE_VERSION, validateNpcVisualProfile } from './npc-visual-profile.mjs';

const HAIR_COLORS = Object.freeze(['#242129','#35252c','#473126','#5a4038','#2a2630','#49362c','#302b37','#634130']);
const OUTFIT_COLORS = Object.freeze([
  '#4a89b8','#865d9e','#3f8d87','#d06f4f','#7d9d6d','#b85c60','#566b81',
  '#795ca3','#507fb4','#5a9bb9','#8b75af','#927653','#446481','#b96972'
]);
const ACCENT_COLORS = Object.freeze([
  '#f0bd55','#aee4d2','#f3b36b','#f2d16b','#f3cfaa','#bfe4f2','#e8ba72',
  '#b5e6dc','#a9d7ca','#ebad73','#edc98e','#d8e6a9','#efb1aa','#d8c2ef'
]);
const BODY_TYPES = NPC_VISUAL_ENUMS.bodyType;
const FACE_SHAPES = NPC_VISUAL_ENUMS.faceShape;
const BROWS = NPC_VISUAL_ENUMS.brow;
const EYES = NPC_VISUAL_ENUMS.eye;
const HAIR = NPC_VISUAL_ENUMS.hairStyle;
const OUTFIT = NPC_VISUAL_ENUMS.outfitStyle;
const ACCESSORY = NPC_VISUAL_ENUMS.accessory;

const numericId = id => {
  const match = /([0-9]+)$/.exec(String(id ?? ''));
  return match ? Number(match[1]) : 1;
};
const pick = (values, index) => values[((index % values.length) + values.length) % values.length];
const traitsFor = npc => Array.isArray(npc?.personality?.traits)
  ? npc.personality.traits : Array.isArray(npc?.traits) ? npc.traits : [];

function motionFor(npc, n) {
  const traits = new Set(traitsFor(npc));
  if (traits.has('calm') || traits.has('patient') || traits.has('thoughtful')) {
    return { style: 'calm', walk_speed_scale: .92 + (n % 3) * .02, gesture_level: .22 + (n % 4) * .05 };
  }
  if (traits.has('focused') || traits.has('practical')) {
    return { style: 'focused', walk_speed_scale: .97 + (n % 3) * .015, gesture_level: .28 + (n % 4) * .04 };
  }
  if (traits.has('playful') || traits.has('cheerful')) {
    return { style: 'lively', walk_speed_scale: 1.03 + (n % 3) * .02, gesture_level: .58 + (n % 4) * .06 };
  }
  return { style: 'steady', walk_speed_scale: .98 + (n % 4) * .015, gesture_level: .36 + (n % 4) * .05 };
}

export function visualProfileFor(entry, npc = null) {
  if (!entry?.npc_id) throw new Error('NPC visual resolver requires npc_id');
  const n = numericId(entry.npc_id);
  const skinTone = [0, 1, 2, 3].includes(entry.visual?.skin_tone) ? entry.visual.skin_tone : n % 4;
  const height = Math.round((.94 + (n % 9) * .015) * 1000) / 1000;
  const primaryAccessory = pick(ACCESSORY, n * 11 + 1);
  const secondaryAccessory = n % 5 === 0 ? pick(ACCESSORY, n * 7 + 3) : null;
  const accessories = secondaryAccessory && secondaryAccessory !== primaryAccessory
    ? [primaryAccessory, secondaryAccessory] : [primaryAccessory];
  const profile = {
    schema_version: NPC_VISUAL_PROFILE_VERSION,
    body: {
      type: pick(BODY_TYPES, n * 3 + 1),
      height,
      shoulder: Math.round((.92 + (n % 7) * .025) * 1000) / 1000,
      build: Math.round((.91 + ((n * 5) % 8) * .025) * 1000) / 1000
    },
    face: {
      shape: pick(FACE_SHAPES, n * 5 + 2),
      skin_tone: skinTone,
      brow: pick(BROWS, n * 7 + 1),
      eye: pick(EYES, n * 11 + 2)
    },
    hair: {
      style: pick(HAIR, n * 5 + 3),
      color: pick(HAIR_COLORS, n * 3 + 2)
    },
    outfit: {
      style: pick(OUTFIT, n * 7 + 2),
      color: pick(OUTFIT_COLORS, n * 13 + 1),
      accent_color: pick(ACCENT_COLORS, n * 11 + 4)
    },
    accessories,
    motion: motionFor(npc, n),
    tier: 'resident'
  };
  return validateNpcVisualProfile(profile);
}

export function resolveNpcAppearance(entry, npc = null) {
  const profile = visualProfileFor(entry, npc);
  const presentation = entry.gender === 'female' ? 'female' : 'male';
  return {
    ...entry.visual,
    height: profile.body.height,
    skin_tone: profile.face.skin_tone,
    hair_style: profile.hair.style,
    hair_color: profile.hair.color,
    outfit_style: profile.outfit.style,
    outfit_color: profile.outfit.color,
    accent_color: profile.outfit.accent_color,
    accessory: profile.accessories[0],
    presentation,
    label: presentation === 'female' ? '여성' : '남성',
    profile
  };
}
