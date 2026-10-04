// Hosted Chromium only. The shared harness serves the pinned engine from disk,
// blocks all other external traffic, and starts only the disposable local server.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';

const output=process.env.WORLD_STUDENT_QA_OUTPUT||'test-results/student-center-connected';
await mkdir(output,{recursive:true});
const report={
  scope:'Isolated reviewed connected candidate. Historical/conceptual rooms, inferred doors. No production imports, API, account, deployment or original reference-photo traffic.',
  limits:'Keyboard operates the real connected collision/support adapter through this test input shell, not the production PlayerController. Deterministic 0.1 m held-key ticks (up to four per rendered frame) are accelerated QA, not a real-time speed benchmark. Positive-Z controls and lifecycle probes are programmatic. Pixel deltas establish visibility, not photorealistic fidelity or a manual aesthetic review.',
  status:'RUNNING',viewports:[],
};
const save=()=>writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
const checkDisposal=receipt=>{
  assert.ok(receipt.meshes>0);assert.ok(receipt.destroyCalls.every(n=>n===1));
  assert.equal(receipt.buffersReleased,true);assert.equal(receipt.rootDetached,true);
};
const checkPixels=p=>{assert.equal(p.glError,0);assert.ok(p.width>0&&p.height>0);assert.ok(p.quantizedColors>=5,'frame must contain varied actual canvas pixels');};
const checkFullFrame=f=>{
  assert.equal(f.scope,'entire silhouette');assert.ok(f.points>0);assert.equal(f.captionOverlapsCanvas,false);
  assert.ok(f.minX>=.06&&f.maxX<=.94&&f.minY>=.06&&f.maxY<=.94,JSON.stringify(f));
};

try {
  for(const [name,viewport,mobile] of [
    ['desktop',{width:1280,height:720},false],
    ['portrait',{width:390,height:844},true],
    ['landscape',{width:844,height:390},true],
  ]) {
    const entry={name,viewport,actualKeyboard:[],pixelEvidence:[],programmaticContracts:[],network:{apiAttempts:[],externalAttempts:[]},status:'RUNNING'};
    report.viewports.push(entry);let smoke,page;
    try {
      smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1}});
      page=await smoke.context.newPage();const fatal=smoke.watch(page);
      const race=p=>Promise.race([p,fatal]);
      page.on('request',request=>{
        const url=new URL(request.url());
        if(url.origin===smoke.origin){if(url.pathname.startsWith('/api/'))entry.network.apiAttempts.push(url.pathname);return;}
        // This single URL is fulfilled from pinned local npm bytes by harness.mjs.
        if(url.href!=='https://cdn.jsdelivr.net/npm/playcanvas@2.22.4/build/playcanvas.mjs')entry.network.externalAttempts.push(url.origin+url.pathname);
      });
      await page.goto(`${smoke.origin}/tests/browser/student-center-connected-hosted-harness.html`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
      await race(page.waitForFunction(()=>window.__STUDENT_HOSTED_QA__?.ready||window.__STUDENT_HOSTED_QA__?.error,null,{timeout:TIMEOUT_MS}));
      assert.equal(await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.error),undefined);
      const plan=await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.plan);
      assert.deepEqual(plan.actor,{radiusMeters:.48,diameterMeters:.96,heightMeters:1.75});
      const pixels=()=>race(page.evaluate(()=>window.__STUDENT_HOSTED_QA__.pixels()));
      async function capture(view,label,{actor=true,full=false}={}) {
        await page.evaluate(id=>window.__STUDENT_HOSTED_QA__.view(id),view);
        await pixels();
        await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.visibility({building:false}));
        const withoutBuilding=await pixels();
        await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.visibility());
        const visible=await pixels();checkPixels(visible);
        assert.ok(visible.visibleCandidateMeshes>0,`${label}: actual candidate meshes visible`);
        assert.ok(visible.changed>50&&withoutBuilding.changed>50,`${label}: hiding real candidate must alter rendered pixels`);
        const stable=await pixels();assert.equal(stable.hash,visible.hash);assert.equal(stable.changed,0,`${label}: stationary frame`);
        let withoutActor=null;
        if(actor){
          await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.visibility({person:false}));
          withoutActor=await pixels();assert.ok(withoutActor.changed>3,`${label}: actor must be visible in close-up canvas pixels`);
          await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.visibility());await pixels();
        }
        const framing=await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.framing());
        if(full)checkFullFrame(framing);else assert.equal(framing.captionOverlapsCanvas,false);
        const filename=`${name}-${label}.png`;
        const evidence={view,label,filename,visible,withoutBuilding,withoutActor,stable,framing,state:await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.getState())};
        entry.pixelEvidence.push(evidence);
        await page.screenshot({path:path.join(output,filename),timeout:TIMEOUT_MS});
        return evidence;
      }
      for(const space of ['world','local']) {
        entry.stats=await page.evaluate(coordinateSpace=>window.__STUDENT_HOSTED_QA__.configure({coordinateSpace,reflected:true}),space);
        assert.equal(entry.stats.engine,'2.22.4');assert.equal(entry.stats.parentScaleSign,-1);
        assert.deepEqual(entry.stats.offsetWorld,[2.2,-7.15]);assert.equal(entry.stats.rotationDelta,0);
        const contracts=await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.programmaticContracts());
        assert.ok(Math.abs(contracts.offset[0]-2.2)<1e-9&&Math.abs(contracts.offset[1]+7.15)<1e-9);
        assert.equal(contracts.yaw,contracts.baseYaw);assert.equal(contracts.phantomFloor.supported,false);
        assert.equal(contracts.wallTunnel.blocked,true);assert.equal(contracts.glassPane.clear,false);assert.equal(contracts.openDoor.clear,true);
        assert.deepEqual(contracts.actorWorldSize,[.48,.875,.48]);
        assert.ok(contracts.redCore.x<contracts.roundedGlass.x,`${name}/${space}: production red core must project left of rounded glass`);
        contracts.lifecycle.forEach(checkDisposal);entry.programmaticContracts.push({space,reflected:true,...contracts});
        for(const reverse of [false,true]) {
          const direction=reverse?'reverse':'forward',route=reverse?[...plan.route].reverse():plan.route;
          const run={space,direction,scope:'Actual trusted browser keydown/up events only; no position-setting API',segments:[],status:'RUNNING'};
          entry.actualKeyboard.push(run);
          await capture('exterior',`${space}-${direction}-exterior`,{actor:false,full:true});
          const initial=await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.getState());
          for(let i=1;i<route.length;i++) {
            const [ax,az]=route[i-1].at,[bx,bz]=route[i].at,dx=bx-ax,dz=bz-az;
            assert.equal(Number(dx!==0)+Number(dz!==0),1,'plan must be axis-aligned');
            const key=dx?dx>0?'ArrowRight':'ArrowLeft':dz>0?'ArrowDown':'ArrowUp';
            const ticks=Math.round(Math.hypot(dx,dz)/plan.tickMeters);
            const before=await page.evaluate(n=>window.__STUDENT_HOSTED_QA__.armInput(n),ticks);
            await page.locator('#stage').focus();
            await page.keyboard.down(key);
            try {
              await race(page.waitForFunction(()=>{const s=window.__STUDENT_HOSTED_QA__.getState();return s.remaining===0||s.blockedTicks>0;},null,{timeout:TIMEOUT_MS}));
            } finally {await page.keyboard.up(key);}
            const after=await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.getState());
            const segment={index:i,label:route[i].label,key,ticks,before,after};run.segments.push(segment);
            assert.equal(after.blockedTicks,0,JSON.stringify(segment));assert.equal(after.raw.blocked,false,JSON.stringify(segment));
            assert.equal(after.inputTicks-before.inputTicks,ticks,`${space}/${direction}/${i}: every tick came from held input`);
            assert.equal(after.trustedDowns-before.trustedDowns,1);assert.equal(after.trustedUps-before.trustedUps,1);
            assert.ok(Math.hypot(after.local.x-bx,after.local.z-bz)<1e-6,JSON.stringify(segment));
            assert.deepEqual(after.keys,[]);assert.equal(after.remaining,0);
            if(route[i].view&&route[i].view!=='exterior')await capture(route[i].view,`${space}-${direction}-${route[i].view}`);
          }
          run.final=await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.getState());
          assert.ok(Math.hypot(run.final.local.x-initial.local.x,run.final.local.z-initial.local.z)<1e-6);
          assert.ok(Math.abs(run.final.local.elevation)<1e-8);assert.ok(run.final.maxElevation>=4.03);
          run.ticks=run.final.inputTicks-initial.inputTicks;assert.ok(run.ticks>1000);
          run.status='PASS';await save();
        }
        const trace=await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.trace());
        assert.ok(trace.length>100);assert.ok(trace.every(t=>t.supported&&t.clear&&!t.blocked));
        await writeFile(path.join(output,`${name}-${space}-keyboard-trace.json`),JSON.stringify(trace,null,2)+'\n');
        // Same logical coordinate input, opposite render-parent sign only. No walk claim.
        await page.evaluate(coordinateSpace=>window.__STUDENT_HOSTED_QA__.configure({coordinateSpace,reflected:false}),space);
        await capture('exterior',`${space}-positive-z-render-control`,{actor:false,full:true});
        const control=await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.programmaticContracts());
        assert.ok(control.redCore.x>control.roundedGlass.x,'positive-Z screen-order control');
        entry.programmaticContracts.push({space,reflected:false,...control});
      }
      // Exercise real ResizeObserver/device resize twice in the same app, restoring the requested viewport.
      await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.configure({coordinateSpace:'world',reflected:true}));
      entry.resize=[];
      for(const size of [{width:viewport.width+37,height:viewport.height+29},viewport]) {
        await page.setViewportSize(size);
        await race(page.waitForFunction(({width,height})=>{
          const canvas=document.getElementById('stage');return innerWidth===width&&innerHeight===height&&canvas.width===canvas.clientWidth&&canvas.height===canvas.clientHeight;
        },size,{timeout:TIMEOUT_MS}));
        const actual=await pixels();checkPixels(actual);const framing=await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.framing());checkFullFrame(framing);
        entry.resize.push({viewport:size,pixels:actual,framing});
      }
      const beforeRebuild=await pixels();
      entry.rebuild=await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.rebuild());checkDisposal(entry.rebuild.disposal);
      const afterRebuild=await pixels();checkPixels(afterRebuild);assert.equal(afterRebuild.hash,beforeRebuild.hash,'rebuild renders identical visible geometry');
      entry.disposal=await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.dispose());checkDisposal(entry.disposal.receipt);assert.equal(entry.disposal.disposed,true);
      const beforeDisposedKey=await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.getState());
      await page.keyboard.down('ArrowUp');await page.keyboard.up('ArrowUp');
      assert.deepEqual(await page.evaluate(()=>window.__STUDENT_HOSTED_QA__.getState()),beforeDisposedKey,'disposed keyboard listeners do not advance state');
      assert.deepEqual(entry.network.apiAttempts,[]);assert.deepEqual(entry.network.externalAttempts,[]);assert.deepEqual(smoke.problems,[]);
      entry.status='PASS';
    } catch(error) {
      entry.status='FAIL';entry.error=String(error.stack||error);
      if(page){
        entry.lastState=await page.evaluate(()=>window.__STUDENT_HOSTED_QA__?.getState?.()).catch(()=>null);
        await page.screenshot({path:path.join(output,`${name}-failure.png`),timeout:TIMEOUT_MS}).catch(()=>{});
      }
      throw error;
    } finally {if(smoke)await smoke.close();await save();}
  }
  report.status='PASS';console.log('student-center hosted Chromium pixels, trusted input and lifecycle: PASS');
} catch(error) {report.status='FAIL';throw error;}
finally {await save();}
