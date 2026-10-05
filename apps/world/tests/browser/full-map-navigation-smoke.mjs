// Prepared acceptance; use the supported offline browser harness. This script is not
// evidence of execution. No production services, account writes or published assets.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
const expectedHead = process.env.EXPECTED_MAP_HEAD;
assert.match(expectedHead ?? "", /^[a-f0-9]{40}$/, "EXPECTED_MAP_HEAD must identify the immutable candidate");
assert.equal(head, expectedHead, "hosted acceptance must test the exact PR head");
const sourceHashes = {};
for (const file of ["src/minimap/full-map-controller.js", "src/minimap/full-map-search.js", "src/minimap/minimap-data.js", "src/main.js", "campus/index.html", "styles.css", "data/reality/campus-facilities.json", "tests/browser/full-map-navigation-fixture.mjs", "tests/browser/full-map-navigation-smoke.mjs", "tests/browser/full-map-readability-smoke.mjs"]) {
  sourceHashes[file] = createHash("sha256").update(await readFile(new URL(`../../${file}`, import.meta.url))).digest("hex");
}

const output = path.resolve(process.env.FULL_MAP_NAVIGATION_OUTPUT || "test-results/full-map-navigation");
await mkdir(output, { recursive: true });
const report = { head, tree, expectedHead, sourceHashes, screenshots: [], limits: ["IME uses Chromium CDP, not an OS Korean candidate window; Input.insertText compositionend may have isTrusted=false", "Mobile uses Chromium touch emulation, not a physical handset"], scope: "Real map controllers/CSS/campus POIs; fixed player, no game engine or account", status: "RUNNING", cases: [] };
try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 360, height: 800 }, { width: 844, height: 390 }, { width: 568, height: 320 }]) {
    const smoke = await startSmoke({ viewport, contextOptions: { isMobile: viewport.width <= 844, hasTouch: viewport.width <= 844 } });
    let page;
    try {
      page = await smoke.context.newPage();
      const fatal = smoke.watch(page);
      await page.goto(`${smoke.origin}/tests/browser/full-map-navigation-harness.html`, { waitUntil: "domcontentloaded" });
      await Promise.race([page.waitForFunction(() => window.__FULL_MAP_NAVIGATION_QA__?.ready, null, { timeout: TIMEOUT_MS }), fatal]);
      const opener = page.locator("#minimap-open-map");
      const activate = async locator => viewport.width <= 844 ? locator.tap() : locator.click();
      await activate(opener);
      assert.equal(await page.locator("#minimap").isHidden(), true);
      await page.locator("#full-map-close").press("Shift+Tab");
      assert.equal(await page.evaluate(() => document.activeElement.id), "full-map-reset-view");
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement.id), "full-map-close");
      const input = page.locator(".full-map-search-input");
      await input.fill("정석"); await input.fill("관");
      const firstResult = await page.locator(".full-map-search-result").first().getAttribute("data-poi-id");
      await input.press("ArrowDown");
      assert.equal(await page.evaluate(() => document.activeElement.dataset.poiId), firstResult);
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => window.__FULL_MAP_NAVIGATION_QA__.fullMap.selectedPoi.poiId), firstResult);
      for (const [name, id] of [["우남호", "poi.woonam-aircraft"], ["인경호 정자", "poi.pond-gazebo"], ["후문", "poi.back-gate"], ["비룡탑", "poi.biryong-tower"]]) {
        await input.fill(name); await input.press("Enter");
        assert.equal(await page.evaluate(() => window.__FULL_MAP_NAVIGATION_QA__.fullMap.selectedPoi.poiId), id);
        assert.equal(await page.locator("#full-map-set-destination").isDisabled(), id === "poi.back-gate" || id === "poi.biryong-tower");
        assert.equal(await page.evaluate(() => window.__FULL_MAP_NAVIGATION_QA__.fullMap.destination), null);
      }
      await input.fill("없는장소");
      assert.equal(await page.locator(".full-map-search-result").count(), 0);
      assert.equal(await page.locator(".full-map-search-status").textContent(), "검색 결과가 없어요");
      await activate(page.locator(".full-map-search-clear"));
      assert.equal(await input.inputValue(), "");
      assert.equal(await input.evaluate(node => node === document.activeElement), true);
      // Browser/CDP composition. This tests Chromium's actual
      // composition lifecycle, not the operating system's Korean candidate window.
      await input.focus();
      await input.evaluate(node => {
        window.__MAP_IME_EVENTS__ = [];
        for (const type of ["compositionstart", "compositionupdate", "compositionend", "keydown"])
          node.addEventListener(type, event => window.__MAP_IME_EVENTS__.push({ type, key: event.key, isComposing: event.isComposing, trusted: event.isTrusted }));
      });
      const ime = await smoke.context.newCDPSession(page);
      const beforeIme = await page.evaluate(() => window.__FULL_MAP_NAVIGATION_QA__.fullMap.selectedPoi.poiId);
      await ime.send("Input.imeSetComposition", { text: "본", selectionStart: 1, selectionEnd: 1 });
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => window.__FULL_MAP_NAVIGATION_QA__.fullMap.selectedPoi.poiId), beforeIme);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#full-map-panel").isVisible(), true);
      await ime.send("Input.insertText", { text: "본" });
      await ime.detach();
      const imeEvents = await page.evaluate(() => window.__MAP_IME_EVENTS__);
      report.imeReceipts ??= [];
      report.imeReceipts.push({ viewport, events: imeEvents });
      assert.ok(imeEvents.some(event => event.type === "compositionstart" && event.trusted));
      // Chromium emits an untrusted compositionend for CDP Input.insertText;
      // preserve that flag in the receipt rather than claiming native OS IME.
      assert.ok(imeEvents.findIndex(event => event.type === "compositionend") > imeEvents.findIndex(event => event.type === "compositionstart"), "browser composition must finish after it starts");
      for (const key of ["Enter", "Escape"]) assert.ok(imeEvents.some(event => event.key === key && event.isComposing && event.trusted), `${key} reaches the browser during composition`);
      await input.fill("본관");
      await input.press("Enter");
      assert.equal(await page.evaluate(() => window.__FULL_MAP_NAVIGATION_QA__.fullMap.selectedPoi.poiId), "poi.main-hall", "search resumes after completed composition");
      for (const presentation of ["LOCKED", "UNDISCOVERED", "UNKNOWN", "DISABLED", "COMING_SOON"]) {
        await page.evaluate(state => window.__FULL_MAP_NAVIGATION_QA__.setStateFixture("poi.main-hall", { presentation: state }), presentation);
        await input.press("Enter");
        assert.equal(await page.evaluate(() => window.__FULL_MAP_NAVIGATION_QA__.fullMap.selectedPoi.poiId), "poi.main-hall");
        assert.equal(await page.locator("#full-map-set-destination").isDisabled(), true);
        assert.equal(await page.evaluate(() => window.__FULL_MAP_NAVIGATION_QA__.fullMap.destination), null);
      }
      await page.evaluate(() => window.__FULL_MAP_NAVIGATION_QA__.setStateFixture("poi.main-hall", { visible: false }));
      await input.focus();
      assert.equal(await page.locator(".full-map-search-result").count(), 0, "hidden state is not searchable");
      await page.evaluate(() => window.__FULL_MAP_NAVIGATION_QA__.setStateFixture("poi.main-hall", null));
      await input.fill("우남호");
      await activate(page.locator(".full-map-search-result"));
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement.id), "full-map-set-destination");
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("#full-map-clear-destination").isVisible(), true);
      await page.locator("#full-map-clear-destination").focus();
      await page.keyboard.press("Space");
      assert.equal(await page.evaluate(() => window.__FULL_MAP_NAVIGATION_QA__.fullMap.destination), null);
      assert.equal(await page.evaluate(() => document.activeElement.id), "full-map-info-title");
      await input.fill("인경호");
      const layout = await page.evaluate(() => {
        const root = document.getElementById("full-map-panel");
        const parts = [...root.querySelectorAll(".full-map-search, .full-map-search-input, .full-map-search-panel, .full-map-search-result")];
        const header = root.querySelector(".full-map-header").getBoundingClientRect();
        const search = root.querySelector(".full-map-search").getBoundingClientRect();
        const close = root.querySelector(".full-map-close").getBoundingClientRect();
        const title = root.querySelector("h2").getBoundingClientRect();
        return { compactHeader: innerHeight <= 340 ? { search: search.toJSON(), close: close.toJSON(), title: title.toJSON(), header: header.toJSON() } : null, width: innerWidth, parts: parts.map(node => ({ name: node.className, ...node.getBoundingClientRect().toJSON() })) };
      });
      if (layout.compactHeader) {
        const { search, close, title, header } = layout.compactHeader;
        assert.ok(search.x >= title.right && search.right < close.x, "compact search stays between title and close");
        assert.ok(search.y >= header.y && search.bottom <= header.bottom, "compact search stays inside header");
      }
      for (const part of layout.parts) assert.ok(part.x >= 0 && part.right <= layout.width, `${part.name} stays inside ${viewport.width}px`);
      const file = `search-${viewport.width}.png`;
      const bytes = await page.screenshot({ path: path.join(output, file) });
      report.screenshots.push({ file, sha256: createHash("sha256").update(bytes).digest("hex") });
      for (const direction of ["Tab", "Shift+Tab"]) for (let i = 0; i < 35; i++) {
        await page.keyboard.press(direction);
        assert.equal(await page.evaluate(() => document.getElementById("full-map-panel").contains(document.activeElement)), true);
      }
      await page.keyboard.press("Escape");
      assert.equal(await opener.evaluate(node => node === document.activeElement), true);
      await opener.press("Enter"); await page.locator("#full-map-close").click();
      assert.equal(await opener.evaluate(node => node === document.activeElement), true);
      assert.equal(smoke.problems.length, 0, smoke.problems.join("\n"));
      report.cases.push({ viewport, status: "PASS", layout, imeEvents, input: { tap: viewport.width <= 844, tab: true, shiftTab: true, enter: true, space: true, escape: true } });
    } catch (error) {
      report.cases.push({ viewport, status: "FAIL", error: String(error?.stack ?? error), problems: smoke.problems });
      if (page) {
        const file = `failure-${viewport.width}.png`;
        const bytes = await page.screenshot({ path: path.join(output, file) }).catch(() => null);
        if (bytes) report.screenshots.push({ file, sha256: createHash("sha256").update(bytes).digest("hex") });
      }
      throw error;
    } finally { await smoke.close(); }
  }
  report.status = "PASS";
} catch (error) { report.status = "FAIL"; report.error = String(error?.stack ?? error); throw error; }
finally { await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2)); }
