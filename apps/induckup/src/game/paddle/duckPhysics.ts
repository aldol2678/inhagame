import { tuning } from '../config/tuning';

export const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function softSeparation(distance: number, minDistance: number, strength: number): number {
  if (!Number.isFinite(distance) || distance >= minDistance) return 0;
  return (1 - Math.max(0, distance) / minDistance) * strength;
}

export function clampDuckAngle(angle: number): number {
  return clamp(angle, -tuning.paddle.maxAngle, tuning.paddle.maxAngle);
}

export interface ReflectionInput {
  contactOffset: number;
  angle: number;
  duckVelocityX: number;
  incomingX: number;
  incomingY: number;
  head: boolean;
}

/** Stable upper surface: offsets are local to the torso, not raw compound normals. */
export function reflectFromDuck(input: ReflectionInput): { x: number; y: number } {
  const speed = clamp(Math.hypot(input.incomingX, input.incomingY) || tuning.ball.speed,
    tuning.ball.minSpeed, tuning.ball.maxSpeed);
  const offset = clamp(input.contactOffset, -1, 1);
  const lateral = offset * (input.head ? 0.71 : 0.6)
    + clamp(input.angle, -tuning.paddle.maxAngle, tuning.paddle.maxAngle) * 0.6
    + clamp(input.duckVelocityX, -13, 13) * 0.018
    + clamp(input.incomingX / speed, -1, 1) * 0.1;
  const minVertical = Math.max(tuning.ball.minVerticalSpeedRatio, 0.53);
  const normalizedX = clamp(lateral, -Math.sqrt(1 - minVertical ** 2), Math.sqrt(1 - minVertical ** 2));
  return { x: normalizedX * speed, y: -Math.sqrt(1 - normalizedX ** 2) * speed };
}

/** Add a predictable sideways bias while retaining the common upward reflection floor. */
export type ElasticMode = 'standard' | 'strong';
export function reflectElasticFromDuck(input: ReflectionInput, mode: ElasticMode = 'standard'): { x: number; y: number } {
  const base = reflectFromDuck(input);
  const speed = Math.hypot(base.x, base.y);
  const minVertical = Math.max(tuning.ball.minVerticalSpeedRatio, 0.53);
  const lateral = base.x / speed + (mode === 'strong' ? 0.16 : 0.07) * clamp(input.contactOffset, -1, 1)
    + (mode === 'strong' ? 0.07 : 0.04) * clamp(input.duckVelocityX / 13, -1, 1);
  const x = clamp(lateral, -Math.sqrt(1 - minVertical ** 2), Math.sqrt(1 - minVertical ** 2));
  return { x: x * speed, y: -Math.sqrt(1 - x * x) * speed };
}
