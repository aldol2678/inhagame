// INHA WORLD Mini-map M0 SVG/HTML view.
// Consumes already-resolved view data. It never reads PlayerController, World registries,
// quests, Realtime or database state and never performs world-coordinate projection itself.

import { MINIMAP_STATE } from "./minimap-model.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const ACTIVE = MINIMAP_STATE.ACTIVE;
const states = new Set(Object.values(MINIMAP_STATE));
const glyphFor = iconKey => ({
  gate: "◇",
  "main-hall": "H",
  water: "≈",
  "student-center": "S",
  library: "L",
  housing: "⌂",
  exit: "↩",
  dragon: "🐉",
  echo: "◎",
  landmark: "•"
}[iconKey] ?? "•");

const finite = (value, label) => {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
};

function pathForRings(rings, id) {
  if (!Array.isArray(rings) || !rings.length) throw new TypeError(`Invalid geometry rings: ${id}`);
  return rings.map((ring, ringIndex) => {
    if (!Array.isArray(ring) || ring.length < 3) throw new TypeError(`Invalid geometry ring: ${id}[${ringIndex}]`);
    const points = ring.map((p, pointIndex) => {
      if (!Number.isFinite(p?.x) || !Number.isFinite(p?.z)) {
        throw new TypeError(`Invalid geometry point: ${id}[${ringIndex}][${pointIndex}]`);
      }
      // SVG y grows downward, so world north (+z) is stored as negative SVG y.
      return `${p.x} ${-p.z}`;
    });
    return `M ${points.join(" L ")} Z`;
  }).join(" ");
}

function clearChildren(element) {
  while (element?.firstChild) element.removeChild(element.firstChild);
}

function setAttr(element, name, value) {
  const next = String(value);
  if (element.getAttribute?.(name) === next) return false;
  element.setAttribute?.(name, next);
  return true;
}

function setVisibility(element, visible) {
  return setAttr(element, "visibility", visible ? "visible" : "hidden");
}

export function createMiniMapRenderer({
  root,
  geometryLayer,
  poiLayer,
  objectiveLayer,
  socialLayer,
  playerLayer,
  compassLayer,
  // M3 navigation layers are optional so M0/M1 embeddings keep their DOM contract.
  routeLayer = null,
  navigationLayer = null,
  documentLike = globalThis.document
} = {}) {
  if (!root || !geometryLayer || !poiLayer || !objectiveLayer || !socialLayer || !playerLayer || !compassLayer) {
    throw new Error("Mini-map renderer requires root and all SVG layers");
  }
  if (!documentLike?.createElementNS) throw new Error("Mini-map renderer requires SVG DOM support");

  const poiNodes = new Map();
  const socialNodes = new Map();
  const geometryNodes = new Map();
  let mountedGeometry = false;
  let geometryNodeCount = 0;
  let state = MINIMAP_STATE.HIDDEN;
  let profileId = null;
  let mapMode = "campus";
  let worldTransformKey = null;
  let compassKey = null;
  let destroyed = false;
  let lastVisiblePoiCount = 0;
  let objectiveVisible = false;
  let lastVisibleSocialCount = 0;
  let navigationVisible = false;
  let routeVisible = false;

  const svg = tag => documentLike.createElementNS(SVG_NS, tag);

  function setState(next) {
    if (!states.has(next)) throw new TypeError(`Invalid Mini-map state: ${next}`);
    if (state === next && root.hidden === (next !== ACTIVE)) return false;
    state = next;
    root.hidden = next !== ACTIVE;
    setAttr(root, "data-minimap-state", next);
    return true;
  }

  function setMapMode(mode = "campus") {
    const next = mode === "room" ? "room" : "campus";
    mapMode = next;
    worldTransformKey = null;
    setAttr(root, "data-map-mode", next);
    return next;
  }

  function setProfile(profile) {
    if (!profile?.id || !Number.isFinite(profile.sizePx)) throw new TypeError("Invalid Mini-map profile");
    if (profileId === profile.id) return false;
    profileId = profile.id;
    setAttr(root, "data-minimap-profile", profile.id);
    root.style?.setProperty?.("--minimap-size", `${profile.sizePx}px`);
    return true;
  }

  function mountGeometry(geometry = []) {
    if (!Array.isArray(geometry)) throw new TypeError("Mini-map geometry must be an array");
    clearChildren(geometryLayer);
    geometryNodes.clear();
    geometryNodeCount = 0;
    // Source switches replace the children in-place. Force the next frame to restamp
    // the transform even if its numeric key happens to match the previous space.
    worldTransformKey = null;

    for (const item of geometry) {
      if (!item?.id || !item?.kind) throw new TypeError("Invalid Mini-map geometry record");
      const path = svg("path");
      setAttr(path, "d", pathForRings(item.rings, item.id));
      setAttr(path, "fill-rule", "evenodd");
      setAttr(path, "clip-rule", "evenodd");
      setAttr(path, "data-map-id", item.id);
      setAttr(path, "data-map-kind", item.kind);
      if (item.style) setAttr(path, "data-map-style", item.style);
      if (item.kind === "ROOM_FLOOR") {
        setAttr(path, "fill", "#9d7f5b");
        setAttr(path, "stroke", "#ffe4b9");
        setAttr(path, "stroke-width", ".9");
        setAttr(path, "opacity", "1");
      } else if (item.kind === "ROOM_FURNITURE") {
        setAttr(path, "fill", "#dce8ee");
        setAttr(path, "stroke", "#ffffff");
        setAttr(path, "stroke-width", ".65");
        setAttr(path, "opacity", "1");
      }
      geometryLayer.appendChild(path);
      geometryNodes.set(item.id, path);
      geometryNodeCount += 1;
    }
    mountedGeometry = true;
    return geometryNodeCount;
  }

  function makePoiNode(poi) {
    const group = svg("g");
    setAttr(group, "class", "minimap-poi");
    setAttr(group, "data-poi-id", poi.poiId);

    const dot = svg("circle");
    setAttr(dot, "class", "minimap-poi-dot");
    setAttr(dot, "cx", 0);
    setAttr(dot, "cy", 0);
    setAttr(dot, "r", 5.1);
    group.appendChild(dot);

    const glyph = svg("text");
    setAttr(glyph, "class", "minimap-poi-glyph");
    setAttr(glyph, "x", 0);
    setAttr(glyph, "y", 2.4);
    setAttr(glyph, "text-anchor", "middle");
    glyph.textContent = glyphFor(poi.iconKey);
    group.appendChild(glyph);

    setVisibility(group, false);
    poiLayer.appendChild(group);
    return { group, glyph, iconKey: poi.iconKey };
  }

  function updatePoiMeta(node, poi) {
    setAttr(node.group, "data-icon-key", poi.iconKey ?? "landmark");
    setAttr(node.group, "data-presentation", poi.presentation ?? "NORMAL");
    if (node.iconKey !== poi.iconKey) {
      node.iconKey = poi.iconKey;
      node.glyph.textContent = glyphFor(poi.iconKey);
    }
  }

  function setPois(pois = []) {
    if (!Array.isArray(pois)) throw new TypeError("Mini-map POIs must be an array");
    const keep = new Set();

    for (const poi of pois) {
      if (!poi?.poiId) throw new TypeError("Mini-map POI requires poiId");
      if (keep.has(poi.poiId)) throw new Error(`Duplicate Mini-map frame POI: ${poi.poiId}`);
      keep.add(poi.poiId);
      let node = poiNodes.get(poi.poiId);
      if (!node) {
        node = makePoiNode(poi);
        poiNodes.set(poi.poiId, node);
      }
      updatePoiMeta(node, poi);
    }

    for (const [poiId, node] of poiNodes) {
      if (keep.has(poiId)) continue;
      poiLayer.removeChild(node.group);
      poiNodes.delete(poiId);
    }
    return poiNodes.size;
  }

  function renderProjectedGeometry(geometry = null) {
    if (!Array.isArray(geometry)) return false;
    setAttr(geometryLayer, "transform", "matrix(1 0 0 1 0 0)");
    for (const item of geometry) {
      const path = geometryNodes.get(item.id);
      if (!path) continue;
      const d = item.rings.map((ring, ringIndex) => {
        if (!Array.isArray(ring) || ring.length < 3) throw new TypeError(`Invalid projected geometry ring: ${item.id}[${ringIndex}]`);
        const points = ring.map((point, pointIndex) => {
          if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
            throw new TypeError(`Invalid projected geometry point: ${item.id}[${ringIndex}][${pointIndex}]`);
          }
          return `${point.x} ${point.y}`;
        });
        return `M ${points.join(" L ")} Z`;
      }).join(" ");
      setAttr(path, "d", d);
    }
    worldTransformKey = null;
    return true;
  }

  function renderWorldTransform(worldTransform) {
    if (!worldTransform) return false;
    const centerX = finite(worldTransform.centerX ?? 56, "worldTransform.centerX");
    const centerY = finite(worldTransform.centerY ?? 56, "worldTransform.centerY");
    const translateX = finite(worldTransform.translateX, "worldTransform.translateX");
    const translateY = finite(worldTransform.translateY, "worldTransform.translateY");
    const rotationRad = finite(worldTransform.rotationRad, "worldTransform.rotationRad");
    const scale = finite(worldTransform.scale, "worldTransform.scale");
    if (scale <= 0) throw new TypeError("worldTransform.scale must be greater than zero");
    const rotationDeg = rotationRad * 180 / Math.PI;
    const key = [centerX, centerY, translateX, translateY, rotationDeg, scale].join("|");
    if (key === worldTransformKey) return false;
    worldTransformKey = key;
    if (mapMode === "room") {
      // Room geometry is small enough that transform-list ambiguity becomes visible.
      // Stamp the heading-up projection as one SVG matrix:
      // q=(worldX,-worldZ), player=(-translateX, translateY).
      const cos = Math.cos(rotationRad), sin = Math.sin(rotationRad);
      const playerX = -translateX, playerZ = translateY;
      const a = scale * cos;
      const b = scale * sin;
      const c = -scale * sin;
      const d = scale * cos;
      const e = centerX - scale * (cos * playerX + sin * playerZ);
      const f = centerY + scale * (-sin * playerX + cos * playerZ);
      setAttr(geometryLayer, "transform", `matrix(${a} ${b} ${c} ${d} ${e} ${f})`);
    } else {
      setAttr(
        geometryLayer,
        "transform",
        `translate(${centerX} ${centerY}) rotate(${rotationDeg}) scale(${scale}) translate(${translateX} ${translateY})`
      );
    }
    return true;
  }

  function renderPois(pois = []) {
    setPois(pois);
    let visibleCount = 0;
    for (const poi of pois) {
      const node = poiNodes.get(poi.poiId);
      if (!node) continue;
      const visible = poi.visible !== false && Number.isFinite(poi.screenX) && Number.isFinite(poi.screenY);
      setVisibility(node.group, visible);
      if (!visible) continue;
      setAttr(node.group, "transform", `translate(${poi.screenX} ${poi.screenY})`);
      updatePoiMeta(node, poi);
      visibleCount += 1;
    }
    lastVisiblePoiCount = visibleCount;
    return visibleCount;
  }

  function renderObjective(objective = null) {
    const visible = Boolean(objective && Number.isFinite(objective.screenX) && Number.isFinite(objective.screenY));
    setVisibility(objectiveLayer, visible);
    objectiveVisible = visible;
    if (!visible) return false;
    setAttr(objectiveLayer, "transform", `translate(${objective.screenX} ${objective.screenY})`);
    setAttr(objectiveLayer, "data-edge", objective.edge === true ? "true" : "false");
    setAttr(objectiveLayer, "data-objective-kind", objective.kind ?? "destination");
    const glyph = objectiveLayer.querySelector?.(".minimap-objective-glyph") ?? objectiveLayer.children?.[1] ?? null;
    if (glyph) glyph.textContent = objective.kind === "quest-npc" ? "N" : "!";
    return true;
  }

  // Navigation destination: coral diamond, plus an outward chevron when clamped to the edge.
  function renderNavigation(navigation = null) {
    if (!navigationLayer) return false;
    const visible = Boolean(navigation && Number.isFinite(navigation.screenX) && Number.isFinite(navigation.screenY));
    setVisibility(navigationLayer, visible);
    navigationVisible = visible;
    if (!visible) return false;
    setAttr(navigationLayer, "transform", `translate(${navigation.screenX} ${navigation.screenY})`);
    setAttr(navigationLayer, "data-edge", navigation.edge === true ? "true" : "false");
    const arrow = navigationLayer.querySelector?.(".minimap-navigation-arrow") ?? null;
    if (arrow && Number.isFinite(navigation.angleDeg)) setAttr(arrow, "transform", `rotate(${navigation.angleDeg})`);
    return true;
  }

  function renderRoute(points = null) {
    if (!routeLayer) return false;
    const visible = Array.isArray(points) && points.length >= 2 &&
      points.every(point => Number.isFinite(point?.x) && Number.isFinite(point?.y));
    setVisibility(routeLayer, visible);
    routeVisible = visible;
    if (!visible) return false;
    const d = `M ${points.map(point => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" L ")}`;
    const paths = routeLayer.querySelectorAll?.("path") ?? routeLayer.children ?? [];
    for (const path of paths) setAttr(path, "d", d);
    return true;
  }

  function makeSocialNode(marker) {
    const group = svg("g");
    setAttr(group, "class", "minimap-social-marker");
    setAttr(group, "data-social-id", marker.markerId);
    const dot = svg("circle");
    setAttr(dot, "class", "minimap-social-dot");
    setAttr(dot, "cx", 0);
    setAttr(dot, "cy", 0);
    setAttr(dot, "r", marker.kind === "friend" ? 4.7 : 3.8);
    group.appendChild(dot);
    const core = svg("circle");
    setAttr(core, "class", "minimap-social-core");
    setAttr(core, "cx", 0);
    setAttr(core, "cy", 0);
    setAttr(core, "r", marker.kind === "friend" ? 1.8 : 1.4);
    group.appendChild(core);
    socialLayer.appendChild(group);
    return { group, dot, core, kind: marker.kind };
  }

  function updateSocialMeta(node, marker) {
    if (node.kind !== marker.kind) {
      node.kind = marker.kind;
      setAttr(node.dot, "r", marker.kind === "friend" ? 4.7 : 3.8);
      setAttr(node.core, "r", marker.kind === "friend" ? 1.8 : 1.4);
    }
    setAttr(node.group, "data-social-kind", marker.kind ?? "player");
  }

  function renderSocial(markers = []) {
    if (!Array.isArray(markers)) throw new TypeError("Mini-map social markers must be an array");
    const keep = new Set();
    let visible = 0;
    for (const marker of markers) {
      if (!marker?.markerId) throw new TypeError("Mini-map social marker requires markerId");
      if (keep.has(marker.markerId)) throw new Error(`Duplicate Mini-map social marker: ${marker.markerId}`);
      keep.add(marker.markerId);
      let node = socialNodes.get(marker.markerId);
      if (!node) {
        node = makeSocialNode(marker);
        socialNodes.set(marker.markerId, node);
      }
      updateSocialMeta(node, marker);
      const show = marker.visible !== false && Number.isFinite(marker.screenX) && Number.isFinite(marker.screenY);
      setVisibility(node.group, show);
      if (!show) continue;
      setAttr(node.group, "transform", `translate(${marker.screenX} ${marker.screenY})`);
      visible += 1;
    }
    for (const [markerId, node] of socialNodes) {
      if (keep.has(markerId)) continue;
      socialLayer.removeChild(node.group);
      socialNodes.delete(markerId);
    }
    lastVisibleSocialCount = visible;
    return visible;
  }

  function renderCompass(compass) {
    if (!compass) return false;
    const angle = finite(compass.northAngleRad, "compass.northAngleRad");
    const centerX = finite(compass.centerX ?? 56, "compass.centerX");
    const centerY = finite(compass.centerY ?? 56, "compass.centerY");
    const deg = angle * 180 / Math.PI;
    const key = [deg, centerX, centerY].join("|");
    if (key === compassKey) return false;
    compassKey = key;
    setAttr(compassLayer, "transform", `rotate(${deg} ${centerX} ${centerY})`);
    return true;
  }

  function renderFrame({
    state: nextState = state,
    profile = null,
    worldTransform = null,
    projectedGeometry = null,
    compass = null,
    pois = [],
    objective = null,
    social = [],
    navigation = null,
    route = null
  } = {}) {
    if (destroyed) return false;
    setState(nextState);
    if (profile) setProfile(profile);
    if (nextState !== ACTIVE) {
      lastVisiblePoiCount = 0;
      renderObjective(null);
      renderSocial([]);
      renderNavigation(null);
      renderRoute(null);
      return true;
    }
    if (projectedGeometry) renderProjectedGeometry(projectedGeometry);
    else if (worldTransform) renderWorldTransform(worldTransform);
    if (compass) renderCompass(compass);
    renderRoute(route);
    renderPois(pois);
    renderObjective(objective);
    renderNavigation(navigation);
    renderSocial(social);
    return true;
  }

  function destroy() {
    if (destroyed) return false;
    destroyed = true;
    clearChildren(geometryLayer);
    clearChildren(poiLayer);
    clearChildren(socialLayer);
    poiNodes.clear();
    socialNodes.clear();
    geometryNodes.clear();
    geometryNodeCount = 0;
    mountedGeometry = false;
    lastVisiblePoiCount = 0;
    objectiveVisible = false;
    lastVisibleSocialCount = 0;
    navigationVisible = false;
    routeVisible = false;
    state = MINIMAP_STATE.UNAVAILABLE;
    root.hidden = true;
    setAttr(root, "data-minimap-state", state);
    return true;
  }

  setState(MINIMAP_STATE.HIDDEN);

  return {
    mountGeometry,
    setPois,
    renderFrame,
    renderProjectedGeometry,
    setState,
    setProfile,
    setMapMode,
    destroy,
    status: () => Object.freeze({
      state,
      profileId,
      mapMode,
      mountedGeometry,
      geometryNodeCount,
      poiNodeCount: poiNodes.size,
      visiblePoiCount: lastVisiblePoiCount,
      objectiveVisible,
      socialNodeCount: socialNodes.size,
      visibleSocialCount: lastVisibleSocialCount,
      navigationVisible,
      routeVisible,
      destroyed
    })
  };
}
