import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {trianglePenetratesBox} from './browser/npc-c04-geometry.mjs';
import {C04_VIEWPORTS,assertC04Hosted,assertC04Frame,angleError} from './browser/npc-c04-browser-qa.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('C04 hosted gate requires exact PR head and every requested viewport',()=>{
  const env={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',GITHUB_EVENT_NAME:'pull_request',EXPECTED_C04_HEAD:'a'.repeat(40),C04_VIEWPORT:'desktop',WORLD_SMOKE_DISABLE_WEBGPU:'1',WORLD_SMOKE_BROWSER:'chrome'};
  assert.deepEqual(Object.keys(C04_VIEWPORTS),['desktop','portrait','landscape']);
  for(const C04_VIEWPORT of Object.keys(C04_VIEWPORTS))assert.doesNotThrow(()=>assertC04Hosted({...env,C04_VIEWPORT}));
  for(const key of Object.keys(env))assert.throws(()=>assertC04Hosted({...env,[key]:''}));
});
test('C04 actual-render oracle rejects wrong heading, missing prop, wrong seat and absent pixels',()=>{
  const f={seatGeometry:{triangles:100,penetrations:0,contactGap:0},photoLensAlignment:1,photoLensVertical:0,avatarBounds:{x:100,y:300,width:70,height:120},hud:[],actor:{id:'INKYUNG-NPC-009',phase:'ACTING',visible:true,activity:'PHOTO'},render:{enabled:true,heading:171,position:{x:2,z:3},seatAnchorY:.53},renderedFrames:3,clock:{state:'SYNCED'},count:46,viewport:{width:390,height:844},screen:{x:100,y:300},photoTargetYaw:171,photoPropVisible:true,seat:{position:{x:2,z:3},yaw:90},seatTopY:.53};
  assert.doesNotThrow(()=>assertC04Frame(f,{id:f.actor.id,phase:'ACTING'}));
  assert.throws(()=>assertC04Frame({...f,render:{...f.render,heading:37}},{id:f.actor.id,phase:'ACTING'}));
  assert.throws(()=>assertC04Frame({...f,photoPropVisible:false},{id:f.actor.id,phase:'ACTING'}));
  assert.throws(()=>assertC04Frame({...f,renderedFrames:0},{id:f.actor.id,phase:'ACTING'}));
  const seat={...f,actor:{...f.actor,id:'INKYUNG-NPC-010',activity:'RESTING'},render:{...f.render,position:{x:2.10,z:3},heading:90}};
  assert.doesNotThrow(()=>assertC04Frame(seat,{id:seat.actor.id,phase:'ACTING'}));
  assert.throws(()=>assertC04Frame({...seat,render:{...seat.render,position:{x:5,z:3}}},{id:seat.actor.id,phase:'ACTING'}));
  assert.throws(()=>assertC04Frame({...seat,seatGeometry:{...seat.seatGeometry,contactGap:.03}},{id:seat.actor.id,phase:'ACTING'}));
  assert.throws(()=>assertC04Frame({...f,hud:[{x:100,y:300,width:70,height:120}]},{id:f.actor.id,phase:'ACTING'}));
  assert.throws(()=>assertC04Frame({...f,photoLensAlignment:-1},{id:f.actor.id,phase:'ACTING'}));
  assert.throws(()=>assertC04Frame({...seat,seatGeometry:{...seat.seatGeometry,penetrations:1}},{id:seat.actor.id,phase:'ACTING'}));
  assert.equal(angleError(-179,179),2);
});
test('actual campus-life receipt summary handles the C04 record without inventing labels',()=>{
  const source=read('./browser/npc-campus-life-diversity-smoke.mjs');
  const summary=source.split('\n').find(l=>l.includes("console.log('Campus life diversity browser PASS'"));
  assert.ok(summary);let result;
  new Function('receipts','console',summary)([{name:'desktop',labels:[{}]},{name:'c04-living-lunch',photo:'PHOTO',seated:'RESTING'}],{log:(_label,json)=>{result=JSON.parse(json)}});
  assert.equal(result[0].labelCount,1);assert.equal(result[1].labelCount,null);assert.equal(result[1].photo,'PHOTO');
});
test('C04 workflow preserves main-only deployment policy and uploads exact-head three-size evidence',()=>{
  const workflow=read('../../../.github/workflows/npc-c04-living-browser.yml');
  assert.match(workflow,/contents: read/);assert.match(workflow,/ref: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(workflow,/persist-credentials: false/);assert.match(workflow,/viewport: \[desktop, portrait, landscape\]/);
  assert.match(workflow,/npc-c04-living-smoke.mjs/);assert.match(workflow,/actions\/upload-artifact@v4/);
  const policy=JSON.parse(read('../../../vercel.json'));assert.deepEqual(policy.git.deploymentEnabled,{'**':false,main:true});
});

test('C04 inspection camera runs on the actual PlayCanvas pre-render event',()=>{
  const smoke=read('./browser/npc-c04-living-smoke.mjs');
  assert.match(smoke,/d\.app\.on\('prerender',window\.__C04_CAMERA__\)/);
  assert.doesNotMatch(smoke,/['"]postupdate['"]/);
  assert.match(smoke,/assert.equal\(afterScreenshot.actor.phase,phase/);
  assert.match(smoke,/arrivalById\[id\]-20/);
});

test('C04 seat triangle SAT distinguishes penetration from surface contact',()=>{
  assert.equal(trianglePenetratesBox([[-1,0,0],[1,1,0],[1,-1,0]],[.25,.05,.2]),true);
  assert.equal(trianglePenetratesBox([[0,0,0],[.1,0,0],[0,.1,0]],[.25,.05,.2]),true);
  assert.equal(trianglePenetratesBox([[0,.05,0],[.1,.05,0],[0,.05,.1]],[.25,.05,.2]),false);
  assert.equal(trianglePenetratesBox([[2,0,0],[3,0,0],[2,1,0]],[.25,.05,.2]),false);
});
