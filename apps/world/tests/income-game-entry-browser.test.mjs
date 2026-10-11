import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = p => readFile(new URL(p, import.meta.url), 'utf8');
test('game-entry browser uses actual modules and explicit isolated renderer boundary', async () => {
  const fixture = await read('./browser/income-game-entry-browser-fixture.mjs');
  for (const expected of ['createHumanAvatar','createIncomeGameEntry','createContextActionController','bindIncomeGameLifecycle','DEVICETYPE_WEBGL2','gl.readPixels','framebufferEvidence','fullMainBoot: false','persistedLifecycleIsSynthetic: true']) assert.ok(fixture.includes(expected),expected);
  assert.match(fixture,/getLocalAuthHost:.*HOSTED_GAME_MUST_NOT_READ_LOCAL_AUTH/);
  assert.doesNotMatch(fixture,/createIncomeRpc|serviceKey|authorization:|\.rpc\(/i);
});
test('exact-head renderer CI preserves pixels and reports simulated lifecycle accurately', async () => {
  const runner=await read('./browser/income-game-entry-browser-smoke.mjs');
  for (const expected of ['fullMainBoot: false','not a real back-forward cache navigation','servedHashes','report.expectedHead','initialPixels.foreground>300','pixels.hash,item.initialPixels.hash',"['mounted','seated','blocked']",'synthetic-account-b','completion restores focus','result.json']) assert.ok(runner.includes(expected),expected);
  const workflow=await read('../../../.github/workflows/income-game-entry-browser.yml');
  assert.match(workflow,/contents: read/);assert.match(workflow,/persist-credentials: false/);assert.match(workflow,/EXPECTED_INCOME_GAME_HEAD:/);assert.match(workflow,/if: always\(\)/);
  assert.match(workflow,/WORLD_SMOKE_DISABLE_WEBGPU: '1'/);assert.doesNotMatch(workflow,/secrets\.|pull_request_target|deploy/i);
});
