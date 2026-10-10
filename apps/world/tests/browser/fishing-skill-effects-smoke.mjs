// Offline browser acceptance of effect copy and panel layout; no live account or DB.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';

const output = path.resolve(process.env.FISHING_EFFECTS_QA_OUTPUT || 'test-results/fishing-skill-effects');
await mkdir(output, { recursive: true });
const report = { status: 'RUNNING', scope: 'Offline real client/panel, synthetic read-only RPCs', sourceHashes: {}, viewports: [] };
for (const name of ['src/life-skills/life-skill-book-panel.js', 'src/life-skills/life-skill-book-client.js', 'styles.css'])
  report.sourceHashes[name] = createHash('sha256').update(await readFile(new URL(`../../${name}`, import.meta.url))).digest('hex');

try {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const smoke = await startSmoke({ viewport });
    try {
      const page = await smoke.context.newPage(), fatal = smoke.watch(page);
      await page.goto(`${smoke.origin}/tests/browser/fishing-skill-effects-harness.html`);
      await Promise.race([page.waitForFunction(() => window.__FISHING_EFFECTS_QA__, null, { timeout: TIMEOUT_MS }), fatal]);
      const panel = page.locator('#life-skill-book-panel');
      const configure = (mode, ranks) => page.evaluate(([m, r]) => window.__FISHING_EFFECTS_QA__.configure(m, r), [mode, ranks]);
      const state = value => page.waitForFunction(v => window.__FISHING_EFFECTS_QA__.snapshot().treeState === v, value);
      const openTree = () => page.locator('.life-skill-open').click();
      const screenshot = name => page.screenshot({ path: path.join(output, `${viewport.width}-${name}.png`) });
      const assertLayout = async () => {
        const layout = await panel.evaluate(root => {
          const body = root.querySelector('.shop-panel-body'), rect = root.getBoundingClientRect();
          const effects = [...root.querySelectorAll('.life-node-effect, .life-tree-effect-timing')];
          return { left: rect.left, right: rect.right, viewport: innerWidth,
            panelOverflow: root.scrollWidth > root.clientWidth, bodyOverflow: body.scrollWidth > body.clientWidth,
            textOverflow: effects.some(el => el.scrollWidth > el.clientWidth),
            buttonsTooSmall: [...root.querySelectorAll('.life-node-unlock')].some(el => el.getBoundingClientRect().height < 44) };
        });
        assert.ok(layout.left >= 0 && layout.right <= layout.viewport, JSON.stringify(layout));
        assert.deepEqual([layout.panelOverflow, layout.bodyOverflow, layout.textOverflow, layout.buttonsTooSmall], [false, false, false, false]);
      };

      await page.locator('#open-book').click();
      await openTree();
      await state('READY');
      assert.equal(await page.locator('.life-node-effect').filter({ hasText: '미보유 (효과 없음)' }).count(), 2);
      assert.match(await panel.innerText(), /랭크당 입질 후 반응 시간 \+250ms/);
      assert.match(await panel.innerText(), /랭크당 입질 대기 시간 -250ms/);
      assert.match(await panel.innerText(), /다음 낚시 시작부터 적용돼요.*진행 중인 낚시는 바뀌지/);
      assert.match(await panel.innerText(), /최솟값·최댓값.*1ms 미만으로 줄어들지/);
      await assertLayout();
      await screenshot('unowned');

      for (const ranks of [[1, 2], [3, 3]]) {
        await page.locator('.life-skill-back').click();
        await configure('success', ranks);
        await openTree();
        await state('READY');
        const steady = page.locator('[data-node-id="life.node.fishing.steady_hands"]');
        const sense = page.locator('[data-node-id="life.node.fishing.fish_sense"]');
        assert.ok((await steady.innerText()).includes(`현재 · 랭크 ${ranks[0]}/3 · 반응 시간 +${ranks[0] * 250}ms`));
        assert.ok((await sense.innerText()).includes(`현재 · 랭크 ${ranks[1]}/3 · 입질 대기 시간 -${ranks[1] * 250}ms`));
        if (ranks[0] === 3) {
          assert.equal(await page.locator('.life-node-effect').filter({ hasText: '최대 단계에 도달했어요' }).count(), 2);
          assert.doesNotMatch(await panel.innerText(), /1000ms|랭크 4/);
        }
        await assertLayout();
        await sense.scrollIntoViewIfNeeded();
        await screenshot(ranks[0] === 3 ? 'max' : 'owned');
      }

      await page.locator('.life-skill-back').click();
      await configure('hold');
      await openTree();
      await state('LOADING');
      assert.equal(await page.locator('.life-node-effect').count(), 0);
      assert.match(await panel.innerText(), /스킬트리를 불러오는 중/);
      await screenshot('loading');
      await page.evaluate(() => window.__FISHING_EFFECTS_QA__.release('failure'));
      await state('UNAVAILABLE');
      assert.equal(await page.locator('.life-node-effect').count(), 0);
      assert.equal(await page.locator('.life-node-unlock').count(), 0);
      await screenshot('error');
      await configure('success', [0, 0]);
      await page.locator('.life-tree-retry').click();
      await state('READY');
      assert.equal(await page.locator('.life-node-effect').filter({ hasText: '미보유 (효과 없음)' }).count(), 2);
      await page.keyboard.press('Escape');
      assert.equal(await panel.isVisible(), false);
      await page.locator('#open-book').click();
      assert.equal(await page.locator('.life-node-effect').count(), 0);
      const final = await page.evaluate(() => window.__FISHING_EFFECTS_QA__.snapshot());
      assert.equal(final.selectedSkillId, null);
      assert.ok(final.calls.every(c => ['get_my_world_life_skills_v1', 'get_my_world_life_skill_tree_v1'].includes(c.rpc)));
      assert.deepEqual(smoke.problems, []);
      report.viewports.push({ ...viewport, status: 'PASS', final, problems: smoke.problems });
      console.log(`Fishing skill effect copy PASS (${viewport.width} × ${viewport.height})`);
    } finally { await smoke.close(); }
  }
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.error = error.stack ?? String(error); throw error;
} finally { await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`); }
