// The single Photo Mode input binding: keyboard, canvas drag/pinch/wheel and the on-screen
// move controls. Gameplay listeners stay gated by InputFocus while Photo Mode holds its
// claim; these act only while PhotoMode reports that it alone owns input, so the two
// never run in the same frame. Held state is per session and is never resumed.
export const PHOTO_KEYS = Object.freeze({
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', down: 'KeyQ', up: 'KeyE',
  reset: 'KeyR', hide: 'KeyH', open: 'KeyP'
});
// Exponential lens step per normalized wheel pixel; deltaY 100 ≈ 13% FOV.
export const PHOTO_WHEEL_ZOOM = .0012;
const MOVE_CODES = new Set([PHOTO_KEYS.forward, PHOTO_KEYS.back, PHOTO_KEYS.left, PHOTO_KEYS.right, PHOTO_KEYS.down, PHOTO_KEYS.up]);
const SHIFT_CODES = new Set(['ShiftLeft', 'ShiftRight']);
const CAPTURE_CODES = new Set(['Space', 'Enter', 'NumpadEnter']);
const PAD_DEADZONE = .12;
const control = target => !!target?.closest?.('button, input, select, textarea, a[href], [contenteditable="true"]') ||
  /^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(target?.tagName ?? '');
const typing = target => target?.isContentEditable === true || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '');

export function createPhotoInput({ mode, rig, canvas, doc = globalThis.document, win = globalThis.window,
  canUseShortcut = () => true, getMouseLook = () => ({ sensitivity: 1, invertY: false }) } = {}) {
  if (!mode?.subscribe || !rig?.look || !canvas?.addEventListener) throw new TypeError('Photo input requires mode, rig and canvas');
  const held = new Set(), shift = new Set(), pointers = new Map(), unbinders = [];
  const vertical = { up: 0, down: 0 };
  let pad = { x: 0, z: 0 }, latched = false, precision = false, commands = {}, destroyed = false;
  const allowed = () => !destroyed && mode.active && mode.inputAllowed();
  const listen = (target, type, fn, options) => {
    target?.addEventListener?.(type, fn, options);
    unbinders.push(() => target?.removeEventListener?.(type, fn, options));
  };

  function syncIntent() {
    if (!mode.active) return;
    const k = code => held.has(code) ? 1 : 0;
    rig.setMoveIntent({
      x: k(PHOTO_KEYS.right) - k(PHOTO_KEYS.left) + pad.x,
      y: k(PHOTO_KEYS.up) - k(PHOTO_KEYS.down) + vertical.up - vertical.down,
      z: k(PHOTO_KEYS.forward) - k(PHOTO_KEYS.back) + pad.z
    });
  }
  function syncPrecision() {
    const next = shift.size > 0 || latched;
    if (mode.active) rig.setPrecision(next);
    if (next === precision) return;
    precision = next;
    commands.precision?.(precision);
  }
  const padResets = new Set();
  function releaseAll() {
    held.clear(); shift.clear(); pointers.clear(); vertical.up = vertical.down = 0;
    for (const reset of padResets) reset();
    pad = { x: 0, z: 0 };
    syncIntent(); syncPrecision();
  }

  function keydown(event) {
    if (destroyed) return;
    const code = event.code;
    if (!mode.active) {
      // P opens Photo Mode from play, under the same shortcut gate as other gameplay keys.
      if (code !== PHOTO_KEYS.open || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
        typing(event.target) || !canUseShortcut()) return;
      if (mode.open()) event.preventDefault?.();
      return;
    }
    if (event.isComposing) return;
    if (code === 'Escape') {
      event.preventDefault?.(); event.stopImmediatePropagation?.(); event.stopPropagation?.();
      if (!commands.escape?.()) mode.close('escape');
      return;
    }
    // Never forward a photo key to the window-level gameplay shortcuts.
    event.stopPropagation?.();
    if (code === 'Tab') { commands.tab?.(event); return; }
    if (!allowed() || event.ctrlKey || event.metaKey || event.altKey) return;
    if (SHIFT_CODES.has(code)) { shift.add(code); syncPrecision(); return; }
    if (CAPTURE_CODES.has(code)) {
      // A focused photo control activates natively (the shutter itself, ⚙, ✕ ...).
      if (control(event.target)) return;
      event.preventDefault?.();
      if (!event.repeat) commands.capture?.();
      return;
    }
    if (MOVE_CODES.has(code)) {
      event.preventDefault?.();
      // A repeat without our own keydown is a key still held from play: never resume it.
      if (!event.repeat) { held.add(code); syncIntent(); }
      return;
    }
    if (event.repeat) return;
    if (code === PHOTO_KEYS.reset) { event.preventDefault?.(); rig.reset(); commands.reset?.(); return; }
    if (code === PHOTO_KEYS.hide) { event.preventDefault?.(); commands.toggleUi?.(); }
  }
  function keyup(event) {
    if (held.delete(event.code)) syncIntent();
    if (shift.delete(event.code)) syncPrecision();
  }

  function pointerdown(event) {
    if (!allowed() || (event.pointerType === 'mouse' && ![0, 1, 2].includes(event.button))) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault?.();
  }
  function pointermove(event) {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    if (!allowed()) { pointers.clear(); return; }
    const point = { x: event.clientX, y: event.clientY, type: previous.type };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    if (pointers.size === 1) {
      // One pointer looks, with the gameplay camera's mental model (drag right turns right).
      const mouse = previous.type === 'mouse', settings = mouse ? getMouseLook() ?? {} : {};
      const dy = point.y - previous.y;
      rig.look(point.x - previous.x, mouse && settings.invertY ? -dy : dy, { scale: mouse ? settings.sensitivity ?? 1 : 1 });
    } else if (pointers.size === 2) {
      const other = [...pointers].find(([id]) => id !== event.pointerId)?.[1];
      const before = other && Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = other && Math.hypot(point.x - other.x, point.y - other.y);
      // Spreading two fingers narrows the lens (zoom in).
      if (before > 0 && after > 0 && rig.zoom(before / after)) commands.lens?.();
    }
    pointers.set(event.pointerId, point);
    event.preventDefault?.();
  }
  const pointerend = event => { pointers.delete(event.pointerId); };
  function wheel(event) {
    if (!allowed()) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight || 800 : 1);
    if (!Number.isFinite(delta)) return;
    if (rig.zoom(Math.exp(delta * PHOTO_WHEEL_ZOOM))) commands.lens?.();
    event.preventDefault?.();
  }

  listen(doc, 'keydown', keydown);
  listen(doc, 'keyup', keyup);
  listen(win, 'blur', releaseAll);
  listen(canvas, 'pointerdown', pointerdown);
  listen(canvas, 'pointermove', pointermove);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(canvas, type, pointerend);
  listen(canvas, 'wheel', wheel, { passive: false });
  const unsubscribe = mode.subscribe(({ active }) => {
    // Every session starts from rest; nothing held in play or a prior session carries over.
    latched = false;
    releaseAll();
    if (!active) precision = false;
  });
  const offClosing = mode.subscribeClosing?.(releaseAll);

  // Small virtual stick: up = forward. Pointer capture keeps its drag off the camera look.
  function bindMovePad(element, knob = null) {
    let id = null;
    const reset = () => {
      id = null; pad = { x: 0, z: 0 };
      if (knob?.style) knob.style.transform = '';
      syncIntent();
    };
    const track = event => {
      const r = element.getBoundingClientRect(), radius = Math.max(1, Math.min(r.width, r.height) / 2);
      let x = (event.clientX - r.left - r.width / 2) / radius, y = (event.clientY - r.top - r.height / 2) / radius;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const length = Math.hypot(x, y);
      if (length > 1) { x /= length; y /= length; }
      const live = length < PAD_DEADZONE ? 0 : 1;
      pad = { x: x * live, z: -y * live };
      if (knob?.style) knob.style.transform = `translate(${(x * radius * .55).toFixed(1)}px, ${(y * radius * .55).toFixed(1)}px)`;
      syncIntent();
    };
    padResets.add(reset);
    listen(element, 'pointerdown', event => {
      if (!allowed() || id !== null) return;
      id = event.pointerId; element.setPointerCapture?.(id);
      event.preventDefault?.(); event.stopPropagation?.();
      track(event);
    });
    listen(element, 'pointermove', event => { if (event.pointerId === id && allowed()) { event.preventDefault?.(); track(event); } });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      listen(element, type, event => { if (event.pointerId === id) reset(); });
    }
  }
  // Press-and-hold vertical control; keyboard activation (click without a pointer) nudges.
  function bindHoldButton(element, direction) {
    const key = direction > 0 ? 'up' : 'down';
    let id = null;
    const release = () => { id = null; vertical[key] = 0; syncIntent(); };
    padResets.add(() => { id = null; });
    listen(element, 'pointerdown', event => {
      if (!allowed() || id !== null) return;
      id = event.pointerId; element.setPointerCapture?.(id);
      event.preventDefault?.(); vertical[key] = 1; syncIntent();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      listen(element, type, event => { if (event.pointerId === id) release(); });
    }
    listen(element, 'click', event => { if (event.detail === 0 && allowed()) rig.nudge({ y: direction }); });
  }

  return Object.freeze({
    bindMovePad, bindHoldButton, releaseAll,
    setCommands(next = {}) { commands = { ...next }; },
    setPrecisionLatch(active) { latched = active === true; syncPrecision(); return latched; },
    get precision() { return precision; },
    get latched() { return latched; },
    status() {
      return Object.freeze({ keys: [...held].sort(), shift: shift.size > 0, latched, precision,
        pad: { ...pad }, vertical: { ...vertical }, pointers: pointers.size });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; releaseAll(); unsubscribe(); offClosing?.();
      for (const unbind of unbinders.splice(0)) unbind();
      padResets.clear();
    }
  });
}
