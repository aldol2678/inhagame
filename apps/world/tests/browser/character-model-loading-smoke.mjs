import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
const output = resolve(process.env.CHARACTER_SMOKE_OUTPUT || 'test-results/character-model');
await mkdir(output, { recursive: true });
const smoke = await startSmoke({ viewport: { width: 664, height: 580 } });
const results = [];
const read = page => page.evaluate(() => window.__CHARACTER_MODEL_HARNESS__.snapshot());
const action = (page, method, ...args) => page.evaluate(({ method, args }) => window.__CHARACTER_MODEL_HARNESS__[method](...args), { method, args });
async function open(query = '') {
  const page = await smoke.context.newPage(), fatal = smoke.watch(page);
  await page.goto(`${smoke.origin}/tests/browser/character-model-loading-harness.html${query}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  await Promise.race([page.waitForFunction(() => window.__CHARACTER_MODEL_HARNESS__?.initialized !== undefined, null, { timeout: TIMEOUT_MS }), fatal]);
  const start = await page.evaluate(() => ({ initialized: window.__CHARACTER_MODEL_HARNESS__.initialized, error: window.__CHARACTER_MODEL_HARNESS__.error }));
  assert.equal(start.initialized, true, start.error);
  const state = await read(page); assert.equal(state.engine, '2.22.4'); assert.equal(state.renderer, 'WebGL2');
  return page;
}
const settled = page => page.waitForFunction(() => window.__CHARACTER_MODEL_HARNESS__.snapshot().ready, null, { timeout: TIMEOUT_MS });
async function capture(page, name) {
  await action(page, 'label', name);
  const before = (await read(page)).frame;
  await page.waitForFunction(frame => window.__CHARACTER_MODEL_HARNESS__.snapshot().frame >= frame + 3, before);
  await page.screenshot({ path: resolve(output, `${name}.png`) });
  const state = await read(page); results.push({ name, state }); return state;
}
async function releaseCheck(page) {
  const before = await read(page);
  await action(page, 'destroy'); const state = await read(page);
  assert.equal(state.containerAssets, before.containerAssets, 'disposal does not evict shared container assets');
  assert.equal(state.playerChildren, 0); assert.equal(state.sceneRenderComponents, 0);
  assert.equal(state.liveClones, 0); assert.equal(state.unattachedLiveClones, 0); assert.equal(state.duplicateDestroy, false);
  assert.ok(state.clones.every(clone => clone.destroys === 1 && clone.renderComponents === 0));
  return state;
}
try {
  for (const failed of ['duck', 'dragon']) {
    const good = failed === 'duck' ? 'dragon' : 'duck', page = await open();
    await action(page, 'fail', failed);
    assert.equal((await read(page)).ready, false, 'readiness cannot settle while sibling remains pending');
    await action(page, 'success', good); await settled(page); await action(page, 'update', 0);
    let state = await read(page);
    assert.ok(state[good]?.enabled); assert.equal(state[failed], null);
    assert.ok(state[good].renderComponents > 0);
    const duck = state.duck ?? state.fallbackDuck, carrier = state.dragon ?? state.fallbackDragon;
    // Tilt changes the seat relative to the carrier origin; follow the authored anchor.
    const relativeY = state.riderFeet[1] - (state.riderSeatY ?? carrier.position[1]);
    await action(page, 'update', .3); state = await read(page);
    assert.ok(Math.abs(state.riderFeet[1] - (state.riderSeatY ?? (state.dragon ?? state.fallbackDragon).position[1]) - relativeY) < 1e-6);
    assert.equal(state.unattachedLiveClones, 0); assert.equal(state.liveClones, 1);
    assert.equal(state[failed === 'duck' ? 'fallbackDuck' : 'fallbackDragon'].enabled, true);
    assert.equal(state[good === 'duck' ? 'fallbackDuck' : 'fallbackDragon'].enabled, false);
    await capture(page, `${failed}-failure-sibling-retained`);
    await action(page, 'firstPerson', true); state = await read(page);
    assert.equal(state[good].enabled, false); await action(page, 'firstPerson', false);
    await action(page, 'occluded', true); assert.equal((await read(page))[good].enabled, false); await action(page, 'occluded', false);
    results.push({ name: `${failed}-failure-disposed`, state: await releaseCheck(page) }); await page.close();
  }
  {
    const page = await open(); await action(page, 'success', 'duck');
    await page.waitForFunction(() => Boolean(window.__CHARACTER_MODEL_HARNESS__.snapshot().duck));
    const early = await capture(page, 'duck-visible-before-carrier-completes'); assert.equal(early.ready, false);
    assert.equal(early.duck.enabled, true); assert.ok(early.duck.renderComponents > 0); assert.equal(early.fallbackDuck.enabled, false);
    await action(page, 'success', 'dragon'); await settled(page);
    const complete = await capture(page, 'both-models-ready'); assert.ok(complete.duck.enabled && complete.dragon.enabled); assert.equal(complete.liveClones, 2);
    results.push({ name: 'both-disposed', state: await releaseCheck(page) }); await page.close();
  }
  {
    const page = await open(); await action(page, 'destroy'); await action(page, 'success', 'duck'); await action(page, 'success', 'dragon'); await settled(page);
    const state = await capture(page, 'late-callbacks-after-disposal');
    assert.equal(state.clones.length, 0); assert.equal(state.playerChildren, 0); assert.equal(state.sceneRenderComponents, 0); await page.close();
  }
  {
    const page = await open(); await action(page, 'success', 'duck', true); await action(page, 'success', 'dragon'); await settled(page);
    const state = await capture(page, 'bad-duck-pivot-carrier-retained');
    assert.equal(state.duck, null); assert.ok(state.dragon.enabled); assert.equal(state.liveClones, 1);
    assert.equal(state.clones.find(clone => clone.kind === 'duck').destroys, 1); await releaseCheck(page); await page.close();
  }
  {
    const page = await open('?canary=1&hold=1'); await action(page, 'success', 'duck'); await action(page, 'fail', 'dragon');
    await page.waitForFunction(() => window.__CHARACTER_MODEL_HARNESS__.snapshot().clones.length === 1);
    const immediate = await releaseCheck(page); assert.equal(immediate.ready, false); assert.equal(immediate.clones.length, 1);
    results.push({ name: 'pending-canonical-released-before-resolution', state: immediate });
    await action(page, 'releaseOptimized'); await settled(page);
    const late = await capture(page, 'pending-canary-disposal');
    assert.equal(late.liveClones, 0); assert.equal(late.unattachedLiveClones, 0); assert.equal(late.duplicateDestroy, false);
    assert.equal(late.clones.length, 2); assert.ok(late.clones.every(clone => clone.destroys === 1)); assert.equal(late.sceneRenderComponents, 0); await page.close();
  }
  {
    const page = await open('?canary=1'); await action(page, 'success', 'duck'); await action(page, 'fail', 'dragon'); await settled(page);
    assert.equal((await read(page)).canary.authority, 'OPTIMIZED_CANARY');
    await action(page, 'rollback'); await action(page, 'rollback');
    const state = await capture(page, 'canary-rollback-carrier-fallback');
    assert.equal(state.canary.authority, 'CANONICAL'); assert.equal(state.liveClones, 1); assert.equal(state.unattachedLiveClones, 0); assert.equal(state.duplicateDestroy, false);
    assert.ok(state.duck.enabled && state.fallbackDragon.enabled); await releaseCheck(page); await page.close();
  }
  assert.deepEqual(smoke.problems, []);
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ passed: true, headSha: process.env.CHARACTER_SMOKE_HEAD_SHA ?? null, results, problems: smoke.problems }, null, 2));
  console.log(`Character model WebGL2 smoke: PASS (${results.length} snapshots)`);
} catch (error) {
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ passed: false, error: String(error.stack ?? error), results, problems: smoke.problems }, null, 2));
  throw error;
} finally { await smoke.close(); }
