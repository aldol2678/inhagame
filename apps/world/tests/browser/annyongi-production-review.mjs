// Read-only local review. The original GLB and captures belong outside the repo.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {startSmoke} from './harness.mjs';
assert.ok(process.env.FIDELITY_RIDER_GLB,'Set a private local Production GLB path');
const body=await readFile(process.env.FIDELITY_RIDER_GLB);
const out=process.env.ANNYONGI_OUTPUT||'test-results/annyongi/production-review';await mkdir(out,{recursive:true});
const smoke=await startSmoke({viewport:{width:720,height:800}});
try {
 await smoke.context.route('**/assets/induck-v3.glb',route=>route.fulfill({status:200,contentType:'model/gltf-binary',body}));
 const page=await smoke.context.newPage();smoke.watch(page);
 await page.goto(smoke.origin+'/tests/browser/annyongi-review-harness.html');await page.waitForFunction(()=>window.__ANNYONGI_REVIEW__);
 await page.evaluate(()=>{const d=window.__ANNYONGI_REVIEW__;d.character.setMounted(false);d.character.update(.05,{mounted:false,moving:false,grounded:true});d.rider.enabled=true;d.camera.camera.orthoHeight=1.25;});
 for(const [name,position] of [['basic',[0,.1,6]],['front',[0,.1,6]],['right',[6,.1,0]],['back',[0,.1,-6]],['left',[-6,.1,0]]]) {
  await page.evaluate(position=>{const d=window.__ANNYONGI_REVIEW__;d.camera.setPosition(...position);d.camera.lookAt(0,-.03,0);},position);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await page.screenshot({path:`${out}/induck-${name}.png`,timeout:60000});
 }
 const transitions=await page.evaluate(async()=>{
  const pc=await import('playcanvas'),d=window.__ANNYONGI_REVIEW__;d.character.setMounted(true);
  const results=[];
  for(const mode of ['ground','hover','ascend','forward','descend','landing','ground']) {
   let minimum=Infinity;
   for(let step=0;step<120;step++) {
    const p=d.player.getLocalPosition(),dt=1/60;
    d.player.setLocalPosition(p.x,p.y+(['descend','landing'].includes(mode)?-5*dt:mode==='ascend'?5*dt:0),p.z+(mode==='forward'?6*dt:0));
    d.character.update(dt,{mounted:true,moving:mode==='forward',grounded:mode==='ground',flightClearance:mode==='landing'?.1:Infinity});
    const inverse=d.carrier.findByName('FlightHeadPivot').getWorldTransform().clone().invert();
    for(const c of d.rider.findComponents('render'))for(const mi of c.meshInstances) {
     const v=[];mi.mesh.getPositions(v);const matrix=new pc.Mat4().mul2(inverse,mi.node.getWorldTransform());
     for(let i=0;i<v.length;i+=3){const q=matrix.transformPoint(new pc.Vec3(v[i],v[i+1],v[i+2]));minimum=Math.min(minimum,(q.x/.69)**2+((q.y-.37)/.63)**2+((q.z-.07)/.52)**2);}
    }
   }
   results.push({mode,minimum,actual:d.character.flightVisualState.mode});
  }
  return results;
 });
 for(const t of transitions){assert.equal(t.mode,t.actual);assert.ok(t.minimum>=1,`${t.mode}: real rider/head intersection ${t.minimum}`);}
 assert.deepEqual(smoke.problems,[]);
 await writeFile(out+'/result.json',JSON.stringify({sourceSha256:createHash('sha256').update(body).digest('hex'),bytes:body.length,transitions,problems:smoke.problems},null,2));
}finally{await smoke.close();}
