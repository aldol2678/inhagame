// Diagnostic only: identical pinned campus source, camera, environment and settings for PNG then pacing.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
import { boundedPerformancePhase } from './biryong-performance-diagnostics.mjs';
import { finalizeTraceDiagnostic } from './biryong-render-trace-cleanup.mjs';
import { assertReproductionSourceIdentity, PROTOCOL, classifyReproduction, assertSameCampusScene, sampleCampusPacing, assessPacing, readCampusScene, settleCampusRenders } from './campus-render-reproduction-support.mjs';
import { NPC_WORLD_EPOCH_MS } from '../../npc-factory/npc-world-time-contract.mjs';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const output = resolve(process.env.CAMPUS_REPRO_OUTPUT || 'test-results/campus-render-reproduction');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding:'utf8', timeout:5000 }).trim();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = { schema:'campus-render-reproduction-v1', measurementClass:'DIAGNOSTIC_ONLY',
  performanceAcceptance:'NOT_EVALUATED', realDevice:false, status:'RUNNING', protocol:PROTOCOL,
  samplerHead:git(repo,'rev-parse','HEAD'), samplerTree:git(repo,'rev-parse','HEAD^{tree}'),
  sourcePins:{app:process.env.CAMPUS_REPRO_APP_SHA??null,sampler:process.env.CAMPUS_REPRO_SAMPLER_SHA??null},
  sourcePolicy:'Direct clean checkouts of the same immutable instrumented revision; no instrumentation overlay. Application and sampler identities and file hashes are recorded separately.',
  runtime:{node:process.version,platform:process.platform,arch:process.arch,disableWebGpu:process.env.WORLD_SMOKE_DISABLE_WEBGPU==='1'},
  source:null, sourceHashes:{}, samplerHashes:{}, attempts:Array.from({length:PROTOCOL.attempts},(_,index)=>({attempt:index+1,status:'NOT_ATTEMPTED',phases:[],png:null,pacing:null})),
  warmupPolicy:'Before PNG and after PNG terminal state plus decode: observe three natural postrender events, host bounded at 15 s. No forced frame, sleep-based success, retry or app timeout change. This excludes an active application capture request but does not establish that native encoding or GPU/driver work is idle, or that thermal history is identical.',
  limits:['Photo mode stays open for both measurements so the same real camera is fixed. This is not the gameplay-mode graphics acceptance run.',
    'Two fresh offline browser contexts only. Natural failure not reproduced remains unresolved.',
    'Photo diagnostics are reread once after pacing without an extra wait or retry. Absent late callback evidence does not prove the callback never ran; it may occur after the final observation or outside the retained-record observation limit.',
    '2500 ms window, minimum 3 rendered frames and <=34 FPS ceiling are unchanged. A ~1 FPS CI renderer cannot validate real 30 FPS pacing.',
    'The separate e49419c3 old-main trace remains immutable historical evidence. PNG evidence from 2f991bb is not same-source evidence.',
    'The earlier 66695573 application did not include split readback instrumentation. This instrumented application is a different revision, not an identical-source rerun of that historical diagnostic.'],
  launchedAt:new Date().toISOString() };
await mkdir(output,{recursive:true});
const persist = () => {
  if(receipt.attempts.some(run=>run.forcedFailureExit)){
    receipt.status='DIAGNOSTIC_PARTIAL';receipt.naturalFailure=classifyReproduction(receipt.attempts);
    receipt.resolution='UNRESOLVED: owned cleanup did not finish; remaining planned attempts were not started.';
    receipt.completedAt=new Date().toISOString();
  }
  return writeFile(join(output,'receipt.json'),JSON.stringify(receipt,null,2));
};
let root, main, servedMain;
try {
  assert.ok(process.env.CAMPUS_REPRO_WORLD_ROOT,'pinned application worldRoot is required');
  root = resolve(process.env.CAMPUS_REPRO_WORLD_ROOT);
  receipt.source = { head:git(root,'rev-parse','HEAD'),tree:git(root,'rev-parse','HEAD^{tree}') };
  receipt.sourcePins = assertReproductionSourceIdentity({appHead:receipt.source.head,samplerHead:receipt.samplerHead});
  assert.equal(git(root,'status','--porcelain','--untracked-files=no'),'','application source must be clean');
  assert.equal(git(repo,'status','--porcelain','--untracked-files=no'),'','sampler source must be clean');
  for(const path of ['src/main.js','src/photo/photo-capture.js','src/photo/photo-mode.js','src/photo/photo-mode-panel.js',
    'src/photo/photo-camera-controller.js','src/graphics-presets.js','campus/index.html','styles.css','tests/browser/package.json'])
    receipt.sourceHashes[path] = sha256(await readFile(join(root,path)));
  for(const path of ['campus-render-reproduction.mjs','campus-render-reproduction-support.mjs','harness.mjs','harness-source.mjs','harness-cleanup.mjs','biryong-performance-diagnostics.mjs','biryong-render-trace-cleanup.mjs',
    'package.json','package-lock.json','../../npc-factory/npc-world-time-contract.mjs'])
    receipt.samplerHashes[path] = sha256(await readFile(new URL(path,import.meta.url)));
  receipt.runtime.engineVersion=JSON.parse(await readFile(new URL('./package.json',import.meta.url),'utf8')).devDependencies.playcanvas;
  receipt.runtime.engineSha256=sha256(await readFile(new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url)));
  main = await readFile(join(root,'src/main.js'),'utf8');
  const needle = 'const worldClock = previewHost ? null : createNpcWorldClock();';
  assert.equal(main.split(needle).length,2,'same documented fixed-clock seam');
  servedMain = main.replace(needle,'const worldClock = window.__GRAPHICS_QA_CLOCK__;');
  receipt.clockOverride = { originalMainSha256:sha256(main),servedMainSha256:sha256(servedMain),
    seam:needle,replacement:'const worldClock = window.__GRAPHICS_QA_CLOCK__;',epoch:NPC_WORLD_EPOCH_MS };
  await persist();
  let referenceScene;
  for(const run of receipt.attempts) {
    const attempt=run.attempt;run.status='RUNNING';await persist();
    let smoke,page,fatal;
    async function phase(label,work,timeoutMs=PROTOCOL.phaseMs,useFatal=true) {
      const record={label,state:'RUNNING',startedAt:new Date().toISOString(),startedMs:Date.now(),
        deadline:timeoutMs===null?{owner:'harness',serverMs:15000,browserSetupMs:TIMEOUT_MS,cleanupMs:5000}:{owner:'node',timeoutMs}};
      run.phases.push(record);await persist();
      try { const value=await (timeoutMs===null?work():boundedPerformancePhase(work,{label,timeoutMs,fatal:useFatal?fatal:null})); record.state='DONE'; return value; }
      catch(error) { record.state='ERROR';record.error=String(error);throw error; }
      finally {record.elapsedMs=Date.now()-record.startedMs;await persist();}
    }
    try {
      smoke=await phase('start-offline-browser',()=>startSmoke({worldRoot:root,viewport:PROTOCOL.viewport,contextOptions:{acceptDownloads:true},startupTimeoutMs:TIMEOUT_MS}),null);
      await phase('configure-fixed-clock',async()=>{
      await smoke.context.route('**/src/main.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:servedMain}));
      await smoke.context.addInitScript(({epoch,minute})=>{
        localStorage.clear();
        window.__GRAPHICS_QA_CLOCK__={nowMs:epoch+minute*60000,now(){return this.nowMs;},
          async sync(){return this.status();},refreshIfDue(){},dispose(){},
          status(){return {state:'SYNCED',serverNowMs:this.nowMs,ageMs:0,rttMs:0,lastError:null};}};
      },{epoch:NPC_WORLD_EPOCH_MS,minute:PROTOCOL.worldMinute});
      });
      run.browserVersion=smoke.context.browser().version();
      page=await phase('create-page',()=>smoke.context.newPage());fatal=smoke.watch(page);
      await phase('boot-campus',async()=>{
        await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear&photoDiagnostics=1`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
        await page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus?.().loading?.finished,null,{timeout:TIMEOUT_MS});
        await page.bringToFront();
        await page.evaluate(protocol=>{
          const d=window.__INHAGAME_P0__;
          d.player.setLocalPosition(...protocol.player);d.controller.velocityY=0;d.controller.grounded=true;
          Object.assign(d.orbit,protocol.orbit);d.graphics.setPreference(protocol.graphics.preference);
          for(const key of ['renderScale','shadows','frameLimit'])d.graphics.setDetail(key,protocol.graphics[key]);
        },PROTOCOL);
        await page.waitForFunction(()=>{const d=window.__INHAGAME_P0__,e=window.__INHAGAME_ENVIRONMENT__.status();
          return d.getStatus().photoMode.blocked===null && e.settled && e.weatherSettled;},null,{timeout:TIMEOUT_MS});
      },TIMEOUT_MS);
      run.servedHashes=await phase('verify-served-source',()=>page.evaluate(async paths=>Object.fromEntries(await Promise.all(paths.map(async path=>{
        const response=await fetch(`/${path}`);if(!response.ok)throw Error(`source fetch failed: ${path}`);
        return [path,[...new Uint8Array(await crypto.subtle.digest('SHA-256',await response.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('')];
      }))),Object.keys(receipt.sourceHashes)));
      assert.deepEqual(run.servedHashes,{...receipt.sourceHashes,'src/main.js':receipt.clockOverride.servedMainSha256});
      await phase('three-renders-before-photo-entry',()=>page.evaluate(settleCampusRenders,PROTOCOL.settleRenders));
      await phase('open-photo-mode',async()=>{
        await page.locator('#photo-mode-toggle').click();
        await page.waitForFunction(()=>window.__INHAGAME_P0__.getStatus().photoMode.active);
      });
      run.warmupBefore=await phase('three-renders-before-png',()=>page.evaluate(settleCampusRenders,PROTOCOL.settleRenders));
      run.before=await phase('scene-before-png',()=>page.evaluate(readCampusScene));
      assert.equal(run.before.graphics.frameLimit,30);assert.equal(run.before.graphics.renderScale,1);
      assert.equal(run.before.graphics.tier,'high');assert.equal(run.before.graphics.shadowResolution,1024);assert.equal(run.before.graphics.castShadows,true);
      assert.equal(run.before.environment.targetTime,'DAY');assert.equal(run.before.environment.targetWeather,'CLEAR');
      assert.deepEqual(run.before.viewport,[1280,720,1]);assertSameCampusScene(run.before,run.before);
      if(referenceScene) assertSameCampusScene(referenceScene,run.before);else referenceScene=run.before;
      // Save the exact camera/viewport/environment before attempting a potentially hung capture.
      await persist();
      const downloads=[];page.on('download',download=>downloads.push(download));
      const downloadReady=new Promise(resolve=>page.once('download',resolve));
      await phase('native-png-request-and-terminal-state',async()=>{
        await page.locator('[data-photo-control="capture"]').click();
        await page.waitForFunction(()=>{
          const d=window.__INHAGAME_P0__,last=d.getPhotoCaptureDiagnostics?.().at(-1);
          return last?.code && !d.getStatus().photoMode.panel.busy;
        },null,{timeout:PROTOCOL.phaseMs});
        const records=await page.evaluate(()=>window.__INHAGAME_P0__.getPhotoCaptureDiagnostics());
        run.png={code:records.at(-1).code,records,success:records.at(-1).code==='success'};
      });
      await persist();
      if(run.png.success) await phase('preserve-and-decode-png',async()=>{
        const download=await downloadReady;
        assert.equal(downloads.length,1,'one capture creates one download');
        const file=`attempt-${attempt}.png`;await download.saveAs(join(output,file));
        assert.equal(await download.failure(),null);
        const bytes=await readFile(join(output,file));
        assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
        assert.equal(bytes.readUInt32BE(16),run.before.drawingBuffer[0]);assert.equal(bytes.readUInt32BE(20),run.before.drawingBuffer[1]);
        run.png.file=file;run.png.sha256=sha256(bytes);run.png.bytes=bytes.length;
        run.png.decoded=await page.evaluate(async encoded=>{
          const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],{type:'image/png'}));
          const c=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);
          const data=ctx.getImageData(0,0,c.width,c.height).data;let opaque=0;const bins=new Set();
          for(let i=0;i<data.length;i+=4){if(data[i+3]===255)opaque++;if(i%64===0)bins.add(`${data[i]>>4},${data[i+1]>>4},${data[i+2]>>4}`);}
          bitmap.close();return {width:c.width,height:c.height,opaque,colorBins:bins.size};
        },bytes.toString('base64'));
        assert.equal(run.png.decoded.opaque,run.before.drawingBuffer[0]*run.before.drawingBuffer[1]);assert.ok(run.png.decoded.colorBins>3);
      });
      // Capture stays in the same photo session. No camera reset, settings change or forced frame.
      run.warmupAfter=await phase('three-renders-after-png-terminal-and-decode',()=>page.evaluate(settleCampusRenders,PROTOCOL.settleRenders));
      run.beforePacing=await phase('scene-before-pacing',()=>page.evaluate(readCampusScene));
      assertSameCampusScene(run.before,run.beforePacing);
      run.pacing=await phase('unchanged-2500ms-pacing',()=>page.evaluate(sampleCampusPacing));await persist();
      run.pacing.assessment=assessPacing(run.pacing);
      run.after=await phase('scene-after-pacing',()=>page.evaluate(readCampusScene));
      assertSameCampusScene(run.before,run.after);run.invariants='PASS';
      run.photoDiagnosticsAfterPacing=await phase('photo-diagnostics-after-pacing',()=>page.evaluate(()=>window.__INHAGAME_P0__.getPhotoCaptureDiagnostics()));
      assert.equal(downloads.length,run.png.success?1:0,'no delayed duplicate or failed-capture download');
      run.status='COLLECTED';await persist();
    } catch(error) {
      run.status='PARTIAL';run.error=error.stack||String(error);
      if(error.code==='SMOKE_STARTUP_TIMEOUT' || ['failed','timeout'].includes(error.startupCleanup)){
        run.startupCleanup=error.startupCleanup??'unknown';run.forcedFailureExit=true;
      }
      await persist();
      if(page) {
        try {run.recoveredDiagnostics=await phase('recover-photo-diagnostics',()=>page.evaluate(()=>window.__INHAGAME_P0__?.getPhotoCaptureDiagnostics?.()??null),5000,false);}
        catch(error){run.diagnosticError=String(error);}await persist();
        try {await phase('failure-screenshot',()=>page.screenshot({path:join(output,`attempt-${attempt}-failure.png`),timeout:5000}),5000,false);run.failureScreenshot=`attempt-${attempt}-failure.png`;}
        catch(error){run.screenshotError=String(error);}await persist();
      }
    } finally {
      await finalizeTraceDiagnostic({smoke,receipt:run,phase:(label,work)=>phase(label,work,5000,false),persist,log:()=>{}});
    }
  }
  receipt.status=receipt.attempts.every(run=>run.status==='COLLECTED')?'DIAGNOSTIC_COMPLETE':'DIAGNOSTIC_PARTIAL';
  receipt.naturalFailure=classifyReproduction(receipt.attempts); // NATURAL_FAILURE_NOT_REPRODUCED is unresolved, not fixed.
  receipt.resolution='UNRESOLVED: this bounded diagnostic does not establish a cause or a fix.';
  if(receipt.status==='DIAGNOSTIC_PARTIAL')process.exitCode=1;
} catch(error) {receipt.status='DIAGNOSTIC_PARTIAL';receipt.error=error.stack||String(error);process.exitCode=1;}
finally {receipt.completedAt=new Date().toISOString();await persist();}
console.log(JSON.stringify({status:receipt.status,source:receipt.source,samplerHead:receipt.samplerHead,naturalFailure:receipt.naturalFailure,output}));
