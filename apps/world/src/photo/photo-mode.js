import { INPUT_FOCUS_POLICY } from '../input/input-focus-manager.js';
import { createInputFocusOwner } from '../input/input-focus-owner.js';

export const PHOTO_MODE_OWNER = 'photo-mode';
// The same blocking class as other modal UI: gameplay movement, the gameplay camera, world
// actions, shortcuts and Pointer Lock are suspended (InputFocusManager also releases held
// keys, touch and assists). The photo camera is not the gameplay `camera` capability;
// PhotoInput accepts it only while this owner alone holds the top claim (inputAllowed()).
export const PHOTO_MODE_POLICY = INPUT_FOCUS_POLICY.BLOCKING_UI;

// Why Photo Mode cannot open right now. Place never decides it: any normal world state can.
export const PHOTO_MODE_BLOCK = Object.freeze({
  DESTROYED: 'destroyed', ACTIVE: 'active', LOBBY: 'lobby', TRANSITION: 'transition', COMBAT: 'combat',
  CINEMATIC: 'cinematic', REGION: 'region', MOUNTED: 'mounted', AIRBORNE: 'airborne', FOCUS: 'focus', POSITION: 'position'
});
// A subject that drifts this far (~2 m) was teleported or carried; the bounded photo rig
// around the old spot is stale. Settling, seating and emote poses stay well inside it.
export const PHOTO_SUBJECT_DRIFT_LIMIT = 1;

const finitePosition = p => p && [p.x, p.y, p.z].every(Number.isFinite);
// Shared by entry and session validation, so a state that cannot open also closes a session.
function worldBlock(s) {
  if (s.world !== true) return PHOTO_MODE_BLOCK.LOBBY;
  if (s.transitioning) return PHOTO_MODE_BLOCK.TRANSITION;
  if (s.combat) return PHOTO_MODE_BLOCK.COMBAT;
  if (s.cinematic) return PHOTO_MODE_BLOCK.CINEMATIC;
  // TODO(photo-mode P1): the Biryong realm swaps the camera obstacle and ground authority
  // with its own scripted camera; verify a free camera there before allowing it.
  if (s.region !== 'campus') return PHOTO_MODE_BLOCK.REGION;
  // TODO(photo-mode P1): mounts keep vehicle physics and the flight chase camera; a moving
  // subject needs its own rig policy. Campus, rooms and seats share the walking camera.
  if (s.mounted) return PHOTO_MODE_BLOCK.MOUNTED;
  return null;
}

// Lifecycle owner: entry policy, InputFocus claim, play-camera snapshot/restore and pose.
// The PhotoCameraRig owns the camera transform in between; the orbit is never modified.
export function createPhotoMode({
  orbit, rig, inputFocus, getPosition, getState, getPointerLocked = () => false, beforeOpen = () => {},
  requestPose = () => false, cancelPose = () => {}, onChange = () => {}, entryOwnerId = null
} = {}) {
  if (!orbit?.camera?.camera || !rig?.begin || !inputFocus?.can) throw new TypeError('Photo Mode requires orbit, rig and InputFocus');
  const owner = createInputFocusOwner({ manager: inputFocus, ownerId: PHOTO_MODE_OWNER, policy: PHOTO_MODE_POLICY });
  const listeners = new Set([onChange]);
  let session = null, destroyed = false, handingOff = false;

  function blockedReason({ entryOwner = null } = {}) {
    if (destroyed) return PHOTO_MODE_BLOCK.DESTROYED;
    if (session) return PHOTO_MODE_BLOCK.ACTIVE;
    const state = getState() ?? {};
    const block = worldBlock(state);
    if (block) return block;
    if (!state.grounded) return PHOTO_MODE_BLOCK.AIRBORNE;
    // Any dialog, panel or system lock already holding input keeps the camera to itself.
    const focus = inputFocus.snapshot();
    const fromPhone = entryOwnerId && entryOwner === entryOwnerId && focus.activeClaimCount === 1 &&
      focus.topOwners.length === 1 && focus.topOwners[0] === entryOwnerId;
    if (!inputFocus.can('WORLD_ACTION') && !fromPhone) return PHOTO_MODE_BLOCK.FOCUS;
    if (!finitePosition(getPosition())) return PHOTO_MODE_BLOCK.POSITION;
    return null;
  }
  function publish(reason, old = session) {
    const change = { active: !!session, reason, origin: old?.origin ?? 'WORLD_SHORTCUT', purpose: old?.purpose ?? 'normal' };
    for (const listener of listeners) listener(change);
  }
  // Everything needed to put the exact play frame back, in the gameplay (unmirrored) frame.
  function snapshotPlayCamera() {
    const entity = orbit.camera, lens = entity.camera;
    const p = entity.getPosition(), r = entity.getRotation(), f = entity.forward;
    return Object.freeze({
      position: Object.freeze({ x: p.x, y: p.y, z: -p.z }),
      forward: Object.freeze({ x: f.x, y: f.y, z: -f.z }),
      rotation: Object.freeze([r.x, r.y, r.z, r.w]),
      fov: lens.fov, nearClip: lens.nearClip,
      orbit: Object.freeze({ yaw: orbit.yaw, pitch: orbit.pitch, distance: orbit.distance, firstPerson: orbit.firstPerson,
        firstPersonPitch: orbit.firstPersonPitch, thirdPersonPitch: orbit.thirdPersonPitch }),
      pointerLocked: getPointerLocked() === true
    });
  }
  function restorePlayCamera(saved) {
    const entity = orbit.camera, lens = entity.camera, { position: p, rotation: r } = saved;
    entity.setPosition(p.x, p.y, -p.z);
    entity.setRotation(r[0], r[1], r[2], r[3]);
    lens.fov = saved.fov; lens.nearClip = saved.nearClip;
    // Photo Mode never writes the orbit; this only guards against an external writer.
    const { firstPerson, ...view } = saved.orbit;
    Object.assign(orbit, view);
    if (orbit.firstPerson !== firstPerson) {
      orbit.firstPerson = firstPerson;
      orbit.perspectiveButton?.setAttribute('aria-pressed', String(firstPerson));
      if (orbit.perspectiveButton) orbit.perspectiveButton.textContent = firstPerson ? '👁 3인칭으로' : '👁 1인칭으로';
    }
    // Pointer Lock needs a fresh user gesture; the runtime re-arms it from InputFocus on release.
  }
  function open({ origin = 'WORLD_SHORTCUT', purpose = 'normal', entryOwner = null } = {}) {
    if (blockedReason({ entryOwner })) return false;
    beforeOpen();
    // beforeOpen may synchronously start another world transaction.
    if (blockedReason({ entryOwner })) return false;
    const p = getPosition(), state = getState() ?? {};
    const saved = snapshotPlayCamera();
    if (!rig.begin(saved)) return false;
    session = { saved, subject: { x: p.x, y: p.y, z: p.z }, space: state.space ?? null,
      accountId: state.accountId ?? null, posed: false, origin, purpose };
    handingOff = entryOwner === entryOwnerId && entryOwnerId !== null;
    owner.acquire();
    publish('open');
    handingOff = false;
    if (!inputAllowed()) { close('takeover'); return false; }
    return true;
  }
  function close(reason = 'close') {
    if (!session) return false;
    const old = session; session = null;
    rig.end();
    // Restore before releasing the claim so later transition owners snapshot the normal view.
    restorePlayCamera(old.saved);
    if (old.posed) cancelPose();
    // A Phone subscriber can acquire its return claim before Photo releases its claim.
    publish(reason, old);
    owner.release();
    return true;
  }
  function update() {
    if (!session) return false;
    const state = getState() ?? {}, p = getPosition(), at = session.subject;
    if (worldBlock(state) || state.space !== session.space || state.accountId !== session.accountId ||
      !finitePosition(p) || Math.hypot(p.x - at.x, p.y - at.y, p.z - at.z) > PHOTO_SUBJECT_DRIFT_LIMIT) {
      close('lifecycle'); return false;
    }
    return true;
  }
  // Called once per frame at the camera-apply point: the rig is this frame's only camera owner.
  function applyCamera(dt) {
    if (!update()) return false;
    rig.update(dt);
    return true;
  }
  function pose() {
    if (!update()) return false;
    const result = requestPose();
    if (result === 'started') session.posed = true;
    return result;
  }
  function inputAllowed() {
    if (!session) return false;
    const { topOwners } = inputFocus.snapshot();
    return topOwners.length === 1 && topOwners[0] === PHOTO_MODE_OWNER;
  }
  const unsubscribe = inputFocus.subscribe(state => {
    if (session && state.topOwners.some(id => id !== PHOTO_MODE_OWNER && !(handingOff && id === entryOwnerId))) close('takeover');
  });
  return Object.freeze({
    open, close, update, applyCamera, pose, blockedReason, inputAllowed,
    canOpen: () => blockedReason() === null,
    toggle() { return session ? close() : open(); },
    get active() { return !!session; },
    get saved() { return session?.saved ?? null; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { if (destroyed) return; close('destroy'); destroyed = true; unsubscribe(); listeners.clear(); }
  });
}
