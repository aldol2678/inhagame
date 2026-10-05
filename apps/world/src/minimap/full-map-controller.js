// INHA WORLD Full Map M2-1 / M2-1.1 / M3.
// North-up campus map using the same geometry/POI authority as the Mini-map.
// Display state and viewport are local-only. With an injected M3 navigation adapter the
// destination lives in the shared Guidance State (route, map-point picks, indoor pause);
// without one the M2 local-only destination contract is unchanged. No persistence or network.

import { createFullMapSearch, isMapCompositionEvent } from "./full-map-search.js";
import { worldToMapUv } from "./minimap-model.js";
import { formatGuidanceDistance, navigationPauseLabel } from "../navigation/navigation-state.js";
import { MAP_POI_ICON_PATHS, MAP_POI_STATES, MAP_POI_KIND_LABELS, layoutFullMapLabels } from "./full-map-presentation.js";
export { layoutFullMapLabels } from "./full-map-presentation.js";

const SVG_NS = "http://www.w3.org/2000/svg";
export const FULL_MAP_VIEW = Object.freeze({ size: 1000, padding: 36 });
export const FULL_MAP_ZOOM = Object.freeze({ min: 1, max: 4, step: 1.35, locateMin: 2 });

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function finitePoint(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.z);
}

export function projectFullMapPoint(point, bounds, view = FULL_MAP_VIEW) {
  if (!finitePoint(point)) throw new TypeError("Full Map point must be finite");
  const { u, v } = worldToMapUv(point, bounds);
  const span = view.size - view.padding * 2;
  return Object.freeze({
    x: view.padding + u * span,
    y: view.padding + v * span,
    u,
    v
  });
}

// Inverse of projectFullMapPoint: Full Map SVG units → world point (null outside the map).
export function unprojectFullMapPoint(mapX, mapY, bounds, view = FULL_MAP_VIEW) {
  if (!Number.isFinite(mapX) || !Number.isFinite(mapY)) return null;
  const span = view.size - view.padding * 2;
  const u = (mapX - view.padding) / span;
  const v = (mapY - view.padding) / span;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return Object.freeze({
    x: bounds.minX + u * (bounds.maxX - bounds.minX),
    z: bounds.minZ + (1 - v) * (bounds.maxZ - bounds.minZ)
  });
}

const MAP_POINT_REASON_TEXT = Object.freeze({
  BLOCKED: "건물·시설 안은 목적지로 지정할 수 없어요",
  OFF_NETWORK: "길에서 너무 멀어 안내할 수 없어요",
  INDOOR: "실내 지도에서는 캠퍼스 목적지를 지정할 수 없어요",
  INVALID: "지정할 수 없는 위치예요"
});

export function clampFullMapViewport(view, width, height) {
  const zoom = clamp(Number(view?.zoom) || 1, FULL_MAP_ZOOM.min, FULL_MAP_ZOOM.max);
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const minX = Math.min(0, w - w * zoom);
  const minY = Math.min(0, h - h * zoom);
  return Object.freeze({
    zoom,
    panX: clamp(Number(view?.panX) || 0, minX, 0),
    panY: clamp(Number(view?.panY) || 0, minY, 0)
  });
}

export function zoomFullMapAt(view, nextZoom, anchorX, anchorY, width, height) {
  const current = clampFullMapViewport(view, width, height);
  const zoom = clamp(nextZoom, FULL_MAP_ZOOM.min, FULL_MAP_ZOOM.max);
  const ax = Number.isFinite(anchorX) ? anchorX : width / 2;
  const ay = Number.isFinite(anchorY) ? anchorY : height / 2;
  const contentX = (ax - current.panX) / current.zoom;
  const contentY = (ay - current.panY) / current.zoom;
  return clampFullMapViewport({
    zoom,
    panX: ax - contentX * zoom,
    panY: ay - contentY * zoom
  }, width, height);
}

function pathForGeometry(item, bounds) {
  if (!item?.id || !Array.isArray(item.rings) || !item.rings.length) {
    throw new TypeError("Invalid Full Map geometry");
  }
  return item.rings.map((ring, ringIndex) => {
    if (!Array.isArray(ring) || ring.length < 3) throw new TypeError(`Invalid Full Map ring: ${item.id}[${ringIndex}]`);
    const points = ring.map((point, pointIndex) => {
      if (!finitePoint(point)) throw new TypeError(`Invalid Full Map point: ${item.id}[${ringIndex}][${pointIndex}]`);
      const p = projectFullMapPoint(point, bounds);
      return `${p.x} ${p.y}`;
    });
    return `M ${points.join(" L ")} Z`;
  }).join(" ");
}

function setAttr(element, name, value) {
  const next = String(value);
  if (element.getAttribute?.(name) === next) return false;
  element.setAttribute?.(name, next);
  return true;
}

function placeOverlay(element, point, bounds) {
  if (!element) return false;
  if (!finitePoint(point)) {
    element.hidden = true;
    return false;
  }
  const p = projectFullMapPoint(point, bounds);
  element.hidden = false;
  element.style.left = `${p.x / FULL_MAP_VIEW.size * 100}%`;
  element.style.top = `${p.y / FULL_MAP_VIEW.size * 100}%`;
  return true;
}

export function createFullMapController({
  root,
  openButton,
  closeButton,
  searchRoot = null,
  surface,
  svg,
  markerLayer,
  geometryLayer,
  poiLayer,
  playerMarker,
  objectiveMarker,
  destinationMarker,
  socialLayer,
  titleElement,
  infoPanel,
  infoTitle,
  infoMeta,
  destinationButton,
  clearDestinationButton,
  autoMoveButton = null,
  zoomInButton,
  zoomOutButton,
  locateButton,
  resetViewButton,
  zoomLabel,
  // M3 optional DOM: SVG route path, map-point pick pin and the guidance status bar.
  routePath = null,
  pickMarker = null,
  navBar = null,
  navBarText = null,
  navBarClear = null,
  // M3 optional Guidance State adapter ({ snapshot, setPoi, setTarget, resolveMapPoint, clear,
  // canNavigate, onChange }); main.js builds it from the campus navigation adapter.
  navigation = null,
  // P0-A Auto Move is optional and local. It reuses the M3 route; this controller never moves the player.
  canAutoMove = () => true,
  onAutoMove = () => false,
  isAutoMoveActive = () => false,
  isAutoMovePaused = () => false,
  dataSource,
  getPlayerPosition,
  getObjectiveMarker = () => null,
  getSocialMarkers = () => [],
  onOpen = () => {},
  onClose = () => {},
  documentLike = globalThis.document,
  windowTarget = globalThis.window
} = {}) {
  if (!root || !openButton || !closeButton || !surface || !svg || !markerLayer || !geometryLayer || !poiLayer ||
      !playerMarker || !objectiveMarker || !destinationMarker || !socialLayer || !titleElement ||
      !infoPanel || !infoTitle || !infoMeta || !destinationButton || !clearDestinationButton ||
      !zoomInButton || !zoomOutButton || !locateButton || !resetViewButton || !zoomLabel) {
    throw new Error("Full Map requires its complete DOM contract");
  }
  if (!dataSource?.geometry || !dataSource?.poiRegistry || !dataSource?.bounds) {
    throw new TypeError("Full Map requires the Mini-map data source");
  }
  if (typeof getPlayerPosition !== "function") throw new TypeError("Full Map requires getPlayerPosition");
  if (!documentLike?.createElement || !documentLike?.createElementNS) throw new Error("Full Map requires DOM support");

  let currentDataSource = dataSource;
  let bounds = currentDataSource.bounds;
  let mapSourceId = "campus";
  let mapLabel = "캠퍼스 전체 지도";
  const poiNodes = new Map();
  const socialNodes = new Map();
  const destinationListeners = new Set();
  const pointers = new Map();
  let returnFocus = null;
  let opened = false;
  let mounted = false;
  let selectedPoi = null;
  let destination = null;
  let geometryNodeCount = 0;
  let viewport = { zoom: 1, panX: 0, panY: 0 };
  let pinch = null;
  let tap = null;
  let routeKey = null;
  let focusedPoiId = null;
  let hoveredPoiId = null;
  let labelDestinationId = null;
  const TAP_SLOP_PX = 6;
  if (navigation && (!navigation.snapshot || !navigation.setPoi || !navigation.clear)) {
    throw new TypeError("Full Map navigation adapter requires snapshot, setPoi and clear");
  }

  root.setAttribute("tabindex", "-1");
  infoTitle.setAttribute("tabindex", "-1");
  const availableFocus = element => {
    if (!element || element.isConnected === false || element.disabled || typeof element.focus !== "function") return false;
    for (let node = element; node && node !== documentLike; node = node.parentNode) {
      if (node.hidden || node.inert || node.getAttribute?.("aria-hidden") === "true") return false;
      const style = windowTarget?.getComputedStyle?.(node);
      if (style?.display === "none" || style?.visibility === "hidden") return false;
    }
    return true;
  };
  const focusCandidates = () => [...(root.querySelectorAll?.("button, input, select, textarea, a[href], [tabindex]") ?? [])];
  const focusables = () => focusCandidates()
    .filter(node => availableFocus(node) && (node.getAttribute?.("tabindex") === null || Number(node.getAttribute("tabindex")) >= 0) && node.tabIndex !== -1);
  const focusInside = () => (availableFocus(closeButton) ? closeButton : root).focus?.();
  const repairFocus = previous => {
    if (opened && root.contains?.(previous) && !availableFocus(previous)) {
      (availableFocus(infoTitle) ? infoTitle : closeButton).focus?.();
    }
  };
  const resolvedPois = () => currentDataSource.poiRegistry().list({ surface: "FULL_MAP" });
  const search = createFullMapSearch({ root: searchRoot, documentLike, getPois: resolvedPois,
    onSelect(poi) {
      refreshPois();
      const current = poiNodes.get(poi?.poiId)?.__mapPoi;
      if (!current) return;
      selectPoi(current);
      centerOn(current, { minimumZoom: FULL_MAP_ZOOM.locateMin });
      infoTitle.focus?.();
    }
  });

  const svgElement = tag => documentLike.createElementNS(SVG_NS, tag);
  const surfaceRect = () => {
    const rect = surface.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 1, height: 1 };
    return {
      left: Number(rect.left) || 0,
      top: Number(rect.top) || 0,
      width: Math.max(1, Number(rect.width) || 1),
      height: Math.max(1, Number(rect.height) || 1)
    };
  };

  function applyViewport(next = viewport) {
    const rect = surfaceRect();
    viewport = clampFullMapViewport(next, rect.width, rect.height);
    const transform = `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`;
    svg.style.transform = transform;
    markerLayer.style.transform = transform;
    markerLayer.style.setProperty?.("--full-map-inverse-zoom", String(1 / viewport.zoom));
    markerLayer.dataset.zoomBand = viewport.zoom >= 1.55 ? "detail" : "overview";
    zoomLabel.textContent = `${Math.round(viewport.zoom * 100)}%`;
    zoomOutButton.disabled = viewport.zoom <= FULL_MAP_ZOOM.min + 1e-9;
    zoomInButton.disabled = viewport.zoom >= FULL_MAP_ZOOM.max - 1e-9;
    layoutLabels();
    return viewport;
  }

  function zoomAt(nextZoom, clientX = null, clientY = null) {
    const rect = surfaceRect();
    const x = Number.isFinite(clientX) ? clientX - rect.left : rect.width / 2;
    const y = Number.isFinite(clientY) ? clientY - rect.top : rect.height / 2;
    return applyViewport(zoomFullMapAt(viewport, nextZoom, x, y, rect.width, rect.height));
  }

  function panBy(dx, dy) {
    const rect = surfaceRect();
    return applyViewport({
      zoom: viewport.zoom,
      panX: viewport.panX + dx,
      panY: viewport.panY + dy
    });
  }

  function resetView() {
    return applyViewport({ zoom: 1, panX: 0, panY: 0 });
  }

  function centerOn(point, { minimumZoom = viewport.zoom } = {}) {
    if (!finitePoint(point)) return false;
    const rect = surfaceRect();
    const projected = projectFullMapPoint(point, bounds);
    const normalizedX = projected.x / FULL_MAP_VIEW.size;
    const normalizedY = projected.y / FULL_MAP_VIEW.size;
    const zoom = clamp(Math.max(viewport.zoom, minimumZoom), FULL_MAP_ZOOM.min, FULL_MAP_ZOOM.max);
    return applyViewport({
      zoom,
      panX: rect.width / 2 - normalizedX * rect.width * zoom,
      panY: rect.height / 2 - normalizedY * rect.height * zoom
    });
  }

  function clearChildren(element) {
    while (element?.firstChild) element.removeChild(element.firstChild);
  }

  function mountGeometry() {
    if (mounted) return geometryNodeCount;
    for (const item of currentDataSource.geometry()) {
      const path = svgElement("path");
      setAttr(path, "d", pathForGeometry(item, bounds));
      setAttr(path, "fill-rule", "evenodd");
      setAttr(path, "clip-rule", "evenodd");
      setAttr(path, "data-map-id", item.id);
      setAttr(path, "data-map-kind", item.kind);
      if (item.style) setAttr(path, "data-map-style", item.style);
      geometryLayer.appendChild(path);
      geometryNodeCount += 1;
    }
    mounted = true;
    return geometryNodeCount;
  }

  function poiStateLabel(poi) {
    return (MAP_POI_STATES[poi.presentation] ?? MAP_POI_STATES.UNKNOWN).label;
  }

  const navSnapshot = () => {
    if (!navigation) return null;
    try { return navigation.snapshot() ?? null; } catch { return null; }
  };

  // Active destination as seen by this map: the shared Guidance State when injected.
  function currentDestination() {
    if (!navigation) return destination;
    const target = navSnapshot()?.destination;
    return target ? { poiId: target.poiId ?? null, id: target.id, mapSourceId: target.mapSourceId,
      title: target.title, x: target.x, z: target.z } : null;
  }

  function destinationAllowed(poi) {
    if (poi?.mapPoint) return poi.supported === true;
    if (navigation && navigation.canNavigate?.(mapSourceId) === false) return false;
    return poi?.visible !== false && poi?.validPosition !== false && poi?.presentation === "NORMAL";
  }

  function renderInfo() {
    const previouslyFocused = documentLike.activeElement;
    if (!selectedPoi) {
      infoPanel.hidden = true;
      if (pickMarker) pickMarker.hidden = true;
      if (opened) applyViewport();
      repairFocus(previouslyFocused);
      return;
    }
    const active = currentDestination();
    infoPanel.hidden = false;
    infoTitle.textContent = selectedPoi.title;
    infoMeta.textContent = selectedPoi.mapPoint
      ? selectedPoi.supported
        ? `지도 위치 · 길에서 ${formatGuidanceDistance(selectedPoi.walkwayDistance ?? 0)}`
        : MAP_POINT_REASON_TEXT[selectedPoi.reason] ?? MAP_POINT_REASON_TEXT.INVALID
      : `${MAP_POI_KIND_LABELS[selectedPoi.kind] ?? "장소"} · ${poiStateLabel(selectedPoi)}`;
    destinationButton.disabled = !destinationAllowed(selectedPoi);
    const isCurrent = selectedPoi.mapPoint
      ? active?.id === selectedPoi.target?.id
      : active?.poiId === selectedPoi.poiId;
    destinationButton.textContent = isCurrent
      ? (navigation ? "안내 중" : "목적지 설정됨")
      : navigation && active ? "목적지 변경" : "목적지 설정";
    if (autoMoveButton) {
      const autoMoving = isAutoMoveActive(selectedPoi) === true;
      const autoPaused = isAutoMovePaused(selectedPoi) === true;
      autoMoveButton.hidden = !navigation;
      autoMoveButton.disabled = !navigation || !destinationAllowed(selectedPoi) || canAutoMove(selectedPoi) === false || autoMoving;
      autoMoveButton.textContent = autoMoving ? "자동이동 중" : autoPaused ? "자동이동 재개" : "자동이동";
    }
    clearDestinationButton.hidden = !active;
    if (navigation) clearDestinationButton.textContent = "안내 종료";
    if (pickMarker) {
      if (selectedPoi.mapPoint) placeOverlay(pickMarker, selectedPoi, bounds);
      else pickMarker.hidden = true;
      if (!pickMarker.hidden) pickMarker.dataset.supported = selectedPoi.supported ? "true" : "false";
    }
    if (opened) applyViewport();
    repairFocus(previouslyFocused);
  }

  function selectPoi(poi) {
    selectedPoi = poi;
    for (const [poiId, node] of poiNodes) node.classList?.toggle?.("is-selected", poiId === poi.poiId);
    renderInfo();
    return poi;
  }

  // M3: a tap on open map space proposes that location; the adapter decides if it is routable.
  function selectMapPoint(point) {
    if (!navigation?.resolveMapPoint || !point) return null;
    let resolved;
    try { resolved = navigation.resolveMapPoint(point, mapSourceId); } catch { resolved = { supported: false, reason: "INVALID" }; }
    return selectPoi(Object.freeze({
      poiId: "map.point",
      mapPoint: true,
      title: resolved?.target?.title ?? "지도에서 고른 위치",
      kind: "위치",
      presentation: resolved?.supported ? "NORMAL" : "DISABLED",
      supported: resolved?.supported === true,
      reason: resolved?.reason ?? null,
      walkwayDistance: resolved?.walkwayDistance ?? null,
      target: resolved?.target ?? null,
      x: point.x,
      z: point.z
    }));
  }

  function clientToWorld(clientX, clientY) {
    const rect = surfaceRect();
    const contentX = (clientX - rect.left - viewport.panX) / viewport.zoom;
    const contentY = (clientY - rect.top - viewport.panY) / viewport.zoom;
    return unprojectFullMapPoint(contentX / rect.width * FULL_MAP_VIEW.size, contentY / rect.height * FULL_MAP_VIEW.size, bounds);
  }

  function renderRoute(snapshot) {
    if (!routePath) return false;
    const points = snapshot?.status === "GUIDING" && snapshot.destination?.mapSourceId === mapSourceId
      ? snapshot.routePoints ?? [] : [];
    if (points.length < 2) {
      if (routeKey !== "none") {
        setAttr(routePath, "d", "");
        setAttr(routePath, "visibility", "hidden");
        routeKey = "none";
      }
      return false;
    }
    const d = `M ${points.map(point => {
      const p = projectFullMapPoint(point, bounds);
      return `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    }).join(" L ")}`;
    if (d !== routeKey) {
      setAttr(routePath, "d", d);
      setAttr(routePath, "visibility", "visible");
      routeKey = d;
    }
    return true;
  }

  function renderNavBar(snapshot) {
    if (!navBar || !navBarText) return;
    const target = snapshot?.destination;
    const previouslyFocused = documentLike.activeElement;
    const wasHidden = navBar.hidden;
    if (!target) {
      navBar.hidden = true;
      repairFocus(previouslyFocused);
      if (!wasHidden && opened) applyViewport();
      return;
    }
    navBar.hidden = false;
    navBar.dataset.status = snapshot.status;
    navBarText.textContent = snapshot.status === "ARRIVED"
      ? `${target.title} 도착`
      : snapshot.status === "PAUSED"
        ? `${target.title} · ${navigationPauseLabel(snapshot)}`
        : `${target.title} · ${formatGuidanceDistance(snapshot.remainingDistance)}`;
    // The short-landscape CSS changes map size when this bar appears/disappears.
    if (wasHidden && opened) applyViewport();
  }

  function makeSymbol(className) {
    const icon = svgElement("svg");
    setAttr(icon, "class", className);
    setAttr(icon, "viewBox", "0 0 24 24");
    setAttr(icon, "aria-hidden", "true");
    setAttr(icon, "focusable", "false");
    const path = svgElement("path");
    icon.appendChild(path);
    return { icon, path };
  }

  function updatePoiEmphasis(button, activeId = currentDestination()?.poiId) {
    const id = button.dataset.poiId;
    const emphasized = id === selectedPoi?.poiId || id === activeId || id === focusedPoiId || id === hoveredPoiId;
    button.dataset.emphasized = emphasized ? "true" : "false";
    return emphasized;
  }

  function ensurePoiNode(poi) {
    let button = poiNodes.get(poi.poiId);
    if (button) return button;
    button = documentLike.createElement("button");
    button.type = "button";
    button.className = "full-map-poi";
    button.dataset.poiId = poi.poiId;
    const symbol = makeSymbol("full-map-poi-icon");
    const badge = documentLike.createElement("span");
    badge.className = "full-map-poi-state";
    badge.setAttribute("aria-hidden", "true");
    const stateSymbol = makeSymbol("full-map-poi-state-icon");
    badge.appendChild(stateSymbol.icon);
    const label = documentLike.createElement("span");
    label.className = "full-map-poi-label";
    label.setAttribute("aria-hidden", "true");
    button.appendChild(symbol.icon);
    button.appendChild(badge);
    button.appendChild(label);
    button.__mapParts = { symbol, badge, stateSymbol, label };
    button.addEventListener("click", () => { if (button.__mapPoi) selectPoi(button.__mapPoi); });
    // Visible labels are part of this button's hit target. Do not move them between
    // pointer entry, focus and click. Keyboard focus can still reveal hidden labels.
    button.addEventListener("focus", () => {
      focusedPoiId = poi.poiId;
      updatePoiEmphasis(button);
      if (button.dataset.labelVisible !== "true" || button.matches?.(":focus-visible") === true) layoutLabels();
    });
    button.addEventListener("blur", () => { focusedPoiId = null; updatePoiEmphasis(button); });
    button.addEventListener("pointerenter", () => {
      hoveredPoiId = poi.poiId;
      updatePoiEmphasis(button);
      if (button.dataset.labelVisible !== "true") layoutLabels();
    });
    button.addEventListener("pointerleave", () => { hoveredPoiId = null; updatePoiEmphasis(button); });
    poiLayer.appendChild(button);
    poiNodes.set(poi.poiId, button);
    return button;
  }

  function layoutLabels() {
    if (!opened) return;
    const rect = surfaceRect();
    const activeId = currentDestination()?.poiId ?? null;
    const candidates = [];
    for (const [id, node] of poiNodes) {
      const poi = node.__mapPoi;
      const label = node.__mapParts.label;
      const p = projectFullMapPoint(poi, bounds);
      const emphasized = updatePoiEmphasis(node, activeId);
      candidates.push({
        id,
        x: p.x / FULL_MAP_VIEW.size * rect.width * viewport.zoom + viewport.panX,
        y: p.y / FULL_MAP_VIEW.size * rect.height * viewport.zoom + viewport.panY,
        width: label.offsetWidth || Math.max(24, poi.title.length * 11 + 4),
        height: label.offsetHeight || 16,
        priority: (id === selectedPoi?.poiId ? 1000 : id === activeId ? 900 : id === focusedPoiId ? 800 : id === hoveredPoiId ? 700 : 0) + (poi.priority ?? 80),
        eligible: emphasized || viewport.zoom >= 1.55 || (poi.priority ?? 80) >= 80
      });
      node.dataset.labelVisible = "false";
    }
    const controlRect = zoomInButton.parentNode?.getBoundingClientRect?.();
    const obstacles = controlRect ? [{ left: controlRect.left - rect.left, top: controlRect.top - rect.top,
      width: controlRect.width, height: controlRect.height }] : [];
    const positions = layoutFullMapLabels(candidates, { width: rect.width, height: rect.height, obstacles });
    const byId = new Map(candidates.map(item => [item.id, item]));
    for (const position of positions) {
      const node = poiNodes.get(position.id), point = byId.get(position.id);
      node.dataset.labelVisible = "true";
      node.__mapParts.label.style.left = `${22 + position.left - point.x}px`;
      node.__mapParts.label.style.top = `${22 + position.top - point.y}px`;
    }
  }

  function refreshPois() {
    const list = resolvedPois();
    const keep = new Set();
    for (const poi of list) {
      if (!finitePoint(poi) || poi.visible === false) continue;
      keep.add(poi.poiId);
      const button = ensurePoiNode(poi);
      button.__mapPoi = poi;
      button.setAttribute("aria-label", `${poi.title} · ${poiStateLabel(poi)}`);
      button.setAttribute("title", `${poi.title} · ${poiStateLabel(poi)}`);
      const p = projectFullMapPoint(poi, bounds);
      button.style.left = `${p.x / FULL_MAP_VIEW.size * 100}%`;
      button.style.top = `${p.y / FULL_MAP_VIEW.size * 100}%`;
      button.dataset.presentation = poi.presentation;
      button.dataset.kind = poi.kind;
      const parts = button.__mapParts;
      setAttr(parts.symbol.path, "d", MAP_POI_ICON_PATHS[poi.iconKey] ?? MAP_POI_ICON_PATHS.landmark);
      const state = MAP_POI_STATES[poi.presentation] ?? MAP_POI_STATES.UNKNOWN;
      parts.badge.hidden = !state.path;
      setAttr(parts.stateSymbol.path, "d", state.path ?? "");
      parts.label.textContent = poi.title;
      if (selectedPoi?.poiId === poi.poiId && !selectedPoi.mapPoint) selectedPoi = poi;
    }
    for (const [poiId, node] of poiNodes) {
      if (keep.has(poiId)) continue;
      const heldFocus = node === documentLike.activeElement || node.contains?.(documentLike.activeElement);
      poiLayer.removeChild(node);
      if (heldFocus && opened) focusInside();
      poiNodes.delete(poiId);
    }
    if (selectedPoi && !selectedPoi.mapPoint && !keep.has(selectedPoi.poiId)) {
      selectedPoi = null;
      infoPanel.hidden = true;
    }
    renderInfo();
    search?.refresh();
    layoutLabels();
    return poiNodes.size;
  }

  function renderSocial(markers = []) {
    const keep = new Set();
    for (const marker of Array.isArray(markers) ? markers : []) {
      if (!marker?.markerId || !finitePoint(marker)) continue;
      keep.add(marker.markerId);
      let node = socialNodes.get(marker.markerId);
      if (!node) {
        node = documentLike.createElement("span");
        node.className = "full-map-social-marker";
        node.setAttribute("aria-hidden", "true");
        socialLayer.appendChild(node);
        socialNodes.set(marker.markerId, node);
      }
      node.dataset.socialKind = marker.kind === "friend" ? "friend" : "player";
      placeOverlay(node, marker, bounds);
    }
    for (const [markerId, node] of socialNodes) {
      if (keep.has(markerId)) continue;
      socialLayer.removeChild(node);
      socialNodes.delete(markerId);
    }
  }

  function update() {
    if (!opened) return false;
    placeOverlay(playerMarker, getPlayerPosition(), bounds);
    const objective = getObjectiveMarker?.() ?? null;
    placeOverlay(objectiveMarker, objective, bounds);
    if (!objectiveMarker.hidden) objectiveMarker.dataset.objectiveKind = objective?.kind ?? "destination";
    const active = currentDestination();
    if (labelDestinationId !== (active?.poiId ?? null)) {
      labelDestinationId = active?.poiId ?? null;
      layoutLabels();
    }
    // A campus destination is never drawn in room-local coordinates (and vice versa).
    placeOverlay(destinationMarker, active && (active.mapSourceId ?? mapSourceId) === mapSourceId ? active : null, bounds);
    if (navigation) {
      const snapshot = navSnapshot();
      renderRoute(snapshot);
      renderNavBar(snapshot);
    }
    renderSocial(getSocialMarkers?.() ?? []);
    return true;
  }

  function emitDestination() {
    const current = currentDestination();
    const snapshot = current ? Object.freeze({ ...current }) : null;
    for (const listener of destinationListeners) {
      try { listener(snapshot); } catch { /* UI listener failure is isolated */ }
    }
  }

  function setDestinationFromSelection() {
    if (!selectedPoi || !destinationAllowed(selectedPoi)) return false;
    if (navigation) {
      const ok = selectedPoi.mapPoint
        ? navigation.setTarget?.(selectedPoi.target) === true
        : navigation.setPoi(selectedPoi, mapSourceId) === true;
      if (!ok) return false;
    } else {
      destination = Object.freeze({
        poiId: selectedPoi.poiId,
        mapSourceId,
        title: selectedPoi.title,
        x: selectedPoi.x,
        z: selectedPoi.z
      });
    }
    renderInfo();
    update();
    if (!navigation) emitDestination();
    return true;
  }

  function startAutoMoveFromSelection() {
    if (!selectedPoi || !navigation || !destinationAllowed(selectedPoi) || canAutoMove(selectedPoi) === false) return false;
    if (!setDestinationFromSelection()) return false;
    const started = onAutoMove(navSnapshot(), selectedPoi) === true;
    renderInfo();
    update();
    if (started) close();
    return started;
  }

  function clearDestination() {
    if (!currentDestination()) return false;
    if (navigation) navigation.clear();
    else destination = null;
    renderInfo();
    update();
    if (!navigation) emitDestination();
    return true;
  }

  // Guidance State changes (arrival, cancel from the HUD, reroutes) refresh this map too.
  const offNavigation = navigation?.onChange?.(() => {
    emitDestination();
    renderInfo();
    update();
  }) ?? null;
  navBarClear?.addEventListener?.("click", () => clearDestination());

  function open() {
    if (opened) return false;
    returnFocus = documentLike.activeElement;
    mountGeometry();
    refreshPois();
    opened = true;
    root.hidden = false;
    openButton.setAttribute("aria-expanded", "true");
    onOpen();
    resetView();
    update();
    closeButton.focus?.();
    return true;
  }

  function close() {
    if (!opened) return false;
    const focused = documentLike.activeElement;
    const ownedFocus = root.contains?.(focused) === true;
    opened = false;
    pointers.clear();
    pinch = null;
    tap = null;
    if (selectedPoi?.mapPoint) {
      selectedPoi = null;
      renderInfo();
    }
    root.hidden = true;
    openButton.setAttribute("aria-expanded", "false");
    search?.reset();
    onClose();
    const next = documentLike.activeElement;
    if (ownedFocus && (next === focused || root.contains?.(next) || next === documentLike.body)) {
      const target = returnFocus !== documentLike.body && returnFocus !== documentLike &&
        !root.contains?.(returnFocus) && availableFocus(returnFocus) ? returnFocus : openButton;
      if (availableFocus(target)) target.focus();
    }
    returnFocus = null;
    return true;
  }

  function pointerSnapshot() {
    const values = [...pointers.values()];
    if (values.length < 2) return null;
    const [a, b] = values;
    return {
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      distance: Math.hypot(b.x - a.x, b.y - a.y)
    };
  }

  const onWheel = event => {
    if (!opened) return;
    event.preventDefault?.();
    const factor = Math.exp(-Number(event.deltaY || 0) * 0.0015);
    zoomAt(viewport.zoom * factor, event.clientX, event.clientY);
  };

  const onDoubleClick = event => {
    if (!opened || event.target?.closest?.("button")) return;
    event.preventDefault?.();
    zoomAt(viewport.zoom * 1.6, event.clientX, event.clientY);
  };

  const onPointerDown = event => {
    if (!opened || event.target?.closest?.("button")) return;
    if (!Number.isFinite(event.pointerId) || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    surface.setPointerCapture?.(event.pointerId);
    pinch = pointerSnapshot();
    tap = pointers.size === 1 ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY } : null;
    event.preventDefault?.();
  };

  const onPointerMove = event => {
    const previous = pointers.get(event.pointerId);
    if (!opened || !previous || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    if (tap && (tap.pointerId !== event.pointerId || Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > TAP_SLOP_PX)) tap = null;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      panBy(event.clientX - previous.x, event.clientY - previous.y);
      pinch = null;
    } else {
      const current = pointerSnapshot();
      if (current && pinch && pinch.distance > 1e-6) {
        const rect = surfaceRect();
        const contentX = (pinch.cx - rect.left - viewport.panX) / viewport.zoom;
        const contentY = (pinch.cy - rect.top - viewport.panY) / viewport.zoom;
        const nextZoom = clamp(viewport.zoom * current.distance / pinch.distance, FULL_MAP_ZOOM.min, FULL_MAP_ZOOM.max);
        applyViewport({
          zoom: nextZoom,
          panX: current.cx - rect.left - contentX * nextZoom,
          panY: current.cy - rect.top - contentY * nextZoom
        });
      }
      pinch = current;
    }
    event.preventDefault?.();
  };

  const onPointerEnd = event => {
    const wasTap = event.type !== "pointercancel" && tap?.pointerId === event.pointerId && pointers.size === 1 &&
      Number.isFinite(event.clientX) && Number.isFinite(event.clientY) &&
      Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= TAP_SLOP_PX;
    tap = null;
    if (wasTap && opened && navigation?.resolveMapPoint) selectMapPoint(clientToWorld(event.clientX, event.clientY));
    pointers.delete(event.pointerId);
    pinch = pointerSnapshot();
    if (pointers.size === 1) {
      const remaining = pointers.values().next().value;
      if (remaining) pointers.set([...pointers.keys()][0], { ...remaining });
    }
  };

  const onKeyDown = event => {
    if (!opened || event.defaultPrevented || search?.composing || isMapCompositionEvent(event)) return;
    const key = event.key || event.code;
    if (key === "Escape") {
      event.preventDefault?.();
      close();
    } else if (key === "Tab") {
      const targets = focusables();
      const active = documentLike.activeElement;
      const index = targets.indexOf(active);
      if (!targets.length || index < 0 || (event.shiftKey ? index === 0 : index === targets.length - 1)) {
        event.preventDefault?.();
        // Programmatic anchors (the selected card title) are not Tab stops, but
        // Tab should still continue to the adjacent live action in DOM order.
        const candidates = focusCandidates();
        const anchorIndex = availableFocus(active) ? candidates.indexOf(active) : -1;
        const adjacent = index < 0 && anchorIndex >= 0
          ? (event.shiftKey ? candidates.slice(0, anchorIndex).reverse() : candidates.slice(anchorIndex + 1))
            .find(node => targets.includes(node))
          : null;
        (adjacent ?? (event.shiftKey ? targets.at(-1) : targets[0]))?.focus?.();
        if (!targets.length) root.focus?.();
      }
    }
  };

  const onResize = () => {
    if (!opened) return;
    applyViewport(viewport);
  };

  openButton.addEventListener("click", () => open());
  closeButton.addEventListener("click", () => close());
  destinationButton.addEventListener("click", () => setDestinationFromSelection());
  autoMoveButton?.addEventListener?.("click", () => startAutoMoveFromSelection());
  clearDestinationButton.addEventListener("click", () => clearDestination());
  zoomInButton.addEventListener("click", () => zoomAt(viewport.zoom * FULL_MAP_ZOOM.step));
  zoomOutButton.addEventListener("click", () => zoomAt(viewport.zoom / FULL_MAP_ZOOM.step));
  locateButton.addEventListener("click", () => centerOn(getPlayerPosition(), { minimumZoom: FULL_MAP_ZOOM.locateMin }));
  resetViewButton.addEventListener("click", () => resetView());
  surface.addEventListener("wheel", onWheel, { passive: false });
  surface.addEventListener("dblclick", onDoubleClick);
  surface.addEventListener("pointerdown", onPointerDown);
  surface.addEventListener("pointermove", onPointerMove);
  surface.addEventListener("pointerup", onPointerEnd);
  surface.addEventListener("pointercancel", onPointerEnd);
  documentLike.addEventListener?.("keydown", onKeyDown);
  windowTarget?.addEventListener?.("resize", onResize);

  applyViewport(viewport);

  function setDataSource(nextDataSource, { id = "campus", label = "캠퍼스 전체 지도" } = {}) {
    if (!nextDataSource?.geometry || !nextDataSource?.poiRegistry || !nextDataSource?.bounds) {
      throw new TypeError("Full Map data source must expose geometry, poiRegistry and bounds");
    }
    // M2 local destinations never cross spaces. An M3 Guidance State destination survives the
    // switch (indoor pause) and is simply not drawn on a map of another space.
    const hadDestination = !navigation && Boolean(destination);
    currentDataSource = nextDataSource;
    bounds = currentDataSource.bounds;
    mapSourceId = id;
    mapLabel = label;
    titleElement.textContent = mapLabel;
    const heldFocus = root.contains?.(documentLike.activeElement);
    search?.reset();
    selectedPoi = null;
    focusedPoiId = null;
    hoveredPoiId = null;
    destination = null;
    infoPanel.hidden = true;
    if (pickMarker) pickMarker.hidden = true;
    routeKey = null;
    clearChildren(geometryLayer);
    clearChildren(poiLayer);
    clearChildren(socialLayer);
    poiNodes.clear();
    socialNodes.clear();
    geometryNodeCount = 0;
    mounted = false;
    if (hadDestination) emitDestination();
    if (opened) {
      mountGeometry();
      refreshPois();
      resetView();
      update();
      if (heldFocus) focusInside();
    }
    return true;
  }

  return {
    open,
    close,
    update,
    setDataSource,
    refreshPois,
    clearDestination,
    resetView,
    zoomAt,
    panBy,
    centerOnPlayer: () => centerOn(getPlayerPosition(), { minimumZoom: FULL_MAP_ZOOM.locateMin }),
    get openState() { return opened; },
    get destination() { const current = currentDestination(); return current ? { ...current } : null; },
    get selectedPoi() { return selectedPoi ? { ...selectedPoi } : null; },
    get viewport() { return { ...viewport }; },
    onDestinationChange(listener) {
      destinationListeners.add(listener);
      return () => destinationListeners.delete(listener);
    },
    status: () => Object.freeze({
      open: opened,
      mounted,
      geometryNodeCount,
      poiNodeCount: poiNodes.size,
      socialNodeCount: socialNodes.size,
      selectedPoiId: selectedPoi?.poiId ?? null,
      destinationPoiId: currentDestination()?.poiId ?? null,
      destinationId: currentDestination()?.id ?? currentDestination()?.poiId ?? null,
      routeVisible: routeKey !== null && routeKey !== "none",
      mapSourceId,
      mapLabel,
      zoom: viewport.zoom,
      panX: viewport.panX,
      panY: viewport.panY
    }),
    selectMapPoint,
    destroy() {
      offNavigation?.();
      documentLike.removeEventListener?.("keydown", onKeyDown);
      windowTarget?.removeEventListener?.("resize", onResize);
      destinationListeners.clear();
      pointers.clear();
      pinch = null;
      return true;
    }
  };
}
