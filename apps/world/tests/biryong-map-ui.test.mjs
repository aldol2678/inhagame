import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFullMapController } from '../src/minimap/full-map-controller.js';
import { createMiniMapController } from '../src/minimap/minimap-controller.js';
import { createMiniMapRenderer } from '../src/minimap/minimap-renderer.js';
import { createNavigationState } from '../src/navigation/navigation-state.js';
import { createNavigationHud } from '../src/navigation/navigation-hud.js';
import { createBiryongMapDataSource } from '../src/biryong/biryong-map-data.js';
import { createBiryongNavigation } from '../src/biryong/biryong-navigation.js';
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const returnLabelCss=css.match(/\.full-map-poi\[data-poi-id="poi\.biryong-realm\.return"\] \.full-map-poi-label\s*\{([^}]+)\}/)?.[1]??'';
// Explicit layout fixtures, not browser font measurements: 130px is the
// regression's unwrapped title; the scoped cap creates two 16px lines + padding.
const returnLabelWidth=Math.min(130,parseFloat(returnLabelCss.match(/max-width:\s*([\d.]+)px/)?.[1])||Infinity);
const returnLabelHeight=returnLabelWidth<130&&/white-space:\s*normal/.test(returnLabelCss)?36:20;
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
  get offsetWidth() { return this.className==='full-map-poi-label'&&this.parentNode?.dataset.poiId==='poi.biryong-realm.return'?returnLabelWidth:0; }
  get offsetHeight() { return this.className==='full-map-poi-label'&&this.parentNode?.dataset.poiId==='poi.biryong-realm.return'?returnLabelHeight:0; }
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


const region='BIRYONG_REALM';
const keys=['root','openButton','closeButton','surface','svg','markerLayer','geometryLayer','poiLayer','playerMarker',
  'objectiveMarker','destinationMarker','socialLayer','titleElement','infoPanel','infoTitle','infoMeta',
  'destinationButton','clearDestinationButton','zoomInButton','zoomOutButton','locateButton',
  'resetViewButton','zoomLabel','routePath','pickMarker','navBar','navBarText','navBarClear'];
function rig(width=390,height=844){
  const documentLike=new FakeDocument(),windowTarget=new FakeElement('window');
  Object.assign(windowTarget,{innerWidth:width,innerHeight:height});
  const els=Object.fromEntries(keys.map(key=>[key,new FakeElement()]));
  els.navBar.hidden=true;
  // Match the production square surface, including short-landscape chrome and
  // the guidance bar's extra height (306px overview / 260px guiding at 844×390).
  els.surface.getBoundingClientRect=()=>{
    const size=width>height&&height<=500?Math.min(els.navBar.hidden?430:390,height-24-(els.navBar.hidden?60:106)):
      width<=720?width-54:Math.min(width-64,height-160);
    return {left:0,top:0,width:size,height:size};
  };
  const map=createBiryongMapDataSource(),provider=createBiryongNavigation();
  const current={spaceId:region,position:{x:0,z:0}};
  const nav=createNavigationState({solver:provider.solver,guidanceSpaceId:region});
  const adapter={snapshot:()=>nav.getSnapshot(),canNavigate:id=>id===region&&current.spaceId===region,
    setPoi:(poi,id)=>{if(id!==current.spaceId)return false;const target=provider.poiTarget(poi,id);if(!target)return false;
      return nav.setDestination(target,current).status==='GUIDING';},
    setTarget:target=>{if(target?.mapSourceId!==current.spaceId)return false;return nav.setDestination(target,current).status==='GUIDING';},
    resolveMapPoint:provider.mapPointTarget,clear:()=>nav.clearDestination(),onChange:nav.onChange};
  const controller=createFullMapController({...els,navigation:adapter,dataSource:map,
    getPlayerPosition:()=>current.position,documentLike,windowTarget});
  controller.setDataSource(map,{id:region,label:map.label});
  return {controller,els,nav,current,map,provider,documentLike,windowTarget};
}
for(const [width,height] of [[1280,720],[390,844],[844,390]])test(`Biryong map ${width}x${height}: selection, route, view controls and cancel share existing controller`,()=>{
  const r=rig(width,height);r.controller.open();
  assert.equal(r.els.titleElement.textContent,r.map.label);
  assert.equal(r.els.poiLayer.children.length,7);
  const button=r.els.poiLayer.children.find(el=>el.dataset.poiId==='poi.biryong-realm.return');
  button.dispatch('click');r.els.destinationButton.dispatch('click');
  assert.equal(r.nav.getSnapshot().destination.mapSourceId,region);
  assert.equal(r.els.routePath.getAttribute('visibility'),'visible');
  assert.equal(r.els.destinationMarker.hidden,false);
  r.els.zoomInButton.dispatch('click');assert.ok(r.controller.viewport.zoom>1);
  r.els.resetViewButton.dispatch('click');assert.equal(r.controller.viewport.zoom,1);
  r.els.navBarClear.dispatch('click');assert.equal(r.nav.getSnapshot().status,'IDLE');
  assert.equal(r.els.routePath.getAttribute('visibility'),'hidden');
});

test('both map renderers mount the Biryong palette on the existing authoritative geometry',()=>{
  const r=rig();r.controller.open();
  assert.ok(r.els.geometryLayer.children.every(path=>path.getAttribute('data-map-style')==='biryong'));
  const names=['root','geometryLayer','poiLayer','objectiveLayer','socialLayer','playerLayer','compassLayer'];
  const layers=Object.fromEntries(names.map(name=>[name,new FakeElement()]));
  const renderer=createMiniMapRenderer({...layers,documentLike:r.documentLike});
  renderer.mountGeometry(r.map.geometry());
  assert.equal(layers.geometryLayer.children.length,r.map.geometry().length);
  assert.ok(layers.geometryLayer.children.every(path=>path.getAttribute('data-map-style')==='biryong'));
  renderer.mountGeometry([{id:'campus.test',kind:'ROAD',rings:[[{x:0,z:0},{x:1,z:0},{x:0,z:1}]]}]);
  assert.equal(layers.geometryLayer.children[0].getAttribute('data-map-style'),null,'campus does not retain regional paint');
});

for(const [width,height] of [[1280,720],[390,844],[844,390]])test(`Biryong return label is visible on overview at ${width}x${height}`,()=>{
  const r=rig(width,height);r.controller.open();
  const button=r.els.poiLayer.children.find(el=>el.dataset.poiId==='poi.biryong-realm.return');
  assert.equal(button.dataset.labelVisible,'true');
  assert.match(button.getAttribute('aria-label'),/귀환.*F1.*인하대후문/);
  const before={left:button.style.left,top:button.style.top};
  r.els.zoomInButton.dispatch('click');r.els.resetViewButton.dispatch('click');
  assert.deepEqual({left:button.style.left,top:button.style.top},before,'priority never moves the stop');
  assert.equal(button.dataset.labelVisible,'true');
});

test('Biryong return stays readable on real short-landscape overview and guidance surfaces',()=>{
  const r=rig(844,390);r.controller.open();
  const button=r.els.poiLayer.children.find(el=>el.dataset.poiId==='poi.biryong-realm.return');
  const label=button.__mapParts.label;
  const assertFits=size=>{
    const rect=r.els.surface.getBoundingClientRect();
    assert.deepEqual([rect.width,rect.height],[size,size]);
    assert.equal(button.dataset.labelVisible,'true',`${size}px map keeps the return label`);
    const left=parseFloat(button.style.left)/100*size+parseFloat(label.style.left)-22;
    const top=parseFloat(button.style.top)/100*size+parseFloat(label.style.top)-22;
    assert.ok(left>=4&&left+label.offsetWidth<=size-4,'complete padded label fits horizontally');
    assert.ok(top>=4&&top+label.offsetHeight<=size-4,'complete padded label fits vertically');
  };
  assertFits(306);
  button.dispatch('click');r.els.destinationButton.dispatch('click');
  assertFits(260);
  assert.match(r.els.infoTitle.textContent,/귀환.*F1.*인하대후문/,'selection keeps the complete destination name');
  r.els.navBarClear.dispatch('click');assertFits(306);
});

test('Biryong map roundtrip never renders regional coordinates on Campus and drops stale selections',()=>{
  const r=rig();r.controller.open();
  r.els.poiLayer.children.find(el=>el.dataset.poiId==='poi.biryong-realm.market').dispatch('click');
  r.els.destinationButton.dispatch('click');
  const target=r.nav.getSnapshot().destination;
  r.current.spaceId='campus';r.nav.update({...r.current});
  const campus={bounds:r.map.bounds,geometry:()=>[],poiRegistry:()=>({list:()=>[]})};
  r.controller.setDataSource(campus,{id:'campus',label:'캠퍼스 전체 지도'});
  assert.equal(r.els.destinationMarker.hidden,true);assert.equal(r.els.routePath.getAttribute('visibility'),'hidden');
  assert.equal(r.els.infoPanel.hidden,true);assert.equal(r.nav.getSnapshot().status,'PAUSED');
  assert.match(r.els.navBarText.textContent,/비룡권으로 돌아가면/);
  r.els.destinationButton.dispatch('click');assert.deepEqual(r.nav.getSnapshot().destination,target);
  r.current.spaceId=region;r.current.position={x:0,z:-12};r.nav.update({...r.current});
  r.controller.setDataSource(r.map,{id:region,label:r.map.label});
  assert.equal(r.els.destinationMarker.hidden,false);assert.equal(r.els.routePath.getAttribute('visibility'),'visible');
});

test('navigation HUD distinguishes unavailable routes, other outdoor region and ordinary indoor pause',()=>{
  const els=Object.fromEntries(['root','arrow','title','detail','cancelButton'].map(k=>[k,new FakeElement()]));
  const hud=createNavigationHud(els);
  const snapshot={status:'PAUSED',active:true,destination:{id:'d',title:'시장',mapSourceId:region}};
  hud.render({...snapshot,pauseReason:'ROUTE_UNAVAILABLE',currentSpaceId:region});
  assert.match(els.detail.textContent,/경로.*찾/);
  hud.render({...snapshot,pauseReason:'SPACE_MISMATCH',currentSpaceId:'campus'});
  assert.match(els.detail.textContent,/비룡권으로 돌아가면/);
  hud.render({...snapshot,destination:{id:'c',title:'캠퍼스',mapSourceId:'campus'},pauseReason:'SPACE_MISMATCH',currentSpaceId:region});
  assert.match(els.detail.textContent,/캠퍼스로 돌아가면/);
});

test('Biryong minimap uses outdoor region mode and existing heading projection',()=>{
  const r=rig(),frames=[];
  const minimap=createMiniMapController({player:{getLocalPosition:()=>r.current.position},orbit:{yaw:0},
    dataSource:r.map,renderer:{mountGeometry(){},renderFrame:frame=>frames.push(frame),setState(){},setMapMode(){}},
    documentLike:r.documentLike,windowTarget:r.windowTarget});
  minimap.setDataSource(r.map,{id:region,indoor:false});minimap.update({force:true});
  assert.equal(frames.at(-1).state,'ACTIVE');assert.equal(minimap.status().mapSourceId,region);
});
