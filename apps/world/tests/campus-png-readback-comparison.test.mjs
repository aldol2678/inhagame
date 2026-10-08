import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROTOCOL } from './browser/campus-render-reproduction-support.mjs';

const beforeSha = 'aa35d922716e726beb92d53d359c357f6276296c';
const candidateSha = 'b'.repeat(40);
const supportUrl = new URL('./browser/campus-png-readback-comparison.mjs', import.meta.url);
const load = () => import(supportUrl);
const hash = 'a'.repeat(64);
const samplerPaths = ['campus-render-reproduction.mjs', 'campus-render-reproduction-support.mjs', 'harness.mjs', 'harness-source.mjs', 'harness-cleanup.mjs', 'biryong-performance-diagnostics.mjs', 'biryong-render-trace-cleanup.mjs', 'package.json', 'package-lock.json', '../../npc-factory/npc-world-time-contract.mjs'];
const sourcePaths = ['src/main.js', 'src/photo/photo-capture.js', 'src/photo/photo-mode.js', 'src/photo/photo-mode-panel.js', 'src/photo/photo-camera-controller.js', 'src/graphics-presets.js', 'campus/index.html', 'styles.css', 'tests/browser/package.json'];
function fixture(sha) {
  const scene = { viewport:[1280,720,1], drawingBuffer:[1280,720], driver:{renderer:'fixture'}, visible:'visible', inBiryong:false,
    position:[0,1,-98], camera:[0,.4,3.5,false], cameraTransform:[0,3,90,0,0,0,1], cameraFov:45,
    environment:{targetTime:'DAY',targetWeather:'CLEAR',settled:true,weatherSettled:true,worldCycleSeconds:900},
    graphics:{tier:'high',frameLimit:30,renderScale:1,shadowResolution:1024,castShadows:true}, photoActive:true, worldClockMs:123 };
  const sourceHashes = Object.fromEntries(sourcePaths.map(path => [path, hash]));
  sourceHashes['src/photo/photo-capture.js'] = sha === beforeSha ? hash : 'b'.repeat(64);
  return { schema:'campus-render-reproduction-v1', measurementClass:'DIAGNOSTIC_ONLY', performanceAcceptance:'NOT_EVALUATED', realDevice:false,
    status:'DIAGNOSTIC_COMPLETE', protocol:structuredClone(PROTOCOL), source:{head:sha,tree:sha}, samplerHead:sha,samplerTree:sha,
    sourcePins:{app:sha,sampler:sha}, sourceHashes, samplerHashes:Object.fromEntries(samplerPaths.map(path => [path,hash])),
    clockOverride:{originalMainSha256:hash,servedMainSha256:hash,seam:'fixed seam',replacement:'fixed clock',epoch:123},
    runtime:{node:'v24.19.0',platform:'linux',arch:'x64',disableWebGpu:true,engineVersion:'2.22.4',engineSha256:hash},
    completedAt:'2026-10-08T00:00:00Z', naturalFailure:'NATURAL_FAILURE_NOT_REPRODUCED',
    attempts:[1,2].map(attempt => ({attempt,status:'COLLECTED',browserVersion:'fixture-browser',
      before:structuredClone(scene),beforePacing:structuredClone(scene),after:structuredClone(scene),invariants:'PASS',
      servedHashes:{...sourceHashes,'src/main.js':hash},
      png:{success:true,code:'success',file:`attempt-${attempt}.png`,sha256:hash,bytes:1234,decoded:{width:1280,height:720,opaque:921600,colorBins:24},records:[{code:'success',readbackOperations:[{operation:'getImageData',durationMs:4}],timeout:{nominalDeadlineElapsedMs:10000,callbackElapsedMs:null,skewMs:null}}]},
      pacing:{startState:{visibility:'visible',contextLost:false,autoRender:false,renderNextFrame:false},endState:{visibility:'visible',contextLost:false,autoRender:false,renderNextFrame:false},renders:3,updates:4,elapsedMs:2500,renderedFps:1.2,intervals:[800,900],p50Ms:900,p95Ms:900,assessment:{checks:{minimumThreeRenders:true,simulationContinues:true,ceiling34Fps:true},passed:true,real30FpsValidated:false}},
      photoDiagnosticsAfterPacing:[{code:'success',lateEncodingCallback:null}],
      phases:[{label:'start-offline-browser',state:'DONE'},{label:'close-offline-browser',state:'DONE'}],problems:[],completedAt:'2026-10-08T00:00:00Z'})) };
}
function pair() { return [fixture(beforeSha),fixture(candidateSha)]; }

test('comparison support exists before any A/B evidence can be interpreted', async () => {
  const source = await readFile(supportUrl,'utf8').catch(() => '');
  assert.ok(source.includes('compareCampusReceipts'), 'implement the read-only receipt comparison contract');
});
test('same measured scenes accept only distinct exact revision labels without claiming a fix', async () => {
  const { compareCampusReceipts, BEFORE_SHA } = await load();
  const [before,candidate] = pair(), original = structuredClone([before,candidate]);
  const report = compareCampusReceipts(before,candidate,{candidateSha});
  assert.equal(BEFORE_SHA,beforeSha); assert.equal(report.comparisonStatus,'COMPARABLE');
  assert.equal(report.arms.before.application.sha,beforeSha); assert.equal(report.arms.candidate.application.sha,candidateSha);
  assert.equal(report.arms.before.sampler.sha,beforeSha); assert.equal(report.arms.candidate.sampler.sha,candidateSha);
  assert.equal(report.arms.before.application.tree,before.source.tree);
  assert.equal(report.performanceAcceptance,'NOT_EVALUATED'); assert.equal(report.realDevice,false);
  assert.match(report.conclusion,/UNRESOLVED/); assert.deepEqual([before,candidate],original);
});
test('changed or absent camera, environment, viewport, GPU, pacing settings and scene keys invalidate comparison', async () => {
  const { compareCampusReceipts } = await load();
  for (const key of Object.keys(fixture(beforeSha).attempts[0].before)) {
    const [before,candidate] = pair(); candidate.attempts[0].before[key] = null;
    assert.equal(compareCampusReceipts(before,candidate,{candidateSha}).comparisonStatus,'INVALID',key);
  }
  const [before,candidate] = pair();
  for (const receipt of [before,candidate]) for(const run of receipt.attempts) for(const key of ['before','beforePacing','after']) delete run[key].cameraFov;
  assert.equal(compareCampusReceipts(before,candidate,{candidateSha}).comparisonStatus,'INVALID');
});
test('application or sampler drift, changed deadlines, and changed non-capture source invalidate A/B', async () => {
  const { compareCampusReceipts } = await load();
  const changes = [c=>c.source.head='c'.repeat(40),c=>c.samplerTree='c'.repeat(40),c=>c.sourcePins.sampler=beforeSha,
    c=>c.samplerHashes['harness.mjs']='c'.repeat(64),c=>delete c.samplerHashes['harness.mjs'],
    c=>c.sourceHashes['src/main.js']='c'.repeat(64),c=>c.protocol.appPngTimeoutMs=20000,
    c=>c.protocol.sampleMs=5000,c=>c.attempts.push(structuredClone(c.attempts[0])),
    c=>c.runtime.engineVersion='other',c=>c.attempts[1].browserVersion='other',
    c=>c.attempts[0].servedHashes['src/photo/photo-capture.js']=hash];
  for(const change of changes){const [before,candidate]=pair();change(candidate);
    assert.equal(compareCampusReceipts(before,candidate,{candidateSha}).comparisonStatus,'INVALID',String(change));}
  for(const candidate of ['', 'main', beforeSha, 'g'.repeat(40)]) {
    assert.equal(compareCampusReceipts(...pair(),{candidateSha:candidate}).comparisonStatus,'INVALID');
  }
});
test('readback, timeout skew, late callback, raw pacing and cleanup failure remain separate evidence', async () => {
  const { compareCampusReceipts } = await load(); const [before,candidate] = pair();
  const run=candidate.attempts[0];run.status='DIAGNOSTIC_PARTIAL';run.cleanupError='owned close timed out';
  run.phases[1].state='ERROR';run.phases.push({label:'abort-offline-browser',state:'DONE'});
  candidate.status='DIAGNOSTIC_PARTIAL';
  run.png={success:false,code:'timeout',records:[{code:'timeout',readbackOperations:[{operation:'alphaProbe',durationMs:2}],timeout:{nominalDeadlineElapsedMs:10000,callbackElapsedMs:12000,skewMs:2000}}]};
  run.photoDiagnosticsAfterPacing=[{...run.png.records[0],lateEncodingCallback:{elapsedMs:13000,afterTimeoutMs:1000}}];
  const report=compareCampusReceipts(before,candidate,{candidateSha});
  assert.equal(report.comparisonStatus,'COMPARABLE');
  assert.equal(report.arms.candidate.measurementStatus,'COMPLETE');
  assert.deepEqual(report.arms.candidate.measurements[0].png,run.png);
  assert.deepEqual(report.arms.candidate.measurements[0].pacing,run.pacing);
  assert.deepEqual(report.arms.candidate.measurements[0].photoDiagnosticsAfterPacing,run.photoDiagnosticsAfterPacing);
  assert.equal(report.arms.candidate.cleanup[0].cleanupError,run.cleanupError);
  assert.equal(report.arms.candidate.cleanupStatus,'FAILED');
});
test('partial or missing evidence is incomplete and never treated as natural failure not reproduced', async () => {
  const { compareCampusReceipts } = await load();const [before,candidate]=pair();
  candidate.attempts[1]={attempt:2,status:'NOT_ATTEMPTED',phases:[],png:null,pacing:null};
  const report=compareCampusReceipts(before,candidate,{candidateSha});
  assert.equal(report.comparisonStatus,'INCOMPLETE');assert.equal(report.arms.candidate.measurementStatus,'PARTIAL');
  const absent=compareCampusReceipts(before,null,{candidateSha});
  assert.equal(absent.comparisonStatus,'INCOMPLETE');assert.equal(absent.arms.candidate.measurementStatus,'NOT_MEASURED');
});
test('cleanup evidence requires a terminal receipt and proven owned cleanup, separate from measurement', async () => {
  const { hasProvenCleanup } = await load();
  assert.equal(hasProvenCleanup(fixture(beforeSha)),true);
  for(const change of [r=>delete r.completedAt,r=>r.status='RUNNING',r=>r.attempts[0].forcedFailureExit=true,
    r=>r.attempts[0].cleanupAbortError='abort failed',r=>r.attempts[0].startupCleanup='unknown',
    r=>r.attempts[0].phases.pop()]){const r=fixture(beforeSha);change(r);assert.equal(hasProvenCleanup(r),false,String(change));}
  const recovered=fixture(beforeSha);recovered.attempts[0].phases[1].state='ERROR';
  recovered.attempts[0].cleanupError='close timed out';recovered.attempts[0].phases.push({label:'abort-offline-browser',state:'DONE'});
  assert.equal(hasProvenCleanup(recovered),true);assert.equal(hasProvenCleanup(null),false);
});
test('CLI reads receipts, writes JSON only to stdout and reports absent files without losing the first arm', async () => {
  const dir=await mkdtemp(join(tmpdir(),'campus-comparison-'));
  try {
    const before=join(dir,'before.json'),candidate=join(dir,'candidate.json');await writeFile(before,JSON.stringify(fixture(beforeSha)));
    const result=spawnSync(process.execPath,[supportUrl.pathname,before,candidate,candidateSha],{encoding:'utf8'});
    assert.equal(result.status,1);const report=JSON.parse(result.stdout);
    assert.equal(report.comparisonStatus,'INCOMPLETE');assert.equal(report.arms.before.application.sha,beforeSha);
    assert.match(report.inputErrors[0],/candidate/);assert.equal(await readFile(before,'utf8'),JSON.stringify(fixture(beforeSha)));
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('archived v1 manual workflow pins isolated sequential arms and preserves original bounded experiment', async () => {
  const workflow=await readFile(new URL('../../../.github/workflows/campus-png-readback-comparison.yml',import.meta.url),'utf8').catch(()=> '');
  assert.doesNotMatch(workflow,/pull_request:/);assert.match(workflow,/workflow_dispatch:/);assert.doesNotMatch(workflow,/pull_request_target|schedule:|continue-on-error|secrets\./);
  assert.match(workflow,new RegExp(beforeSha));assert.match(workflow,/contents: read/);
  assert.match(workflow,/CAMPUS_AB_CANDIDATE_SHA: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/);
  assert.match(workflow,/needs: before/);assert.match(workflow,/if: \$\{\{ always\(\) && !cancelled\(\) \}\}/);
  assert.match(workflow,/PIPESTATUS\[0\]/);assert.match(workflow,/actions\/download-artifact@v4/);
  assert.equal((workflow.match(/timeout --signal=TERM --kill-after=10s 8m node/g)||[]).length,2);
  assert.equal((workflow.match(/campus-render-reproduction\.mjs 2>&1/g)||[]).length,2);
  assert.match(workflow,/if: always\(\)/);assert.match(workflow,/actions\/upload-artifact@v4/);
  assert.match(workflow,/CAMPUS_REPRO_APP_SHA="\$CAMPUS_AB_BEFORE_SHA" CAMPUS_REPRO_SAMPLER_SHA="\$CAMPUS_AB_BEFORE_SHA"/);
  assert.match(workflow,/CAMPUS_REPRO_APP_SHA="\$CAMPUS_AB_CANDIDATE_SHA" CAMPUS_REPRO_SAMPLER_SHA="\$CAMPUS_AB_CANDIDATE_SHA"/);
});

test('readback summary aggregates every getImageData call without losing rectangles or inventing missing durations', async () => {
  const { compareCampusReceipts }=await load();const [before,candidate]=pair();
  const record=candidate.attempts[0].png.records[0];
  record.readbackOperations=[{operation:'getImageData',rectangle:[0,0,1,1],durationMs:2},
    {operation:'getImageData',rectangle:[0,0,1280,720],durationMs:8},{operation:'alphaScan',durationMs:1}];
  let report=compareCampusReceipts(before,candidate,{candidateSha});
  assert.deepEqual(report.arms.candidate.measurements[0].readbackSummary[0],
    {getImageData:{observedOperations:2,completedOperations:2,durationMsTotal:10,requestedPixels:921601}});
  assert.deepEqual(report.arms.candidate.measurements[0].png.records[0],record);
  record.readbackOperations[1].durationMs=null;
  report=compareCampusReceipts(before,candidate,{candidateSha});
  assert.equal(report.arms.candidate.measurements[0].readbackSummary[0].getImageData.durationMsTotal,null);
  assert.equal(report.arms.candidate.measurements[0].readbackSummary[0].getImageData.completedOperations,1);
  delete record.readbackOperations;
  report=compareCampusReceipts(before,candidate,{candidateSha});
  assert.equal(report.arms.candidate.measurements[0].readbackSummary[0].getImageData.durationMsTotal,null);
});

for (const field of ['servedHashes','browserVersion']) test(`every otherwise-complete attempt requires ${field}`, async () => {
  const { compareCampusReceipts } = await load();
  for (const arm of [0,1]) for (const attempt of [0,1]) {
    const receipts=pair();delete receipts[arm].attempts[attempt][field];
    const report=compareCampusReceipts(...receipts,{candidateSha});
    assert.equal(report.comparisonStatus,'INVALID',`${arm}/${attempt} missing ${field}`);
    assert.deepEqual(report.arms[arm === 0 ? 'before' : 'candidate'].receipt,receipts[arm]);
  }
});
test('empty or non-string browser identity cannot be accepted as matching evidence', async () => {
  const { compareCampusReceipts } = await load();
  for (const invalid of [null,'', ' ', 123]) {
    const receipts=pair();receipts[1].attempts[0].browserVersion=invalid;
    assert.equal(compareCampusReceipts(...receipts,{candidateSha}).comparisonStatus,'INVALID',`browser version ${JSON.stringify(invalid)}`);
  }
});

test('missing terminal capture records cannot be complete or comparable evidence', async () => {
  const { compareCampusReceipts } = await load();
  for(const arm of [0,1]) for(const attempt of [0,1]) {
    const receipts=pair();delete receipts[arm].attempts[attempt].png.records;
    const report=compareCampusReceipts(...receipts,{candidateSha});
    assert.equal(report.comparisonStatus,'INCOMPLETE');
    assert.equal(report.arms[arm === 0 ? 'before' : 'candidate'].measurementStatus,'PARTIAL');
  }
});
test('a late measurement assertion error stays incomplete even when all earlier fields were saved', async () => {
  const { compareCampusReceipts } = await load();
  for(const arm of [0,1]) for(const attempt of [0,1]) {
    const receipts=pair(),run=receipts[arm].attempts[attempt];
    run.status='PARTIAL';run.error='AssertionError: no delayed duplicate or failed-capture download';
    const report=compareCampusReceipts(...receipts,{candidateSha});
    assert.equal(report.comparisonStatus,'INCOMPLETE');
    const result=report.arms[arm === 0 ? 'before' : 'candidate'];
    assert.equal(result.measurementStatus,'PARTIAL');assert.equal(result.cleanupStatus,'COMPLETE');
    assert.equal(result.measurements[attempt].error,run.error);assert.deepEqual(result.receipt,receipts[arm]);
  }
});

test('successful PNG evidence requires the sampler file, hash, bytes and decoded image proof', async () => {
  const { compareCampusReceipts }=await load();
  const changes=[r=>delete r.png.file,r=>delete r.png.sha256,r=>r.png.sha256='invalid',r=>delete r.png.bytes,
    r=>r.png.bytes=0,r=>delete r.png.decoded,r=>delete r.png.decoded.width,r=>r.png.decoded.height=1,
    r=>r.png.decoded.opaque=1,r=>r.png.decoded.colorBins=3];
  for(const change of changes){const receipts=pair();change(receipts[1].attempts[0]);
    const report=compareCampusReceipts(...receipts,{candidateSha});
    assert.equal(report.comparisonStatus,'INCOMPLETE',String(change));assert.equal(report.arms.candidate.measurementStatus,'PARTIAL');}
});
test('pacing requires existing raw sampler fields and types instead of merely a truthy object', async () => {
  const { compareCampusReceipts }=await load();
  for(const field of Object.keys(fixture(candidateSha).attempts[0].pacing)) {
    const receipts=pair();delete receipts[1].attempts[0].pacing[field];
    assert.equal(compareCampusReceipts(...receipts,{candidateSha}).comparisonStatus,'INCOMPLETE',`missing pacing ${field}`);
  }
  for(const change of [r=>r.pacing={},r=>r.pacing.renders='3',r=>r.pacing.intervals=[null],
    r=>r.pacing.p50Ms='900',r=>r.pacing.startState={},r=>r.pacing.assessment={}]) {
    const receipts=pair();change(receipts[1].attempts[0]);
    assert.equal(compareCampusReceipts(...receipts,{candidateSha}).comparisonStatus,'INCOMPLETE',String(change));
  }
});
test('PNG success boolean must agree with the terminal code and terminal record', async () => {
  const { compareCampusReceipts }=await load();
  for(const change of [r=>r.png.success=false,r=>{r.png.code='timeout';r.png.records[0].code='timeout';}]) {
    const receipts=pair();change(receipts[1].attempts[0]);
    assert.equal(compareCampusReceipts(...receipts,{candidateSha}).comparisonStatus,'INCOMPLETE');
  }
});
test('early timeout without readback timing and measured zero-render pacing failure remain complete evidence', async () => {
  const { compareCampusReceipts }=await load();const receipts=pair(),run=receipts[1].attempts[0];
  run.png={success:false,code:'timeout',records:[{code:'timeout',events:[],timeout:{nominalDeadlineElapsedMs:10000,callbackElapsedMs:10000,skewMs:0}}]};
  run.pacing={...run.pacing,renders:0,updates:0,elapsedMs:2500,renderedFps:0,intervals:[],p50Ms:null,p95Ms:null,
    assessment:{checks:{minimumThreeRenders:false,simulationContinues:true,ceiling34Fps:true},passed:false,real30FpsValidated:false}};
  const report=compareCampusReceipts(...receipts,{candidateSha});
  assert.equal(report.comparisonStatus,'COMPARABLE');assert.equal(report.arms.candidate.measurementStatus,'COMPLETE');
  assert.deepEqual(report.arms.candidate.measurements[0].png,run.png);assert.deepEqual(report.arms.candidate.measurements[0].pacing,run.pacing);
});

const asyncBeforeSha = 'be2e683e5c18637327648b54da45dc2182a94a3e';
const asyncBeforeTree = 'a29becf3a727ce83a3a362e22649558128907912';
const workerPath = 'src/photo/photo-alpha-worker.js';
function asyncPair() {
  return [asyncBeforeSha, candidateSha].map((sha, index) => {
    const receipt = fixture(sha);
    receipt.schema = 'campus-render-reproduction-async-v2';
    receipt.source.tree = index ? candidateSha : asyncBeforeTree;
    receipt.samplerHead = candidateSha; receipt.samplerTree = candidateSha;
    receipt.sourcePins.sampler = candidateSha;
    receipt.runtime.hostedImage = { os: 'ubuntu24', version: '20261005.1.0' };
    receipt.sourceHashes[workerPath] = index ? 'c'.repeat(64) : null;
    for (const run of receipt.attempts) {
      run.servedHashes = { ...receipt.sourceHashes, 'src/main.js': hash };
      if (index) Object.assign(run.png.records[0], {
        validation: { path: 'worker', fallbackReason: null, decodeMs: 2, readbackMs: 3, scanMs: 4 },
        encoding: { callStartElapsedMs: 10, callReturnElapsedMs: 16, callbackElapsedMs: 26 }
      });
    }
    return receipt;
  });
}
test('async-v2 explicitly pins approved before tree and one shared updated sampler, preserving immutable receipts', async () => {
  const support = await load();
  assert.equal(typeof support.compareAsyncCampusReceipts, 'function', 'new async comparison must have an explicit entry point');
  const receipts = asyncPair(), original = structuredClone(receipts);
  const report = support.compareAsyncCampusReceipts(...receipts, { candidateSha });
  assert.equal(report.schema, 'campus-png-async-comparison-v2');
  assert.equal(report.comparisonStatus, 'COMPARABLE');
  assert.equal(report.arms.before.expectedSha, asyncBeforeSha);
  assert.equal(report.performanceAcceptance, 'NOT_EVALUATED');
  assert.deepEqual(receipts, original);
  assert.equal(support.compareCampusReceipts(...receipts, { candidateSha }).comparisonStatus, 'INVALID');
});
test('async timing report separates worker use, encoder call-return/callback and worker-local durations', async () => {
  const { compareAsyncCampusReceipts } = await load();
  const report = compareAsyncCampusReceipts(...asyncPair(), { candidateSha });
  assert.deepEqual(report.arms.candidate.measurements[0].asyncValidationSummary[0], {
    workerUsed: true, path: 'worker', fallbackReason: null,
    encoding: { callStartElapsedMs: 10, callReturnElapsedMs: 16, callbackElapsedMs: 26,
      callDurationMs: 6, callbackAfterReturnMs: 10, callbackAfterCallMs: 16 },
    worker: { decodeMs: 2, readbackMs: 3, scanMs: 4 }
  });
  const before = report.arms.before.measurements[0].asyncValidationSummary[0];
  assert.equal(before.workerUsed, null); assert.equal(before.encoding.callDurationMs, null);
  assert.equal(before.worker.decodeMs, null, 'legacy missing timing is not fabricated zero');
});
test('async comparison rejects source, worker integrity, sampler, scene, browser, and deadline drift', async () => {
  const { compareAsyncCampusReceipts } = await load();
  const changes = [
    r => r[0].source.tree = 'd'.repeat(40), r => r[0].source.head = beforeSha,
    r => r[0].samplerHead = asyncBeforeSha, r => r[0].samplerTree = asyncBeforeTree,
    r => r[1].samplerHashes['campus-render-reproduction.mjs'] = 'd'.repeat(64),
    r => delete r[0].sourceHashes[workerPath], r => r[0].sourceHashes[workerPath] = hash,
    r => r[1].sourceHashes[workerPath] = null, r => r[1].attempts[0].servedHashes[workerPath] = hash,
    r => r[1].sourceHashes['src/main.js'] = 'd'.repeat(64),
    r => r[1].attempts[0].before.cameraFov = 90, r => r[1].attempts[1].browserVersion = 'different',
    r => r[1].runtime.hostedImage.version = 'different', r => r[1].runtime.hostedImage.os = 'different',
    r => delete r[0].runtime.hostedImage, r => r[1].runtime.hostedImage.version = '',
    r => r[1].protocol.appPngTimeoutMs = 20000, r => r[1].protocol.phaseMs = 30000
  ];
  for (const change of changes) {
    const receipts = asyncPair(); change(receipts);
    assert.equal(compareAsyncCampusReceipts(...receipts, { candidateSha }).comparisonStatus, 'INVALID', String(change));
  }
});
test('async summaries retain fallback and incomplete timing without converting either into worker success', async () => {
  const { compareAsyncCampusReceipts } = await load();
  const receipts = asyncPair(), record = receipts[1].attempts[0].png.records[0];
  record.validation = { path: 'legacy', fallbackReason: 'unsupported', decodeMs: null, readbackMs: null, scanMs: null };
  record.encoding.callbackElapsedMs = null;
  const report = compareAsyncCampusReceipts(...receipts, { candidateSha });
  const result = report.arms.candidate.measurements[0].asyncValidationSummary[0];
  assert.equal(result.workerUsed, false); assert.equal(result.fallbackReason, 'unsupported');
  assert.equal(result.encoding.callDurationMs, 6); assert.equal(result.encoding.callbackAfterReturnMs, null);
  assert.equal(result.worker.readbackMs, null);
  assert.equal(report.asyncEvidence.workerValidated, false);
  assert.equal(report.comparisonStatus, 'INCOMPLETE', 'successful candidate must retain complete encoder timing');
});
test('async successful fallback is comparable evidence but never validates worker performance', async () => {
  const { compareAsyncCampusReceipts } = await load(); const receipts = asyncPair();
  for (const run of receipts[1].attempts) run.png.records[0].validation = { path: 'legacy', fallbackReason: 'unsupported' };
  const report = compareAsyncCampusReceipts(...receipts, { candidateSha });
  assert.equal(report.comparisonStatus, 'COMPARABLE'); assert.equal(report.asyncEvidence.workerValidated, false);
});
test('async timeout remains valid terminal evidence with missing encoder return and worker timing', async () => {
  const { compareAsyncCampusReceipts } = await load(); const receipts = asyncPair();
  receipts[1].attempts[0].png = { success: false, code: 'timeout', records: [{ code: 'timeout',
    validation: { path: 'worker', fallbackReason: null },
    encoding: { callStartElapsedMs: 5, callReturnElapsedMs: null, callbackElapsedMs: null },
    timeout: { nominalDeadlineElapsedMs: 10000, callbackElapsedMs: 12000, skewMs: 2000 } }] };
  const report = compareAsyncCampusReceipts(...receipts, { candidateSha });
  assert.equal(report.comparisonStatus, 'COMPARABLE');
  assert.equal(report.arms.candidate.measurements[0].asyncValidationSummary[0].encoding.callDurationMs, null);
  assert.equal(report.asyncEvidence.workerValidated, false);
});
test('contradictory terminal PNG evidence never counts as worker validation', async () => {
  const { compareAsyncCampusReceipts } = await load(); const receipts = asyncPair();
  receipts[1].attempts[0].png.records[0].code = 'timeout';
  const report = compareAsyncCampusReceipts(...receipts, { candidateSha });
  assert.equal(report.comparisonStatus, 'INCOMPLETE');
  assert.equal(report.asyncEvidence.workerValidated, false, 'worker proof requires a coherent terminal PNG receipt');
});
test('async hosted workflow uses approved before app and exact candidate sampler in both isolated bounded arms', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/campus-png-async-comparison.yml', import.meta.url), 'utf8').catch(() => '');
  assert.match(workflow, new RegExp(`CAMPUS_AB_BEFORE_SHA: ${asyncBeforeSha}`));
  assert.match(workflow, /CAMPUS_REPRO_MODE: async-v2/);
  assert.match(workflow, /'apps\/world\/src\/photo\/photo-alpha-worker.js'/);
  assert.match(workflow, /CAMPUS_REPRO_APP_SHA="\$CAMPUS_AB_BEFORE_SHA" CAMPUS_REPRO_SAMPLER_SHA="\$CAMPUS_AB_CANDIDATE_SHA"/);
  assert.equal((workflow.match(/ref: \$\{\{ env.CAMPUS_AB_CANDIDATE_SHA \}\}/g) || []).length, 4, 'both samplers, candidate app, and comparer use exact candidate');
  assert.equal((workflow.match(/ref: \$\{\{ env.CAMPUS_AB_BEFORE_SHA \}\}/g) || []).length, 1, 'only before app uses the fixed before checkout');
  assert.match(workflow, /needs: before/); assert.match(workflow, /--async-v2 > "\$CAMPUS_AB_OUTPUT\/comparison.json"/);
  assert.equal((workflow.match(/timeout --signal=TERM --kill-after=10s 8m node/g) || []).length, 2);
  assert.equal((workflow.match(/timeout-minutes: 15/g) || []).length, 2);
  assert.match(workflow, /contents: read/); assert.match(workflow, /if: always\(\)/);
  assert.doesNotMatch(workflow, /pull_request_target|schedule:|continue-on-error|secrets\./);
});

test('real-browser PNG matrix demands both 68-case paths, original Blob identity and split timing', async () => {
  const cases = await readFile(new URL('./browser/photo-mode-alpha-cases.mjs', import.meta.url), 'utf8');
  const runner = await readFile(new URL('./browser/photo-mode-png-smoke.mjs', import.meta.url), 'utf8');
  assert.match(cases, /cases.length !== 68/); assert.match(cases, /\[0, 1, 127, 255\]/);
  assert.match(cases, /createWorker: \(\) => null/); assert.match(cases, /result.blob !== encoded\[0\]/);
  assert.match(cases, /path === 'worker' \? \[\]/);
  for (const field of ['decodeMs', 'readbackMs', 'scanMs', 'callReturnElapsedMs', 'callbackElapsedMs']) assert.ok(cases.includes(field));
  for (const path of ['legacy', 'worker']) assert.match(runner, new RegExp(`page.evaluate\\(validateAlphaCaptures, \\{ path: '${path}' \\}\\)`));
  assert.match(runner, /src\/photo\/photo-alpha-worker.js/);
});
