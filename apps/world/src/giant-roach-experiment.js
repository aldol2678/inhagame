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

function sharedMaterial() {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(0.19, 0.105, 0.055);
  m.gloss = 18;
  m.metalness = 0.05;
  m.update();
  return m;
}
function part(parent,name,type,scale,pos,material) {
  const e=new pc.Entity(name); e.addComponent('render',{type}); e.setLocalScale(...scale); e.setLocalPosition(...pos);
  e.render.material=material; parent.addChild(e); return e;
}
function createRoachVisual(root,index,material) {
  // One shared-material primitive per stress entity: this experiment measures entity density,
  // not prototype mesh complexity. Keeping one render component avoids multiplying shadow/draw passes.
  const e=new pc.Entity(`GIANT_ROACH_${index+1}`);
  e.addComponent('render',{type:'sphere'});
  // Human-sized crawler silhouette: ~1.7 m long and ~0.6 m tall, still one render primitive.
  e.setLocalScale(0.9,0.6,1.7);
  e.render.material=material;
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
  const roaches=[];
  let lastFrame=nowMs(), errors=0;

  function addOne(index){
    const position=spawnPoint(navigator,center,index);
    const entity=createRoachVisual(campusRoot,index,material);
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
        routeToward(r,{x:playerPos.x,z:playerPos.z});
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
    material.destroy?.(); delete window.__GIANT_ROACH_TEST__;
  }
  setCount(targetCount); app.on('update',update);
  const api=Object.freeze({status,setCount,destroy,counts:GIANT_ROACH_COUNTS});
  window.__GIANT_ROACH_TEST__=api;
  return api;
}
