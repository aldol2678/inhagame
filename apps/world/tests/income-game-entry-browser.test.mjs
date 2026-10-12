import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = p => readFile(new URL(p, import.meta.url), 'utf8');
test('game-entry browser uses actual modules and explicit isolated renderer boundary', async () => {
  const fixture = await read('./browser/income-game-entry-browser-fixture.mjs');
  for (const expected of ['createHumanAvatar','createIncomeGameEntry','createContextActionController','bindIncomeGameLifecycle','DEVICETYPE_WEBGL2','readIncomeResolvedFramebuffer',"app.once('postrender'",'fullMainBoot: false','persistedLifecycleIsSynthetic: true']) assert.ok(fixture.includes(expected),expected);
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

test('framebuffer evidence reads resolved default and restores engine binding, even on failure', async () => {
  const { readIncomeResolvedFramebuffer } = await import('./browser/income-game-entry-framebuffer.mjs');
  const calls = [], old = { multisampled: true };
  const gl = { drawingBufferWidth: 2, drawingBufferHeight: 1, READ_FRAMEBUFFER: 1, READ_FRAMEBUFFER_BINDING: 2, RGBA: 3, UNSIGNED_BYTE: 4,
    isContextLost: () => false, getParameter: () => old, getError: () => 0,
    bindFramebuffer: (target, value) => calls.push(['bind', target, value]), finish: () => calls.push(['finish']),
    readPixels: (x, y, w, h, format, type, data) => { calls.push(['read', w, h]); data.set([0,0,0,255,100,150,200,255]); } };
  const result = readIncomeResolvedFramebuffer(gl);
  assert.deepEqual(calls, [['bind',1,null],['finish'],['read',2,1],['bind',1,old]]);
  assert.equal(result.foreground,1); assert.equal(result.readbackFramebuffer,'resolved-default'); assert.equal(result.glError,0);
  calls.length=0; gl.readPixels=()=>{throw new Error('read failed');};
  assert.throws(()=>readIncomeResolvedFramebuffer(gl),/read failed/); assert.deepEqual(calls.at(-1),['bind',1,old]);
});

test('fixture button layout excludes hidden choices instead of overriding native hidden', async () => {
  const html = await read('./browser/income-game-entry-browser.html');
  assert.match(html, /\.furniture-editor button:not\(\[hidden\]\)\{display:block/);
  assert.doesNotMatch(html, /\.furniture-editor button\s*\{[^}]*display\s*:/);
  const smoke = await read('./browser/income-game-entry-browser-smoke.mjs');
  for (const assertion of ["button[hidden]", "getComputedStyle(node).display", "node.getClientRects().length", "completed modal cannot tab to hidden choices", "delivery-only view hides practice and wage note"]) assert.ok(smoke.includes(assertion), assertion);
});
