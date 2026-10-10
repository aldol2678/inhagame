// Run with the existing pinned browser dependencies. Fully offline; no account or DB access.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";
const output = path.resolve(process.env.ROOM_SEATING_QA_OUTPUT || "test-results/personal-room-seating");
await mkdir(output, { recursive: true });
const report = [];
for (const viewport of [{ label: "desktop", width: 1280, height: 720, mobile: false },
  { label: "mobile", width: 390, height: 844, mobile: true }]) {
  const smoke = await startSmoke({ viewport: { width: viewport.width, height: viewport.height },
    contextOptions: { isMobile: viewport.mobile, hasTouch: viewport.mobile } });
  try {
    const page = await smoke.context.newPage(), fatal = smoke.watch(page);
    await page.goto(`${smoke.origin}/tests/browser/personal-room-seating-harness.html`, { waitUntil: "domcontentloaded" });
    await Promise.race([fatal, page.waitForFunction(() => window.__ROOM_SEATING_QA__?.ready || window.__ROOM_SEATING_QA__?.error,
      null, { timeout: TIMEOUT_MS })]);
    assert.equal(await page.evaluate(() => window.__ROOM_SEATING_QA__.error ?? null), null);
    const state = () => page.evaluate(() => window.__ROOM_SEATING_QA__.snapshot());
    const click = async id => viewport.mobile ? page.locator(id).tap() : page.locator(id).click();
    const seated = async value => page.waitForFunction(expected => window.__ROOM_SEATING_QA__.snapshot().seated === expected, value);
    const action = async () => {
      await page.locator("#context-action").waitFor({ state: "visible" });
      if (viewport.mobile) await click("#context-action"); else await page.keyboard.press("KeyF");
    };
    for (const kind of ["fixed", "chair", "sofa"]) {
      await click(`#qa-${kind}`);
      await action(); await seated(true);
      await page.screenshot({ path: path.join(output, `${viewport.label}-${kind}-seated.png`) });
      report.push({ viewport: viewport.label, kind, state: await state() });
      await action(); await seated(false);
      assert.equal((await state()).safe, true, `${kind} stands outside furniture collision`);
    }
    await click("#qa-fixed"); await action(); await seated(true);
    if (viewport.mobile) {
      const box = await page.locator("#joystick").boundingBox();
      assert.ok(box); const x = box.x + box.width / 2, y = box.y + box.height / 2;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + box.width * .3, y }] });
      try { await seated(false); }
      finally { await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await cdp.detach(); }
    } else { await page.keyboard.down("KeyW"); await seated(false); await page.keyboard.up("KeyW"); }
    await seated(false);
    await click("#qa-fixed"); await action(); await seated(true);
    await click("#qa-edit"); await seated(false);
    assert.equal((await state()).safe, true);
    assert.equal((await state()).editing, true);
    await click("#qa-sofa"); await action(); await seated(true);
    await page.evaluate(() => window.__ROOM_SEATING_QA__.removeOccupied()); await seated(false);
    assert.equal((await state()).safe, true);
    await click("#qa-fixed"); await action(); await seated(true);
    await click("#qa-exit"); await seated(false);
    assert.equal((await state()).inside, false);
    assert.equal((await state()).parent, "QA_Campus");
    assert.equal(smoke.problems.length, 0, JSON.stringify(smoke.problems));
  } finally { await smoke.close(); }
}
await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(`Personal room seating browser smoke passed: ${output}`);
