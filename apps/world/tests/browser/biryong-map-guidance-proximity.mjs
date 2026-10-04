// Browser-safe pure QA selector. It observes live actor snapshots and production
// geometry; it does not move the player/NPCs, pause them or advance their clock.
export function findBiryongNpcApproach({ npcId, actors, target, walkable, segmentSafe }) {
  const actor = actors.find(item => item.id === npcId);
  if (!actor?.visible || !['MOVING', 'ACTING'].includes(actor.phase) || !walkable(actor.position)) return null;
  for (const radius of [.8, 1.2, 1.9]) {
    for (const [dx, dz] of [[0,-1],[1,0],[-1,0],[0,1]]) {
      const player = { x: actor.position.x + dx * radius, z: actor.position.z + dz * radius };
      if (!walkable(player) || !segmentSafe(player, actor.position) || Math.hypot(player.x-target.x,player.z-target.z) < 1.65) continue;
      let nearest = null;
      for (const candidate of actors) {
        if (!candidate.visible) continue;
        const distance = Math.hypot(player.x-candidate.position.x, player.z-candidate.position.z);
        if (distance > 2.2 || (nearest && distance >= nearest.distance)) continue;
        nearest = { ...candidate, distance };
      }
      if (nearest?.id === npcId) return { player, actor, nearest, radius };
    }
  }
  return null;
}
