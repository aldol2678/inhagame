// 비룡탑 runtime: first-visit discovery, the repeatable 울림돌 shout, and BR01 「돌아오는 목소리」.
// Owns its NPC, dialogue panel, captions and two short camera moves. PlayerController keeps all
// movement and collision; this module only reads the player position and suspends input while a
// dialogue or camera move is running.
import { createHumanAvatar } from '../../npc-factory/dev-human-avatar.mjs';
import { playEchoStoneCue } from './biryong-audio.js';
import {
  BIRYONG_AXIS, BIRYONG_CENTER, BIRYONG_DISCOVER_RADIUS, BIRYONG_DRAGON_BASE_Y, BIRYONG_EVENT_NPC,
  BIRYONG_PLACE_ID, BIRYONG_PLATFORM, ECHO_CENTER, distanceTo, isAtEchoCenter, isNearBiryong
} from './biryong-layout.js';
import {
  BIRYONG_PLACE, BR01_EVENT, BR01_SCRIPT, BR01_STEP, CAMPUS_LORE, FIRST_SHOUT, SHOUT_POSE,
  createBiryongProgress, echoSchedule, pickShoutLine, shoutPoseOffsets
} from './biryong-state.js';

export const BIRYONG_CONTEXT_PRIORITY = Object.freeze({ shout: 245, npc: 250 });
const NPC_APPEARANCE = Object.freeze({
  outfit_color: '#3f6f8f', accent_color: '#f0c85a', skin_tone: 0, hair_color: '#2b2320',
  hair_style: 'ponytail', outfit_style: 'hoodie', accessory: 'backpack', presentation: 'female', height: 0.98
});
const REPEAT_LINE = '울림돌은 언제든 다시 써봐. 시험기간엔 다들 여기 와서 한 번씩 외치고 가.';
const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
const lerp = (a, b, t) => a + (b - a) * t;

function browserStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function el(documentLike, tag, className, text) {
  const node = documentLike.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function createUi(documentLike) {
  const root = el(documentLike, 'div', 'biryong-ui');
  root.id = 'biryong-ui';

  const toast = el(documentLike, 'section', 'biryong-toast');
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.hidden = true;
  const toastKicker = el(documentLike, 'p', 'biryong-toast-kicker');
  const toastTitle = el(documentLike, 'strong', 'biryong-toast-title');
  const toastDetail = el(documentLike, 'p', 'biryong-toast-detail');
  toast.append(toastKicker, toastTitle, toastDetail);

  const caption = el(documentLike, 'p', 'biryong-echo-caption');
  caption.setAttribute('aria-live', 'polite');
  caption.hidden = true;

  const objective = el(documentLike, 'p', 'biryong-objective');
  objective.hidden = true;

  const dialog = el(documentLike, 'section', 'biryong-dialogue');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', `${BIRYONG_EVENT_NPC.name}과의 대화`);
  dialog.hidden = true;
  const header = el(documentLike, 'div', 'biryong-dialogue-header');
  const portrait = el(documentLike, 'span', 'biryong-dialogue-portrait', '하');
  portrait.setAttribute('aria-hidden', 'true');
  const identity = el(documentLike, 'div', 'biryong-dialogue-identity');
  identity.append(el(documentLike, 'strong', null, BIRYONG_EVENT_NPC.name), el(documentLike, 'small', null, BIRYONG_EVENT_NPC.role));
  const close = el(documentLike, 'button', 'biryong-dialogue-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', '대화 닫기');
  header.append(portrait, identity, close);
  const playerLine = el(documentLike, 'p', 'biryong-dialogue-player');
  playerLine.hidden = true;
  const line = el(documentLike, 'p', 'biryong-dialogue-line');
  line.setAttribute('aria-live', 'polite');
  const choices = el(documentLike, 'div', 'biryong-dialogue-choices');
  choices.setAttribute('aria-label', '대답 선택');
  dialog.append(header, playerLine, line, choices);

  root.append(objective, caption, toast, dialog);
  documentLike.body.appendChild(root);
  return { root, toast, toastKicker, toastTitle, toastDetail, caption, objective, dialog, close, playerLine, line, choices };
}

export function createBiryongSystem({
  app,
  root,
  player,
  camera,
  worldAudio = null,
  documentLike = globalThis.document,
  // Progress lives in this browser only (localStorage); persist=false keeps it in memory.
  persist = true,
  storage = persist ? browserStorage() : null,
  random = Math.random,
  onDiscovered = () => {},
  onLoreFound = () => {},
  onStatus = () => {},
  onProgress = () => {},
  onInputLockChange = () => {}
} = {}) {
  if (!app || !root || !player || !camera) throw new Error('Biryong system requires app, root, player and camera');
  const progress = createBiryongProgress({ storage, onChange: onProgress });
  const ui = createUi(documentLike);
  const timers = new Set();
  const later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };

  // BR01 student NPC. Scaled procedural human, no identity asset; the selection ring stays off.
  const npc = createHumanAvatar(root, { id: BIRYONG_EVENT_NPC.id }, NPC_APPEARANCE);
  npc.marker.enabled = false;
  npc.avatar.setLocalPosition(BIRYONG_EVENT_NPC.position.x, 0, BIRYONG_EVENT_NPC.position.z);
  npc.avatar.enabled = progress.discovered;
  let npcYaw = Math.atan2(ECHO_CENTER.x - BIRYONG_EVENT_NPC.position.x, ECHO_CENTER.z - BIRYONG_EVENT_NPC.position.z) * 180 / Math.PI;

  let elapsed = 0;
  let shout = null;          // { line, startedAt, forEvent }
  let cinematic = null;      // { kind, t, duration }
  let dialogue = null;       // { lines, index, onDone }
  let toastTimer = null;
  let captionTimer = null;
  let centerHintShown = false;
  let lastShoutLine = null;
  let inputHeld = false;
  let accountSyncing = false;

  function holdInput(hold) {
    const next = Boolean(hold);
    if (inputHeld === next) return false;
    inputHeld = next;
    onInputLockChange(inputHeld);
    return true;
  }

  function showToast(kicker, title, detail, ms = 4200) {
    ui.toastKicker.textContent = kicker;
    ui.toastTitle.textContent = title;
    ui.toastDetail.textContent = detail ?? '';
    ui.toastDetail.hidden = !detail;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, ms);
  }

  function showCaption(text, ms = 1400) {
    ui.caption.textContent = text;
    ui.caption.hidden = false;
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => { ui.caption.hidden = true; }, ms);
  }

  function renderObjective() {
    const step = progress.step;
    const text = accountSyncing || !progress.discovered || progress.complete ? null
      : step === BR01_STEP.INTRO ? `${BR01_EVENT.title} · ${BIRYONG_EVENT_NPC.name}에게 말 걸기`
      : step === BR01_STEP.FIND_CENTER ? `${BR01_EVENT.title} · ${BR01_EVENT.objectiveFindCenter}`
      : step === BR01_STEP.SHOUT ? `${BR01_EVENT.title} · ${BR01_EVENT.objectiveShout}`
      : null;
    ui.objective.hidden = !text;
    if (text && ui.objective.textContent !== text) ui.objective.textContent = text;
  }

  // ---- Dialogue -------------------------------------------------------------------------------
  function renderDialogue() {
    const beat = dialogue.lines[dialogue.index];
    ui.line.textContent = beat.text;
    ui.choices.replaceChildren(...beat.choices.map((choice, i) => {
      const button = el(documentLike, 'button', 'biryong-dialogue-choice', `${i + 1}. ${choice}`);
      button.type = 'button';
      button.addEventListener('click', () => choose(i));
      return button;
    }));
    ui.choices.firstChild?.focus?.({ preventScroll: true });
  }

  function openDialogue(lines, onDone) {
    dialogue = { lines, index: 0, onDone, openedAt: globalThis.performance?.now?.() ?? 0 };
    ui.playerLine.hidden = true;
    ui.dialog.hidden = false;
    holdInput(true);
    renderDialogue();
  }

  function endDialogue() {
    if (!dialogue) return false;
    const done = dialogue.onDone;
    dialogue = null;
    ui.dialog.hidden = true;
    done?.();
    if (!dialogue && !shout && !cinematic) holdInput(false);
    return true;
  }

  function choose(index = 0) {
    if (!dialogue) return false;
    const beat = dialogue.lines[dialogue.index];
    const choice = beat.choices[Math.max(0, Math.min(beat.choices.length - 1, index))];
    ui.playerLine.textContent = choice;
    ui.playerLine.hidden = false;
    dialogue.index += 1;
    if (dialogue.index >= dialogue.lines.length) return endDialogue();
    renderDialogue();
    return true;
  }
  ui.close.addEventListener('click', () => endDialogue());
  const keyTarget = documentLike.defaultView ?? globalThis;
  const onKey = event => {
    if (!dialogue || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    // The key press that opened the dialogue (F on the NPC) must not also answer it.
    if (event.timeStamp <= dialogue.openedAt) return;
    if (event.key === 'Escape') { event.preventDefault(); endDialogue(); return; }
    // F (the World interaction key) picks the first reply while the dialogue owns the slot.
    if (event.code === 'KeyF') { event.preventDefault(); choose(0); return; }
    const digit = /^Digit([1-9])$/.exec(event.code);
    if (digit && Number(digit[1]) <= dialogue.lines[dialogue.index].choices.length) {
      event.preventDefault();
      choose(Number(digit[1]) - 1);
    }
  };
  keyTarget.addEventListener?.('keydown', onKey);

  // ---- Discovery ------------------------------------------------------------------------------
  function discover() {
    if (!progress.discover()) return false;
    npc.avatar.enabled = true;
    showToast('새로운 장소 발견', `${BIRYONG_PLACE.icon} ${BIRYONG_PLACE.title}`, BIRYONG_PLACE.description);
    onDiscovered(BIRYONG_PLACE);
    app.fire?.('placeDiscovered', BIRYONG_PLACE);
    return true;
  }

  // ---- Shout / echo ---------------------------------------------------------------------------
  function faceTower() {
    const d = { x: BIRYONG_CENTER.x - player.getLocalPosition().x, z: BIRYONG_CENTER.z - player.getLocalPosition().z };
    player.setLocalEulerAngles(0, Math.atan2(d.x, d.z) * 180 / Math.PI, 0);
  }

  function startShout() {
    if (shout || dialogue || !progress.discovered) return false;
    const forEvent = progress.step === BR01_STEP.SHOUT;
    const line = forEvent ? FIRST_SHOUT : pickShoutLine(random, lastShoutLine);
    lastShoutLine = line;
    shout = { line, startedAt: elapsed, forEvent, voiced: false };
    holdInput(true);
    faceTower();
    return true;
  }

  function voiceShout() {
    shout.voiced = true;
    progress.recordShout();
    const schedule = echoSchedule(shout.line);
    showCaption(`“${shout.line}”`, 900);
    const echo = schedule.find(tap => tap.text && tap.kind === 'echo');
    if (echo) later(echo.delayMs + 260, () => showCaption(echo.text, 1600));
    playEchoStoneCue(worldAudio, shout.line);
    cinematic = { kind: 'echo', t: 0, duration: 2.8 };
    app.fire?.('echoStoneShout', { line: shout.line, shouts: progress.shouts });
  }

  function finishShout() {
    const { forEvent } = shout;
    shout = null;
    // A free shout hands control back when the echo camera move ends.
    if (!forEvent) { if (!cinematic) holdInput(false); return; }
    progress.advance(BR01_STEP.REACTION);
    later(350, () => openDialogue(BR01_SCRIPT.reaction, completeEvent));
  }

  // ---- Completion -----------------------------------------------------------------------------
  function completeEvent() {
    holdInput(true);
    cinematic = { kind: 'rise', t: 0, duration: 3.2 };
    later(2300, () => {
      const lore = [CAMPUS_LORE.BIRYONG_TOWER, CAMPUS_LORE.ECHO_STONE];
      const fresh = lore.filter(entry => progress.addLore(entry.id));
      progress.advance(BR01_STEP.COMPLETE);
      renderObjective();
      showToast('Campus Story 발견', '📜 비룡탑과 울림돌', '캠퍼스 이야기 2개가 기록됐어요.', 5200);
      for (const entry of fresh) { onLoreFound(entry); app.fire?.('campusLoreFound', entry); }
    });
  }

  function talkToNpc() {
    if (dialogue || shout || cinematic) return false;
    if (progress.complete || progress.step === BR01_STEP.FIND_CENTER || progress.step === BR01_STEP.SHOUT) {
      const text = progress.complete ? REPEAT_LINE : '가운데 서서 소리 내봐. 돌 사이, 딱 가운데.';
      openDialogue([{ speaker: 'npc', text, choices: ['알았어.'] }], null);
      return true;
    }
    openDialogue(BR01_SCRIPT.intro, () => {
      progress.advance(BR01_STEP.FIND_CENTER);
      renderObjective();
    });
    return true;
  }

  // ---- Camera ---------------------------------------------------------------------------------
  function cinematicPose(kind, t) {
    const p = player.getLocalPosition();
    const { toEcho } = BIRYONG_AXIS;
    if (kind === 'echo') {
      // Pull back a little on the lawn side so the tower joins the frame.
      const pull = ease(t / 0.9) * 1.4;
      const pos = { x: p.x + toEcho.x * (4.2 + pull), y: p.y + 1.6 + pull * 0.5, z: p.z + toEcho.z * (4.2 + pull) };
      const look = { x: lerp(p.x, BIRYONG_CENTER.x, 0.55), y: lerp(p.y, BIRYONG_DRAGON_BASE_Y, 0.35), z: lerp(p.z, BIRYONG_CENTER.z, 0.55) };
      return { pos, look };
    }
    // Rise: low camera near the echo ring tilts up the column to the dragon over ~2 s.
    const pos = { x: ECHO_CENTER.x + toEcho.x * 3.4, y: 1.35, z: ECHO_CENTER.z + toEcho.z * 3.4 };
    const lift = ease((t - 0.25) / 2.0);
    const look = { x: BIRYONG_CENTER.x, y: lerp(BIRYONG_PLATFORM.height + 1.2, BIRYONG_DRAGON_BASE_Y + 2.6, lift), z: BIRYONG_CENTER.z };
    return { pos, look };
  }

  // Called after OrbitCameraController.apply(): blends the orbit pose toward a scripted one.
  function applyCamera() {
    if (!cinematic) return false;
    const { kind, t, duration } = cinematic;
    const w = Math.min(ease(t / 0.45), ease((duration - t) / 0.45));
    const cine = cinematicPose(kind, t);
    const from = camera.getPosition();
    const forward = camera.forward;
    // PlayCanvas world z is the negated campus z (CampusCoordinateFrame).
    const orbitPos = { x: from.x, y: from.y, z: -from.z };
    const orbitLook = { x: from.x + forward.x * 10, y: from.y + forward.y * 10, z: -(from.z + forward.z * 10) };
    const pos = { x: lerp(orbitPos.x, cine.pos.x, w), y: lerp(orbitPos.y, cine.pos.y, w), z: lerp(orbitPos.z, cine.pos.z, w) };
    const look = { x: lerp(orbitLook.x, cine.look.x, w), y: lerp(orbitLook.y, cine.look.y, w), z: lerp(orbitLook.z, cine.look.z, w) };
    camera.setPosition(pos.x, pos.y, -pos.z);
    camera.lookAt(look.x, look.y, -look.z);
    return true;
  }

  // ---- Frame update ---------------------------------------------------------------------------
  function update(dt, position, { inside = false } = {}) {
    dt = Math.min(Number.isFinite(dt) ? dt : 0, 0.05);
    elapsed += dt;
    if (accountSyncing || inside || !position) return;
    if (!progress.discovered && isNearBiryong(position, BIRYONG_DISCOVER_RADIUS)) {
      discover();
      renderObjective();
    }
    if (progress.step === BR01_STEP.FIND_CENTER && isAtEchoCenter(position)) {
      progress.advance(BR01_STEP.SHOUT);
      renderObjective();
    }
    if (progress.discovered && !centerHintShown && isAtEchoCenter(position) && !shout) {
      centerHintShown = true;
      onStatus('뭔가 소리가 이상하게 들린다.');
    }
    if (!isAtEchoCenter(position, 1.6)) centerHintShown = false;

    if (shout) {
      const ms = (elapsed - shout.startedAt) * 1000;
      if (!shout.voiced && ms >= SHOUT_POSE.handMs) voiceShout();
      if (ms >= SHOUT_POSE.durationMs) finishShout();
    }
    if (cinematic) {
      cinematic.t += dt;
      if (cinematic.t >= cinematic.duration) {
        const wasRise = cinematic.kind === 'rise';
        cinematic = null;
        if (wasRise || (!shout && !dialogue)) holdInput(false);
      }
    }
    // NPC turns toward a nearby player and breathes a little.
    if (npc.avatar.enabled) {
      const d = distanceTo(position, BIRYONG_EVENT_NPC.position);
      if (d < 6) {
        const target = Math.atan2(position.x - BIRYONG_EVENT_NPC.position.x, position.z - BIRYONG_EVENT_NPC.position.z) * 180 / Math.PI;
        const delta = ((target - npcYaw + 540) % 360) - 180;
        npcYaw += delta * Math.min(1, dt * 4);
      }
      npc.avatar.setLocalEulerAngles(0, npcYaw, 0);
      const sway = Math.sin(elapsed * 1.6) * 4;
      npc.arms.forEach((arm, i) => arm.setLocalEulerAngles(sway * (i ? 1 : -1), 0, 0));
    }
    if (!dialogue) renderObjective();
  }

  function getContextAction(position, { blocked = false } = {}) {
    if (accountSyncing || blocked || !position || !progress.discovered || shout || dialogue || cinematic) return null;
    const npcDistance = distanceTo(position, BIRYONG_EVENT_NPC.position);
    if (npcDistance <= BIRYONG_EVENT_NPC.interactionRadius) {
      return {
        id: 'biryong-npc', icon: '💬', label: `${BIRYONG_EVENT_NPC.name}과 대화`, compactLabel: '대화',
        shortcut: 'F', priority: BIRYONG_CONTEXT_PRIORITY.npc, distance: npcDistance, pressed: false,
        trigger: talkToNpc
      };
    }
    if (isAtEchoCenter(position)) {
      return {
        id: 'biryong-echo', icon: '📣', label: '울림돌에서 외쳐본다', compactLabel: '외치기',
        shortcut: 'F', priority: BIRYONG_CONTEXT_PRIORITY.shout, distance: distanceTo(position, ECHO_CENTER), pressed: false,
        trigger: startShout
      };
    }
    return null;
  }

  function getMapObjective() {
    if (accountSyncing || !progress.discovered || progress.complete) return null;
    const step = progress.step;
    if (step === BR01_STEP.INTRO) {
      return { objectiveId: 'biryong.br01.intro', x: BIRYONG_EVENT_NPC.position.x, z: BIRYONG_EVENT_NPC.position.z, kind: 'destination', label: BIRYONG_EVENT_NPC.name };
    }
    if (step === BR01_STEP.FIND_CENTER || step === BR01_STEP.SHOUT) {
      return { objectiveId: 'biryong.br01.center', x: ECHO_CENTER.x, z: ECHO_CENTER.z, kind: 'destination', label: BR01_EVENT.objectiveFindCenter };
    }
    return null;
  }

  renderObjective();
  return Object.freeze({
    update,
    applyCamera,
    getContextAction,
    getMapObjective,
    poseOffsets: () => shout ? shoutPoseOffsets((elapsed - shout.startedAt) * 1000) : null,
    isDialogueOpen: () => dialogue !== null,
    isBusy: () => dialogue !== null || shout !== null || cinematic !== null,
    advanceDialogue: () => choose(0),
    closeDialogue: endDialogue,
    isPlaceDiscovered: id => id === BIRYONG_PLACE_ID && progress.discovered,
    progressSnapshot: () => progress.snapshot(),
    setLocalScope: (scope, options) => progress.setScope(scope, options),
    mergeProgress(snapshot, options) {
      const changed = progress.merge(snapshot, options);
      npc.avatar.enabled = progress.discovered;
      renderObjective();
      return changed;
    },
    replaceProgress(snapshot, options) {
      const changed = progress.replace(snapshot, options);
      npc.avatar.enabled = progress.discovered;
      renderObjective();
      return changed;
    },
    setAccountSyncing(value) {
      accountSyncing = Boolean(value);
      renderObjective();
      return accountSyncing;
    },
    status: () => Object.freeze({
      ...progress.snapshot(),
      shouting: !!shout, cinematic: cinematic?.kind ?? null, dialogueOpen: !!dialogue,
      inputLocked: inputHeld, npcEnabled: npc.avatar.enabled, accountSyncing, localScope: progress.localScope
    }),
    destroy() {
      for (const id of timers) clearTimeout(id);
      timers.clear();
      clearTimeout(toastTimer); clearTimeout(captionTimer);
      holdInput(false);
      keyTarget.removeEventListener?.('keydown', onKey);
      npc.avatar.destroy?.();
      ui.root.remove();
    }
  });
}
