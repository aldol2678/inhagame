// INHA WORLD Mini-map M0 pure model.
// Owns only coordinate math, viewport profiles and HUD visibility state.
// No DOM, PlayCanvas, network, database or INHA content imports beyond the shared world scale.

import { metersToWorld } from "../world-scale.js";

export const MINIMAP_STATE = Object.freeze({
  UNAVAILABLE: "UNAVAILABLE",
  HIDDEN: "HIDDEN",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED"
});

const profile = (id, sizePx, radiusMeters) => Object.freeze({
  id,
  sizePx,
  radiusMeters,
  radiusWorld: metersToWorld(radiusMeters)
});

export const MINIMAP_PROFILE = Object.freeze({
  COMPACT: profile("COMPACT", 96, 90),
  MOBILE: profile("MOBILE", 112, 90),
  DESKTOP: profile("DESKTOP", 156, 90)
});

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function point2(value, label) {
  if (!value || typeof value !== "object") throw new TypeError(`${label} must be an object`);
  return { x: finite(value.x, `${label}.x`), z: finite(value.z, `${label}.z`) };
}

export function worldToMapUv(point, bounds) {
  const p = point2(point, "point");
  if (!bounds || typeof bounds !== "object") throw new TypeError("bounds must be an object");
  const minX = finite(bounds.minX, "bounds.minX");
  const maxX = finite(bounds.maxX, "bounds.maxX");
  const minZ = finite(bounds.minZ, "bounds.minZ");
  const maxZ = finite(bounds.maxZ, "bounds.maxZ");
  if (maxX <= minX || maxZ <= minZ) throw new TypeError("bounds must have positive width and depth");
  return Object.freeze({
    u: (p.x - minX) / (maxX - minX),
    v: 1 - (p.z - minZ) / (maxZ - minZ)
  });
}

export function projectHeadingUp(target, player, yaw, pxPerWorldUnit = 1) {
  const t = point2(target, "target");
  const p = point2(player, "player");
  const angle = finite(yaw, "yaw");
  const scale = finite(pxPerWorldUnit, "pxPerWorldUnit");
  if (scale <= 0) throw new TypeError("pxPerWorldUnit must be greater than zero");

  const dx = t.x - p.x;
  const dz = t.z - p.z;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const right = dx * cos + dz * sin;
  const forward = -dx * sin + dz * cos;

  return Object.freeze({
    right,
    forward,
    x: right * scale,
    y: forward === 0 ? 0 : -forward * scale,
    distanceWorld: Math.hypot(dx, dz)
  });
}

export function resolveMiniMapState({
  ready = false,
  minimapAvailable = true,
  lobbyActive = false,
  lobbyTransitionActive = false,
  insideRoom = false,
  blockingOverlayOpen = false
} = {}) {
  if (!minimapAvailable) return MINIMAP_STATE.UNAVAILABLE;
  if (!ready || lobbyActive || lobbyTransitionActive || insideRoom) return MINIMAP_STATE.HIDDEN;
  if (blockingOverlayOpen) return MINIMAP_STATE.SUSPENDED;
  return MINIMAP_STATE.ACTIVE;
}

export function profileForViewport({ width, height, coarsePointer = false } = {}) {
  const w = finite(width, "width");
  const h = finite(height, "height");
  if (w <= 0 || h <= 0) throw new TypeError("viewport dimensions must be greater than zero");
  if (w <= 380 || h <= 640) return MINIMAP_PROFILE.COMPACT;
  if (coarsePointer || w < 700) return MINIMAP_PROFILE.MOBILE;
  return MINIMAP_PROFILE.DESKTOP;
}

