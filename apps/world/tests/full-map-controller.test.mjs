import test from "node:test";
import assert from "node:assert/strict";
import {
  FULL_MAP_ZOOM,
  clampFullMapViewport,
  createFullMapController,
  projectFullMapPoint,
  zoomFullMapAt
} from "../src/minimap/full-map-controller.js";

class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, on) { if (on) this.values.add(name); else this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}
class FakeStyle {
  constructor() { this.values = new Map(); }
  setProperty(name, value) { this.values.set(name, String(value)); }
  getPropertyValue(name) { return this.values.get(name) ?? ""; }
}
class FakeElement {
  constructor(tag = "div") {
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
    this.type = "";
    this.className = "";
    this.focused = false;
    this.rect = { left: 0, top: 0, width: 500, height: 500 };
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  get firstChild() { return this.children[0] ?? null; }
  removeChild(child) { this.children.splice(this.children.indexOf(child),1); child.parentNode=null; return child; }
  setAttribute(name,value) { this.attributes.set(name,String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type,fn) {
    if(!this.listeners.has(type)) this.listeners.set(type,new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type,fn) { this.listeners.get(type)?.delete(fn); }
  dispatch(type,event={}) {
    const payload={ type, target:event.target ?? this, ...event };
    for(const fn of this.listeners.get(type) ?? []) fn(payload);
  }
  focus() { this.focused = true; }
  closest(selector) { return selector === "button" && this.tagName === "button" ? this : this.parentNode?.closest(selector) ?? null; }
  getBoundingClientRect() { return { ...this.rect }; }
  setPointerCapture() {}
}
class FakeDocument extends FakeElement {
  constructor() { super("document"); }
  createElement(tag) { return new FakeElement(tag); }
  createElementNS(_ns,tag) { return new FakeElement(tag); }
}
const doc = () => new FakeDocument();

function rig() {
  const d = doc();
  const windowTarget = new FakeElement("window");
  const elements = {};
  for (const id of [
    "root","openButton","closeButton","surface","svg","markerLayer","geometryLayer","poiLayer","playerMarker",
    "objectiveMarker","destinationMarker","socialLayer","titleElement","infoPanel","infoTitle","infoMeta",
    "destinationButton","clearDestinationButton","zoomInButton","zoomOutButton","locateButton",
    "resetViewButton","zoomLabel"
  ]) elements[id]=new FakeElement(id.endsWith("Button") ? "button" : "div");
  elements.root.hidden = true;
  elements.infoPanel.hidden = true;
  elements.objectiveMarker.hidden = true;
  elements.destinationMarker.hidden = true;
  elements.clearDestinationButton.hidden = true;
  elements.surface.rect = { left: 10, top: 20, width: 500, height: 500 };

  const definitions = [
    { poiId:"poi.main", title:"본관", kind:"BUILDING", iconKey:"main-hall", presentation:"NORMAL",
      visible:true, validPosition:true, x:50,z:0 },
    { poiId:"poi.locked", title:"후문", kind:"GATE", iconKey:"gate", presentation:"LOCKED",
      visible:true, validPosition:true, x:90,z:80 }
  ];
  const geometry = [
    { id:"bldg", kind:"BUILDING", rings:[[{x:0,z:0},{x:10,z:0},{x:10,z:10},{x:0,z:10}]] }
  ];
  const dataSource = {
    bounds:{minX:0,maxX:100,minZ:0,maxZ:100},
    geometry:()=>geometry,
    poiRegistry:()=>({list:()=>definitions.map(x=>({...x}))})
  };
  const state = {
    player:{x:25,z:75},
    objective:{x:50,z:50,kind:"destination"},
    social:[{markerId:"r1",x:30,z:70,kind:"friend"}]
  };
  const calls={open:0,close:0,destination:[]};
  const controller=createFullMapController({
    ...elements,
    dataSource,
    getPlayerPosition:()=>state.player,
    getObjectiveMarker:()=>state.objective,
    getSocialMarkers:()=>state.social,
    onOpen:()=>calls.open++,
    onClose:()=>calls.close++,
    documentLike:d,
    windowTarget
  });
  controller.onDestinationChange(value=>calls.destination.push(value));
  return {d,windowTarget,elements,state,calls,controller,geometry,definitions};
}

test("Full Map projection is north-up across world bounds",()=>{
  const b={minX:-100,maxX:100,minZ:-200,maxZ:200};
  const sw=projectFullMapPoint({x:-100,z:-200},b);
  const ne=projectFullMapPoint({x:100,z:200},b);
  assert.ok(sw.x<ne.x,"east maps right");
  assert.ok(ne.y<sw.y,"north maps up");
});

test("viewport clamp keeps map covering the surface from 1x through 4x",()=>{
  assert.deepEqual(clampFullMapViewport({zoom:.2,panX:-20,panY:-20},500,400),
    {zoom:1,panX:0,panY:0});
  assert.deepEqual(clampFullMapViewport({zoom:2,panX:-900,panY:50},500,400),
    {zoom:2,panX:-500,panY:0});
  assert.equal(clampFullMapViewport({zoom:9,panX:0,panY:0},500,400).zoom,FULL_MAP_ZOOM.max);
});

test("cursor-centred zoom preserves the content point under the cursor",()=>{
  const before={zoom:1,panX:0,panY:0};
  const after=zoomFullMapAt(before,2,125,300,500,500);
  const contentBefore={x:(125-before.panX)/before.zoom,y:(300-before.panY)/before.zoom};
  const contentAfter={x:(125-after.panX)/after.zoom,y:(300-after.panY)/after.zoom};
  assert.ok(Math.abs(contentBefore.x-contentAfter.x)<1e-9);
  assert.ok(Math.abs(contentBefore.y-contentAfter.y)<1e-9);
});

test("open mounts geometry once, resets view and renders dynamic markers",()=>{
  const r=rig();
  assert.equal(r.controller.open(),true);
  assert.equal(r.elements.root.hidden,false);
  assert.equal(r.calls.open,1);
  assert.equal(r.elements.geometryLayer.children.length,1);
  assert.equal(r.elements.poiLayer.children.length,2);
  assert.equal(r.elements.playerMarker.hidden,false);
  assert.equal(r.elements.objectiveMarker.hidden,false);
  assert.equal(r.elements.socialLayer.children.length,1);
  assert.deepEqual(r.controller.viewport,{zoom:1,panX:0,panY:0});
  assert.equal(r.elements.zoomLabel.textContent,"100%");
  assert.equal(r.controller.open(),false);
  assert.equal(r.elements.geometryLayer.children.length,1,"no geometry rebuild");
});

test("zoom buttons stay within 1x-4x, switch label density, and reset returns to full view",()=>{
  const r=rig(); r.controller.open();
  assert.equal(r.elements.markerLayer.dataset.zoomBand,"overview");
  r.controller.zoomAt(1.6);
  assert.equal(r.elements.markerLayer.dataset.zoomBand,"detail");
  for(let i=0;i<20;i++) r.elements.zoomInButton.dispatch("click");
  assert.equal(r.controller.viewport.zoom,FULL_MAP_ZOOM.max);
  assert.equal(r.elements.zoomInButton.disabled,true);
  for(let i=0;i<30;i++) r.elements.zoomOutButton.dispatch("click");
  assert.equal(r.controller.viewport.zoom,FULL_MAP_ZOOM.min);
  assert.equal(r.elements.zoomOutButton.disabled,true);
  assert.equal(r.elements.markerLayer.dataset.zoomBand,"overview");
  r.controller.zoomAt(3);
  r.elements.resetViewButton.dispatch("click");
  assert.deepEqual(r.controller.viewport,{zoom:1,panX:0,panY:0});
  assert.equal(r.elements.markerLayer.dataset.zoomBand,"overview");
});

test("wheel zoom uses the pointer as its anchor",()=>{
  const r=rig(); r.controller.open();
  let prevented=false;
  r.elements.surface.dispatch("wheel",{deltaY:-300,clientX:135,clientY:320,preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.ok(r.controller.viewport.zoom>1);
  assert.ok(r.controller.viewport.panX<0);
});

test("drag pans a zoomed map while remaining clamped",()=>{
  const r=rig(); r.controller.open();
  r.controller.zoomAt(2,260,270);
  const before={...r.controller.viewport};
  r.elements.surface.dispatch("pointerdown",{pointerId:1,clientX:260,clientY:270,preventDefault(){}});
  r.elements.surface.dispatch("pointermove",{pointerId:1,clientX:210,clientY:220,preventDefault(){}});
  assert.ok(r.controller.viewport.panX<before.panX);
  assert.ok(r.controller.viewport.panY<before.panY);
  r.elements.surface.dispatch("pointerup",{pointerId:1,clientX:210,clientY:220});
  assert.ok(r.controller.viewport.panX>=-500 && r.controller.viewport.panX<=0);
});

test("two-pointer pinch zooms around the moving pinch centre",()=>{
  const r=rig(); r.controller.open();
  r.elements.surface.dispatch("pointerdown",{pointerId:1,clientX:110,clientY:220,preventDefault(){}});
  r.elements.surface.dispatch("pointerdown",{pointerId:2,clientX:210,clientY:220,preventDefault(){}});
  r.elements.surface.dispatch("pointermove",{pointerId:2,clientX:310,clientY:220,preventDefault(){}});
  assert.ok(r.controller.viewport.zoom>1.9 && r.controller.viewport.zoom<=2.01);
  r.elements.surface.dispatch("pointerup",{pointerId:1,clientX:110,clientY:220});
  r.elements.surface.dispatch("pointerup",{pointerId:2,clientX:310,clientY:220});
});

test("locate zooms to at least 2x and centres the player",()=>{
  const r=rig(); r.controller.open();
  r.elements.locateButton.dispatch("click");
  assert.ok(r.controller.viewport.zoom>=FULL_MAP_ZOOM.locateMin);
  const projected=projectFullMapPoint(r.state.player,{minX:0,maxX:100,minZ:0,maxZ:100});
  const normalizedX=projected.x/1000, normalizedY=projected.y/1000;
  const screenX=normalizedX*500*r.controller.viewport.zoom+r.controller.viewport.panX;
  const screenY=normalizedY*500*r.controller.viewport.zoom+r.controller.viewport.panY;
  assert.ok(Math.abs(screenX-250)<1e-9);
  assert.ok(Math.abs(screenY-250)<1e-9);
});

test("POI selection exposes info and normal POI can become a local destination",()=>{
  const r=rig(); r.controller.open();
  const main=r.elements.poiLayer.children.find(node=>node.dataset.poiId==="poi.main");
  main.dispatch("click");
  assert.equal(r.elements.infoPanel.hidden,false);
  assert.equal(r.elements.infoTitle.textContent,"본관");
  assert.equal(r.elements.destinationButton.disabled,false);
  r.elements.destinationButton.dispatch("click");
  assert.equal(r.controller.destination.poiId,"poi.main");
  assert.equal(r.elements.destinationMarker.hidden,false);
  assert.equal(r.calls.destination.length,1);
  r.elements.clearDestinationButton.dispatch("click");
  assert.equal(r.controller.destination,null);
  assert.equal(r.elements.destinationMarker.hidden,true);
  assert.equal(r.calls.destination.at(-1),null);
});

test("POI pointerdown does not begin map dragging",()=>{
  const r=rig(); r.controller.open();
  r.controller.zoomAt(2,260,270);
  const poi=r.elements.poiLayer.children[0];
  const before={...r.controller.viewport};
  r.elements.surface.dispatch("pointerdown",{pointerId:4,clientX:260,clientY:270,target:poi,preventDefault(){}});
  r.elements.surface.dispatch("pointermove",{pointerId:4,clientX:180,clientY:190,target:poi,preventDefault(){}});
  assert.deepEqual(r.controller.viewport,before);
});

test("M2 room source switch replaces geometry/title and clears cross-space destination",()=>{
  const r=rig(); r.controller.open();
  const main=r.elements.poiLayer.children.find(node=>node.dataset.poiId==="poi.main");
  main.dispatch("click");
  r.elements.destinationButton.dispatch("click");
  assert.equal(r.controller.destination.poiId,"poi.main");

  const roomGeometry=[{id:"room-floor",kind:"ROOM_FLOOR",rings:[[
    {x:-4,z:-3},{x:4,z:-3},{x:4,z:3},{x:-4,z:3}
  ]]}];
  const roomPoi={poiId:"room.exit",title:"나가기",kind:"EXIT",iconKey:"exit",presentation:"NORMAL",
    visible:true,validPosition:true,x:0,z:-2.5};
  const roomSource={
    bounds:{minX:-4,maxX:4,minZ:-3,maxZ:3},
    geometry:()=>roomGeometry,
    poiRegistry:()=>({list:()=>[{...roomPoi}]})
  };
  assert.equal(r.controller.setDataSource(roomSource,{id:"ROOM_CLUBHOUSE_01",label:"동아리방 지도"}),true);
  assert.equal(r.elements.titleElement.textContent,"동아리방 지도");
  assert.equal(r.controller.status().mapSourceId,"ROOM_CLUBHOUSE_01");
  assert.equal(r.controller.destination,null,"campus destination never leaks into room coordinates");
  assert.equal(r.elements.geometryLayer.children.length,1);
  assert.equal(r.elements.poiLayer.children.length,1);
  assert.equal(r.elements.poiLayer.children[0].dataset.poiId,"room.exit");
  assert.equal(r.controller.status().geometryNodeCount,1);
});

test("locked POI is inspectable but cannot be selected as destination",()=>{
  const r=rig(); r.controller.open();
  const locked=r.elements.poiLayer.children.find(node=>node.dataset.poiId==="poi.locked");
  locked.dispatch("click");
  assert.equal(r.elements.infoTitle.textContent,"후문");
  assert.equal(r.elements.destinationButton.disabled,true);
  r.elements.destinationButton.dispatch("click");
  assert.equal(r.controller.destination,null);
});

test("close and Escape restore modal state through callbacks and clear gestures",()=>{
  const r=rig(); r.controller.open();
  assert.equal(r.controller.close(),true);
  assert.equal(r.elements.root.hidden,true);
  assert.equal(r.calls.close,1);
  r.controller.open();
  r.d.dispatch("keydown",{code:"Escape",preventDefault(){}});
  assert.equal(r.elements.root.hidden,true);
  assert.equal(r.calls.close,2);
});

test("dynamic marker updates reuse static geometry and preserve inverse marker scale",()=>{
  const r=rig(); r.controller.open();
  const before=r.elements.geometryLayer.children[0];
  r.controller.zoomAt(4,260,270);
  assert.equal(r.elements.markerLayer.style.getPropertyValue("--full-map-inverse-zoom"),"0.25");
  r.state.player={x:40,z:40};
  r.state.social=[
    {markerId:"r1",x:41,z:41,kind:"friend"},
    {markerId:"r2",x:42,z:42,kind:"player"}
  ];
  r.controller.update();
  assert.strictEqual(r.elements.geometryLayer.children[0],before);
  assert.equal(r.elements.socialLayer.children.length,2);
  r.state.social=[{markerId:"r2",x:43,z:43,kind:"player"}];
  r.controller.update();
  assert.equal(r.elements.socialLayer.children.length,1);
  assert.equal(r.controller.status().geometryNodeCount,1);
});


test("POI icons are semantic SVGs, with visible distinct status badges and accessible state", () => {
  const r = rig();
  for (const [index, presentation] of ["COMING_SOON", "DISABLED", "UNKNOWN", "UNDISCOVERED"].entries()) {
    r.definitions.push({ ...r.definitions[0], poiId: `poi.state-${index}`, presentation, x: 10 + index * 20, z: 45 });
  }
  r.controller.open();
  const nodes = r.elements.poiLayer.children;
  const main = nodes[0];
  assert.equal(main.children.find(node => node.getAttribute("class") === "full-map-poi-icon")?.tagName, "svg");
  assert.equal(main.children.find(node => node.className === "full-map-poi-label")?.textContent, "본관");
  assert.equal(main.children.find(node => node.className === "full-map-poi-state")?.hidden, true);
  const badges = nodes.slice(1).map(node => node.children.find(child => child.className === "full-map-poi-state"));
  assert.ok(badges.every(badge => badge && !badge.hidden), "non-normal states have visible non-color badges");
  assert.equal(new Set(badges.map(badge => badge.children[0]?.children[0]?.getAttribute("d"))).size, 5, "each state uses a different symbol");
  assert.equal(nodes[1].getAttribute("aria-label"), "후문 · 잠김");
  nodes[1].dispatch("click");
  assert.equal(r.elements.infoMeta.textContent, "출입구 · 잠김");
  assert.equal(r.elements.destinationButton.disabled, true, "presentation does not change access authority");
});

test("POI state changes refresh a selected card without leaving a stale available destination", () => {
  const r = rig(); r.controller.open();
  const main = r.elements.poiLayer.children[0]; main.dispatch("click");
  r.definitions[0].presentation = "UNDISCOVERED";
  r.controller.refreshPois();
  assert.equal(main.getAttribute("aria-label"), "본관 · 미발견");
  assert.equal(r.elements.infoMeta.textContent, "건물 · 미발견");
  assert.equal(r.elements.destinationButton.disabled, true);
  r.definitions[0].presentation = "NORMAL";
  r.controller.refreshPois();
  assert.equal(r.elements.destinationButton.disabled, false);
  assert.equal(main.children.find(node => node.className === "full-map-poi-state").hidden, true);
});

test("labels prioritize the selected destination, avoid overlaps and stay inside the viewport", async () => {
  const { layoutFullMapLabels } = await import("../src/minimap/full-map-controller.js");
  assert.equal(typeof layoutFullMapLabels, "function", "Full Map needs an explicit collision-aware label layout");
  const candidates = [
    { id: "minor", x: 100, y: 100, width: 100, height: 16, priority: 10 },
    { id: "selected", x: 102, y: 100, width: 100, height: 16, priority: 1000 },
    { id: "edge", x: 5, y: 5, width: 90, height: 16, priority: 80 },
    { id: "offscreen", x: -40, y: 100, width: 90, height: 16, priority: 800 }
  ];
  const result = layoutFullMapLabels(candidates, { width: 220, height: 160 });
  assert.ok(result.some(label => label.id === "selected"));
  assert.ok(!result.some(label => label.id === "offscreen"));
  for (const label of result) {
    assert.ok(label.left >= 4 && label.top >= 4 && label.left + label.width <= 216 && label.top + label.height <= 156);
  }
  for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) {
    const a = result[i], b = result[j];
    assert.ok(a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + a.height <= b.top || b.top + b.height <= a.top,
      "accepted labels must not overlap");
  }
  assert.deepEqual(layoutFullMapLabels(candidates.slice().reverse(), { width: 220, height: 160 }), result,
    "priority ordering is deterministic, independent of registry iteration");
});

test("label layout respects fixed map controls and suppresses labels only, never map POIs", async () => {
  const { layoutFullMapLabels } = await import("../src/minimap/full-map-controller.js");
  assert.equal(typeof layoutFullMapLabels, "function");
  const candidates = [{ id: "gate", x: 90, y: 90, width: 80, height: 16, priority: 100 }];
  const obstacle = { left: 0, top: 0, width: 180, height: 180 };
  assert.deepEqual(layoutFullMapLabels(candidates, { width: 180, height: 180, obstacles: [obstacle] }), []);
  assert.equal(candidates.length, 1, "layout does not remove or mutate authoritative POIs");
});


test("a visible POI label stays put through pointer entry, focus and selection", () => {
  const r = rig(); r.controller.open();
  r.controller.zoomAt(2); r.controller.panBy(0, -250);
  const beforeView = { ...r.controller.viewport };
  const main = r.elements.poiLayer.children[0];
  const label = main.children.find(node => node.className === "full-map-poi-label");
  assert.equal(main.dataset.labelVisible, "true");
  const before = { left: label.style.left, top: label.style.top };
  let geometryReads = 0;
  const measure = r.elements.surface.getBoundingClientRect.bind(r.elements.surface);
  r.elements.surface.getBoundingClientRect = () => { geometryReads++; return measure(); };
  main.matches = selector => selector === ":focus-visible" ? false : false;
  main.dispatch("pointerenter");
  main.dispatch("focus");
  assert.equal(geometryReads, 0, "pointer interaction with an already-visible label cannot trigger moving layout");
  assert.deepEqual({ left: label.style.left, top: label.style.top }, before);
  r.elements.surface.dispatch("pointerdown", { target: label, pointerId: 8, clientX: 200, clientY: 200 });
  r.elements.surface.dispatch("pointermove", { target: label, pointerId: 8, clientX: 250, clientY: 240 });
  assert.deepEqual(r.controller.viewport, beforeView, "label press is a POI press, never a map drag even when panning is possible");
  main.dispatch("click", { target: label });
  assert.equal(r.controller.selectedPoi.poiId, "poi.main");
});

test("keyboard focus still prioritizes a hidden POI label", () => {
  const r = rig(); r.controller.open();
  const main = r.elements.poiLayer.children[0];
  main.dataset.labelVisible = "false";
  main.matches = selector => selector === ":focus-visible";
  main.dispatch("focus");
  assert.equal(main.dataset.labelVisible, "true");
});


test("pointer emphasis clears without moving labels and preserves a selected POI", () => {
  const r = rig(); r.controller.open();
  const main = r.elements.poiLayer.children[0];
  const label = main.children.find(node => node.className === "full-map-poi-label");
  const before = { left: label.style.left, top: label.style.top };
  main.dispatch("pointerenter");
  assert.equal(main.dataset.emphasized, "true");
  main.dispatch("pointerleave");
  assert.equal(main.dataset.emphasized, "false");
  assert.deepEqual({ left: label.style.left, top: label.style.top }, before);
  main.dispatch("click");
  main.dispatch("pointerenter"); main.dispatch("pointerleave"); main.dispatch("blur");
  assert.equal(main.dataset.emphasized, "true", "selection keeps its stacking priority");
});
