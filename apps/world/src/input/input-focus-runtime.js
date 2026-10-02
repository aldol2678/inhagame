export function bindInputFocusRuntime({
  manager,
  controller,
  orbit
} = {}) {
  if (!manager?.subscribe || !manager?.snapshot) {
    throw new TypeError("Input focus manager is required");
  }
  if (!controller?.setInputEnabled) {
    throw new TypeError("PlayerController adapter requires setInputEnabled()");
  }
  if (!orbit?.setInputEnabled) {
    throw new TypeError("OrbitCameraController adapter requires setInputEnabled()");
  }

  let lastMovement = null;
  let lastCamera = null;
  let destroyed = false;

  function apply(state) {
    if (destroyed || !state) return;

    if (state.movement !== lastMovement) {
      lastMovement = state.movement === true;
      controller.setInputEnabled(lastMovement);
    }

    if (state.camera !== lastCamera) {
      lastCamera = state.camera === true;
      orbit.setInputEnabled(lastCamera);
    }
  }

  const unsubscribe = manager.subscribe(apply, { emitCurrent: true });

  return Object.freeze({
    sync() {
      if (destroyed) return false;
      apply(manager.snapshot());
      return true;
    },
    destroy() {
      if (destroyed) return false;
      destroyed = true;
      unsubscribe?.();
      return true;
    }
  });
}
