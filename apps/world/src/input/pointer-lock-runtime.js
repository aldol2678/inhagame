export function bindPointerLockRuntime({
  manager,
  canvas,
  orbit,
  documentLike = globalThis.document,
  windowTarget = globalThis.window,
  finePointer = null,
  onStatusChange = () => {}
} = {}) {
  if (!manager?.subscribe || !manager?.snapshot) {
    throw new TypeError("Pointer lock runtime requires InputFocusManager");
  }
  if (!canvas) throw new TypeError("Pointer lock runtime requires a canvas");
  if (!orbit?.pointerLook || !orbit?.setPointerLockActive) {
    throw new TypeError("Pointer lock runtime requires OrbitCameraController pointer-lock adapters");
  }

  const pointerIsFine = typeof finePointer === "boolean"
    ? finePointer
    : Boolean(windowTarget?.matchMedia?.("(pointer: fine)")?.matches);
  const supported = pointerIsFine &&
    typeof canvas.requestPointerLock === "function" &&
    typeof documentLike?.exitPointerLock === "function";

  let destroyed = false;
  let desired = manager.snapshot().pointerLockDesired === true;
  let locked = supported && documentLike.pointerLockElement === canvas;
  let pending = false;
  let errors = 0;
  let lastError = null;
  let gestureRecoveryArmed = false;
  let gestureRecoveryGeneration = 0;

  const listeners = [];
  const add = (target, type, fn) => {
    target?.addEventListener?.(type, fn);
    listeners.push([target, type, fn]);
  };

  function setOrbitLock(active) {
    orbit.setPointerLockActive(active === true);
  }

  function status() {
    return Object.freeze({
      supported,
      finePointer: pointerIsFine,
      desired,
      locked,
      pending,
      awaitingGesture: supported && desired && !locked,
      errors,
      lastError
    });
  }

  function publish() {
    onStatusChange(status());
  }

  function recordError(error) {
    errors += 1;
    lastError = String(error?.message ?? error ?? "POINTER_LOCK_ERROR");
    pending = false;
    publish();
  }

  function exit() {
    if (!supported || documentLike.pointerLockElement !== canvas) return false;
    try {
      documentLike.exitPointerLock();
      return true;
    } catch (error) {
      recordError(error);
      return false;
    }
  }

  function syncActual() {
    if (destroyed) return false;
    const nextLocked = supported && documentLike.pointerLockElement === canvas;
    const changed = locked !== nextLocked;
    locked = nextLocked;
    pending = false;
    if (locked) lastError = null;
    setOrbitLock(locked);

    // A request may complete after focus changed to Chat/UI/System Lock.
    if (locked && !desired) exit();
    publish();
    return changed;
  }

  function request() {
    if (destroyed || !supported || !desired || locked || pending) return false;
    pending = true;
    publish();
    try {
      const result = canvas.requestPointerLock();
      if (result?.catch) {
        result.catch(error => {
          if (!destroyed) recordError(error);
        });
      }
      return true;
    } catch (error) {
      recordError(error);
      return false;
    }
  }

  function armGestureRecovery() {
    const generation = ++gestureRecoveryGeneration;
    gestureRecoveryArmed = true;
    // Keep the arm through the rest of this trusted click's propagation. A microtask
    // can run between target and document listeners in real browsers, which would
    // clear it before the bubble phase. The zero-delay task expires before the next
    // separate user event, so no latent auto-lock remains.
    const expire = globalThis.setTimeout ?? (fn => fn());
    expire(() => {
      if (generation === gestureRecoveryGeneration) gestureRecoveryArmed = false;
    }, 0);
  }

  function applyFocus(state) {
    if (destroyed || !state) return;
    const wasDesired = desired;
    desired = state.pointerLockDesired === true;
    if (!desired) {
      gestureRecoveryGeneration += 1;
      gestureRecoveryArmed = false;
      pending = false;
      exit();
    } else if (!wasDesired) {
      // When a user closes a blocking panel (or presses START), the focus owner is
      // released inside that same trusted click. Arm only for the remainder of the
      // current event so the document bubble handler can reacquire without a second click.
      armGestureRecovery();
    }
    publish();
  }

  const unsubscribe = manager.subscribe(applyFocus, { emitCurrent: true });

  add(documentLike, "pointerlockchange", syncActual);
  add(documentLike, "pointerlockerror", () => recordError("POINTER_LOCK_ERROR"));
  add(documentLike, "mousemove", event => {
    if (!locked || !desired) return;
    orbit.pointerLook(Number(event.movementX ?? 0), Number(event.movementY ?? 0));
  });
  add(canvas, "pointerdown", event => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    request();
  });
  add(documentLike, "click", () => {
    if (!gestureRecoveryArmed) return;
    gestureRecoveryGeneration += 1;
    gestureRecoveryArmed = false;
    request();
  });
  add(windowTarget, "blur", () => {
    pending = false;
    exit();
  });

  setOrbitLock(locked);
  publish();

  return Object.freeze({
    request,
    exit,
    sync: syncActual,
    status,
    destroy() {
      if (destroyed) return false;
      destroyed = true;
      unsubscribe?.();
      for (const [target, type, fn] of listeners) target?.removeEventListener?.(type, fn);
      listeners.length = 0;
      if (supported && documentLike.pointerLockElement === canvas) {
        try { documentLike.exitPointerLock(); } catch { /* best-effort shutdown */ }
      }
      locked = false;
      pending = false;
      gestureRecoveryGeneration += 1;
      gestureRecoveryArmed = false;
      setOrbitLock(false);
      publish();
      return true;
    }
  });
}
