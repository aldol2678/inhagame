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

  // The guest launch lobby shows who you are, the current quest and the entry button. The
  // population card, account figures and the still-locked Back Gate teaser are withheld.
  assert.equal(await page.locator("#world-lobby").getAttribute("data-guest-launch"), "", `${label}: guest launch lobby`);
  for (const selector of ["#lobby-player-summary", "#lobby-quest-highlight", "#main-gate-start"]) {
    assert.equal(await page.locator(selector).isVisible(), true, `${label}: ${selector} visible`);
  }
  for (const selector of ["#lobby-presence-summary", "#back-gate-locked"]) {
    assert.equal(await page.locator(selector).isVisible(), false, `${label}: ${selector} withheld`);
  }
  assert.equal(await page.locator("#back-gate-locked").evaluate(el => el.classList.contains("is-unlocked")), false,
    `${label}: the Back Gate is withheld because it is locked, not removed`);
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

  assert.equal(await page.locator(".world-lobby-player-stats").isVisible(), false,
    `${label}: account EXP + wallet never appear for a guest, even when populated`);
  assert.ok(boxes.player && boxes.player.right <= width && boxes.player.height <= 120,
    `${label}: player card stays compact and on screen with a long nickname`);
  // The entry button now leads the column directly under the character stage; the quest card follows it.
  assert.ok(boxes.stage && boxes.main && boxes.main.y >= boxes.stage.bottom - 1,
    `${label}: MAIN_GATE stays below the reserved 3D character stage`);
  assert.ok(boxes.quest && boxes.main && boxes.quest.y >= boxes.main.bottom,
    `${label}: quest card follows MAIN_GATE without overlapping it`);
  assert.ok(boxes.quest && boxes.quest.y >= 0 && boxes.quest.bottom <= height,
    `${label}: quest card stays in first viewport`);
  assert.ok(boxes.quest && boxes.quest.height <= (height <= 720 ? 40 : 48),
    `${label}: quest highlight stays compact in its two-row mobile layout`);
  assert.ok(boxes.main && boxes.main.y >= 0 && boxes.main.bottom <= height,
    `${label}: MAIN_GATE stays in first viewport`);
  assert.ok(boxes.locked && boxes.locked.height === 0,
    `${label}: the withheld Back Gate teaser reserves no space`);
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
