import * as pc from 'playcanvas';
import { createNpcNavigator, advanceRoute } from '../../npc-factory/dev-navigation.mjs';
import { roadviewGroundHeight } from './roadview-layout.js';

export const GIANT_ROACH_COUNTS = Object.freeze([10, 30, 50, 100]);
export const GIANT_ROACH_MAX = 100;

function clampCount(value) {
  const n = Number(value);
  return GIANT_ROACH_COUNTS.includes(n) ? n : 10;
}
function nowMs() { return performance.now(); }
function distance2d(a,b) { return Math.hypot(a.x-b.x,a.z-b.z); }

function pursuitSlot(index, playerPos) {
  const angle=(index*2.399963229728653)%(Math.PI*2);
  const radius=3.5+(index%10)*0.48;
  return {x:playerPos.x+Math.cos(angle)*radius,z:playerPos.z+Math.sin(angle)*radius};
}

function sharedMaterial() {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(0.34, 0.14, 0.045);
  m.emissive = new pc.Color(0.055, 0.018, 0.004);
  m.gloss = 18;
  m.metalness = 0.05;
  m.update();
  return m;
}

function pushQuad(positions,normals,indices,a,b,c,d,n) {
  const o=positions.length/3;
  for(const p of [a,b,c,d]) positions.push(...p);
  for(let i=0;i<4;i++) normals.push(...n);
  indices.push(o,o+1,o+2,o,o+2,o+3);
}
function addBar(g,from,to,width=.08,height=.08) {
  const dx=to[0]-from[0], dz=to[2]-from[2], len=Math.hypot(dx,dz)||1;
  const px=-dz/len*width/2, pz=dx/len*width/2, y0=from[1]-height/2, y1=from[1]+height/2;
  const a=[from[0]+px,y0,from[2]+pz], b=[from[0]-px,y0,from[2]-pz];
  const c=[to[0]-px,y0,to[2]-pz], d=[to[0]+px,y0,to[2]+pz];
  const A=[a[0],y1,a[2]], B=[b[0],y1,b[2]], C=[c[0],y1,c[2]], D=[d[0],y1,d[2]];
  pushQuad(g.positions,g.normals,g.indices,A,D,C,B,[0,1,0]);
  pushQuad(g.positions,g.normals,g.indices,a,b,c,d,[0,-1,0]);
  const nx=dz/len,nz=-dx/len;
  pushQuad(g.positions,g.normals,g.indices,a,d,D,A,[nx,0,nz]);
  pushQuad(g.positions,g.normals,g.indices,b,B,C,c,[-nx,0,-nz]);
  pushQuad(g.positions,g.normals,g.indices,a,A,B,b,[-dx/len,0,-dz/len]);
  pushQuad(g.positions,g.normals,g.indices,d,c,C,D,[dx/len,0,dz/len]);
}
function addEllipsoid(g,c,r,segments=10) {
  const top=g.positions.length/3;
  g.positions.push(c[0],c[1]+r[1],c[2]); g.normals.push(0,1,0);
  const ring=[];
  for(let i=0;i<segments;i++) {
    const a=i/segments*Math.PI*2, x=Math.cos(a), z=Math.sin(a);
    ring.push(g.positions.length/3);
    g.positions.push(c[0]+x*r[0],c[1],c[2]+z*r[2]);
    const nx=x/r[0],nz=z/r[2],nl=Math.hypot(nx,nz)||1;
    g.normals.push(nx/nl,0,nz/nl);
  }
  const bottom=g.positions.length/3;
  g.positions.push(c[0],c[1]-r[1],c[2]); g.normals.push(0,-1,0);
  for(let i=0;i<segments;i++) {
    const n=(i+1)%segments;
    g.indices.push(top,ring[n],ring[i], bottom,ring[i],ring[n]);
  }
}
function createRoachMesh(device) {
  const g={positions:[],normals:[],indices:[]};
  addEllipsoid(g,[0,0.02,0.28],[0.48,0.27,0.76],12);
  addEllipsoid(g,[0,0.03,-0.52],[0.39,0.25,0.46],10);
  addEllipsoid(g,[0,0.00,-0.96],[0.27,0.20,0.27],8);
  for(const side of [-1,1]) {
    addBar(g,[side*.28,-.16,-.55],[side*.92,-.22,-.86],.09,.07);
    addBar(g,[side*.34,-.17,-.10],[side*1.02,-.23,-.12],.09,.07);
    addBar(g,[side*.33,-.16,.38],[side*.92,-.22,.72],.09,.07);
    addBar(g,[side*.14,.02,-1.12],[side*.62,.04,-1.72],.055,.045);
  }
  return pc.createMesh(device,g.positions,{normals:g.normals,indices:g.indices});
}
function createRoachVisual(root,index,material,mesh) {
  const e=new pc.Entity(`GIANT_ROACH_${index+1}`);
  e.addComponent('render',{
    type:'asset',castShadows:false,receiveShadows:true,
    meshInstances:[new pc.MeshInstance(mesh,material)]
  });
  root.addChild(e);
  return e;
}
function candidate(center,index,attempt) {
  const angle=(index*2.399963229728653 + attempt*0.71)%(Math.PI*2);
  // Stay inside createNpcNavigator's local ±15 m bounds so fallback-to-player overlap is rare.
  const radius=4+(index%12)*0.62+attempt*0.12;
  return {x:center.x+Math.cos(angle)*radius,z:center.z+Math.sin(angle)*radius};
}
function spawnPoint(navigator,center,index) {
  for(let a=0;a<18;a++){ const p=candidate(center,index,a); if(navigator.walkable(p)) return p; }
  return {x:center.x,z:center.z};
}
function metricNumber(v){ return Number.isFinite(v)?Math.round(v*100)/100:null; }

export function createGiantRoachExperiment({app,campusRoot,player,count=10}) {
  let targetCount=clampCount(count), destroyed=false, elapsed=0, frameSamples=[], updateCostSamples=[], navCostSamples=[];
  const center=player.getLocalPosition();
  const navigator=createNpcNavigator(null,{additionalAnchors:[{x:center.x,z:center.z}]});
  const material=sharedMaterial();
  const mesh=createRoachMesh(app.graphicsDevice);
  const roaches=[];
  let lastFrame=nowMs(), errors=0;

  function addOne(index){
    const position=spawnPoint(navigator,center,index);
    const entity=createRoachVisual(campusRoot,index,material,mesh);
    entity.setLocalPosition(position.x,roadviewGroundHeight(position.x,position.z)+0.32,position.z);
    roaches.push({entity,position,waypoints:[],heading:0,nextNavAt:index*.017,nextUpdateAt:0,index});
  }
  function setCount(next){
    targetCount=clampCount(next);
    while(roaches.length<targetCount) addOne(roaches.length);
    while(roaches.length>targetCount){ const r=roaches.pop(); r.entity.destroy(); }
    return status();
  }
  function routeToward(r,goal){
    const t0=nowMs();
    try { r.waypoints=navigator.route(r.position,goal)??[]; }
    catch(e){ errors++; r.waypoints=[]; console.warn('[GIANT_ROACH_TEST] navigation failed',e); }
    navCostSamples.push(nowMs()-t0); if(navCostSamples.length>240) navCostSamples.shift();
  }
  function update(dt){
    if(destroyed) return;
    const start=nowMs(), now=elapsed+=Math.min(Math.max(dt,0),.1);
    const playerPos=player.getLocalPosition();
    for(const r of roaches){
      const d=distance2d(r.position,playerPos);
      const interval=d>55?.35:d>30?.16:.05;
      if(now<r.nextUpdateAt) continue;
      r.nextUpdateAt=now+interval;
      if(now>=r.nextNavAt){
        const goal=pursuitSlot(r.index,playerPos);
        if(distance2d(r.position,goal)>.55) routeToward(r,goal);
        else r.waypoints=[];
        r.nextNavAt=now+(d>45?2.4:d>25?1.4:.8)+(r.index%7)*.035;
      }
      if(r.waypoints.length){
        const moved=advanceRoute(r.position,r.waypoints,(d>45?1.15:2.15)*interval);
        r.position=moved.position; r.heading=moved.heading;
        r.entity.setLocalPosition(r.position.x,roadviewGroundHeight(r.position.x,r.position.z)+0.32,r.position.z);
        r.entity.setLocalEulerAngles(0,r.heading,0);
      }
      r.entity.enabled=d<85;
    }
    updateCostSamples.push(nowMs()-start); if(updateCostSamples.length>240) updateCostSamples.shift();
    const frameNow=nowMs(), frame=frameNow-lastFrame; lastFrame=frameNow;
    if(frame>0&&frame<1000){ frameSamples.push(frame); if(frameSamples.length>240) frameSamples.shift(); }
  }
  function avg(a){ return a.length?a.reduce((x,y)=>x+y,0)/a.length:0; }
  function status(){
    const frame=avg(frameSamples), stats=app.stats??{}, mem=performance.memory;
    return Object.freeze({
      experiment:'GIANT_ROACH_TEST',active:!destroyed,targetCount,activeEntityCount:roaches.length,
      fps:metricNumber(frame?1000/frame:0),frameTimeMs:metricNumber(frame),
      runtimeUpdateMs:metricNumber(avg(updateCostSamples)),navigationMs:metricNumber(avg(navCostSamples)),
      memoryUsedMB:mem?metricNumber(mem.usedJSHeapSize/1048576):null,
      drawCalls:stats.drawCalls?.total??stats.frame?.drawCalls??null,
      triangles:stats.frame?.triangles??null,errors
    });
  }
  function destroy(){
    if(destroyed)return; destroyed=true; app.off('update',update);
    while(roaches.length) roaches.pop().entity.destroy();
    mesh.destroy?.(); material.destroy?.(); delete window.__GIANT_ROACH_TEST__;
  }
  setCount(targetCount); app.on('update',update);
  const api=Object.freeze({status,setCount,destroy,counts:GIANT_ROACH_COUNTS});
  window.__GIANT_ROACH_TEST__=api;
  return api;
}
