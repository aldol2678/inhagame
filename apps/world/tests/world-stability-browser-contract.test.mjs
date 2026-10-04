import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeDocument } from './support/fake-dom.mjs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('hosted stability QA pins exact head and uses bounded read-only offline Chromium',()=>{
 const flow=read('../../../.github/workflows/world-stability-browser.yml');
 assert.match(flow,/contents: read/);assert.match(flow,/timeout-minutes: 15/);assert.match(flow,/ref: \$\{\{ github.event.pull_request.head.sha \}\}/);
 assert.match(flow,/EXPECTED_STABILITY_HEAD:/);assert.doesNotMatch(flow,/pull_request_target|secrets\.|contents: write|supabase db/);
 const smoke=read('./browser/world-stability-smoke.mjs');assert.match(smoke,/legacy-explicit-ended-point/);assert.match(smoke,/foreign native pointerup required/);assert.match(smoke,/releaseCapture\(id\),owner.id/);assert.match(smoke,/Input.dispatchTouchEvent/);assert.match(smoke,/gotpointercapture/);assert.match(smoke,/lostpointercapture/);assert.match(smoke,/sha256/);assert.equal((smoke.match(/touch\('touchStart',\[first\]\);await active\(\)/g)??[]).length,4,'every fresh native gesture proves movement before reset');assert.match(smoke,/native-fresh-gesture-recovery/);assert.match(smoke,/assert.deepEqual\(smoke.problems,\[\]\)/);
 const fixture=read('./browser/world-stability-fixture.mjs');assert.doesNotMatch(fixture,/fetch\(|createClient\(|signIn|localStorage|sessionStorage/);
});

test('browser auth fixture executes actual clients/panel and valid daily contracts offline',async t=>{
 const previous=Object.fromEntries(['window','document','HTMLElement'].map(k=>[k,globalThis[k]]));t.after(()=>Object.assign(globalThis,previous));
 const doc=createFakeDocument();doc.body=doc.createElement('body');
 const ids=['shop-panel','joystick','joystick-knob','jump','run','descend','receipt'];const elements=Object.fromEntries(ids.map(id=>[id,doc.createElement('div')]));
 for(const el of Object.values(elements)){el.style={};el.clientWidth=120;el.getBoundingClientRect=()=>({left:0,top:0,width:120,height:120});el.hasPointerCapture=()=>false;}
 elements['joystick-knob'].clientWidth=40;doc.getElementById=id=>elements[id]??null;
 globalThis.document=doc;globalThis.window={addEventListener(){},dispatchEvent(){}};globalThis.HTMLElement=class{};
 await import('./browser/world-stability-fixture.mjs');const f=window.__WORLD_STABILITY__;assert.equal(f.ready,true);
 const walk=node=>[node,...(node.children??[]).flatMap(walk)];
 for(const accounts of [['fixture-B'],['fixture-B','fixture-A'],[null]])for(const failure of [false,true]){
  await f.prepareShop();walk(elements['shop-panel']).find(n=>n.className==='shop-offer-buy').click();await f.beginReadback();await f.switchShop(accounts);const r=await f.finishReadback(failure);assert.equal(r.outcome,'STALE');assert.equal(r.writes,1);
 }
 assert.equal((await f.loadoutBoundaries()).length,12);assert.equal((await f.staleKey()).sameRetryKey,true);assert.equal((await f.dailyOrdering()).length,2);
 const pad=elements.joystick,released=[];pad.setPointerCapture=()=>{};pad.hasPointerCapture=id=>id===2||id===3;pad.releasePointerCapture=id=>released.push(id);
 pad.dispatch('pointerdown',{pointerId:2,clientX:100,clientY:60});pad.dispatch('pointerdown',{pointerId:3,clientX:20,clientY:60});f.releaseCapture(2);assert.deepEqual(released,[2],'explicit owner survives another pointer implicit capture');
});
