// Offline real-browser acceptance. Uses synthetic read responses only; no live service or account.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';

const output = path.resolve(process.env.LIFE_TREE_QA_OUTPUT || 'test-results/life-skill-tree-recovery');
await mkdir(output, { recursive: true });
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const expectedHead = process.env.EXPECTED_LIFE_TREE_HEAD;
assert.match(expectedHead ?? '', /^[a-f0-9]{40}$/, 'EXPECTED_LIFE_TREE_HEAD must identify the immutable candidate');
assert.equal(head, expectedHead, 'browser must test the exact candidate head');
const report = { head, expectedHead, status: 'RUNNING', scope: 'Real production client/panel, synthetic read-only RPCs; no live account or DB',
  sourceHashes: {}, screenshots: [], viewports: [] };
for (const name of ['src/life-skills/life-skill-book-client.js', 'src/life-skills/life-skill-book-panel.js',
  'tests/browser/life-skill-tree-recovery-harness.html', 'styles.css']) {
  report.sourceHashes[name] = createHash('sha256').update(await readFile(new URL(`../../${name}`, import.meta.url))).digest('hex');
}
const screenshot = async (page, name) => {
  const file = path.join(output, name);
  await page.screenshot({ path: file });
  const bytes = await readFile(file);
  report.screenshots.push({ file: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
};
try {
for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  const smoke = await startSmoke({ viewport });
  try {
    const page = await smoke.context.newPage();
    const fatal = smoke.watch(page);
    await page.goto(`${smoke.origin}/tests/browser/life-skill-tree-recovery-harness.html`);
    await Promise.race([page.waitForFunction(() => window.__LIFE_TREE_QA__, null, { timeout: TIMEOUT_MS }), fatal]);
    const queue = kind => page.evaluate(value => window.__LIFE_TREE_QA__.queue(value), kind);
    const release = kind => page.evaluate(value => window.__LIFE_TREE_QA__.release(value), kind);
    const snapshot = () => page.evaluate(() => window.__LIFE_TREE_QA__.snapshot());
    const panel = page.locator('#life-skill-book-panel');
    const waitState = treeState => page.waitForFunction(value => window.__LIFE_TREE_QA__.snapshot().treeState === value, treeState);
    const openFishing = () => page.locator('[data-skill-id="life.fishing"] button').click();

    await page.locator('#open-book').click();
    await openFishing();
    await waitState('UNAVAILABLE');
    assert.match(await panel.innerText(), /스킬트리를 불러오지 못했어요/);
    assert.doesNotMatch(await panel.innerText(), /스킬트리를 불러오는 중/);
    const listCalls = (await snapshot()).calls.filter(c => c.rpc === 'get_my_world_life_skills_v1').length;
    await screenshot(page, `${viewport.width}-error.png`);
    await queue('hold');
    await page.locator('.life-tree-retry').click();
    await waitState('LOADING');
    assert.equal(await page.locator('.life-tree-retry').count(), 0);
    assert.equal(await page.locator('.life-node-unlock').count(), 0);
    await release('failure');
    await waitState('UNAVAILABLE');
    await queue('success');
    await page.locator('.life-tree-retry').click();
    await waitState('READY');
    assert.match(await panel.innerText(), /아직 공개된 스킬트리 노드가 없어요/);
    assert.equal((await snapshot()).calls.filter(c => c.rpc === 'get_my_world_life_skills_v1').length, listCalls);
    await screenshot(page, `${viewport.width}-recovered.png`);

    // Back, close, and account changes must invalidate delayed reads, even when reopened.
    for (const boundary of ['back', 'close', 'account']) {
      if (await page.locator('.life-skill-back').count()) await page.locator('.life-skill-back').click();
      await queue('hold');
      await openFishing();
      await waitState('LOADING');
      if (boundary === 'back') await page.locator('.life-skill-back').click();
      else if (boundary === 'close') await page.locator('.profile-close').click();
      else await page.evaluate(() => window.__LIFE_TREE_QA__.switchAccount());
      await release('success');
      await waitState(null);
      assert.equal((await snapshot()).selectedSkillId, null);
      if (boundary === 'close') {
        assert.equal(await panel.isVisible(), false);
        await page.locator('#open-book').click();
      }
      assert.equal(await page.locator('.life-skill-open').count(), 2);
      assert.equal(await page.locator('.life-tree-summary').count(), 0);
    }
    assert.ok((await snapshot()).calls.every(c => ['get_my_world_life_skills_v1', 'get_my_world_life_skill_tree_v1'].includes(c.rpc)));
    assert.deepEqual(smoke.problems, []);
    report.viewports.push({ ...viewport, status: 'PASS', final: await snapshot(), problems: smoke.problems });
    console.log(`Life Skill tree read recovery PASS (${viewport.width} × ${viewport.height})`);
  } finally {
    await smoke.close();
  }
}
report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = error.stack ?? String(error);
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
