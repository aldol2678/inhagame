import { LOGICAL_WIDTH, tuning } from '../game/config/tuning';

export function projectedLandingX(x: number, y: number, vx: number, vy: number): number | null {
  if (![x, y, vx, vy].every(Number.isFinite) || vy <= 0 || y >= 500) return null;
  const left = tuning.ball.radius;
  const width = LOGICAL_WIDTH - 2 * left;
  const travel = (500 - y) / vy;
  const unfolded = x - left + vx * travel;
  const period = width * 2;
  const wrapped = ((unfolded % period) + period) % period;
  return left + (wrapped <= width ? wrapped : period - wrapped);
}
