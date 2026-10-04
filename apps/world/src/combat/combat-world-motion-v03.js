export function createCombatWorldMotionV03({
  runtime,
  training,
  controller
} = {}) {
  if (!runtime?.snapshot || !runtime?.subscribe || !training?.consumeDodgeTravel ||
      !controller?.applyCombatGroundDisplacement || !controller?.setGroundMovementLock) {
    throw new TypeError('Combat world motion v0.3 dependencies required');
  }

  let requestedDistance = 0;
  let appliedDistance = 0;
  let blockedDistance = 0;

  const syncLock = state => {
    const locked = state?.active === true && state?.training?.player?.dodge?.active === true;
    controller.setGroundMovementLock('combat-dodge', locked);
  };
  const unsubscribe = runtime.subscribe(syncLock, { emitCurrent: true });

  function update() {
    if (!runtime.active) {
      controller.setGroundMovementLock('combat-dodge', false);
      return false;
    }
    const step = training.consumeDodgeTravel();
    if (!step || step.distance <= 0) {
      if (step?.done) controller.setGroundMovementLock('combat-dodge', false);
      return false;
    }
    requestedDistance += step.distance;
    const moved = controller.applyCombatGroundDisplacement({ x: step.x, z: step.z });
    const applied = Math.hypot(Number(moved?.x) || 0, Number(moved?.z) || 0);
    appliedDistance += applied;
    blockedDistance += Math.max(0, step.distance - applied);
    if (step.done) controller.setGroundMovementLock('combat-dodge', false);
    return applied > 0;
  }

  return Object.freeze({
    update,
    status: () => Object.freeze({ requestedDistance, appliedDistance, blockedDistance }),
    destroy: () => {
      unsubscribe();
      controller.setGroundMovementLock('combat-dodge', false);
    }
  });
}
