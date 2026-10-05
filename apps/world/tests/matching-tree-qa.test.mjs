import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { MATCHING_TREE as tree } from '../src/matching-tree-layout.js';
import { SEAT_ANCHORS } from '../src/seat-anchors.js';
const url = new URL('./browser/matching-tree-qa.mjs', import.meta.url);
const qa = existsSync(url) ? await import(url) : {};
const hosted = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_EVENT_NAME: 'pull_request',
  EXPECTED_MATCHING_TREE_HEAD: 'a'.repeat(40), WORLD_SMOKE_DISABLE_WEBGPU: '1', WORLD_SMOKE_BROWSER: 'chrome' };

test('matching-tree browser acceptance rejects local execution before browser import', () => {
  assert.equal(typeof qa.assertMatchingTreeHostedExecution, 'function');
  assert.doesNotThrow(() => qa.assertMatchingTreeHostedExecution(hosted));
  for (const key of Object.keys(hosted)) assert.throws(() => qa.assertMatchingTreeHostedExecution({ ...hosted, [key]: '' }));
});

test('matching-tree views face the real shared tree and retain the whole fork in portrait', () => {
  assert.equal(typeof qa.matchingTreeViews, 'function');
  assert.deepEqual(qa.MATCHING_TREE_QA_VIEWPORTS.map(v => v.name), ['desktop', 'portrait', 'landscape']);
  const views = qa.matchingTreeViews();
  assert.deepEqual(views.map(v => v.id), ['tree-facing', 'two-seats']);
  for (const view of views) {
    assert.ok([...view.from, ...view.target].every(Number.isFinite));
    assert.ok((view.from[0] - tree.center.x) * tree.front.x + (view.from[2] - tree.center.z) * tree.front.z > 0);
    const portrait = qa.matchingTreeCamera(view, 390 / 844);
    assert.deepEqual(portrait.target, view.target);
    assert.ok(Math.hypot(...portrait.from.map((v, i) => v - view.target[i])) > Math.hypot(...view.from.map((v, i) => v - view.target[i])));
    assert.deepEqual(qa.matchingTreeCamera(view, 1280 / 720), view);
  }
  assert.throws(() => qa.matchingTreeCamera(views[0], 0), /aspect/);
});

test('seat pose check rejects shifted, wrongly rotated and unseated avatars', () => {
  assert.equal(typeof qa.assertMatchingTreeSeatPose, 'function');
  const anchors = SEAT_ANCHORS.filter(a => a.interactableId === tree.id);
  assert.equal(anchors.length, 2);
  for (const anchor of anchors) {
    const state = { id: anchor.id, position: { ...anchor.position }, yaw: anchor.yaw, seated: true, legs: [70, 70] };
    assert.doesNotThrow(() => qa.assertMatchingTreeSeatPose(state, anchor));
    assert.throws(() => qa.assertMatchingTreeSeatPose({ ...state, position: { ...state.position, y: state.position.y + .03 } }, anchor), /position/);
    assert.throws(() => qa.assertMatchingTreeSeatPose({ ...state, yaw: anchor.yaw + 90 }, anchor), /facing/);
    assert.throws(() => qa.assertMatchingTreeSeatPose({ ...state, seated: false }, anchor), /seated/);
    assert.throws(() => qa.assertMatchingTreeSeatPose({ ...state, legs: [0, 0] }, anchor), /pose/);
  }
});

test('screen-space framing rejects clipped tree/seat samples and invalid depth', () => {
  assert.equal(typeof qa.assertMatchingTreeFraming, 'function');
  const viewport = { width: 390, height: 844 }, points = [{ x: 195, y: 200, depth: 3 }, { x: 80, y: 700, depth: 4 }];
  assert.doesNotThrow(() => qa.assertMatchingTreeFraming(points, viewport));
  for (const point of [{ x: -1, y: 100, depth: 3 }, { x: 100, y: 900, depth: 3 }, { x: 100, y: 100, depth: -1 }])
    assert.throws(() => qa.assertMatchingTreeFraming([point], viewport), /frame/);
  assert.throws(() => qa.assertMatchingTreeFraming([], viewport), /samples/);
});

test('hosted matching-tree QA uses actual campus input and cannot publish', () => {
  const file = new URL('./browser/matching-tree-smoke.mjs', import.meta.url);
  assert.ok(existsSync(file), 'hosted smoke script is prepared');
  const smoke = readFileSync(file, 'utf8');
  assert.ok(smoke.indexOf('assertMatchingTreeHostedExecution(process.env)') < smoke.indexOf("await import('./harness.mjs')"));
  assert.match(smoke, /page\.keyboard\.press\('KeyF'\)/);
  assert.match(smoke, /locator\('#context-action'\)/);
  assert.match(smoke, /page\.keyboard\.down\('KeyW'\)/);
  assert.match(smoke, /page\.keyboard\.press\('Space'\)/);
  assert.match(smoke, /PENDING_INDEPENDENT_PIXEL_REVIEW/);
  assert.doesNotMatch(smoke, /contextActions\.(set|clear|trigger)|seating\.toggle\(/);
  const workflow = readFileSync(new URL('../../../.github/workflows/campus-visual-parity-browser.yml', import.meta.url), 'utf8');
  assert.match(workflow, /matching-tree-null-smoke\.mjs/);
  assert.match(workflow, /matching-tree-smoke\.mjs/);
  assert.match(workflow, /EXPECTED_MATCHING_TREE_HEAD: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.doesNotMatch(workflow, /pull_request_target|contents: write|secrets\.|deploy|--force/);
});

test('live camera samples cover the fork and avatars without demanding a whole canopy at the production 7-WU cap', () => {
  assert.equal(typeof qa.matchingTreeTargetSamples, 'function');
  const live = qa.matchingTreeTargetSamples(false), whole = qa.matchingTreeTargetSamples(true);
  assert.equal(live.length, 9);
  assert.equal(whole.length, live.length + tree.crowns.length * 4);
  assert.ok(live.every(p => [p.x, p.y, p.z].every(Number.isFinite)));
  assert.ok(Math.max(...whole.map(p => p.y)) > Math.max(...live.map(p => p.y)) + 1);
  for (const u of tree.seatOffsets) for (const side of [-.24, .24]) {
    const expected = tree.at(u + side, tree.seatV);
    assert.ok(live.some(p => Math.abs(p.x - expected.x) < 1e-9 && Math.abs(p.z - expected.z) < 1e-9));
  }
  const smoke = readFileSync(new URL('./browser/matching-tree-smoke.mjs', import.meta.url), 'utf8');
  assert.match(smoke, /entry\.liveCamera\.targets = await projectedTargets\(page, false\)/);
  assert.match(smoke, /const projected = await projectedTargets\(page\)/);
  assert.match(smoke, /safeFraction/);
});
