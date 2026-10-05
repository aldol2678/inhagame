import * as pc from 'playcanvas';
import { createNpcNavigator, advanceRoute } from '../../npc-factory/dev-navigation.mjs';
import { roadviewGroundHeight } from './roadview-layout.js';

export const GIANT_ROACH_COUNTS = Object.freeze([10, 30, 50, 100]);
export const GIANT_ROACH_MAX = 100;
export const GIANT_ROACH_TRIANGLES = 384;

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

const ROACH_COLOR = Object.freeze({
  abdomen: [0.68,0.24,0.070,1],
  thorax: [0.48,0.14,0.038,1],
  head: [0.27,0.070,0.022,1],
  limb: [0.16,0.043,0.014,1],
  seam: [0.32,0.080,0.022,1]
});
function pushColor(colors,color,count=1){ for(let i=0;i<count;i++) colors.push(...color); }
function pushQuad(positions,normals,colors,indices,a,b,c,d,n,color) {
  const o=positions.length/3;
  for(const p of [a,b,c,d]) positions.push(...p);
  for(let i=0;i<4;i++) normals.push(...n);
  pushColor(colors,color,4);
  indices.push(o,o+1,o+2,o,o+2,o+3);
}
function addBar(g,from,to,width=.08,height=.08,color=ROACH_COLOR.limb) {
  const dx=to[0]-from[0], dz=to[2]-from[2], len=Math.hypot(dx,dz)||1;
  const px=-dz/len*width/2, pz=dx/len*width/2, y0=from[1]-height/2, y1=from[1]+height/2;
  const a=[from[0]+px,y0,from[2]+pz], b=[from[0]-px,y0,from[2]-pz];
  const c=[to[0]-px,y0,to[2]-pz], d=[to[0]+px,y0,to[2]+pz];
  const A=[a[0],y1,a[2]], B=[b[0],y1,b[2]], C=[c[0],y1,c[2]], D=[d[0],y1,d[2]];
  pushQuad(g.positions,g.normals,g.colors,g.indices,A,D,C,B,[0,1,0],color);
  pushQuad(g.positions,g.normals,g.colors,g.indices,a,b,c,d,[0,-1,0],color);
  const nx=dz/len,nz=-dx/len;
  pushQuad(g.positions,g.normals,g.colors,g.indices,a,d,D,A,[nx,0,nz],color);
  pushQuad(g.positions,g.normals,g.colors,g.indices,b,B,C,c,[-nx,0,-nz],color);
  pushQuad(g.positions,g.normals,g.colors,g.indices,a,A,B,b,[-dx/len,0,-dz/len],color);
  pushQuad(g.positions,g.normals,g.colors,g.indices,d,c,C,D,[dx/len,0,dz/len],color);
}
function addEllipsoid(g,c,r,segments,color) {
  const top=g.positions.length/3;
  g.positions.push(c[0],c[1]+r[1],c[2]); g.normals.push(0,1,0); pushColor(g.colors,color);
  const rings=[];
  for(const theta of [Math.PI*.25,Math.PI*.5,Math.PI*.75]) {
    const ring=[];
    const sy=Math.cos(theta), radial=Math.sin(theta);
    for(let i=0;i<segments;i++) {
      const a=i/segments*Math.PI*2, ca=Math.cos(a), sa=Math.sin(a);
      const x=ca*radial, z=sa*radial;
      ring.push(g.positions.length/3);
      g.positions.push(c[0]+x*r[0],c[1]+sy*r[1],c[2]+z*r[2]);
      const nx=x/r[0],ny=sy/r[1],nz=z/r[2],nl=Math.hypot(nx,ny,nz)||1;
      g.normals.push(nx/nl,ny/nl,nz/nl); pushColor(g.colors,color);
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
  addEllipsoid(g,[0,0.02,0.30],[0.47,0.25,0.76],12,ROACH_COLOR.abdomen);
  addEllipsoid(g,[0,0.04,-0.50],[0.39,0.24,0.45],10,ROACH_COLOR.thorax);
  addEllipsoid(g,[0,0.00,-0.94],[0.26,0.18,0.26],8,ROACH_COLOR.head);

  const legs=[
    {z:-.55,knee:[.66,-.18,-.78],tip:[1.03,-.23,-1.00]},
    {z:-.08,knee:[.76,-.19,-.10],tip:[1.12,-.23,-.04]},
    {z:.40,knee:[.70,-.18,.62],tip:[1.04,-.23,.91]}
  ];
  for(const side of [-1,1]) {
    for(const leg of legs) {
      const knee=[side*leg.knee[0],leg.knee[1],leg.knee[2]];
      const tip=[side*leg.tip[0],leg.tip[1],leg.tip[2]];
      addBar(g,[side*.30,-.12,leg.z],knee,.085,.065,ROACH_COLOR.limb);
      addBar(g,knee,tip,.065,.055,ROACH_COLOR.limb);
    }
    const antennaKnee=[side*.34,.025,-1.36], antennaTip=[side*.68,.035,-1.78];
    addBar(g,[side*.12,.015,-1.12],antennaKnee,.045,.038,ROACH_COLOR.limb);
    addBar(g,antennaKnee,antennaTip,.032,.03,ROACH_COLOR.limb);
  }
  addBar(g,[0,.275,-.12],[0,.285,.94],.036,.018,ROACH_COLOR.seam);

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
        const phase=now*8.5+r.index*.73;
        const bob=Math.abs(Math.sin(phase))*.035;
        const sway=Math.sin(phase*.72)*2.2;
        r.entity.setLocalPosition(r.position.x,roadviewGroundHeight(r.position.x,r.position.z)+0.31+bob,r.position.z);
        r.entity.setLocalEulerAngles(0,r.renderHeading,sway);
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
