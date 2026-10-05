import test from "node:test";
import assert from "node:assert/strict";
import { MINIMAP_STATE } from "../src/minimap/minimap-model.js";
import { MINIMAP_VIEWBOX, createMiniMapController } from "../src/minimap/minimap-controller.js";
import { createMiniMapRenderer } from "../src/minimap/minimap-renderer.js";
import { createFullMapController, projectFullMapPoint, unprojectFullMapPoint } from "../src/minimap/full-map-controller.js";
import { buildNavGraph, createNavGraph } from "../src/navigation/nav-graph.js";
import { createRouteSolver } from "../src/navigation/route-solver.js";
import { NAV_STATUS, createNavigationState } from "../src/navigation/navigation-state.js";
import { createNavigationHud } from "../src/navigation/navigation-hud.js";

class FakeStyle {
  constructor() { this.values = new Map(); }
  setProperty(name, value) { this.values.set(name, String(value)); }
  getPropertyValue(name) { return this.values.get(name) ?? ""; }
}
class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, on) { if (on) this.values.add(name); else this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}
class FakeElement {
  constructor(tag = "div", className = "") {
    this.tagName = tag;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = new FakeStyle();
    this.classList = new FakeClassList();
    this.hidden = false;
    this.textContent = "";
    this.disabled = false;
    this.className = className;
    if (className) this.attributes.set("class", className);
    this.rect = { left: 0, top: 0, width: 500, height: 500 };
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  get firstChild() { return this.children[0] ?? null; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  querySelector(selector) { return this.children.find(child => `.${child.className}` === selector) ?? null; }
  querySelectorAll(tag) { return this.children.filter(child => child.tagName === tag); }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatch(type, event = {}) {
    const payload = { type, target: event.target ?? this, preventDefault() {}, stopPropagation() {}, ...event };
    for (const fn of this.listeners.get(type) ?? []) fn(payload);
  }
  focus() {}
  closest(selector) { return selector === "button" && this.tagName === "button" ? this : null; }
  getBoundingClientRect() { return { ...this.rect }; }
  setPointerCapture() {}
}
class FakeDocument extends FakeElement {
  createElement(tag) { return new FakeElement(tag); }
  createElementNS(_ns, tag) { return new FakeElement(tag); }
}

const line = (id, points) => ({ id, points: points.map(([x, z]) => ({ x, z })) });
function navigationRig() {
  const graph = createNavGraph(buildNavGraph({ polylines: [
    line("street", [[5, 5], [95, 5]]),
    line("avenue", [[95, 5], [95, 95]])
  ] }));
  const clock = { t: 0, now() { return this.t; } };
  return { clock, state: createNavigationState({ solver: createRouteSolver(graph), clock }) };
}

// ---------------------------------------------------------------- Mini-map

function miniMapRig(getNavigation, { room = false } = {}) {
  const frames = [];
  const state = { position: { x: 0, z: 0 }, yaw: 0 };
  const orbit = {};
  Object.defineProperty(orbit, "yaw", { get: () => state.yaw });
  const controller = createMiniMapController({
    player: { getLocalPosition: () => ({ ...state.position }) },
    orbit,
    getNavigation,
    dataSource: { geometry: () => [{ id: "g", kind: "ROOM_FLOOR", rings: [[{ x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }]] }], refreshState: () => [] },
    renderer: { mountGeometry() {}, renderFrame(frame) { frames.push(frame); }, setState() {}, setMapMode() {} },
    documentLike: { hidden: false, addEventListener() {} },
    windowTarget: { innerWidth: 430, innerHeight: 900, addEventListener() {}, matchMedia: () => ({ matches: true }) }
  });
  if (room) controller.setDataSource({ geometry: () => [], refreshState: () => [] }, { id: "ROOM_CLUBHOUSE_01", indoor: true, radiusWorld: 6 });
  return { controller, frames, state };
}

test("M3B Mini-map projects the route and an edge-clamped destination marker", () => {
  const nav = {
    status: "GUIDING", routeVersion: 1,
    destination: { id: "poi:far", title: "먼 곳", x: 0, z: 400 },
    routePoints: [{ x: 0, z: 0 }, { x: 0, z: 20 }, { x: 0, z: 400 }]
  };
  const { controller, frames } = miniMapRig(() => nav);
  controller.update({ force: true });
  const frame = frames.at(-1);
  assert.equal(frame.state, MINIMAP_STATE.ACTIVE);
  assert.equal(frame.navigation.edge, true, "off-map destination is clamped to the ring");
  const radius = Math.hypot(frame.navigation.screenX - MINIMAP_VIEWBOX.centerX, frame.navigation.screenY - MINIMAP_VIEWBOX.centerY);
  assert.ok(Math.abs(radius - MINIMAP_VIEWBOX.navigationEdgeRadius) < 1e-9);
  assert.ok(Math.abs(frame.navigation.angleDeg) < 1e-9, "destination due north with north-up yaw points up");
  assert.equal(frame.route[0].x, MINIMAP_VIEWBOX.centerX);
  assert.equal(frame.route[0].y, MINIMAP_VIEWBOX.centerY, "route starts under the player marker");
  assert.ok(frame.route[1].y < MINIMAP_VIEWBOX.centerY, "north is up");
  assert.equal(controller.status().navigationActive, true);
  assert.equal(controller.status().routePointCount, 3);
});

test("M3B Mini-map repaints when only the navigation state changes", () => {
  let nav = null;
  const { controller, frames } = miniMapRig(() => nav);
  controller.update({ force: true });
  const count = frames.length;
  assert.equal(controller.update(), false, "unchanged frame is skipped");
  nav = { status: "GUIDING", routeVersion: 1, destination: { id: "d", x: 5, z: 5 }, routePoints: [{ x: 0, z: 0 }, { x: 5, z: 5 }] };
  assert.equal(controller.update(), true);
  assert.equal(frames.length, count + 1);
  assert.equal(frames.at(-1).navigation.edge, false, "near destination renders inside the map");
});

test("M3D Mini-map never draws campus navigation in room-local space", () => {
  const nav = { status: "PAUSED", routeVersion: 1, destination: { id: "d", x: 5, z: 5 }, routePoints: [{ x: 0, z: 0 }, { x: 5, z: 5 }] };
  const { controller, frames } = miniMapRig(() => nav, { room: true });
  controller.update({ force: true });
  assert.equal(frames.at(-1).navigation, null);
  assert.equal(frames.at(-1).route, null);
  assert.equal(controller.status().navigationActive, false);
});

test("M3B renderer draws route/destination layers and keeps them optional", () => {
  const layers = {};
  for (const name of ["root", "geometryLayer", "poiLayer", "objectiveLayer", "socialLayer", "playerLayer", "compassLayer", "routeLayer", "navigationLayer"]) layers[name] = new FakeElement("g");
  layers.routeLayer.appendChild(new FakeElement("path", "minimap-route-casing"));
  layers.routeLayer.appendChild(new FakeElement("path", "minimap-route-line"));
  layers.navigationLayer.appendChild(new FakeElement("path", "minimap-navigation-arrow"));
  layers.navigationLayer.appendChild(new FakeElement("path", "minimap-navigation-marker"));
  const doc = new FakeDocument("document");
  const renderer = createMiniMapRenderer({ ...layers, documentLike: doc });
  renderer.renderFrame({
    state: MINIMAP_STATE.ACTIVE,
    route: [{ x: 56, y: 56 }, { x: 56, y: 20 }],
    navigation: { screenX: 56, screenY: 21, angleDeg: 0, edge: true }
  });
  assert.equal(layers.routeLayer.getAttribute("visibility"), "visible");
  assert.equal(layers.routeLayer.children[1].getAttribute("d"), "M 56.00 56.00 L 56.00 20.00");
  assert.equal(layers.navigationLayer.getAttribute("data-edge"), "true");
  assert.equal(layers.navigationLayer.children[0].getAttribute("transform"), "rotate(0)");
  assert.equal(renderer.status().routeVisible, true);
  renderer.renderFrame({ state: MINIMAP_STATE.SUSPENDED });
  assert.equal(layers.routeLayer.getAttribute("visibility"), "hidden", "suspended map hides guidance");
  assert.equal(layers.navigationLayer.getAttribute("visibility"), "hidden");

  const { routeLayer, navigationLayer, ...m1 } = layers;
  const legacy = createMiniMapRenderer({ ...m1, documentLike: doc });
  assert.equal(legacy.renderFrame({ state: MINIMAP_STATE.ACTIVE, route: [{ x: 1, y: 1 }, { x: 2, y: 2 }], navigation: { screenX: 1, screenY: 1 } }), true);
});

// ---------------------------------------------------------------- Full Map

function fullMapRig({ navigation: withNavigation = true } = {}) {
  const d = new FakeDocument("document");
  const elements = {};
  for (const id of [
    "root", "openButton", "closeButton", "surface", "svg", "markerLayer", "geometryLayer", "poiLayer", "playerMarker",
    "objectiveMarker", "destinationMarker", "socialLayer", "titleElement", "infoPanel", "infoTitle", "infoMeta",
    "destinationButton", "clearDestinationButton", "zoomInButton", "zoomOutButton", "locateButton",
    "resetViewButton", "zoomLabel", "routePath", "pickMarker", "navBar", "navBarText", "navBarClear"
  ]) elements[id] = new FakeElement(id.endsWith("Button") || id === "navBarClear" ? "button" : "div");
  for (const id of ["root", "infoPanel", "destinationMarker", "clearDestinationButton", "pickMarker", "navBar"]) elements[id].hidden = true;
  elements.surface.rect = { left: 0, top: 0, width: 500, height: 500 };
  const bounds = { minX: 0, maxX: 100, minZ: 0, maxZ: 100 };
  const definitions = [
    { poiId: "poi.tower", title: "탑", kind: "BUILDING", iconKey: "landmark", presentation: "NORMAL", visible: true, x: 95, z: 95 },
    { poiId: "poi.gate", title: "문", kind: "GATE", iconKey: "gate", presentation: "NORMAL", visible: true, x: 50, z: 5 }
  ];
  const campus = { bounds, geometry: () => [], poiRegistry: () => ({ list: () => definitions.map(x => ({ ...x })) }) };
  const room = { bounds: { minX: -4, maxX: 4, minZ: -3, maxZ: 3 }, geometry: () => [],
    poiRegistry: () => ({ list: () => [{ poiId: "room.exit", title: "나가기", kind: "EXIT", iconKey: "exit", presentation: "NORMAL", visible: true, x: 0, z: -2.5 }] }) };
  const { clock, state } = navigationRig();
  const world = { position: { x: 5, z: 5 }, space: "campus" };
  const calls = { resolve: [] };
  const adapter = {
    snapshot: () => state.getSnapshot(),
    canNavigate: id => id === "campus",
    setPoi: (poi, mapSourceId) => {
      state.setDestination({ id: `poi:${poi.poiId}`, poiId: poi.poiId, title: poi.title, x: poi.x, z: poi.z, mapSourceId },
        { position: world.position, spaceId: world.space });
      return true;
    },
    setTarget: target => { state.setDestination(target, { position: world.position, spaceId: world.space }); return true; },
    resolveMapPoint: (point, mapSourceId) => {
      calls.resolve.push({ point, mapSourceId });
      return point.x < 50
        ? { supported: true, walkwayDistance: 2, target: { id: "point:a", title: "지도에서 고른 위치", source: "MAP_POINT", x: point.x, z: point.z, mapSourceId } }
        : { supported: false, reason: "BLOCKED" };
    },
    clear: () => state.clearDestination("cancel"),
    onChange: listener => state.onChange(listener)
  };
  const controller = createFullMapController({
    ...elements,
    navigation: withNavigation ? adapter : null,
    dataSource: campus,
    getPlayerPosition: () => world.position,
    documentLike: d,
    windowTarget: new FakeElement("window")
  });
  return { controller, elements, state, clock, world, campus, room, calls, bounds };
}

const clickPoi = (r, poiId) => r.elements.poiLayer.children.find(node => node.dataset.poiId === poiId).dispatch("click");

test("M3A Full Map POI selection sets, changes and cancels the shared destination", () => {
  const r = fullMapRig();
  r.controller.open();
  clickPoi(r, "poi.tower");
  assert.equal(r.elements.destinationButton.textContent, "목적지 설정");
  r.elements.destinationButton.dispatch("click");
  assert.equal(r.state.getSnapshot().destination.poiId, "poi.tower");
  assert.equal(r.elements.destinationButton.textContent, "안내 중");
  assert.equal(r.elements.clearDestinationButton.hidden, false);
  assert.equal(r.elements.clearDestinationButton.textContent, "안내 종료");
  assert.equal(r.elements.destinationMarker.hidden, false);
  assert.equal(r.elements.routePath.getAttribute("visibility"), "visible", "walking route is drawn");
  assert.equal(r.elements.navBar.hidden, false);
  assert.match(r.elements.navBarText.textContent, /^탑 · \d+m$/);

  clickPoi(r, "poi.gate");
  assert.equal(r.elements.destinationButton.textContent, "목적지 변경");
  r.elements.destinationButton.dispatch("click");
  assert.equal(r.state.getSnapshot().destination.poiId, "poi.gate", "destination changed");

  r.elements.navBarClear.dispatch("click");
  assert.equal(r.state.getSnapshot().status, NAV_STATUS.IDLE);
  assert.equal(r.elements.navBar.hidden, true);
  assert.equal(r.elements.destinationMarker.hidden, true);
  assert.equal(r.elements.routePath.getAttribute("visibility"), "hidden");
});

test("M3D room map keeps the campus destination but never draws it indoors", () => {
  const r = fullMapRig();
  r.controller.open();
  clickPoi(r, "poi.tower");
  r.elements.destinationButton.dispatch("click");
  r.world.space = "ROOM_CLUBHOUSE_01";
  r.state.update({ position: { x: 0, z: 0 }, spaceId: r.world.space });
  r.controller.setDataSource(r.room, { id: "ROOM_CLUBHOUSE_01", label: "동아리방 지도" });
  assert.equal(r.controller.destination.poiId, "poi.tower", "campus destination survives the source switch");
  assert.equal(r.elements.destinationMarker.hidden, true, "campus coordinates are not drawn on the room map");
  assert.equal(r.elements.routePath.getAttribute("visibility"), "hidden");
  assert.match(r.elements.navBarText.textContent, /실외로 나가면 안내 재개/);
  clickPoi(r, "room.exit");
  assert.equal(r.elements.destinationButton.disabled, true, "room POIs cannot replace the campus destination");

  r.world.space = "campus";
  r.world.position = { x: 60, z: 5 };
  r.state.update({ position: r.world.position, spaceId: "campus" });
  r.controller.setDataSource(r.campus, { id: "campus", label: "캠퍼스 전체 지도" });
  assert.equal(r.elements.destinationMarker.hidden, false, "restored on the campus map");
  assert.equal(r.elements.routePath.getAttribute("visibility"), "visible", "route resumes from the return point");
});

test("M3A tapping open map space proposes a supported or rejected map point", () => {
  const r = fullMapRig();
  r.controller.open();
  // Tap at map 25%/75% → world (≈21, ≈29).
  r.elements.surface.dispatch("pointerdown", { pointerId: 1, clientX: 125, clientY: 375 });
  r.elements.surface.dispatch("pointerup", { pointerId: 1, clientX: 126, clientY: 376 });
  assert.equal(r.calls.resolve.length, 1);
  assert.equal(r.calls.resolve[0].mapSourceId, "campus");
  assert.equal(r.elements.infoTitle.textContent, "지도에서 고른 위치");
  assert.match(r.elements.infoMeta.textContent, /길에서 4m/);
  assert.equal(r.elements.pickMarker.hidden, false);
  assert.equal(r.elements.destinationButton.disabled, false);
  r.elements.destinationButton.dispatch("click");
  assert.equal(r.state.getSnapshot().destination.source, "MAP_POINT");

  r.elements.surface.dispatch("pointerdown", { pointerId: 2, clientX: 400, clientY: 100 });
  r.elements.surface.dispatch("pointerup", { pointerId: 2, clientX: 400, clientY: 100 });
  assert.match(r.elements.infoMeta.textContent, /건물·시설 안/);
  assert.equal(r.elements.destinationButton.disabled, true);
  assert.equal(r.elements.pickMarker.dataset.supported, "false");

  // A drag is a pan, never a pick.
  r.controller.zoomAt(2, 250, 250);
  r.elements.surface.dispatch("pointerdown", { pointerId: 3, clientX: 200, clientY: 200 });
  r.elements.surface.dispatch("pointermove", { pointerId: 3, clientX: 240, clientY: 230 });
  r.elements.surface.dispatch("pointerup", { pointerId: 3, clientX: 240, clientY: 230 });
  assert.equal(r.calls.resolve.length, 2);
});

test("M3A map-point unprojection inverts the Full Map projection", () => {
  const bounds = { minX: -181, maxX: 308, minZ: -180, maxZ: 229.5 };
  const p = projectFullMapPoint({ x: 42, z: -17 }, bounds);
  const back = unprojectFullMapPoint(p.x, p.y, bounds);
  assert.ok(Math.abs(back.x - 42) < 1e-9 && Math.abs(back.z + 17) < 1e-9);
  assert.equal(unprojectFullMapPoint(5, 5, bounds), null, "padding outside the map is ignored");
});

test("M2 Full Map without a navigation adapter keeps the local-only destination contract", () => {
  const r = fullMapRig({ navigation: false });
  r.controller.open();
  clickPoi(r, "poi.tower");
  r.elements.destinationButton.dispatch("click");
  assert.equal(r.controller.destination.poiId, "poi.tower");
  assert.equal(r.state.getSnapshot().status, NAV_STATUS.IDLE, "no shared state touched");
  r.elements.surface.dispatch("pointerdown", { pointerId: 1, clientX: 125, clientY: 375 });
  r.elements.surface.dispatch("pointerup", { pointerId: 1, clientX: 125, clientY: 375 });
  assert.equal(r.controller.selectedPoi.poiId, "poi.tower", "map taps do nothing without navigation");
  r.controller.setDataSource(r.room, { id: "ROOM_CLUBHOUSE_01", label: "동아리방 지도" });
  assert.equal(r.controller.destination, null);
});

// ---------------------------------------------------------------- HUD

test("M3B guidance chip shows name, direction and distance; cancel clears it", () => {
  const els = { root: new FakeElement("aside"), arrow: new FakeElement("span"), title: new FakeElement("strong"),
    detail: new FakeElement("span"), cancelButton: new FakeElement("button"), announcer: new FakeElement("span") };
  els.root.hidden = true;
  const { clock, state } = navigationRig();
  const hud = createNavigationHud({ ...els, onCancel: () => state.clearDestination("cancel") });
  hud.render(state.getSnapshot());
  assert.equal(els.root.hidden, true);
  state.setDestination({ id: "poi:tower", title: "탑", x: 95, z: 95 }, { position: { x: 5, z: 5 }, spaceId: "campus" });
  hud.render(state.update({ position: { x: 5, z: 5 }, yaw: 0, spaceId: "campus" }));
  assert.equal(els.root.hidden, false);
  assert.equal(els.root.dataset.status, "GUIDING");
  assert.equal(els.title.textContent, "탑");
  assert.equal(els.detail.textContent, "360m");
  assert.equal(els.arrow.style.getPropertyValue("--nav-bearing"), "90deg", "walk east first");
  assert.equal(els.announcer.textContent, "탑 안내 중");
  hud.render(state.getSnapshot(), { visible: false });
  assert.equal(els.root.hidden, true, "hidden while the Full Map or lobby covers it");
  hud.render(state.update({ position: { x: 1, z: 1 }, spaceId: "ROOM_CLUBHOUSE_01" }));
  assert.equal(els.detail.textContent, "실외로 나가면 안내 재개");
  hud.render(state.update({ position: { x: 95, z: 94 }, spaceId: "campus" }));
  assert.equal(els.root.dataset.status, "ARRIVED");
  assert.equal(els.announcer.textContent, "탑에 도착했어요");
  els.cancelButton.dispatch("click");
  hud.render(state.getSnapshot());
  assert.equal(els.root.hidden, true);
  assert.equal(clock.t, 0);
});

test("Full Map relayouts a zoomed surface after external guidance changes its landscape size", () => {
  const r = fullMapRig();
  r.elements.surface.getBoundingClientRect = () => ({ left: 0, top: 0,
    width: r.elements.navBar.hidden ? 500 : 200, height: r.elements.navBar.hidden ? 500 : 200 });
  r.controller.open();
  r.controller.zoomAt(4);
  r.controller.panBy(-9999, -9999);
  assert.equal(r.controller.viewport.panX, -1500);
  r.state.setDestination({ id: "external", poiId: "poi.gate", title: "문", x: 50, z: 5, mapSourceId: "campus" },
    { position: r.world.position, spaceId: "campus" });
  assert.equal(r.elements.navBar.hidden, false);
  assert.equal(r.controller.viewport.panX, -600, "navigation bar resize must clamp using the new surface size");
  assert.equal(r.controller.viewport.panY, -600);
});
