// Main Lobby responsive layout smoke.
// Offline: uses the shared browser harness, so no production/auth/secrets are touched.
import assert from "node:assert/strict";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

const smoke = await startSmoke({ viewport: { width: 390, height: 844 } });

async function assertLobbyLayout(page, { width, height, label }) {
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    const name = document.getElementById("lobby-player-name");
    const progression = document.getElementById("lobby-player-progression");
    const wallet = document.getElementById("lobby-player-wallet");
    if (name) name.textContent = "인덕이";
    if (progression) progression.hidden = true;
    if (wallet) wallet.hidden = true;
  });

  for (const selector of [
    "#lobby-player-summary",
    "#lobby-presence-summary",
    "#lobby-quest-highlight",
    "#main-gate-start",
    "#back-gate-locked"
  ]) {
    assert.equal(await page.locator(selector).isVisible(), true, `${label}: ${selector} visible`);
  }

  assert.match(await page.locator("#lobby-zone-presence").innerText(), /^전체 접속/,
    `${label}: global population copy is active`);
  assert.equal(await page.locator("#lobby-player-look").isVisible(), false,
    `${label}: default appearance line is hidden on mobile`);
  assert.equal(await page.locator("#lobby-player-progression").isVisible(), false,
    `${label}: guest does not show account progression`);
  assert.equal(await page.locator("#lobby-player-wallet").isVisible(), false,
    `${label}: guest does not show account wallet`);

  // Presentation stress only: expose account-only rows with deliberately wide values to prove
  // the mobile card remains bounded without requiring a real authenticated account in CI.
  await page.evaluate(() => {
    const name = document.getElementById("lobby-player-name");
    const progression = document.getElementById("lobby-player-progression");
    const wallet = document.getElementById("lobby-player-wallet");
    if (name) name.textContent = "운영자테스트긴닉네임";
    if (progression) {
      progression.hidden = false;
      progression.textContent = "Lv.99 99,999 / 120,000 EXP";
    }
    if (wallet) {
      wallet.hidden = false;
      wallet.textContent = "🪙 999,999";
    }
  });

  const boxes = await page.evaluate(() => {
    const rect = id => {
      const r = document.getElementById(id)?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } : null;
    };
    return {
      player: rect("lobby-player-summary"),
      presence: rect("lobby-presence-summary"),
      quest: rect("lobby-quest-highlight"),
      main: rect("main-gate-start"),
      locked: rect("back-gate-locked"),
      stage: (() => {
        const r = document.querySelector(".world-lobby-stage-slot")?.getBoundingClientRect();
        return r ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } : null;
      })(),
      stats: (() => {
        const r = document.querySelector(".world-lobby-player-stats")?.getBoundingClientRect();
        return r ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } : null;
      })(),
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight
    };
  });

  assert.ok(boxes.player && boxes.presence && boxes.presence.x - boxes.player.right >= 4,
    `${label}: top summary cards keep a visible gap`);
  assert.ok(boxes.player && boxes.player.height <= 120,
    `${label}: player card stays compact with EXP + wallet`);
  assert.ok(boxes.stats && boxes.player && boxes.stats.x >= boxes.player.x && boxes.stats.right <= boxes.player.right,
    `${label}: EXP + wallet stay inside the player card`);
  assert.ok(boxes.stage && boxes.quest && boxes.quest.y >= boxes.stage.bottom - 1,
    `${label}: quest card stays below the reserved 3D character stage`);
  assert.ok(boxes.quest && boxes.main && boxes.quest.bottom <= boxes.main.y,
    `${label}: quest card does not overlap MAIN_GATE`);
  assert.ok(boxes.quest && boxes.quest.height <= (height <= 720 ? 40 : 48),
    `${label}: quest highlight stays compact in its two-row mobile layout`);
  assert.ok(boxes.main && boxes.main.y >= 0 && boxes.main.bottom <= height,
    `${label}: MAIN_GATE stays in first viewport`);
  assert.ok(boxes.locked && boxes.locked.height <= 46,
    `${label}: Back Gate teaser stays visually subordinate`);
  assert.ok(boxes.locked && boxes.locked.bottom <= height,
    `${label}: Back Gate teaser stays in first viewport`);
  assert.ok(boxes.scrollWidth <= width && boxes.scrollHeight <= height,
    `${label}: lobby has no viewport overflow`);
}

try {
  const page = await smoke.context.newPage();
  const fatalError = smoke.watch(page);

  await page.goto(`${smoke.origin}/campus/?lobby=1`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await Promise.race([
    page.waitForFunction(() => {
      const status = window.__INHAGAME_P0__?.getStatus?.();
      return status?.loading?.finished === true && status?.lobby?.active === true;
    }, null, { timeout: TIMEOUT_MS, polling: 100 }),
    fatalError
  ]);

  await assertLobbyLayout(page, { width: 390, height: 844, label: "mobile-390" });

  await page.setViewportSize({ width: 360, height: 640 });
  await assertLobbyLayout(page, { width: 360, height: 640, label: "mobile-short-360" });

  await page.setViewportSize({ width: 320, height: 800 });
  await assertLobbyLayout(page, { width: 320, height: 800, label: "mobile-narrow-320" });

  assert.deepEqual(smoke.problems, [], `browser problems: ${smoke.problems.join("\n")}`);
  console.log("main lobby responsive layout smoke: PASS");
} finally {
  await smoke.close();
}
