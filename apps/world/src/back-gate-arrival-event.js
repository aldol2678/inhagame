// BG01 · 문밖의 거리
// First Back Gate arrival after Main 1 completion -> short exterior reveal -> guide hand-off.
// The real trigger is Main 2 being unlocked but not yet started while the player reaches the Back Gate.
// Preview hosts may force the cinematic with ?backGateArrival=preview; that path never mutates quest progress.
import { BACK_GATE_SPAWN } from './campus-spawn.js';
import { CULTURE_GATE_STATION, CULTURE_LENGTH, culturePoint } from './culture-street-layout.js';
import { MAIN2_GUIDE_NPC } from '../npc-factory/main2-guide-contract.mjs';
import { EVENT_ID } from './events/event-registry.js';

export const BACK_GATE_ARRIVAL_EVENT_ID = EVENT_ID.BACK_GATE_BG01;
export const BACK_GATE_ARRIVAL_DURATION = 6.9;
export const BACK_GATE_ARRIVAL_RADIUS = 28;
export const BACK_GATE_STREET_FOCUS = Object.freeze(
  culturePoint(Math.min(CULTURE_LENGTH - 3, CULTURE_GATE_STATION + 28))
);

const clamp01 = value => Math.max(0, Math.min(1, value));
const ease = value => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

function direction() {
  const dx = BACK_GATE_STREET_FOCUS.x - BACK_GATE_SPAWN.x;
  const dz = BACK_GATE_STREET_FOCUS.z - BACK_GATE_SPAWN.z;
  const length = Math.hypot(dx, dz) || 1;
  const forward = { x: dx / length, z: dz / length };
  return Object.freeze({ forward, side: Object.freeze({ x: -forward.z, z: forward.x }) });
}
const AXIS = direction();

const add = (origin, forward, side, y) => ({
  x: origin.x + AXIS.forward.x * forward + AXIS.side.x * side,
  y,
  z: origin.z + AXIS.forward.z * forward + AXIS.side.z * side
});
const mixPoint = (a, b, t) => ({ x: lerp(a.x,b.x,t), y: lerp(a.y,b.y,t), z: lerp(a.z,b.z,t) });

export function shouldStartBackGateArrival({
  main1Complete = false,
  main2Available = false,
  main2Stage = null,
  distance = Infinity,
  preview = false,
  alreadyPlayed = false
} = {}) {
  if (alreadyPlayed) return false;
  if (preview) return true;
  return main1Complete === true && main2Available === true && main2Stage === 0 &&
    Number.isFinite(distance) && distance <= BACK_GATE_ARRIVAL_RADIUS;
}

export function backGateArrivalBeat(elapsed) {
  if (elapsed < 1.05) return 'ARRIVAL';
  if (elapsed < 4.65) return 'OUTLOOK';
  if (elapsed < BACK_GATE_ARRIVAL_DURATION) return 'GUIDE';
  return 'DONE';
}

export function backGateArrivalFov(elapsed, baseFov = 62) {
  const t = Math.max(0, Math.min(BACK_GATE_ARRIVAL_DURATION, Number(elapsed) || 0));
  if (t <= 1.25) return lerp(baseFov, Math.max(baseFov, 65), ease(t / 1.25));
  if (t <= 4.65) return lerp(Math.max(baseFov, 65), Math.max(baseFov, 78), ease((t - 1.25) / 3.4));
  return lerp(Math.max(baseFov, 78), baseFov, ease((t - 4.65) / (BACK_GATE_ARRIVAL_DURATION - 4.65)));
}

export function backGateArrivalCameraPose(elapsed) {
  const t = Math.max(0, Math.min(BACK_GATE_ARRIVAL_DURATION, Number(elapsed) || 0));

  // 1) Campus side -> pass through the Back Gate.
  const campusStart = add(BACK_GATE_SPAWN, -6.2, 1.7, 3.0);
  const gateOutside = add(BACK_GATE_SPAWN, 4.8, 0.6, 3.7);
  const gateLook = add(BACK_GATE_SPAWN, 10.5, 0, 1.9);

  if (t <= 1.25) {
    const w = ease(t / 1.25);
    return Object.freeze({
      pos: Object.freeze(mixPoint(campusStart, gateOutside, w)),
      look: Object.freeze(mixPoint(add(BACK_GATE_SPAWN, 6.5, 0, 1.8), gateLook, w))
    });
  }

  // 2) Once outside, crane upward + sideways and widen the lens so the road and commercial
  // blocks read together as one establishing view.
  const widePos = add(BACK_GATE_SPAWN, 8.5, 8.2, 10.5);
  const wideLook = { x: BACK_GATE_STREET_FOCUS.x, y: 1.65, z: BACK_GATE_STREET_FOCUS.z };
  if (t <= 4.65) {
    const w = ease((t - 1.25) / 3.4);
    return Object.freeze({
      pos: Object.freeze(mixPoint(gateOutside, widePos, w)),
      look: Object.freeze(mixPoint(gateLook, wideLook, w))
    });
  }

  // 3) Return to player + guide for the single hand-off line.
  const guideMid = {
    x: (BACK_GATE_SPAWN.x + MAIN2_GUIDE_NPC.position.x) / 2,
    y: 1.55,
    z: (BACK_GATE_SPAWN.z + MAIN2_GUIDE_NPC.position.z) / 2
  };
  const guidePos = add(BACK_GATE_SPAWN, -3.0, -4.4, 2.75);
  const w = ease((t - 4.65) / (BACK_GATE_ARRIVAL_DURATION - 4.65));
  return Object.freeze({
    pos: Object.freeze(mixPoint(widePos, guidePos, w)),
    look: Object.freeze(mixPoint(wideLook, guideMid, w))
  });
}

function make(documentLike, tag, className, text) {
  const node = documentLike.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function createUi(documentLike) {
  const root = make(documentLike, 'div', 'back-gate-arrival-ui');
  root.id = 'back-gate-arrival-ui';
  root.hidden = true;
  root.dataset.beat = 'IDLE';
  root.setAttribute('aria-live', 'polite');

  const topBar = make(documentLike, 'div', 'back-gate-cinematic-bar top');
  const bottomBar = make(documentLike, 'div', 'back-gate-cinematic-bar bottom');
  const vignette = make(documentLike, 'div', 'back-gate-arrival-vignette');

  const arrival = make(documentLike, 'section', 'back-gate-arrival-title');
  arrival.append(
    make(documentLike, 'small', null, 'MAIN 02 · 목적지 도착'),
    make(documentLike, 'strong', null, '후문에 도착했습니다')
  );

  const guide = make(documentLike, 'section', 'back-gate-guide-line');
  guide.append(
    make(documentLike, 'strong', null, '후문 안내 학생'),
    make(documentLike, 'p', null, '여기서부터는 학교 밖이야. 학생들이 자주 가는 곳은 이쪽에 몰려 있어.')
  );

  root.append(vignette, topBar, bottomBar, arrival, guide);
  documentLike.body.appendChild(root);
  return { root };
}

export function createBackGateArrivalEvent({
  player,
  camera,
  controller,
  orbit,
  getQuestState = () => null,
  preview = false,
  documentLike = globalThis.document,
  onStart = () => {},
  onComplete = () => {},
  onInputLockChange = null
} = {}) {
  if (!player || !camera || !controller || !orbit || !documentLike) {
    throw new Error('Back Gate arrival event requires player, camera, controller, orbit and document');
  }

  const ui = createUi(documentLike);
  let elapsed = 0;
  let active = false;
  let played = false;
  let lastQuestState = null;
  let previewArmed = Boolean(preview);
  let previewDelay = 0.65;
  let beat = 'IDLE';
  let originalFov = null;

  function holdInput(hold) {
    const locked = Boolean(hold);
    if (typeof onInputLockChange === 'function') {
      onInputLockChange(locked);
      return;
    }
    controller.keys?.clear?.();
    controller.setInputEnabled?.(!locked);
    orbit.setInputEnabled?.(!locked);
  }

  function restoreFov() {
    if (originalFov != null && camera.camera) camera.camera.fov = originalFov;
    originalFov = null;
  }

  function start({ forced = false } = {}) {
    if (active || played) return false;
    active = true;
    played = true;
    elapsed = 0;
    beat = 'ARRIVAL';
    originalFov = Number.isFinite(camera.camera?.fov) ? camera.camera.fov : 62;
    ui.root.hidden = false;
    ui.root.dataset.beat = beat;
    const yaw = Math.atan2(AXIS.forward.x, AXIS.forward.z) * 180 / Math.PI;
    player.setLocalEulerAngles?.(0, yaw, 0);
    holdInput(true);
    onStart({ eventId: BACK_GATE_ARRIVAL_EVENT_ID, forced });
    return true;
  }

  function finish() {
    if (!active) return false;
    active = false;
    beat = 'DONE';
    ui.root.dataset.beat = beat;
    ui.root.hidden = true;
    restoreFov();
    holdInput(false);
    onComplete({ eventId: BACK_GATE_ARRIVAL_EVENT_ID });
    return true;
  }

  function update(dt, { inside = false } = {}) {
    const questState = getQuestState?.() ?? null;
    const position = player.getLocalPosition?.();
    const distance = position && Number.isFinite(position.x) && Number.isFinite(position.z)
      ? Math.hypot(position.x - BACK_GATE_SPAWN.x, position.z - BACK_GATE_SPAWN.z)
      : Infinity;
    if (!inside && shouldStartBackGateArrival({
      main1Complete: questState?.main1Complete === true,
      main2Available: questState?.main2Available === true,
      main2Stage: questState?.main2Stage ?? null,
      distance,
      alreadyPlayed: played
    })) start();
    lastQuestState = questState ? Object.freeze({ ...questState }) : null;

    if (previewArmed && !inside && !played) {
      previewDelay -= Math.min(Number.isFinite(dt) ? dt : 0, 0.05);
      if (previewDelay <= 0) {
        previewArmed = false;
        start({ forced: true });
      }
    }

    if (!active) return;
    elapsed += Math.min(Number.isFinite(dt) ? dt : 0, 0.05);
    const nextBeat = backGateArrivalBeat(elapsed);
    if (nextBeat !== beat) {
      beat = nextBeat;
      ui.root.dataset.beat = beat;
    }
    if (elapsed >= BACK_GATE_ARRIVAL_DURATION) finish();
  }

  function applyCamera() {
    if (!active) return false;
    const pose = backGateArrivalCameraPose(elapsed);
    camera.setPosition(pose.pos.x, pose.pos.y, -pose.pos.z);
    camera.lookAt(pose.look.x, pose.look.y, -pose.look.z);
    if (camera.camera) camera.camera.fov = backGateArrivalFov(elapsed, originalFov ?? camera.camera.fov);
    return true;
  }

  return Object.freeze({
    update,
    applyCamera,
    start,
    isActive: () => active,
    status: () => Object.freeze({ active, played, elapsed, beat, questState: lastQuestState, preview: Boolean(preview) }),
    destroy() {
      if (active) holdInput(false);
      active = false;
      restoreFov();
      ui.root.remove();
    }
  });
}
