// INHA WORLD M3 Guidance State.
// Owns the navigation destination and live guidance (route progress, bearing, distance, arrival,
// indoor pause/resume). Independent from quest/tour objectives. No DOM, PlayCanvas or network.

import { worldToMeters } from "../world-scale.js";
import { polylineLength } from "./route-solver.js";

export const NAV_STATUS = Object.freeze({
  IDLE: "IDLE",
  GUIDING: "GUIDING",
  PAUSED: "PAUSED",
  ARRIVED: "ARRIVED"
});

export const NAV_DESTINATION_SOURCE = Object.freeze({
  POI: "POI",
  MAP_POINT: "MAP_POINT"
});

export const NAV_DEFAULTS = Object.freeze({
  arrivalRadius: 4.5,
  // Leaving the route by more than this (world units) for offRouteGraceMs triggers a reroute.
  offRouteDistance: 7,
  offRouteGraceMs: 900,
  rerouteCooldownMs: 1500,
  // How many upcoming route segments progress may skip ahead in one frame.
  progressLookahead: 6,
  arrivedHoldMs: 4000
});

// World units → short HUD distance ("85m", "1.2km") using the shared world scale.
export function formatGuidanceDistance(worldUnits) {
  if (!Number.isFinite(worldUnits)) return "";
  const meters = Math.max(0, worldToMeters(worldUnits));
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
  if (meters >= 100) return `${Math.round(meters / 10) * 10}m`;
  return `${Math.max(1, Math.round(meters))}m`;
}

const finitePoint = value => Boolean(value) && Number.isFinite(value.x) && Number.isFinite(value.z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function projectOnSegment(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq <= 1e-12 ? 1 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq));
  const x = a.x + dx * t, z = a.z + dz * t;
  return { t, x, z, distance: Math.hypot(p.x - x, p.z - z) };
}

// Same heading-up convention as the Mini-map: 0 = straight ahead of the camera, +π/2 = right.
export function relativeBearing(from, to, yaw) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const right = dx * cos + dz * sin;
  const forward = -dx * sin + dz * cos;
  return Math.atan2(right, forward);
}

export function createNavigationState({
  solver,
  guidanceSpaceId = "campus",
  clock = { now: () => Date.now() },
  ...options
} = {}) {
  if (!solver?.solve) throw new TypeError("Navigation state requires a route solver");
  const config = Object.freeze({ ...NAV_DEFAULTS, ...options });
  const listeners = new Set();
  const errors = [];

  let destination = null;
  let status = NAV_STATUS.IDLE;
  let route = null;
  let segmentIndex = 0;
  let routeVersion = 0;
  let rerouteCount = 0;
  let lastRouteAt = -Infinity;
  let offRouteSince = null;
  let arrivedAt = null;
  let pauseReason = null;
  let currentSpaceId = guidanceSpaceId;
  let lastPosition = null;
  let lastYaw = 0;
  let snapshot = null;

  const record = (where, error) => {
    errors.push({ where, message: String(error?.message ?? error), at: clock.now() });
    if (errors.length > 20) errors.shift();
  };

  function emit(event) {
    snapshot = null;
    const current = getSnapshot();
    for (const listener of listeners) {
      try { listener(current, event); } catch (error) { record("listener", error); }
    }
  }

  function computeRoute(position, reason) {
    if (!destination || !finitePoint(position)) return false;
    try {
      route = solver.solve(position, destination.approach);
    } catch (error) {
      record("solve", error);
      route = Object.freeze({ ok: true, mode: "DIRECT", reason: "SOLVER_ERROR",
        points: Object.freeze([{ x: position.x, z: position.z }, { ...destination.approach }]),
        distance: flat(position, destination.approach) });
    }
    if (route?.ok === false) {
      route = null;
      status = NAV_STATUS.PAUSED;
      pauseReason = "ROUTE_UNAVAILABLE";
      lastRouteAt = clock.now();
      return false;
    }
    pauseReason = null;
    segmentIndex = 0;
    routeVersion += 1;
    lastRouteAt = clock.now();
    offRouteSince = null;
    if (reason === "reroute") rerouteCount += 1;
    return true;
  }

  function normalizeDestination(target) {
    if (!target || !finitePoint(target)) throw new TypeError("Navigation destination requires finite x/z");
    const approach = finitePoint(target.approach) ? target.approach : target;
    const source = Object.values(NAV_DESTINATION_SOURCE).includes(target.source) ? target.source : NAV_DESTINATION_SOURCE.POI;
    return Object.freeze({
      id: String(target.id ?? `${source}.${target.x.toFixed(1)},${target.z.toFixed(1)}`),
      title: String(target.title ?? "목적지"),
      source,
      poiId: target.poiId ?? null,
      mapSourceId: target.mapSourceId ?? guidanceSpaceId,
      x: target.x,
      z: target.z,
      approach: Object.freeze({ x: approach.x, z: approach.z }),
      arrivalRadius: Number.isFinite(target.arrivalRadius) && target.arrivalRadius > 0 ? target.arrivalRadius : config.arrivalRadius
    });
  }

  function setDestination(target, { position = lastPosition, spaceId = guidanceSpaceId } = {}) {
    currentSpaceId = spaceId;
    const next = normalizeDestination(target);
    const changed = destination?.id !== next.id;
    destination = next;
    pauseReason = null;
    arrivedAt = null;
    rerouteCount = 0;
    route = null;
    if (spaceId !== destination.mapSourceId || !finitePoint(position)) {
      status = NAV_STATUS.PAUSED;
      pauseReason = "SPACE_MISMATCH";
    } else {
      status = NAV_STATUS.GUIDING;
      lastPosition = { x: position.x, z: position.z };
      computeRoute(position, changed ? "set" : "reset");
    }
    emit(changed ? "destination" : "destination-reset");
    return getSnapshot();
  }

  function clearDestination(reason = "cancel") {
    if (!destination && status === NAV_STATUS.IDLE) return false;
    destination = null;
    route = null;
    status = NAV_STATUS.IDLE;
    pauseReason = null;
    arrivedAt = null;
    offRouteSince = null;
    segmentIndex = 0;
    emit(reason);
    return true;
  }

  // Advance along the route: nearest projection among the next few segments, never backwards.
  function progress(position) {
    const points = route.points;
    let bestIndex = segmentIndex;
    let best = null;
    const last = Math.min(points.length - 2, segmentIndex + config.progressLookahead);
    for (let i = segmentIndex; i <= last; i += 1) {
      const hit = projectOnSegment(position, points[i], points[i + 1]);
      if (!best || hit.distance < best.distance - 1e-6 || (Math.abs(hit.distance - best.distance) <= 1e-6 && i > bestIndex)) {
        best = hit;
        bestIndex = i;
      }
    }
    segmentIndex = bestIndex;
    // Stepping onto the far end of a segment hands progress to the next one.
    if (best.t >= 0.999 && segmentIndex < points.length - 2) {
      segmentIndex += 1;
      best = projectOnSegment(position, points[segmentIndex], points[segmentIndex + 1]);
    }
    return best;
  }

  function update({ position, yaw = lastYaw, spaceId = guidanceSpaceId } = {}) {
    if (currentSpaceId !== spaceId) snapshot = null;
    currentSpaceId = spaceId;
    if (Number.isFinite(yaw)) lastYaw = yaw;
    const inGuidanceSpace = spaceId === (destination?.mapSourceId ?? guidanceSpaceId);
    if (inGuidanceSpace && finitePoint(position)) lastPosition = { x: position.x, z: position.z };

    if (status === NAV_STATUS.ARRIVED) {
      if (clock.now() - arrivedAt >= config.arrivedHoldMs) clearDestination("arrived-dismiss");
      else snapshot = null;
      return getSnapshot();
    }
    if (!destination) return getSnapshot();

    if (!inGuidanceSpace || !finitePoint(position)) {
      if (status !== NAV_STATUS.PAUSED || pauseReason !== "SPACE_MISMATCH") {
        // Keep the destination; drop the stale route so it is rebuilt from the return point.
        status = NAV_STATUS.PAUSED;
        pauseReason = "SPACE_MISMATCH";
        route = null;
        offRouteSince = null;
        emit("pause");
      }
      return getSnapshot();
    }

    if (status === NAV_STATUS.PAUSED) {
      if (pauseReason === "ROUTE_UNAVAILABLE" && clock.now() - lastRouteAt < config.rerouteCooldownMs) return getSnapshot();
      status = NAV_STATUS.GUIDING;
      if (!computeRoute(position, "resume")) { snapshot = null; return getSnapshot(); }
      emit("resume");
    }

    if (flat(position, destination.approach) <= destination.arrivalRadius) {
      status = NAV_STATUS.ARRIVED;
      arrivedAt = clock.now();
      route = null;
      emit("arrived");
      return getSnapshot();
    }

    if (!route && !computeRoute(position, "set")) { snapshot = null; return getSnapshot(); }
    const hit = progress(position);
    // A region may require safe rejoining even within the generic off-route
    // tolerance. Never expose a straight current-position -> retained-waypoint
    // segment through a building while waiting for the distance/grace threshold.
    if (solver.segmentSafe && !solver.segmentSafe(position, route.points[segmentIndex + 1])) {
      computeRoute(position, "reroute");
      emit("reroute");
      return getSnapshot();
    }
    if (hit.distance > config.offRouteDistance) {
      offRouteSince ??= clock.now();
      const now = clock.now();
      if (now - offRouteSince >= config.offRouteGraceMs && now - lastRouteAt >= config.rerouteCooldownMs) {
        computeRoute(position, "reroute");
        emit("reroute");
        return getSnapshot();
      }
    } else {
      offRouteSince = null;
    }
    snapshot = null;
    return getSnapshot();
  }

  function remainingPoints() {
    if (!route || !lastPosition) return [];
    const points = route.points;
    const out = [{ x: lastPosition.x, z: lastPosition.z }];
    for (let i = segmentIndex + 1; i < points.length; i += 1) out.push(points[i]);
    return out;
  }

  function getSnapshot() {
    if (snapshot) return snapshot;
    const remaining = status === NAV_STATUS.GUIDING ? remainingPoints() : [];
    const next = remaining.find((p, i) => i > 0 && (!lastPosition || flat(p, lastPosition) > 1.2) &&
      (!solver.segmentSafe || solver.segmentSafe(lastPosition, p))) ?? remaining[1] ?? null;
    const directDistance = destination && lastPosition ? flat(lastPosition, destination.approach) : null;
    snapshot = Object.freeze({
      status,
      pauseReason,
      currentSpaceId,
      active: status !== NAV_STATUS.IDLE,
      destination,
      routeVersion,
      routeMode: route?.mode ?? null,
      routePoints: Object.freeze(remaining.map(p => Object.freeze({ x: p.x, z: p.z }))),
      waypointIndex: route ? Math.min(segmentIndex + 1, route.points.length - 1) : 0,
      waypointCount: route ? route.points.length - 1 : 0,
      nextWaypoint: next ? Object.freeze({ x: next.x, z: next.z }) : null,
      remainingDistance: remaining.length > 1 ? polylineLength(remaining) : directDistance,
      directDistance,
      // Walk direction (next waypoint) and destination direction, both camera-relative.
      guidanceBearing: next && lastPosition ? relativeBearing(lastPosition, next, lastYaw) : null,
      destinationBearing: destination && lastPosition ? relativeBearing(lastPosition, destination, lastYaw) : null,
      offRoute: offRouteSince != null,
      rerouteCount
    });
    return snapshot;
  }

  return Object.freeze({
    setDestination,
    clearDestination,
    update,
    getSnapshot,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get destination() { return destination; },
    get status() { return status; },
    config,
    errors: () => errors.slice()
  });
}

// Shared wording for the HUD and full map: a failed route is not an indoor pause.
export function navigationPauseLabel(snapshot) {
  if (snapshot?.pauseReason === "ROUTE_UNAVAILABLE") return "안전한 경로를 찾지 못했어요";
  if (snapshot?.destination?.mapSourceId === "BIRYONG_REALM") return "비룡권으로 돌아가면 안내 재개";
  if (snapshot?.currentSpaceId === "BIRYONG_REALM") return "캠퍼스로 돌아가면 안내 재개";
  return "실외로 나가면 안내 재개";
}
