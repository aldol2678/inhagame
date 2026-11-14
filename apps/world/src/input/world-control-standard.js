/**
 * ALDOL World Controls pilot: engine-free mathematical contract.
 * Right is +X, forward is +Z, up is +Y in gameplay coordinates.
 * Camera yaw is radians. yaw=0 looks along gameplay +Z.
 * The caller owns any gameplay-to-render reflection (INHA WORLD renders -Z).
 */
export const CONTROL_AXES = Object.freeze({ right: '+X', forward: '+Z', up: '+Y', yawUnit: 'radians' });

export function normalizeGroundInput(right = 0, forward = 0) {
  if (!Number.isFinite(right) || !Number.isFinite(forward)) return { right: 0, forward: 0 };
  const length = Math.hypot(right, forward);
  const scale = length > 1 ? 1 / length : 1;
  return { right: right * scale, forward: forward * scale };
}

export function touchToGroundInput(touchX = 0, touchY = 0) {
  return {
    right: Number.isFinite(touchX) ? touchX : 0,
    forward: Number.isFinite(touchY) ? -touchY : 0
  };
}

/** Preserve INHA WORLD's gameplay-space camera-relative XZ rotation. */
export function cameraRelativeGroundDirection(right = 0, forward = 0, cameraYaw = 0) {
  if (![right, forward, cameraYaw].every(Number.isFinite)) return { x: 0, z: 0 };
  const sin = Math.sin(cameraYaw);
  const cos = Math.cos(cameraYaw);
  return { x: right * cos - forward * sin, z: right * sin + forward * cos };
}

/** Rightward drag subtracts yaw; downward drag adds pitch unless inverted. */
export function applyCameraLook({
  yaw, pitch, deltaX, deltaY, yawScale, pitchScale, minPitch, maxPitch, invertY = false
}) {
  if (![yaw, pitch, deltaX, deltaY, yawScale, pitchScale, minPitch, maxPitch].every(Number.isFinite) ||
      yawScale < 0 || pitchScale < 0 || minPitch > maxPitch) {
    return { yaw, pitch };
  }
  return {
    yaw: yaw - deltaX * yawScale,
    pitch: Math.max(minPitch, Math.min(maxPitch, pitch + (invertY ? -deltaY : deltaY) * pitchScale))
  };
}
