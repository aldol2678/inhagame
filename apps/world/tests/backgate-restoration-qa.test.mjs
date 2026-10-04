import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TARGETS,VIEWS,VIEWPORTS,BASELINE,BASELINE_PATHS,assertHosted,EXPECTED_SCREENSHOTS,EXPECTED_PAIRS} from './browser/backgate-restoration-qa-plan.mjs';

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
