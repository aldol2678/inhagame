// INHA WORLD Duck Companion Follow P1 pure movement contract.
// This is presentation-only. Server Creature ownership/party state remains authoritative.

export const DUCK_FOLLOW_CONFIG = Object.freeze({
  trailDistance: 0.9,
  sideOffset: 0.28,
  startDistance: 1.15,
  stopDistance: 0.62,
  teleportDistance: 8,
  moveSpeed: 2.8,
  defaultHeadingX: -0.7,
  defaultHeadingZ: 0.7
});

export function isActiveDuckCompanion(snapshot) {
  const creature = snapshot?.ownedCreature ?? null;
  const activeId = snapshot?.party?.activeCreatureId ?? null;
  return snapshot?.state === 'OWNED'
    && creature?.creatureId
    && creature.currentFormId === 'creature.form.duck.base'
    && activeId === creature.creatureId;
}

function normalize(x, z, fallbackX, fallbackZ) {
  const length = Math.hypot(x, z);
  if (length > 1e-6) return { x: x / length, z: z / length };
  const fallbackLength = Math.hypot(fallbackX, fallbackZ) || 1;
  return { x: fallbackX / fallbackLength, z: fallbackZ / fallbackLength };
}

export function createDuckFollowState(player = { x: 0, z: 0 }) {
  const heading = normalize(
    DUCK_FOLLOW_CONFIG.defaultHeadingX,
    DUCK_FOLLOW_CONFIG.defaultHeadingZ,
    -1, 0
  );
  return {
    x: player.x - heading.x * DUCK_FOLLOW_CONFIG.trailDistance,
    z: player.z - heading.z * DUCK_FOLLOW_CONFIG.trailDistance,
    headingX: heading.x,
    headingZ: heading.z,
    lastPlayerX: player.x,
    lastPlayerZ: player.z,
    moving: false,
    teleported: false
  };
}

export function advanceDuckFollowState(state, {
  player,
  dt,
  config = DUCK_FOLLOW_CONFIG
}) {
  if (!state || !player) throw new TypeError('Duck follow state and player are required');
  dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1));

  const playerDx = player.x - state.lastPlayerX;
  const playerDz = player.z - state.lastPlayerZ;
  const heading = normalize(playerDx, playerDz, state.headingX, state.headingZ);
  if (Math.hypot(playerDx, playerDz) > 0.015) {
    state.headingX = heading.x;
    state.headingZ = heading.z;
  }

  const sideX = -state.headingZ;
  const sideZ = state.headingX;
  const targetX = player.x - state.headingX * config.trailDistance + sideX * config.sideOffset;
  const targetZ = player.z - state.headingZ * config.trailDistance + sideZ * config.sideOffset;

  let dx = targetX - state.x;
  let dz = targetZ - state.z;
  let distance = Math.hypot(dx, dz);
  state.teleported = false;

  if (Math.hypot(player.x - state.x, player.z - state.z) > config.teleportDistance) {
    state.x = targetX;
    state.z = targetZ;
    state.moving = false;
    state.teleported = true;
  } else {
    const shouldMove = state.moving ? distance > config.stopDistance : distance > config.startDistance;
    if (shouldMove && distance > 1e-6 && dt > 0) {
      const step = Math.min(distance, config.moveSpeed * dt);
      state.x += dx / distance * step;
      state.z += dz / distance * step;
      state.moving = distance - step > config.stopDistance;
    } else {
      state.moving = false;
    }
  }

  state.lastPlayerX = player.x;
  state.lastPlayerZ = player.z;
  return state;
}
