import { POND_RING, edgeFrame } from './roadview-layout.js';
// Canonical east-bank frame, not coordinates from the standalone demonstration.
// The dedicated model bench is on the outside edge; no public seat is claimed.
export function createInkyungDailyLayout() {
  const frame = edgeFrame(POND_RING, 1);
  const inward = frame.at(11, 6.2), seat = frame.at(11, 7.2);
  return {
    route: [[5.5, 5], [10, 5], [10, 5.65], [5.5, 5.65]].map(([u, out]) => frame.at(u, out)),
    call: frame.at(4.2, 7.1),
    seat: { ...seat, yaw: Math.atan2(inward.x - seat.x, inward.z - seat.z) * 180 / Math.PI }
  };
}
