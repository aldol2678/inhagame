import * as pc from 'playcanvas';
import { npcWorldScale } from './npc-dimensions.mjs';

// Reusable procedural people for the localhost inspection scene. No external model or identity asset.
const skinColors = ['#efcfb5', '#dbb394', '#bc8f70', '#f1dcc7'];
const clothLight = '#ece8dc';
const trousers = ['#28364a', '#3a3e49', '#454b45'];
const shoes = '#202630';
const ink = '#2a2525';
const surfaces = new Map();

function material(hex) {
  if (surfaces.has(hex)) return surfaces.get(hex);
  const n = parseInt(hex.slice(1), 16);
  const surface = new pc.StandardMaterial();
  surface.diffuse = new pc.Color(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  surface.update();
  surfaces.set(hex, surface);
  return surface;
}
function part(parent, name, type, position, scale, color, angles) {
  const entity = new pc.Entity(name);
  entity.addComponent('render', { type, castShadows: true });
  entity.render.material = material(color);
  entity.setLocalPosition(...position);
  entity.setLocalScale(...scale);
  if (angles) entity.setLocalEulerAngles(...angles);
  parent.addChild(entity);
  return entity;
}
function pivot(parent, name, position) {
  const entity = new pc.Entity(name);
  entity.setLocalPosition(...position);
  parent.addChild(entity);
  return entity;
}

export function createHumanAvatar(root, actor, appearance) {
  const avatar = new pc.Entity(`NPC_TEST_HUMAN_${actor.id}`);
  root.addChild(avatar);
  const outfit = appearance.outfit_color;
  const accent = appearance.accent_color;
  const skin = appearance.skin_color_override ?? skinColors[appearance.skin_tone] ?? skinColors[0];
  const eye = appearance.eye_color_override ?? ink;
  const mouth = appearance.mouth_color_override ?? '#915f59';
  const hair = appearance.hair_color;
  const trouser = trousers[(Number(actor.id.slice(-3)) - 1) % trousers.length];
  const female = appearance.presentation === 'female';

  // Separate head, torso, arms, legs, hands, and shoes give a human silhouette at world scale.
  part(avatar, 'Hips', 'sphere', [0, .89, 0], [female ? .42 : .46, .26, .31], trouser);
  part(avatar, 'Torso', 'capsule', [0, 1.27, 0], [female ? .49 : .56, .69, .34], outfit);
  part(avatar, 'ShirtFront', 'box', [0, 1.33, .175], [.18, .43, .035], clothLight);
  if (appearance.outfit_style === 'coat') {
    part(avatar, 'CoatHem', 'cylinder', [0, .9, 0], [.57, .39, .42], outfit);
    part(avatar, 'CoatLapels', 'box', [0, 1.45, .23], [.21, .28, .04], accent);
  } else if (appearance.outfit_style === 'hoodie') {
    part(avatar, 'Hood', 'sphere', [0, 1.6, -.16], [.4, .3, .24], outfit);
    for (const side of [-1, 1]) part(avatar, `HoodCord_${side}`, 'cylinder', [side * .08, 1.29, .23], [.018, .29, .018], clothLight);
  } else if (appearance.outfit_style === 'cardigan') {
    for (const side of [-1, 1]) part(avatar, `CardiganEdge_${side}`, 'box', [side * .13, 1.28, .22], [.045, .48, .045], accent);
  } else if (appearance.outfit_style === 'jacket') {
    part(avatar, 'JacketStripe', 'box', [0, 1.11, .205], [.35, .075, .04], accent);
    part(avatar, 'JacketCollar', 'box', [0, 1.58, .16], [.41, .08, .09], outfit);
  } else if (appearance.outfit_style === 'sweater') {
    part(avatar, 'SweaterBand', 'box', [0, 1.0, .16], [.43, .09, .06], accent);
  } else {
    part(avatar, 'ShirtCollar', 'box', [0, 1.58, .18], [.33, .09, .07], accent);
  }
  part(avatar, 'Neck', 'cylinder', [0, 1.69, 0], [.15, .15, .15], skin);
  const head = part(avatar, 'Head', 'sphere', [0, 1.91, 0], [.34, .43, .32], skin);
  const eyes = [], brows = [];
  for (const side of [-1, 1]) {
    part(avatar, `Ear_${side}`, 'sphere', [side * .18, 1.91, 0], [.075, .12, .075], skin);
    eyes.push(part(avatar, `Eye_${side}`, 'sphere', [side * .09, 1.94, .287], [.037, .046, .024], eye));
    brows.push(part(avatar, `Brow_${side}`, 'box', [side * .09, 2.025, .288], [.10, .018, .025], hair));
  }
  part(avatar, 'Nose', 'sphere', [0, 1.84, .308], [.048, .071, .07], skin);
  const mouthNode = part(avatar, 'Mouth', 'sphere', [0, 1.72, .292], [.09, .021, .022], mouth);
  if (appearance.face_mark_color) {
    part(avatar, 'FaceMark', 'sphere', [.16, 1.84, .302], [.08, .055, .018], appearance.face_mark_color, [0, 0, -18]);
  }

  part(avatar, 'HairCrown', 'sphere', [0, 2.16, -.025], [.355, .21, .35], hair);
  part(avatar, 'HairFringe', 'box', [0, 2.11, .19], [.28, .10, .11], hair);
  if (appearance.hair_style === 'long' || appearance.hair_style === 'bob' || appearance.hair_style === 'medium') {
    const length = appearance.hair_style === 'long' ? .7 : appearance.hair_style === 'bob' ? .43 : .54;
    part(avatar, 'BackHair', 'capsule', [0, 1.83, -.22], [.38, length, .23], hair);
    for (const side of [-1, 1]) part(avatar, `SideHair_${side}`, 'capsule', [side * .19, 1.82, -.06], [.13, length - .12, .19], hair);
  } else if (appearance.hair_style === 'ponytail') {
    part(avatar, 'Ponytail', 'capsule', [.18, 1.83, -.30], [.21, .62, .22], hair);
  } else if (appearance.hair_style === 'bun') {
    part(avatar, 'HairBun', 'sphere', [0, 2.24, -.27], [.29, .29, .29], hair);
  } else if (appearance.hair_style === 'sidepart') {
    part(avatar, 'SidePart', 'sphere', [-.13, 2.21, .06], [.24, .16, .25], hair);
  } else if (appearance.hair_style === 'curly') {
    for (const [index, x] of [-.23, -.08, .08, .23].entries())
      part(avatar, `Curl_${index}`, 'sphere', [x, 2.23, .08], [.18, .18, .18], hair);
  }

  const arms = [], legs = [];
  for (const side of [-1, 1]) {
    const arm = pivot(avatar, `ArmPivot_${side}`, [side * (female ? .31 : .34), 1.49, 0]);
    part(arm, `Sleeve_${side}`, 'capsule', [side * .05, -.19, 0], [.18, .40, .20], outfit);
    part(arm, `Forearm_${side}`, 'capsule', [side * .07, -.51, 0], [.13, .29, .14], skin);
    part(arm, `Hand_${side}`, 'sphere', [side * .07, -.68, 0], [.14, .15, .14], skin);
    arms.push(arm);

    const leg = pivot(avatar, `LegPivot_${side}`, [side * .13, .85, 0]);
    part(leg, `TrouserLeg_${side}`, 'capsule', [0, -.32, 0], [.19, .62, .22], trouser);
    part(leg, `Shoe_${side}`, 'sphere', [0, -.70, .13], [.23, .14, .35], shoes);
    legs.push(leg);
  }
  if (appearance.accessory === 'glasses') {
    for (const side of [-1, 1]) {
      part(avatar, `GlassTop_${side}`, 'box', [side * .09, 1.99, .325], [.14, .025, .025], ink);
      part(avatar, `GlassBottom_${side}`, 'box', [side * .09, 1.89, .325], [.14, .025, .025], ink);
      for (const edge of [-1, 1]) part(avatar, `GlassSide_${side}_${edge}`, 'box', [side * .09 + edge * .07, 1.94, .325], [.022, .11, .025], ink);
    }
  } else if (appearance.accessory === 'apron') {
    part(avatar, 'Apron', 'box', [0, 1.13, .24], [.42, .64, .05], accent);
    part(avatar, 'ApronPocket', 'box', [0, .97, .275], [.22, .17, .04], outfit);
  } else if (appearance.accessory === 'backpack') {
    part(avatar, 'Backpack', 'box', [0, 1.28, -.28], [.46, .59, .23], accent);
    for (const side of [-1, 1]) part(avatar, `PackStrap_${side}`, 'box', [side * .21, 1.34, .17], [.055, .55, .05], accent);
  } else if (appearance.accessory === 'headphones') {
    for (const side of [-1, 1]) part(avatar, `Earphone_${side}`, 'sphere', [side * .205, 1.99, 0], [.12, .18, .13], accent);
    part(avatar, 'HeadphoneBand', 'box', [0, 2.28, 0], [.45, .055, .08], accent);
  } else if (appearance.accessory === 'messenger') {
    part(avatar, 'MessengerBag', 'box', [.38, .94, .06], [.34, .33, .22], accent);
    part(avatar, 'MessengerStrap', 'box', [0, 1.33, .19], [.045, .68, .04], accent, [0, 0, 30]);
  } else if (appearance.accessory === 'scarf') {
    part(avatar, 'ScarfNeck', 'cylinder', [0, 1.67, .04], [.3, .16, .28], accent);
    part(avatar, 'ScarfTail', 'box', [.17, 1.41, .25], [.1, .39, .06], accent);
  } else if (appearance.accessory === 'badge') {
    part(avatar, 'Badge', 'box', [.18, 1.45, .245], [.17, .14, .04], accent);
  } else {
    const bookColor = appearance.accessory === 'book' ? accent : clothLight;
    part(avatar, 'HeldBook', 'box', [-.35, .88, .22], [.32, .42, .07], bookColor);
    part(avatar, 'BookSpine', 'box', [-.52, .88, .23], [.04, .42, .08], accent);
  }
  const identityMarker = part(avatar, 'IdentityMarker', 'cylinder', [0, .015, 0], [.78, .018, .78], accent);
  const marker = part(avatar, 'SelectedMarker', 'cylinder', [0, .035, 0], [1.0, .025, 1.0], '#ffe66a');
  const worldScale = npcWorldScale(appearance.height);
  avatar.setLocalScale(worldScale, worldScale, worldScale);
  return { avatar, marker, identityMarker, actor, appearance, arms, legs, worldScale,
    face: Object.freeze({ head, eyes: Object.freeze(eyes), brows: Object.freeze(brows), mouth: mouthNode }) };
}
