import { INPUT_FOCUS_POLICY } from '../input/input-focus-manager.js';
import { createInputFocusOwner } from '../input/input-focus-owner.js';

export const PHONE_OWNER = 'smartphone';
export const PHONE_STATE = Object.freeze({ CLOSED: 'CLOSED', HOME: 'HOME', APP: 'APP', HOME_EDIT: 'HOME_EDIT', CAMERA: 'CAMERA', TRANSITION: 'TRANSITION' });

// Only UI history and input ownership live here. Domain state stays in the injected apps.
export function createPhoneShell({ inputFocus, registry, canOpen = () => true, beforeOpen = () => {}, onChange = () => {}, onError = () => {} }) {
  const owner = createInputFocusOwner({ manager: inputFocus, ownerId: PHONE_OWNER, policy: INPUT_FOCUS_POLICY.BLOCKING_UI });
  let state = PHONE_STATE.CLOSED, stack = [], destroyed = false, cameraSession = null;
  const snapshot = () => ({ state, stack: stack.map(x => ({ ...x })), current: stack.at(-1) ?? null, open: state !== PHONE_STATE.CLOSED });
  const publish = () => onChange(snapshot());
  const currentApp = () => registry.find(app => app.id === stack.at(-1)?.appId);
  function leaveApp() { try { currentApp()?.close?.(); } catch (error) { onError(error); } }
  function open() {
    if (destroyed || state !== PHONE_STATE.CLOSED || !canOpen()) return false;
    state = PHONE_STATE.TRANSITION; owner.acquire();
    try { beforeOpen(); } catch (error) { state = PHONE_STATE.CLOSED; owner.release(); onError(error); publish(); return false; }
    stack = []; state = PHONE_STATE.HOME; publish(); return true;
  }
  function close() {
    if (state === PHONE_STATE.CLOSED) return false;
    const oldCamera = cameraSession;
    cameraSession = null; state = PHONE_STATE.CLOSED;
    leaveApp(); stack = []; oldCamera?.close?.('phone-close');
    owner.release(); publish(); return true;
  }
  function launch(appId, params = {}) {
    if (destroyed || !owner.active) return false;
    const app = registry.find(item => item.id === appId && item.available());
    if (!app) return false;
    leaveApp(); stack.push({ ...params, appId }); state = PHONE_STATE.APP;
    try { app.open?.(params); } catch (error) { onError(error); }
    publish(); return true;
  }
  function home() {
    if (!owner.active) return false;
    leaveApp(); stack = []; state = PHONE_STATE.HOME; publish(); return true;
  }
  function back() {
    if (state === PHONE_STATE.HOME_EDIT) { state = PHONE_STATE.HOME; publish(); return true; }
    if (state === PHONE_STATE.HOME) return close();
    if (state !== PHONE_STATE.APP) return false;
    leaveApp(); stack.pop(); state = stack.length ? PHONE_STATE.APP : PHONE_STATE.HOME;
    try { currentApp()?.open?.(stack.at(-1)); } catch (error) { onError(error); }
    publish(); return true;
  }
  function camera(mode, purpose = 'normal') {
    if (!owner.active || destroyed) return false;
    leaveApp(); state = PHONE_STATE.TRANSITION; cameraSession = mode;
    // Photo Mode acquires first. Its synchronous open event releases Phone's claim.
    let started = false;
    try { started = mode.open({ origin: 'PHONE', purpose, entryOwner: PHONE_OWNER }); }
    catch (error) { cameraSession = null; mode.close?.('phone-error'); onError(error); }
    if (!started) { cameraSession = null; state = PHONE_STATE.HOME; stack = []; publish(); }
    return started;
  }
  function cameraChanged({ active, origin, reason }) {
    if (origin !== 'PHONE' || !cameraSession) return;
    if (active) { state = PHONE_STATE.CAMERA; owner.release(); publish(); }
    else {
      cameraSession = null;
      // Lifecycle/takeover must never resurrect a Phone above another modal/system lock.
      if (!['close', 'escape'].includes(reason)) { state = PHONE_STATE.CLOSED; stack = []; publish(); return; }
      owner.acquire(); state = PHONE_STATE.HOME; stack = []; publish();
    }
  }
  const unsubscribe = inputFocus.subscribe(s => {
    if (owner.active && s.topOwners.some(id => ![PHONE_OWNER, 'photo-mode', 'full-map', 'view-settings'].includes(id))) close();
  });
  return Object.freeze({ open, close, launch, home, back, camera, cameraChanged, snapshot,
    edit() { if (state !== PHONE_STATE.HOME) return false; state = PHONE_STATE.HOME_EDIT; publish(); return true; },
    get state() { return state; }, get ownsInput() { return owner.active; },
    destroy() { close(); destroyed = true; unsubscribe(); }
  });
}
