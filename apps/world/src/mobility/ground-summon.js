// Renderer-free safe-ground search. Registry owns clearance/policy; callers own space/access.
export function findGroundSummonPose({ definition, origin, yawDeg = 0, spaceId,
  mounted = false, grounded = false, allowMount = false, groundHeight, overWater,
  canOccupyAt, bounds, groundY = 1.15 } = {}) {
  if (!definition?.summonEnabled || definition.spawnDomain !== "GROUND" ||
      !["NEAR_PLAYER", "CLEAR_AREA"].includes(definition.summonPolicy) ||
      !["NEAR_PLAYER_SAFE_GROUND", "NEAR_PLAYER_SAFE_AREA"].includes(definition.spawnAnchorPolicy) ||
      spaceId !== "campus" || !allowMount || mounted || !grounded ||
      !origin || ![origin.x, origin.y, origin.z, yawDeg, groundY].every(Number.isFinite) ||
      !bounds || ![bounds.minX,bounds.maxX,bounds.minZ,bounds.maxZ].every(Number.isFinite) ||
      typeof groundHeight !== "function" || typeof overWater !== "function" ||
      typeof canOccupyAt !== "function") return null;
  const { radius, height } = definition.summonClearance ?? {};
  if (!(radius > 0) || !(height > 0) || !Number.isFinite(radius + height)) return null;
  if (overWater(origin.x, origin.z) || Math.abs(origin.y - groundY - groundHeight(origin.x, origin.z)) > 0.15) return null;
  const shape = { radius, footOffset: groundY, headOffset: Math.max(0, height - groundY) };
  for (const distance of [radius + 1.2, radius + 2.2, radius + 3.2]) {
    for (const offset of [0,45,-45,90,-90,135,-135,180]) {
      const a = (yawDeg + offset) * Math.PI / 180;
      const x = origin.x + Math.sin(a) * distance, z = origin.z + Math.cos(a) * distance;
      if (x-radius < bounds.minX || x+radius > bounds.maxX || z-radius < bounds.minZ || z+radius > bounds.maxZ) continue;
      const ground = groundHeight(x,z);
      if (!Number.isFinite(ground) || overWater(x,z)) continue;
      let valid = true;
      // Check footprint, not just centre: shore edges and uneven ground refuse safely.
      for (let i=0;i<16;i++) {
        const r = i * Math.PI / 8;
        const sx=x+Math.sin(r)*radius, sz=z+Math.cos(r)*radius;
        const h=groundHeight(sx,sz);
        if (!Number.isFinite(h) || Math.abs(h-ground) > 0.12 || overWater(sx,sz)) { valid=false; break; }
      }
      if (!valid || !canOccupyAt({x,y:ground+groundY,z},shape)) continue;
      return Object.freeze({x,y:ground,z,yaw:yawDeg});
    }
  }
  return null;
}
