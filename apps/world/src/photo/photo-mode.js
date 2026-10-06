import { INPUT_FOCUS_POLICY } from '../input/input-focus-manager.js';
import { createInputFocusOwner } from '../input/input-focus-owner.js';
import { INKYUNG_PHOTO_POINT } from './inkyung-photo-point.js';

export const PHOTO_FRAME_LIMITS = Object.freeze({
  yaw: .65,
  pitch: Object.freeze({ min: .12, max: .65 }),
  distance: Object.freeze({ min: 2.5, max: 6 })
});
export const PHOTO_MODE_OWNER = 'inkyung-photo-mode';
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const finitePosition = p => p && [p.x, p.y, p.z].every(Number.isFinite);
const safeState = s => s?.campus === true && s.grounded === true &&
  !s.mounted && !s.seated && !s.transitioning && !s.combat;

// This is a temporary view over the existing orbit, never a second camera or movement owner.
// InputFocusManager releases held keys/touch/Pointer Lock. Orbit.apply retains camera collision.
export function createPhotoMode({
  orbit, inputFocus, getPosition, getState, beforeOpen = () => {},
  requestPose = () => false, cancelPose = () => {}, onChange = () => {}
} = {}) {
  const owner = createInputFocusOwner({ manager: inputFocus, ownerId: PHOTO_MODE_OWNER, policy: INPUT_FOCUS_POLICY.BLOCKING_UI });
  const listeners = new Set([onChange]);
  let session = null, destroyed = false;
  const distance = () => {
    const p = getPosition();
    return finitePosition(p) ? Math.hypot(p.x - INKYUNG_PHOTO_POINT.position.x, p.z - INKYUNG_PHOTO_POINT.position.z) : Infinity;
  };
  function canOpen() {
    return !destroyed && !session && safeState(getState()) && inputFocus.can('WORLD_ACTION') &&
      !orbit.indoor && !orbit.mounted && distance() <= INKYUNG_PHOTO_POINT.radius;
  }
  function publish(reason) {
    const change = { active: !!session, reason };
    for (const listener of listeners) listener(change);
  }
  function view() {
    return { yaw: orbit.yaw, pitch: orbit.pitch, distance: orbit.distance, firstPerson: orbit.firstPerson,
      nearClip: orbit.camera.camera.nearClip };
  }
  function applyView(next) {
    orbit.yaw = next.yaw; orbit.pitch = next.pitch; orbit.distance = next.distance;
    orbit.firstPerson = next.firstPerson; orbit.camera.camera.nearClip = next.nearClip;
    orbit.perspectiveButton?.setAttribute('aria-pressed', String(next.firstPerson));
    if (orbit.perspectiveButton) orbit.perspectiveButton.textContent = next.firstPerson ? '👁 3인칭으로' : '👁 1인칭으로';
  }
  function open() {
    if (!canOpen()) return false;
    beforeOpen();
    // beforeOpen may synchronously start another world transaction.
    if (!canOpen()) return false;
    const p = getPosition();
    session = { saved: view(), position: { x: p.x, y: p.y, z: p.z }, accountId: getState().accountId,
      baseYaw: orbit.yaw, posed: false };
    applyView({ ...session.saved, firstPerson: false, nearClip: .3,
      pitch: .25, distance: 4 });
    owner.acquire();
    publish('open');
    return true;
  }
  function close(reason = 'close') {
    if (!session) return false;
    const old = session; session = null;
    // Restore before releasing the claim so later transition owners snapshot the normal view.
    applyView(old.saved);
    if (old.posed) cancelPose();
    owner.release();
    publish(reason);
    return true;
  }
  function update() {
    if (!session) return false;
    const state = getState(), p = getPosition(), at = session.position;
    if (!safeState(state) || state.accountId !== session.accountId || !finitePosition(p) ||
      Math.hypot(p.x - at.x, p.y - at.y, p.z - at.z) > .1) {
      close('lifecycle'); return false;
    }
    return true;
  }
  function frame(values = {}) {
    if (!update()) return false;
    if (Number.isFinite(values.yaw)) orbit.yaw = session.baseYaw + clamp(values.yaw, -PHOTO_FRAME_LIMITS.yaw, PHOTO_FRAME_LIMITS.yaw);
    if (Number.isFinite(values.pitch)) orbit.pitch = clamp(values.pitch, PHOTO_FRAME_LIMITS.pitch.min, PHOTO_FRAME_LIMITS.pitch.max);
    if (Number.isFinite(values.distance)) orbit.distance = clamp(values.distance, PHOTO_FRAME_LIMITS.distance.min, PHOTO_FRAME_LIMITS.distance.max);
    return true;
  }
  function pose() {
    if (!update()) return false;
    const result = requestPose();
    if (result === 'started') session.posed = true;
    return result;
  }
  const unsubscribe = inputFocus.subscribe(state => {
    if (session && state.topOwners.some(id => id !== PHOTO_MODE_OWNER)) close('takeover');
  });
  return Object.freeze({
    open, close, update, frame, pose,
    get active() { return !!session; },
    contextAction() {
      if (!canOpen()) return null;
      return { id: PHOTO_MODE_OWNER, icon: '📸', label: '인경호 사진 모드', compactLabel: '사진 모드',
        priority: 240, distance: distance(), trigger: open };
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { if (destroyed) return; close('destroy'); destroyed = true; unsubscribe(); listeners.clear(); }
  });
}
