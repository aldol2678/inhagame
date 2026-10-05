import * as pc from 'playcanvas';
import { createNpcNavigator, advanceRoute } from '../../npc-factory/dev-navigation.mjs';
import { roadviewGroundHeight } from './roadview-layout.js';

export const GIANT_ROACH_COUNTS = Object.freeze([10, 30, 50, 100]);
export const GIANT_ROACH_MAX = 100;
export const GIANT_ROACH_TRIANGLES = 768;

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
  m.diffuse = new pc.Color(1, 1, 1);
  m.diffuseVertexColor = true;
  m.diffuseVertexColorChannel = 'rgb';
  m.useLighting = false;
  m.emissive = new pc.Color(0, 0, 0);
  m.gloss = 0;
  m.metalness = 0;
  m.update();
  return m;
}

// pc.createMesh Geometry colors are uploaded through Mesh.setColors32, so use 8-bit RGBA.
const ROACH_COLOR = Object.freeze({
  abdomen: [184,76,28,255],
  abdomenBand: [148,52,18,255],
  thorax: [132,46,16,255],
  elytra: [164,60,20,255],
  head: [76,21,8,255],
  limb: [45,13,5,255],
  seam: [220,126,52,255],
  cerci: [62,18,7,255]
});
function pushColor(colors,color,count=1){ for(let i=0;i<count;i++) colors.push(...color); }
function pushQuad(positions,normals,colors,indices,a,b,c,d,n,color) {
  const o=positions.length/3;
  for(const p of [a,b,c,d]) positions.push(...p);
  for(let i=0;i<4;i++) normals.push(...n);
  pushColor(colors,color,4);
  indices.push(o,o+1,o+2,o,o+2,o+3);
}
function addTaperedBar(g,from,to,width0=.08,width1=.05,height=.07,color=ROACH_COLOR.limb) {
  const dx=to[0]-from[0], dz=to[2]-from[2], len=Math.hypot(dx,dz)||1;
  const ux=-dz/len, uz=dx/len;
  const p0x=ux*width0/2, p0z=uz*width0/2, p1x=ux*width1/2, p1z=uz*width1/2;
  const y0=from[1]-height/2, y1=from[1]+height/2;
  const z0=to[1]-height/2, z1=to[1]+height/2;
  const a=[from[0]+p0x,y0,from[2]+p0z], b=[from[0]-p0x,y0,from[2]-p0z];
  const c=[to[0]-p1x,z0,to[2]-p1z], d=[to[0]+p1x,z0,to[2]+p1z];
  const A=[a[0],y1,a[2]], B=[b[0],y1,b[2]], C=[c[0],z1,c[2]], D=[d[0],z1,d[2]];
  pushQuad(g.positions,g.normals,g.colors,g.indices,A,D,C,B,[0,1,0],color);
  pushQuad(g.positions,g.normals,g.colors,g.indices,a,b,c,d,[0,-1,0],color);
  const nx=dz/len,nz=-dx/len;
  pushQuad(g.positions,g.normals,g.colors,g.indices,a,d,D,A,[nx,0,nz],color);
  pushQuad(g.positions,g.normals,g.colors,g.indices,b,B,C,c,[-nx,0,-nz],color);
  pushQuad(g.positions,g.normals,g.colors,g.indices,a,A,B,b,[-dx/len,0,-dz/len],color);
  pushQuad(g.positions,g.normals,g.colors,g.indices,d,c,C,D,[dx/len,0,dz/len],color);
}
function addEllipsoid(g,c,r,segments,color,ringColors=null) {
  const top=g.positions.length/3;
  g.positions.push(c[0],c[1]+r[1],c[2]); g.normals.push(0,1,0); pushColor(g.colors,color);
  const rings=[];
  const thetas=[Math.PI/6,Math.PI/3,Math.PI/2,Math.PI*2/3,Math.PI*5/6];
  for(let ringIndex=0;ringIndex<thetas.length;ringIndex++) {
    const theta=thetas[ringIndex], sy=Math.cos(theta), radial=Math.sin(theta), ring=[];
    const ringColor=ringColors?.[ringIndex]??color;
    for(let i=0;i<segments;i++) {
      const a=i/segments*Math.PI*2, ca=Math.cos(a), sa=Math.sin(a);
      const x=ca*radial, z=sa*radial;
      ring.push(g.positions.length/3);
      g.positions.push(c[0]+x*r[0],c[1]+sy*r[1],c[2]+z*r[2]);
      const nx=x/r[0],ny=sy/r[1],nz=z/r[2],nl=Math.hypot(nx,ny,nz)||1;
      g.normals.push(nx/nl,ny/nl,nz/nl); pushColor(g.colors,ringColor);
    }
    rings.push(ring);
  }
  const bottom=g.positions.length/3;
  g.positions.push(c[0],c[1]-r[1],c[2]); g.normals.push(0,-1,0); pushColor(g.colors,color);
  for(let i=0;i<segments;i++) {
    const n=(i+1)%segments;
    g.indices.push(top,rings[0][n],rings[0][i]);
    for(let rIndex=0;rIndex<rings.length-1;rIndex++) {
      const a=rings[rIndex][i], b=rings[rIndex][n], c0=rings[rIndex+1][i], d=rings[rIndex+1][n];
      g.indices.push(a,b,d,a,d,c0);
    }
    g.indices.push(bottom,rings.at(-1)[i],rings.at(-1)[n]);
  }
}
function createRoachMesh(device) {
  const g={positions:[],normals:[],colors:[],indices:[]};
  // 420 body triangles: five rounded rings per section, with abdomen banding.
  addEllipsoid(g,[0,0.03,0.33],[0.49,0.27,0.80],16,ROACH_COLOR.elytra,
    [ROACH_COLOR.elytra,ROACH_COLOR.abdomen,ROACH_COLOR.abdomenBand,ROACH_COLOR.abdomen,ROACH_COLOR.elytra]);
  addEllipsoid(g,[0,0.055,-0.49],[0.405,0.255,0.47],14,ROACH_COLOR.thorax);
  addEllipsoid(g,[0,0.00,-0.96],[0.27,0.19,0.28],12,ROACH_COLOR.head);

  // 216 leg triangles: six tapered, three-segment legs.
  const legs=[
    {z:-.57,j1:[.53,-.15,-.70],j2:[.82,-.20,-.90],tip:[1.08,-.235,-1.08]},
    {z:-.08,j1:[.60,-.16,-.08],j2:[.90,-.205,-.05],tip:[1.16,-.235,.02]},
    {z:.42,j1:[.56,-.15,.55],j2:[.84,-.20,.77],tip:[1.08,-.235,1.00]}
  ];
  for(const side of [-1,1]) {
    for(const leg of legs) {
      const j1=[side*leg.j1[0],leg.j1[1],leg.j1[2]];
      const j2=[side*leg.j2[0],leg.j2[1],leg.j2[2]];
      const tip=[side*leg.tip[0],leg.tip[1],leg.tip[2]];
      addTaperedBar(g,[side*.30,-.11,leg.z],j1,.105,.082,.075,ROACH_COLOR.limb);
      addTaperedBar(g,j1,j2,.082,.055,.062,ROACH_COLOR.limb);
      addTaperedBar(g,j2,tip,.055,.026,.046,ROACH_COLOR.limb);
    }

    // 72 antenna triangles: three tapered segments per side.
    const a1=[side*.28,.028,-1.31], a2=[side*.48,.036,-1.56], a3=[side*.73,.042,-1.88];
    addTaperedBar(g,[side*.10,.018,-1.14],a1,.046,.036,.038,ROACH_COLOR.limb);
    addTaperedBar(g,a1,a2,.036,.025,.032,ROACH_COLOR.limb);
    addTaperedBar(g,a2,a3,.025,.012,.024,ROACH_COLOR.limb);

    // 48 cerci triangles: two short tapered tail segments per side.
    const c1=[side*.18,-.005,1.15], c2=[side*.30,-.015,1.34];
    addTaperedBar(g,[side*.10,-.005,1.04],c1,.045,.032,.036,ROACH_COLOR.cerci);
    addTaperedBar(g,c1,c2,.032,.014,.028,ROACH_COLOR.cerci);
  }

  // 12-triangle raised elytra seam. Total prototype budget = 768 triangles.
  addTaperedBar(g,[0,.295,-.16],[0,.305,1.02],.038,.025,.018,ROACH_COLOR.seam);

  return pc.createMesh(device,g.positions,{normals:g.normals,colors:g.colors,indices:g.indices});
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
    roaches.push({entity,position,waypoints:[],heading:0,renderHeading:0,nextNavAt:index*.017,nextUpdateAt:0,index});
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
        const turn=((r.heading-r.renderHeading+540)%360)-180;
        r.renderHeading+=turn*Math.min(1,interval*7.5);
        const phase=now*9.1+r.index*.73;
        const moving=moved.moved>.0001;
        const bob=moving?Math.abs(Math.sin(phase))*.040:Math.sin(phase*.18)*.006;
        const sway=moving?Math.sin(phase*.68)*2.6:Math.sin(phase*.16)*.45;
        const pitch=moving?Math.cos(phase*.52)*.85:Math.sin(phase*.12)*.22;
        r.entity.setLocalPosition(r.position.x,roadviewGroundHeight(r.position.x,r.position.z)+0.31+bob,r.position.z);
        r.entity.setLocalEulerAngles(pitch,r.renderHeading,sway);
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
      triangles:stats.frame?.triangles??null,
      prototypeTriangles:GIANT_ROACH_TRIANGLES,estimatedRoachTriangles:roaches.length*GIANT_ROACH_TRIANGLES,errors
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
