// Offline PlayCanvas WebGL2 screenshot comparison; intentionally no production/remote calls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
const root = process.env.RUNNER_TEMP || os.tmpdir();
const reportPath = path.join(root, 'fishing-rod-webgl2.json');
const result = { renderer: 'WebGL2', hardware: 'CI software rasterizer (not Android physical device)',
  status: 'NOT_VERIFIED', productionChanged:false };
const smoke = await startSmoke({viewport:{width:512,height:512}});
async function render(variant) {
  const page = await smoke.context.newPage();
  const fatal = smoke.watch(page);
  try {
    await page.goto(smoke.origin + '/tests/browser/fishing-rod-experiment-harness.html?variant=' + variant,
      {waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
    await Promise.race([
      page.waitForFunction(() => window.__FISHING_ROD_RENDER__?.ready !== undefined,
        null, {timeout:TIMEOUT_MS}), fatal
    ]);
    const state = await page.evaluate(() => window.__FISHING_ROD_RENDER__);
    assert.equal(state.ready,true,state.error);
    assert.equal(state.renderer,'WebGL2');
    assert.equal(state.surfaces,3);
    assert.deepEqual(state.sockets,[true,true,true,true]);
    const shot = await page.screenshot({path:path.join(root,'fishing-rod-'+variant+'.png')});
    assert.ok(shot.length > 2000,'screenshot has image bytes');
    return {state,sha256:createHash('sha256').update(shot).digest('hex'),bytes:shot.length,shot};
  } finally { await page.close(); }
}
try {
  const original=await render('source');
  const candidate=await render('candidate');
  // Frame-buffer exactness is required for automatic approval; any difference is flagged for review.
  const samePixels=original.shot.equals(candidate.shot);
  Object.assign(result, { status:samePixels ? 'OFFLINE_SCREENSHOT_EXACT_MATCH':'SCREENSHOTS_DIFFER_REVIEW_REQUIRED',
    original:{...original.state,screenshotSha256:original.sha256,screenshotBytes:original.bytes},
    candidate:{...candidate.state,screenshotSha256:candidate.sha256,screenshotBytes:candidate.bytes},
    byteIdenticalScreenshots:samePixels,
    note:'Same pinned PlayCanvas engine and camera; screenshot equality is a software-renderer proxy, not physical mobile QA' });
  console.log('FISHING_ROD_WEBGL2 ' + JSON.stringify(result));
  assert.deepEqual(smoke.problems,[],'offline browser console/network errors');
  assert.equal(samePixels,true,'different screenshots require visual investigation before adoption');
} catch (e) {
  Object.assign(result, {status:'FAILED',failure:String(e?.stack||e)});
  console.error('FISHING_ROD_WEBGL2_FAILED '+result.failure);
  process.exitCode=1;
} finally {
  await writeFile(reportPath,JSON.stringify(result,null,2)+'\n');
  await smoke.close();
}
