// INHA WORLD Mini-map M0 runtime orchestrator.
// Owns lifecycle/state orchestration only. Coordinate math lives in minimap-model,
// Campus data ownership lives in minimap-data, and DOM writes live in minimap-renderer.

import {
  MINIMAP_PROFILE,
  MINIMAP_STATE,
  profileForViewport,
  projectHeadingUp,
  resolveMiniMapState
} from "./minimap-model.js";

export const MINIMAP_VIEWBOX = Object.freeze({
  size: 112,
  centerX: 56,
  centerY: 56,
  usableRadius: 46,
  maxVisiblePois: 5,
  objectiveEdgeRadius: 39,
  // M3 navigation destination clamps slightly inside the quest objective ring.
  navigationEdgeRadius: 35,
  // Route points beyond this many map radii are cut; the SVG clip hides the rest.
  routeReachRadii: 2.5,
  maxSocialMarkers: 3
});

const BLOCKING_OVERLAY_KEYS = Object.freeze([
  "hudMenu",
  "keyboardHelp",
  "friends",
  "playerCard",
  "guestbook",
  "npcConversation",
  "profile",
  "settings",
  "fullMap",
  "inventory",
  "questJournal"
]);

const finitePoint = value => value && Number.isFinite(value.x) && Number.isFinite(value.z);

export function hasBlockingMiniMapOverlay(state = {}) {
  if (state?.blocking === true) return true;
  return BLOCKING_OVERLAY_KEYS.some(key => state?.[key] === true);
}

export function createMiniMapController({
  player,
  orbit,
  getReady = () => true,
  getLobbyState = () => ({ active: false, transitioning: false }),
  getRoomState = () => ({ insideRoom: false }),
  getOverlayState = () => ({}),
  getObjectiveMarker = () => null,
  getSocialMarkers = () => [],
  // M3: { destination: {x,z,title}, routePoints: [{x,z}], routeVersion, status } or null.
  getNavigation = () => null,
  dataSource,
  renderer,
  documentLike = globalThis.document,
  windowTarget = globalThis.window,
  coarsePointer = null,
  clock = { now: () => Date.now() }
} = {}) {
  if (!player?.getLocalPosition) throw new TypeError("Mini-map controller requires player.getLocalPosition");
  if (!orbit) throw new TypeError("Mini-map controller requires orbit");
  if (!dataSource?.geometry || !dataSource?.refreshState) throw new TypeError("Mini-map controller requires dataSource");
  if (!renderer?.mountGeometry || !renderer?.renderFrame) throw new TypeError("Mini-map controller requires renderer");

  const errors = [];
  let available = true;
  let destroyed = false;
  let currentDataSource = dataSource;
  let mapSourceId = "campus";
  let indoorMapActive = false;
  let mapRadiusWorld = null;
  let currentState = MINIMAP_STATE.HIDDEN;
  let currentProfile = MINIMAP_PROFILE.MOBILE;
  let cachedPois = [];
  let forceSync = true;
  let geometryMounted = false;
  let visiblePoiCount = 0;
  let lastPlayer = null;
  let lastYaw = null;
  let lastObjectiveKey = null;
  let lastSocialKey = null;
  let objectiveActive = false;
  let visibleSocialCount = 0;
  let lastNavigationKey = null;
  let navigationActive = false;
  let routePointCount = 0;

  const record = (where, error) => {
    errors.push({ where, message: String(error?.message ?? error), at: clock.now() });
    if (errors.length > 20) errors.shift();
  };

  const viewport = () => {
    const width = Number(windowTarget?.innerWidth ?? 112);
    const height = Number(windowTarget?.innerHeight ?? 112);
    const coarse = typeof coarsePointer === "boolean"
      ? coarsePointer
      : Boolean(windowTarget?.matchMedia?.("(pointer: coarse)")?.matches);
    return { width, height, coarsePointer: coarse };
  };

  function refreshLayout() {
    if (destroyed) return currentProfile;
    try {
      currentProfile = profileForViewport(viewport());
      forceSync = true;
      return currentProfile;
    } catch (error) {
      record("layout", error);
      available = false;
      currentState = MINIMAP_STATE.UNAVAILABLE;
      try { renderer.setState?.(currentState); } catch { /* view failure already isolated */ }
      return currentProfile;
    }
  }

  function refreshPois(context = null) {
    if (destroyed || !available) return cachedPois;
    try {
      cachedPois = currentDataSource.refreshState(context);
      if (!Array.isArray(cachedPois)) throw new TypeError("Mini-map dataSource.refreshState must return an array");
      forceSync = true;
    } catch (error) {
      record("pois", error);
      cachedPois = [];
    }
    return cachedPois;
  }

  function mount() {
    if (destroyed || geometryMounted || !available) return geometryMounted;
    try {
      renderer.mountGeometry(currentDataSource.geometry());
      geometryMounted = true;
      refreshPois();
      refreshLayout();
      return true;
    } catch (error) {
      record("mount", error);
      available = false;
      currentState = MINIMAP_STATE.UNAVAILABLE;
      try { renderer.setState?.(currentState); } catch { /* keep world alive */ }
      return false;
    }
  }

  const readState = () => {
    const lobby = getLobbyState?.() ?? {};
    const room = getRoomState?.() ?? {};
    const overlay = getOverlayState?.() ?? {};
    return resolveMiniMapState({
      ready: getReady?.() === true,
      minimapAvailable: available,
      lobbyActive: lobby.active === true,
      lobbyTransitionActive: lobby.transitioning === true,
      insideRoom: room.insideRoom === true && !indoorMapActive,
      blockingOverlayOpen: hasBlockingMiniMapOverlay(overlay)
    });
  };

  const activeRadiusWorld = () => Number.isFinite(mapRadiusWorld) && mapRadiusWorld > 0
    ? mapRadiusWorld : currentProfile.radiusWorld;

  function framePois(playerPosition, yaw, scale) {
    const visible = [];
    for (const poi of cachedPois) {
      if (poi?.visible === false || !Number.isFinite(poi?.x) || !Number.isFinite(poi?.z)) continue;
      const projected = projectHeadingUp(poi, playerPosition, yaw, scale);
      if (projected.distanceWorld > activeRadiusWorld()) continue;
      visible.push({
        poiId: poi.poiId,
        iconKey: poi.iconKey,
        presentation: poi.presentation,
        screenX: MINIMAP_VIEWBOX.centerX + projected.x,
        screenY: MINIMAP_VIEWBOX.centerY + projected.y,
        visible: true,
        priority: poi.priority,
        distanceWorld: projected.distanceWorld
      });
    }

    visible.sort((a, b) =>
      (Number(b.priority) || 0) - (Number(a.priority) || 0) ||
      a.distanceWorld - b.distanceWorld ||
      String(a.poiId).localeCompare(String(b.poiId))
    );
    return visible.slice(0, MINIMAP_VIEWBOX.maxVisiblePois);
  }

  function frameObjective(marker, playerPosition, yaw, scale) {
    if (!marker || !finitePoint(marker)) return null;
    const projected = projectHeadingUp(marker, playerPosition, yaw, scale);
    const inside = projected.distanceWorld <= activeRadiusWorld();
    let x = projected.x, y = projected.y;
    if (!inside) {
      const length = Math.hypot(x, y);
      if (length <= 1e-9) return null;
      const factor = MINIMAP_VIEWBOX.objectiveEdgeRadius / length;
      x *= factor;
      y *= factor;
    }
    return {
      objectiveId: marker.objectiveId ?? "objective.active",
      kind: marker.kind ?? "destination",
      label: marker.label ?? null,
      screenX: MINIMAP_VIEWBOX.centerX + x,
      screenY: MINIMAP_VIEWBOX.centerY + y,
      edge: !inside,
      distanceWorld: projected.distanceWorld
    };
  }

  function objectiveKey(marker) {
    if (!marker || !finitePoint(marker)) return "none";
    return [marker.objectiveId ?? "objective.active", marker.kind ?? "destination", marker.x, marker.z, marker.label ?? ""].join("|");
  }

  function navigationKey(navigation) {
    if (!navigation?.destination || !finitePoint(navigation.destination)) return "none";
    return [
      navigation.destination.id ?? "", navigation.status ?? "", navigation.routeVersion ?? 0,
      navigation.routePoints?.length ?? 0, navigation.destination.x, navigation.destination.z
    ].join("|");
  }

  // Heading-up destination marker; clamps to the ring edge when outside the map radius.
  function frameNavigation(navigation, playerPosition, yaw, scale) {
    const destination = navigation?.destination;
    if (!destination || !finitePoint(destination)) return null;
    const projected = projectHeadingUp(destination, playerPosition, yaw, scale);
    const inside = projected.distanceWorld <= activeRadiusWorld();
    let x = projected.x, y = projected.y;
    if (!inside) {
      const length = Math.hypot(x, y);
      if (length <= 1e-9) return null;
      const factor = MINIMAP_VIEWBOX.navigationEdgeRadius / length;
      x *= factor;
      y *= factor;
    }
    return {
      navigationId: destination.id ?? "navigation.destination",
      label: destination.title ?? null,
      status: navigation.status ?? null,
      screenX: MINIMAP_VIEWBOX.centerX + x,
      screenY: MINIMAP_VIEWBOX.centerY + y,
      // Screen-space direction from the player marker, 0° = up, clockwise.
      angleDeg: Math.atan2(x, -y) * 180 / Math.PI,
      edge: !inside,
      distanceWorld: projected.distanceWorld
    };
  }

  function frameRoute(navigation, playerPosition, yaw, scale) {
    const points = navigation?.routePoints;
    if (!Array.isArray(points) || points.length < 2) return null;
    const reach = activeRadiusWorld() * MINIMAP_VIEWBOX.routeReachRadii;
    const out = [];
    for (const point of points) {
      if (!finitePoint(point)) continue;
      const projected = projectHeadingUp(point, playerPosition, yaw, scale);
      out.push({ x: MINIMAP_VIEWBOX.centerX + projected.x, y: MINIMAP_VIEWBOX.centerY + projected.y });
      // Keep the first point past the reach so the line still leaves the map in the right direction.
      if (projected.distanceWorld > reach && out.length > 1) break;
    }
    return out.length >= 2 ? out : null;
  }

  function socialKey(markers) {
    if (!Array.isArray(markers) || !markers.length) return "none";
    return markers.map(marker => finitePoint(marker)
      ? [marker.markerId ?? "", marker.kind ?? "player", marker.x, marker.z].join(":")
      : "invalid").join("|");
  }

  function frameSocial(markers, playerPosition, yaw, scale) {
    if (!Array.isArray(markers)) return [];
    const projected = [];
    for (const marker of markers) {
      if (!marker?.markerId || !finitePoint(marker)) continue;
      const point = projectHeadingUp(marker, playerPosition, yaw, scale);
      if (point.distanceWorld > activeRadiusWorld()) continue;
      projected.push({
        markerId: marker.markerId,
        kind: marker.kind === "friend" ? "friend" : "player",
        screenX: MINIMAP_VIEWBOX.centerX + point.x,
        screenY: MINIMAP_VIEWBOX.centerY + point.y,
        distanceWorld: point.distanceWorld,
        visible: true
      });
    }
    projected.sort((a, b) =>
      (a.kind === "friend" ? -1 : 0) - (b.kind === "friend" ? -1 : 0) ||
      a.distanceWorld - b.distanceWorld ||
      a.markerId.localeCompare(b.markerId)
    );
    return projected.slice(0, MINIMAP_VIEWBOX.maxSocialMarkers);
  }

  function frameIndoorGeometry(playerPosition, yaw, scale) {
    if (!indoorMapActive) return null;
    const geometry = currentDataSource.geometry();
    if (!Array.isArray(geometry)) return [];
    return geometry.map(item => ({
      id: item.id,
      kind: item.kind,
      style: item.style ?? null,
      rings: item.rings.map(ring => ring.map(point => {
        const projected = projectHeadingUp(point, playerPosition, yaw, scale);
        return {
          x: MINIMAP_VIEWBOX.centerX + projected.x,
          y: MINIMAP_VIEWBOX.centerY + projected.y
        };
      }))
    }));
  }

  function update({ force = false } = {}) {
    if (destroyed) return false;
    if (!geometryMounted && !mount()) return false;

    if (documentLike?.hidden === true) {
      forceSync = true;
      return false;
    }

    try {
      currentState = readState();
      if (currentState !== MINIMAP_STATE.ACTIVE) {
        visiblePoiCount = 0;
        objectiveActive = false;
        visibleSocialCount = 0;
        navigationActive = false;
        routePointCount = 0;
        // A hidden/suspended frame must force the next ACTIVE frame to repaint even when
        // the player and camera stayed perfectly still while a panel was open.
        forceSync = true;
        renderer.renderFrame({ state: currentState, profile: currentProfile, pois: [] });
        return true;
      }

      const position = player.getLocalPosition();
      if (!finitePoint(position)) throw new TypeError("Mini-map player position must be finite");
      if (!Number.isFinite(orbit.yaw)) throw new TypeError("Mini-map orbit.yaw must be finite");
      const yaw = orbit.yaw;
      const scale = MINIMAP_VIEWBOX.usableRadius / activeRadiusWorld();
      const objectiveMarker = getObjectiveMarker?.() ?? null;
      const socialMarkers = getSocialMarkers?.() ?? [];
      // Campus navigation never draws in room-local coordinates; it resumes on the campus map.
      const navigationState = indoorMapActive ? null : (getNavigation?.() ?? null);
      const nextObjectiveKey = objectiveKey(objectiveMarker);
      const nextSocialKey = socialKey(socialMarkers);
      const nextNavigationKey = navigationKey(navigationState);

      const unchanged = !force && !forceSync && lastPlayer &&
        position.x === lastPlayer.x && position.z === lastPlayer.z && yaw === lastYaw &&
        nextObjectiveKey === lastObjectiveKey && nextSocialKey === lastSocialKey &&
        nextNavigationKey === lastNavigationKey;
      if (unchanged) return false;

      const pois = framePois(position, yaw, scale);
      const objective = frameObjective(objectiveMarker, position, yaw, scale);
      const social = frameSocial(socialMarkers, position, yaw, scale);
      const projectedGeometry = frameIndoorGeometry(position, yaw, scale);
      const navigation = frameNavigation(navigationState, position, yaw, scale);
      const route = frameRoute(navigationState, position, yaw, scale);
      objectiveActive = Boolean(objective);
      visibleSocialCount = social.length;
      visiblePoiCount = pois.length;
      navigationActive = Boolean(navigation);
      routePointCount = route?.length ?? 0;
      renderer.renderFrame({
        state: currentState,
        profile: currentProfile,
        worldTransform: indoorMapActive ? null : {
          centerX: MINIMAP_VIEWBOX.centerX,
          centerY: MINIMAP_VIEWBOX.centerY,
          translateX: position.x === 0 ? 0 : -position.x,
          translateY: position.z,
          rotationRad: yaw,
          scale
        },
        projectedGeometry,
        compass: {
          northAngleRad: yaw,
          centerX: MINIMAP_VIEWBOX.centerX,
          centerY: MINIMAP_VIEWBOX.centerY
        },
        pois,
        objective,
        social,
        navigation,
        route
      });

      lastPlayer = { x: position.x, z: position.z };
      lastYaw = yaw;
      lastObjectiveKey = nextObjectiveKey;
      lastSocialKey = nextSocialKey;
      lastNavigationKey = nextNavigationKey;
      forceSync = false;
      return true;
    } catch (error) {
      record("update", error);
      available = false;
      currentState = MINIMAP_STATE.UNAVAILABLE;
      visiblePoiCount = 0;
      objectiveActive = false;
      visibleSocialCount = 0;
      navigationActive = false;
      routePointCount = 0;
      try { renderer.setState?.(currentState); } catch { /* keep world alive */ }
      return false;
    }
  }

  const onVisibilityChange = () => {
    if (documentLike?.hidden !== true) {
      forceSync = true;
      update({ force: true });
    } else {
      forceSync = true;
    }
  };
  const onResize = () => {
    refreshLayout();
    if (documentLike?.hidden !== true) update({ force: true });
  };

  documentLike?.addEventListener?.("visibilitychange", onVisibilityChange);
  windowTarget?.addEventListener?.("resize", onResize);
  windowTarget?.addEventListener?.("orientationchange", onResize);

  mount();

  function destroy() {
    if (destroyed) return false;
    destroyed = true;
    documentLike?.removeEventListener?.("visibilitychange", onVisibilityChange);
    windowTarget?.removeEventListener?.("resize", onResize);
    windowTarget?.removeEventListener?.("orientationchange", onResize);
    try { renderer.destroy?.(); } catch (error) { record("destroy", error); }
    currentState = MINIMAP_STATE.UNAVAILABLE;
    available = false;
    visiblePoiCount = 0;
    objectiveActive = false;
    visibleSocialCount = 0;
    return true;
  }

  function setDataSource(nextDataSource, {
    id = "campus",
    indoor = false,
    radiusWorld = null
  } = {}) {
    if (destroyed) return false;
    if (!nextDataSource?.geometry || !nextDataSource?.refreshState) {
      throw new TypeError("Mini-map data source must expose geometry and refreshState");
    }
    currentDataSource = nextDataSource;
    mapSourceId = id;
    indoorMapActive = indoor === true;
    renderer.setMapMode?.(indoorMapActive ? "room" : "campus");
    mapRadiusWorld = Number.isFinite(radiusWorld) && radiusWorld > 0 ? radiusWorld : null;
    try {
      renderer.mountGeometry(currentDataSource.geometry());
      geometryMounted = true;
      refreshPois();
      lastPlayer = null;
      lastYaw = null;
      lastObjectiveKey = null;
      lastSocialKey = null;
      lastNavigationKey = null;
      forceSync = true;
      update({ force: true });
      return true;
    } catch (error) {
      record("source", error);
      available = false;
      currentState = MINIMAP_STATE.UNAVAILABLE;
      try { renderer.setState?.(currentState); } catch { /* keep world alive */ }
      return false;
    }
  }

  return {
    update,
    refreshPois,
    refreshLayout,
    setDataSource,
    destroy,
    status: () => Object.freeze({
      state: currentState,
      profile: currentProfile.id,
      mountedGeometry: geometryMounted,
      visiblePoiCount,
      objectiveActive,
      visibleSocialCount,
      navigationActive,
      routePointCount,
      mapSourceId,
      indoorMapActive,
      radiusMeters: activeRadiusWorld() * 2,
      available,
      errors: errors.slice()
    })
  };
}

