// Read-only analysis of two untouched campus sampler receipts. Never starts a browser.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTOCOL, assertSameCampusScene } from './campus-render-reproduction-support.mjs';

export const BEFORE_SHA = 'aa35d922716e726beb92d53d359c357f6276296c';
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const SCENE_KEYS = ['viewport','drawingBuffer','driver','visible','inBiryong','position','camera',
  'cameraTransform','cameraFov','environment','graphics','photoActive','worldClockMs'];
const SAMPLER_PATHS = ['campus-render-reproduction.mjs','campus-render-reproduction-support.mjs','harness.mjs',
  'harness-source.mjs','harness-cleanup.mjs','biryong-performance-diagnostics.mjs','biryong-render-trace-cleanup.mjs',
  'package.json','package-lock.json','../../npc-factory/npc-world-time-contract.mjs'];
const SOURCE_PATHS = ['src/main.js','src/photo/photo-capture.js','src/photo/photo-mode.js','src/photo/photo-mode-panel.js',
  'src/photo/photo-camera-controller.js','src/graphics-presets.js','campus/index.html','styles.css','tests/browser/package.json'];
const CAPTURE_PATH = 'src/photo/photo-capture.js';

// A measured failure can finish cleanly. An unfinished or unproven cleanup cannot
// be called clean merely because PNG data exists. Each A/B arm owns a separate runner.
export function hasProvenCleanup(receipt) {
  if (!receipt?.completedAt || !['DIAGNOSTIC_COMPLETE','DIAGNOSTIC_PARTIAL'].includes(receipt.status)
      || !Array.isArray(receipt.attempts) || receipt.attempts.length !== 2) return false;
  return receipt.attempts.every(run => {
    if (run.forcedFailureExit || run.cleanupAbortError || run.startupCleanup) return false;
    const phases = run.phases ?? [];
    const started = phases.some(phase => phase.label === 'start-offline-browser');
    if (!started) return run.status === 'NOT_ATTEMPTED';
    return phases.some(phase => ['close-offline-browser','abort-offline-browser'].includes(phase.label) && phase.state === 'DONE');
  });
}

function summarizeReadback(record) {
  const operations = (record.readbackOperations ?? []).filter(item => item.operation === 'getImageData');
  const completed = operations.filter(item => Number.isFinite(item.durationMs) && item.durationMs >= 0);
  const rectangles = operations.map(item => item.rectangle);
  return {getImageData:{observedOperations:operations.length,completedOperations:completed.length,
    durationMsTotal:operations.length && completed.length === operations.length
      ? completed.reduce((sum,item) => sum + item.durationMs,0) : null,
    requestedPixels:operations.length && rectangles.every(rectangle => Array.isArray(rectangle) && rectangle.length === 4
      && rectangle.every(Number.isFinite) && rectangle[2] > 0 && rectangle[3] > 0)
      ? rectangles.reduce((sum,rectangle) => sum + rectangle[2] * rectangle[3],0) : null}};
}

// Validate proof fields produced by the existing sampler, not a performance
// threshold. A measured timeout or failing pacing assessment remains evidence.
function hasTerminalPngProof(run) {
  const png=run.png;
  if (!png || typeof png.success !== 'boolean' || typeof png.code !== 'string' || !png.code
      || png.success !== (png.code === 'success') || !Array.isArray(png.records) || !png.records.length
      || png.records.at(-1)?.code !== png.code) return false;
  if (!png.success) return true;
  const decoded=png.decoded,buffer=run.before?.drawingBuffer;
  return typeof png.file === 'string' && png.file.length > 0 && HASH.test(png.sha256 ?? '')
    && Number.isInteger(png.bytes) && png.bytes > 0 && Array.isArray(buffer) && !!decoded
    && Number.isInteger(decoded.width) && decoded.width > 0 && decoded.width === buffer[0]
    && Number.isInteger(decoded.height) && decoded.height > 0 && decoded.height === buffer[1]
    && decoded.opaque === decoded.width * decoded.height && Number.isInteger(decoded.colorBins) && decoded.colorBins > 3;
}
function hasRawPacingProof(pacing) {
  if (!pacing) return false;
  const finiteNonnegative=value => Number.isFinite(value) && value >= 0;
  const state=value => value && typeof value.visibility === 'string'
    && ['contextLost','autoRender','renderNextFrame'].every(key => typeof value[key] === 'boolean');
  return !!state(pacing.startState) && !!state(pacing.endState)
    && ['renders','updates'].every(key => Number.isInteger(pacing[key]) && pacing[key] >= 0)
    && Number.isFinite(pacing.elapsedMs) && pacing.elapsedMs > 0 && finiteNonnegative(pacing.renderedFps)
    && Array.isArray(pacing.intervals) && pacing.intervals.every(finiteNonnegative)
    && ['p50Ms','p95Ms'].every(key => pacing[key] === null || finiteNonnegative(pacing[key]))
    && typeof pacing.assessment?.passed === 'boolean' && pacing.assessment.real30FpsValidated === false
    && ['minimumThreeRenders','simulationContinues','ceiling34Fps'].every(key => typeof pacing.assessment.checks?.[key] === 'boolean');
}

function summarizeArm(receipt, label, expectedSha) {
  const attempts = Array.isArray(receipt?.attempts) ? receipt.attempts : [];
  const measurements = attempts.map(run => ({attempt:run.attempt, status:run.status,
    before:run.before ?? null,beforePacing:run.beforePacing ?? null,after:run.after ?? null,invariants:run.invariants ?? null,
    png:run.png ?? null,readbackSummary:(Array.isArray(run.png?.records) ? run.png.records : []).map(summarizeReadback),pacing:run.pacing ?? null,photoDiagnosticsAfterPacing:run.photoDiagnosticsAfterPacing ?? null,
    recoveredDiagnostics:run.recoveredDiagnostics ?? null,error:run.error ?? null}));
  const complete = measurements.length === 2 && measurements.every((run,index) => hasTerminalPngProof(run)
    && hasRawPacingProof(run.pacing) && run.error === null
    && (run.status === 'COLLECTED' || (run.status === 'DIAGNOSTIC_PARTIAL' && !!attempts[index].cleanupError))
    && run.before && run.beforePacing && run.after && run.invariants === 'PASS'
    && Array.isArray(run.photoDiagnosticsAfterPacing));
  const measured = measurements.some(run => run.png || run.pacing);
  const cleanup = attempts.map(run => ({attempt:run.attempt,cleanupError:run.cleanupError ?? null,
    cleanupAbortError:run.cleanupAbortError ?? null,startupCleanup:run.startupCleanup ?? null,
    forcedFailureExit:run.forcedFailureExit === true,
    phases:(run.phases ?? []).filter(phase => ['close-offline-browser','abort-offline-browser'].includes(phase.label))}));
  return {label,expectedSha,application:{sha:receipt?.source?.head ?? null,tree:receipt?.source?.tree ?? null},
    sampler:{sha:receipt?.samplerHead ?? null,tree:receipt?.samplerTree ?? null},
    measurementStatus:complete ? 'COMPLETE' : measured ? 'PARTIAL' : 'NOT_MEASURED',measurements,cleanup,
    cleanupStatus:cleanup.some(run => run.cleanupError || run.cleanupAbortError || run.startupCleanup || run.forcedFailureExit)
      ? 'FAILED' : hasProvenCleanup(receipt) ? 'COMPLETE' : 'UNPROVEN',
    // Preserve every original field, including terminal and later observations,
    // phase deadlines, startup errors, source hashes and partial failure evidence.
    receipt:receipt ?? null};
}

export function compareCampusReceipts(before, candidate, { candidateSha } = {}) {
  const issues = [], missing = [];
  const check = (label, work) => {try {work();} catch(error) {issues.push({check:label,error:error.message});}};
  check('candidate pin', () => {assert.match(candidateSha ?? '',SHA);assert.notEqual(candidateSha,BEFORE_SHA);});
  const arms = {before:summarizeArm(before,'BEFORE',BEFORE_SHA),candidate:summarizeArm(candidate,'CANDIDATE',candidateSha)};
  let referenceScene;
  for (const [label,receipt,expectedSha] of [['before',before,BEFORE_SHA],['candidate',candidate,candidateSha]]) {
    if (!receipt) {missing.push(`${label} receipt is absent`);continue;}
    check(`${label} source identity`, () => {
      assert.equal(receipt.schema,'campus-render-reproduction-v1');
      assert.equal(receipt.measurementClass,'DIAGNOSTIC_ONLY');assert.equal(receipt.performanceAcceptance,'NOT_EVALUATED');
      assert.equal(receipt.realDevice,false);assert.equal(receipt.source?.head,expectedSha);
      assert.equal(receipt.samplerHead,expectedSha);assert.deepEqual(receipt.sourcePins,{app:expectedSha,sampler:expectedSha});
      assert.match(receipt.source?.tree ?? '',SHA);assert.equal(receipt.samplerTree,receipt.source.tree);
    });
    check(`${label} fixed protocol`, () => assert.deepEqual(receipt.protocol,PROTOCOL));
    check(`${label} source hashes`, () => {
      for(const path of SOURCE_PATHS) assert.match(receipt.sourceHashes?.[path] ?? '',HASH,`missing source hash: ${path}`);
      for(const path of SAMPLER_PATHS) assert.match(receipt.samplerHashes?.[path] ?? '',HASH,`missing sampler hash: ${path}`);
      assert.match(receipt.clockOverride?.servedMainSha256 ?? '',HASH);
      assert.equal(receipt.clockOverride?.originalMainSha256,receipt.sourceHashes['src/main.js']);
    });
    check(`${label} preregistered attempt budget`, () => assert.deepEqual(receipt.attempts?.map(run => run.attempt),[1,2]));
    for(const run of Array.isArray(receipt.attempts) ? receipt.attempts : []) {
      const measured = run.png || run.pacing || run.before || run.beforePacing || run.after;
      if (run.servedHashes || measured) check(`${label} attempt ${run.attempt} served source`, () =>
        assert.deepEqual(run.servedHashes,{...receipt.sourceHashes,'src/main.js':receipt.clockOverride?.servedMainSha256}));
      if (run.browserVersion !== undefined || measured) check(`${label} attempt ${run.attempt} browser identity`, () => {
        assert.equal(typeof run.browserVersion,'string','browserVersion must be recorded for every measured attempt');
        assert.ok(run.browserVersion.trim().length > 0,'browserVersion must be nonempty');
      });
      for(const phase of ['before','beforePacing','after']) {
        const scene = run[phase];
        if (!scene) {missing.push(`${label} attempt ${run.attempt} scene ${phase} absent`);continue;}
        check(`${label} attempt ${run.attempt} scene ${phase}`, () => {
          for(const key of SCENE_KEYS) assert.ok(scene[key] !== undefined && scene[key] !== null,`missing scene ${key}`);
          assertSameCampusScene(scene,scene);
          if(referenceScene) assertSameCampusScene(referenceScene,scene);else referenceScene=scene;
        });
      }
    }
    if(arms[label].measurementStatus !== 'COMPLETE') missing.push(`${label} measurements are ${arms[label].measurementStatus}`);
  }
  if(before && candidate) {
    check('identical sampler and dependency bytes', () => assert.deepEqual(candidate.samplerHashes,before.samplerHashes));
    check('only production capture source may differ', () => {
      const unaffected = hashes => Object.fromEntries(Object.entries(hashes ?? {}).filter(([path]) => path !== CAPTURE_PATH));
      assert.deepEqual(unaffected(candidate.sourceHashes),unaffected(before.sourceHashes));
    });
    check('identical fixed-clock override', () => assert.deepEqual(candidate.clockOverride,before.clockOverride));
    check('identical runtime and engine', () => {
      for(const key of ['node','platform','arch','disableWebGpu','engineVersion','engineSha256']) {
        assert.notEqual(before.runtime?.[key],undefined,`missing runtime ${key}`);
        assert.equal(candidate.runtime?.[key],before.runtime[key],key);
      }
      assert.equal(before.runtime.disableWebGpu,true);
    });
    check('identical browser versions', () => {
      const versions = [...before.attempts ?? [],...candidate.attempts ?? []].map(run => run.browserVersion).filter(Boolean);
      assert.ok(versions.length > 0,'no browser version recorded');
      for(const version of versions) assert.equal(version,versions[0]);
    });
  }
  return {schema:'campus-png-readback-comparison-v1',measurementClass:'DIAGNOSTIC_ONLY',
    comparisonStatus:issues.length ? 'INVALID' : missing.length ? 'INCOMPLETE' : 'COMPARABLE',
    performanceAcceptance:'NOT_EVALUATED',realDevice:false,issues,missing,arms,
    conclusion:'UNRESOLVED: compatible bounded observations are not proof of optimization, a fixed timeout, or real-device 30 FPS.',
    limits:['Before runs first, then candidate on a separate GitHub-hosted runner. Fixed order and different machines are confounds; matching renderer names do not prove identical hardware.',
      'Equal fixed scenes do not establish equal animation phase, native encoder/GPU idleness, or thermal history.',
      'Keep terminal PNG, late callbacks, timeout skew, raw pacing and cleanup outcomes separate. Missing observations are not zero.',
      'A lower readback duration on this CI renderer alone does not establish a general performance improvement.']};
}

if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  {
    const inputErrors=[];
    const load = async (path,label) => {try{return JSON.parse(await readFile(path,'utf8'));}
      catch(error){inputErrors.push(`${label}: ${error.message}`);return null;}};
    const report=compareCampusReceipts(await load(process.argv[2],'before'),await load(process.argv[3],'candidate'),{candidateSha:process.argv[4]});
    report.inputErrors=inputErrors;console.log(JSON.stringify(report,null,2));
    process.exitCode=report.comparisonStatus === 'COMPARABLE' ? 0 : 1;
  }
}
