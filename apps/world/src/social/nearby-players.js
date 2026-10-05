import { worldToMeters } from "../world-scale.js";

export const NEARBY_ENTER_METERS = 15;
export const NEARBY_EXIT_METERS = 17;
export const NEARBY_MAX_ROWS = 8;

// Presence and poses are display hints. Only a server-verified account operation can change a
// friendship, block or accompany session.
export function selectNearbyPlayers({ remotes = [], position, selfUserId, zoneId, blocked = () => false,
  previouslyVisible = new Set(), limit = NEARBY_MAX_ROWS } = {}) {
  if (!position || !zoneId) return [];
  const byUser = new Map();
  for (const remote of remotes) {
    if (!remote?.userId || !remote.sessionId || remote.userId === selfUserId || blocked(remote.userId)
      || remote.placeZoneId !== zoneId || remote.presence !== "present" || !remote.pose) continue;
    const distance = worldToMeters(Math.hypot(remote.pose.x - position.x, remote.pose.z - position.z));
    if (!Number.isFinite(distance) || distance > (previouslyVisible.has(remote.userId) ? NEARBY_EXIT_METERS : NEARBY_ENTER_METERS)) continue;
    const entry = { userId: remote.userId, sessionId: remote.sessionId, displayName: remote.displayName,
      distance, proximity: distance <= 8 ? "가까이" : "조금 멀리" };
    if (!byUser.has(remote.userId) || distance < byUser.get(remote.userId).distance) byUser.set(remote.userId, entry);
  }
  return [...byUser.values()].sort((a, b) => a.distance - b.distance || a.userId.localeCompare(b.userId)).slice(0, limit);
}
