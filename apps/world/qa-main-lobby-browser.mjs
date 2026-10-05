// Main Lobby P1.6 responsive/failure browser QA.
// Run against a Vercel preview or local server. Requires Playwright + Chrome.
// Example:
//   MAIN_LOBBY_QA_URL=https://<preview>.vercel.app node apps/world/qa-main-lobby-browser.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : "playwright");
const base = process.env.MAIN_LOBBY_QA_URL || "http://127.0.0.1:4187";
const output = resolve(process.env.MAIN_LOBBY_QA_OUTPUT || "main-lobby-qa");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = { url: base, browser: browser.version(), results: [] };

const validResume = () => ({
  version: 1,
  x: 0,
  y: 1.15,
  z: -76,
  yawDeg: 15,
  cameraYaw: .35,
  savedAt: Date.now(),
  zoneId: "AREA_MAIN_GATE",
  displayName: "정문·남쪽 진입로"
});

async function openLobby(context, init = null, initArg = undefined) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await context.route("**/api/hub-event", route => route.fulfill({ status: 204 }));
  await context.route("**/api/hub-entry", route => route.fulfill({ status: 204 }));
  if (init) await page.addInitScript(init, initArg);
  await page.goto(new URL("/campus/?lobby=1", base).href, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForFunction(() => window.__INHAGAME_P0__?.getStatus().renderer?.startsWith("WebG"), null, { timeout: 45000 });
  await page.waitForFunction(() => window.__INHAGAME_P0__?.getStatus().lobby?.active === true);
  return { page, errors };
}

try {
  for (const spec of [
    { name: "desktop", viewport: { width: 1440, height: 900 }, mobile: false },
    { name: "mobile-390", viewport: { width: 390, height: 844 }, mobile: true },
    { name: "mobile-360", viewport: { width: 360, height: 800 }, mobile: true },
    { name: "mobile-short-360", viewport: { width: 360, height: 640 }, mobile: true },
    { name: "mobile-narrow-320", viewport: { width: 320, height: 800 }, mobile: true }
  ]) {
    const context = await browser.newContext({ viewport: spec.viewport, isMobile: spec.mobile, hasTouch: spec.mobile, deviceScaleFactor: 1 });
    const { page, errors } = await openLobby(context, () => {
      localStorage.removeItem("inhagame-world-resume-v1");
      localStorage.removeItem("inhagame-campus-tour-v1");
    });
    const result = { mode: spec.name, errors };
    report.results.push(result);

    const main = page.locator("#main-gate-start");
    const locked = page.locator("#back-gate-locked");
    assert.ok(await main.isVisible(), "MAIN_GATE CTA visible");
    assert.ok(await locked.isVisible(), "locked Back Gate teaser visible");
    assert.ok(await page.locator("#lobby-player-summary").isVisible(), "P1.2 player summary visible");
    assert.ok(await page.locator("#lobby-presence-summary").isVisible(), "P1.3 presence summary visible");
    assert.ok(await page.locator("#lobby-quest-highlight").isVisible(), "P1.4 first-tour highlight visible");
    assert.equal(await page.locator("#resume-last-location").isVisible(), false, "no resume on first visit");

    const lobbyStatus = await page.evaluate(() => window.__INHAGAME_P0__.getStatus());
    assert.equal(lobbyStatus.lobbySpawns.find(item => item.spawnId === "MAIN_GATE")?.state, "AVAILABLE");
    assert.equal(lobbyStatus.lobbySpawns.find(item => item.spawnId === "BACK_GATE")?.state, "LOCKED_PROGRESS");
    assert.match(await page.locator("#lobby-zone-presence").innerText(), /^전체 접속/);

    const mainBox = await main.boundingBox();
    assert.ok(mainBox && mainBox.y >= 0 && mainBox.y + mainBox.height <= spec.viewport.height,
      "MAIN_GATE CTA stays inside first viewport");
    const bodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight);
    assert.equal(bodyOverflow, true, "lobby shell does not overflow viewport");
    const playerBox = await page.locator("#lobby-player-summary").boundingBox();
    const presenceBox = await page.locator("#lobby-presence-summary").boundingBox();
    const questBox = await page.locator("#lobby-quest-highlight").boundingBox();
    assert.ok(playerBox && presenceBox && playerBox.x + playerBox.width <= presenceBox.x,
      "P1 side summaries do not overlap");
    assert.ok(questBox && mainBox && questBox.y + questBox.height <= mainBox.y,
      "quest highlight stays above MAIN_GATE without overlap");
    if (spec.mobile) {
      assert.equal(await page.locator("#lobby-player-look").isVisible(), false,
        "mobile hides the low-value default appearance line");
    }

    await page.locator("#lobby-menu-toggle").click();
    assert.ok(await page.locator("#lobby-menu").isVisible(), "P1.1 menu opens");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#lobby-menu").isVisible(), false, "P1.1 menu closes with Escape");

    const before = await page.evaluate(() => {
      const p = window.__INHAGAME_P0__.player.getLocalPosition();
      return { x: p.x, y: p.y, z: p.z };
    });
    await page.keyboard.press("w");
    await page.waitForTimeout(120);
    const after = await page.evaluate(() => {
      const p = window.__INHAGAME_P0__.player.getLocalPosition();
      return { x: p.x, y: p.y, z: p.z };
    });
    assert.deepEqual(after, before, "movement is locked in lobby");

    await locked.click();
    assert.ok(await page.locator("#back-gate-lock-dialog").isVisible());
    assert.match(await page.locator("#back-gate-lock-description").innerText(), /퀘스트/);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#back-gate-lock-dialog").isVisible(), false);

    await page.screenshot({ path: resolve(output, spec.name + "-lobby.png") });
    await main.click();
    await page.waitForFunction(() => window.__INHAGAME_P0__.getStatus().lobbyTransition?.active === false);
    assert.equal(await page.locator("#world-lobby").isVisible(), false);
    assert.equal(await page.evaluate(() => window.__INHAGAME_P0__.controller.inputEnabled), true);
    result.pass = true;
    await context.close();
  }

  // Valid resume path.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const resume = validResume();
    const { page, errors } = await openLobby(context, value => localStorage.setItem("inhagame-world-resume-v1", JSON.stringify(value)), resume);
    const result = { mode: "resume", errors };
    report.results.push(result);
    assert.ok(await page.locator("#resume-last-location").isVisible());
    await page.locator("#resume-last-location").click();
    await page.waitForFunction(() => window.__INHAGAME_P0__.getStatus().lobbyTransition?.active === false);
    const pos = await page.evaluate(() => {
      const p = window.__INHAGAME_P0__.player.getLocalPosition();
      return { x: p.x, y: p.y, z: p.z };
    });
    assert.ok(Math.abs(pos.x - resume.x) < .01 && Math.abs(pos.z - resume.z) < .01);
    result.pass = true;
    await context.close();
  }

  // Invalid resume degrades to MAIN_GATE.
  {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
    const { page, errors } = await openLobby(context, () => localStorage.setItem("inhagame-world-resume-v1", "{bad-json"));
    const result = { mode: "invalid-resume", errors };
    report.results.push(result);
    assert.equal(await page.locator("#resume-last-location").isVisible(), false);
    assert.ok(await page.locator("#main-gate-start").isVisible());
    result.pass = true;
    await context.close();
  }

  // Optional P1 data endpoints fail: first-tour fallback and MAIN_GATE stay playable.
  {
    const context = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
    await context.route("**/api/world-quest", route => route.abort());
    await context.route("**/api/npc-ai", route => route.abort());
    const { page, errors } = await openLobby(context, () => {
      localStorage.removeItem("inhagame-world-resume-v1");
      localStorage.removeItem("inhagame-campus-tour-v1");
    });
    const result = { mode: "optional-data-failure", errors };
    report.results.push(result);
    assert.ok(await page.locator("#main-gate-start").isVisible(), "MAIN_GATE survives optional API failure");
    assert.ok(await page.locator("#lobby-quest-highlight").isVisible(), "first-tour fallback survives quest API failure");
    assert.match(await page.locator("#lobby-quest-title").innerText(), /첫 캠퍼스 탐방/);
    assert.match(await page.locator("#main-gate-start .world-lobby-card-action").innerText(), /정문에서 시작하기/);
    result.pass = true;
    await context.close();
  }

  // Character assets fail: primitive fallback must keep lobby playable.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route("**/assets/induck-v3.glb", route => route.abort());
    await context.route("**/assets/annyongi-flight-v1.glb", route => route.abort());
    const { page, errors } = await openLobby(context, () => localStorage.removeItem("inhagame-world-resume-v1"));
    const result = { mode: "avatar-fallback", errors };
    report.results.push(result);
    await page.waitForFunction(() => window.__INHAGAME_P0__.getStatus().characterModel === "fallback");
    assert.ok(await page.locator("#main-gate-start").isVisible());
    result.pass = true;
    await context.close();
  }

  for (const result of report.results) assert.deepEqual(result.errors, [], result.mode + " console/page errors");
} finally {
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log("Main Lobby P1.6 browser QA PASS");
