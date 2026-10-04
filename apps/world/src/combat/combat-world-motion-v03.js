export function createCombatWorldMotionV03({
  runtime,
  training,
  controller
} = {}) {
  if (!runtime?.snapshot || !training?.consumeDodgeTravel || !controller?.applyCombatGroundDisplacement) {
    throw new TypeError('Combat world motion v0.3 dependencies required');
  }

  let requestedDistance = 0;
  let appliedDistance = 0;
  let blockedDistance = 0;

  function update() {
    if (!runtime.active) return false;
    const step = training.consumeDodgeTravel();
    if (!step || step.distance <= 0) return false;
    requestedDistance += step.distance;
    const moved = controller.applyCombatGroundDisplacement({ x: step.x, z: step.z });
    const applied = Math.hypot(Number(moved?.x) || 0, Number(moved?.z) || 0);
    appliedDistance += applied;
    blockedDistance += Math.max(0, step.distance - applied);
    return applied > 0;
  }

  return Object.freeze({
    update,
    status: () => Object.freeze({ requestedDistance, appliedDistance, blockedDistance })
  });
}
