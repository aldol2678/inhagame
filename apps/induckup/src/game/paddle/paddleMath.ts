import type { Vec2 } from '../core/types';

export function computeFlexPx(points: Vec2[]): number {
  if (points.length < 3) return 0;
  const first = points[0];
  const last = points[points.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return 0;

  let max = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i];
    const cross = Math.abs(dx * (first.y - point.y) - (first.x - point.x) * dy);
    max = Math.max(max, cross / length);
  }
  return max;
}
