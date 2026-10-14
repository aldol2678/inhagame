import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TARGETS,VIEWS,VIEWPORTS,BASELINE,CURRENT_MAIN,backgateScope,validateBackgateScope,BASELINE_PATHS,assertHosted,EXPECTED_SCREENSHOTS,EXPECTED_PAIRS} from './browser/backgate-restoration-qa-plan.mjs';

test('restoration QA covers all114owners with representative two facade and four road cameras',()=>{
  assert.equal(TARGETS.length,114);assert.equal(new Set(TARGETS.map(q=>q.id)).size,114);
  assert.equal(VIEWS.filter(q=>q.kind==='road').length,4);assert.equal(VIEWS.filter(q=>q.plot).length,2);
  assert.equal(VIEWPORTS.length,3);assert.equal(EXPECTED_SCREENSHOTS,40);assert.equal(EXPECTED_PAIRS,20);
  assert.equal(BASELINE,'3b95e37f3dec477ebe7e06456907176bb81a63a2');assert.equal(BASELINE_PATHS.length,6);
  for(const view of VIEWS)assert.ok(view.prefixes.length);
});
test('browser QA refuses non-hosted runs or an unpinned head',()=>{
  assert.throws(()=>assertHosted({}),/GitHub-hosted only/);
  assert.throws(()=>assertHosted({GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted'}),/head/);
  assert.doesNotThrow(()=>assertHosted({GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',EXPECTED_BACKGATE_HEAD:BASELINE}));
});
test('combined browser fixture retains exact-head, same-camera, stationary and controller checks',async()=>{
  const source=await readFile(new URL('./browser/backgate-restoration-smoke.mjs',import.meta.url),'utf8');
  for(const expected of ['expectedScreenshots=EXPECTED_SCREENSHOTS','assert.equal(stable.changed, 0)','assert.equal(stable.changedFacade, 0)','assert.deepEqual(newRoad.cases,oldRoad.cases','assert.deepEqual(current.camera, old.camera','EXPECTED_BACKGATE_HEAD'])assert.ok(source.includes(expected),expected);
});

test('only the historically absent side-crossing accepts zero baseline contribution; every new target must render',async()=>{
  const plan=await import('./browser/backgate-restoration-qa-plan.mjs');
  assert.equal(typeof plan.expectedContribution,'function');
  assert.deepEqual(VIEWS.filter(v=>!plan.expectedContribution(v,'old')).map(v=>v.name),['side-crossing']);
  assert.ok(VIEWS.every(v=>plan.expectedContribution(v,'new')));
  assert.throws(()=>plan.expectedContribution(VIEWS[0],'unknown'),/variant/);
});

const releaseEnv={GITHUB_HEAD_REF:'release/2026-10-13-ci-runtime-diagnostics',WORLD_BACKGATE_SCOPE_EXTENSION:'release-2026-10-13',WORLD_BACKGATE_SCOPE_BASE:'2ceb251c11538c80dcfc020c4af4b91948e2caf2'};
const manifestFor=s=>[s.base,...s.requiredSourceHeads].map(x=>'\x60'+x+'\x60').join('\n');
test('legacy backgate retains seven paths and historical controls',()=>{
 const s=backgateScope();assert.equal(s.base,CURRENT_MAIN);assert.equal(s.allowedRuntimeChanges.length,7);
 assert.doesNotThrow(()=>validateBackgateScope(s,[]));
 assert.throws(()=>validateBackgateScope(s,['apps/world/data/reality/README.md']));
 assert.throws(()=>backgateScope({WORLD_BACKGATE_SCOPE_BASE:releaseEnv.WORLD_BACKGATE_SCOPE_BASE}));
 assert.equal(BASELINE,'3b95e37f3dec477ebe7e06456907176bb81a63a2');assert.equal(EXPECTED_SCREENSHOTS,40);assert.equal(EXPECTED_PAIRS,20);
});
test('release backgate exact17 paths match hall scope and bind ancestry manifest',async()=>{
 const s=backgateScope(releaseEnv),manifest=manifestFor(s);assert.equal(s.allowedRuntimeChanges.length,17);
 assert.equal(new Set(s.allowedRuntimeChanges).size,17);assert.equal(s.requiredSourceHeads.length,4);
 assert.ok(Object.isFrozen(s.allowedRuntimeChanges));
 const hall=await readFile(new URL('./browser/hall-library-hosted-smoke.mjs',import.meta.url),'utf8');
 const helper=hall.match(/function hallIntegrationScopePaths\(manifest,extension\) \{[\s\S]*?\n\}/)?.[0];
 assert.ok(helper);const fn=new Function('return ('+helper+')')();
 assert.deepEqual([...fn({},'release-2026-10-13')].sort(),[...s.allowedRuntimeChanges].sort());
 assert.doesNotThrow(()=>validateBackgateScope(s,[...s.allowedRuntimeChanges].reverse(),{mergeBase:s.base,manifest}));
 for(const paths of [[],s.allowedRuntimeChanges.slice(1),[...s.allowedRuntimeChanges,s.allowedRuntimeChanges[0]]])assert.throws(()=>validateBackgateScope(s,paths,{mergeBase:s.base,manifest}));
 for(const path of ['apps/world/data/reality/README.md','apps/world/src/main.js','apps/world/src/photo/photo-capture.js','apps/world/src/diagnostics/runtime-diagnostics.js','apps/world/src/other.js','apps/world/src/phone/phone-notification-center.js'])assert.throws(()=>validateBackgateScope(s,[...s.allowedRuntimeChanges,path],{mergeBase:s.base,manifest}));
 for(const sha of [s.base,...s.requiredSourceHeads])assert.throws(()=>validateBackgateScope(s,s.allowedRuntimeChanges,{mergeBase:s.base,manifest:manifest.replace(sha,'')}));
 assert.throws(()=>validateBackgateScope(s,s.allowedRuntimeChanges,{mergeBase:CURRENT_MAIN,manifest}));
 assert.throws(()=>validateBackgateScope({...s},s.allowedRuntimeChanges,{mergeBase:s.base,manifest}));
});
test('backgate rejects wrong release branch base and extension',()=>{
 for(const branch of ['',undefined,'release/other'])assert.throws(()=>backgateScope({...releaseEnv,GITHUB_HEAD_REF:branch}));
 for(const base of ['',undefined,CURRENT_MAIN,'0dcae7b4825c12e1ec03b6879d3bc0d27f9ad46e','bfa08ad78f92fba51eb1a3978dd97a12182fc82c'])assert.throws(()=>backgateScope({...releaseEnv,WORLD_BACKGATE_SCOPE_BASE:base}));
 for(const extension of ['all','unknown'])assert.throws(()=>backgateScope({...releaseEnv,WORLD_BACKGATE_SCOPE_EXTENSION:extension}));
});
test('backgate workflow wiring retains bounded admission before actual browser',async()=>{
 const wf=await readFile(new URL('../../../.github/workflows/backgate-restoration-browser.yml',import.meta.url),'utf8');
 const runner=await readFile(new URL('./browser/backgate-restoration-smoke.mjs',import.meta.url),'utf8');
 for(const x of ['WORLD_BACKGATE_SCOPE_BASE:','WORLD_BACKGATE_SCOPE_EXTENSION:','github.event.pull_request.base.sha','release/2026-10-13-ci-runtime-diagnostics','contents: read','persist-credentials: false','north-walkway-batching.test.mjs'])assert.ok(wf.includes(x),x);
 assert.doesNotMatch(wf,/continue-on-error|pull_request_target|contents: write/);
 for(const x of ['validateBackgateScope(scope, report.runtimeChangedPaths',"['merge-base', '--is-ancestor', sha, 'HEAD']",'sourceHeads: scope.requiredSourceHeads','QA must not change tracked checkout state','assert.equal(report.screenshots.length, expectedScreenshots)','assert.equal(report.comparisons.length, expectedPairs)'])assert.ok(runner.includes(x),x);
 assert.ok(runner.indexOf('validateBackgateScope(scope, report.runtimeChangedPaths')<runner.indexOf("await bounded('browser startup'"));
});
