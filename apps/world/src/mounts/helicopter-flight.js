// Assisted helicopter flight model for the campus prototype.
// This is deliberately a game-sim hybrid: cyclic tilt drives acceleration while neutral collective
// holds altitude. The pure state step is shared by runtime and QA, with no PlayCanvas dependency.

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const blend = (current, target, response, dt) =>
  current + (target - current) * (1 - Math.exp(-response * dt));

function wrapDegrees(value) {
  let result = ((finite(value) + 180) % 360 + 360) % 360 - 180;
  if (result === -180) result = 180;
  return result;
}

export const HELICOPTER_FLIGHT_LIMITS = Object.freeze({
  maxPitchDeg: 18,
  maxRollDeg: 22,
  maxYawRateDeg: 60,
  cruiseSpeed: 9,
  boostSpeed: 13,
  maxVerticalSpeed: 8.5,
  maxAltitude: 48
});

export function createHelicopterFlightState({ yaw = 0 } = {}) {
  return {
    yaw: wrapDegrees(yaw),
    pitch: 0,
    roll: 0,
    yawRate: 0,
    vx: 0,
    vy: 0,
    vz: 0
  };
}

export function stepHelicopterFlight(state = {}, input = {}, dt = 1 / 60) {
  const step = clamp(finite(dt), 0, 0.05);
  const pitchInput = clamp(finite(input.pitch), -1, 1);
  const rollInput = clamp(finite(input.roll), -1, 1);
  const yawInput = clamp(finite(input.yaw), -1, 1);
  const collective = clamp(finite(input.collective), -1, 1);
  const boost = input.boost === true;

  const pitch = blend(finite(state.pitch), -pitchInput * HELICOPTER_FLIGHT_LIMITS.maxPitchDeg, 8, step);
  const roll = blend(finite(state.roll), rollInput * HELICOPTER_FLIGHT_LIMITS.maxRollDeg, 8, step);
  const yawRate = blend(finite(state.yawRate), yawInput * HELICOPTER_FLIGHT_LIMITS.maxYawRateDeg, 7, step);
  const yaw = wrapDegrees(finite(state.yaw) + yawRate * step);

  const yawRad = yaw * Math.PI / 180;
  const forwardX = Math.sin(yawRad);
  const forwardZ = Math.cos(yawRad);
  const rightX = Math.cos(yawRad);
  const rightZ = -Math.sin(yawRad);
  const boostFactor = boost ? 1.35 : 1;
  const forwardAccel = Math.sin(-pitch * Math.PI / 180) * 18 * boostFactor;
  const rightAccel = Math.sin(roll * Math.PI / 180) * 16 * boostFactor;

  let vx = finite(state.vx) + (forwardX * forwardAccel + rightX * rightAccel) * step;
  let vz = finite(state.vz) + (forwardZ * forwardAccel + rightZ * rightAccel) * step;
  const drag = Math.exp(-0.8 * step);
  vx *= drag;
  vz *= drag;

  const horizontalSpeed = Math.hypot(vx, vz);
  const maxHorizontalSpeed = boost ? HELICOPTER_FLIGHT_LIMITS.boostSpeed : HELICOPTER_FLIGHT_LIMITS.cruiseSpeed;
  if (horizontalSpeed > maxHorizontalSpeed) {
    const scale = maxHorizontalSpeed / horizontalSpeed;
    vx *= scale;
    vz *= scale;
  }

  let vy = finite(state.vy) + collective * 13 * step;
  vy *= Math.exp(-1.7 * step);
  vy = clamp(vy, -HELICOPTER_FLIGHT_LIMITS.maxVerticalSpeed, HELICOPTER_FLIGHT_LIMITS.maxVerticalSpeed);

  return { yaw, pitch, roll, yawRate, vx, vy, vz };
}
