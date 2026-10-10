// Main Lobby START latency smoke (mobile P0).
// Offline: uses the shared browser harness, so no production/auth/secrets are touched.
//
// Measures, inside the page, pointerup -> lobby hidden for a real touch tap, and proves that
//   * the lobby closes and gameplay input is enabled in the same task as the tap (activation = pointerup
//     reaching page code; the input delay before that is reported separately as telemetry),
//   * no staged lobby transition runs at MAIN_GATE (the player is already at the spawn),
//   * the NPC simulation is held while the lobby is open and starts after it closes,
//   * Enter / Space / mouse click still activate MAIN_GATE on desktop.
//
// Thresholds: HARD fail values are loose enough for software-rendered CI; TARGET values are the
// product goals and are reported (and only fail when LOBBY_START_STRICT=1).
//   LOBBY_START_BASELINE=1  skip the hold assertions (measure an older checkout)
//   LOBBY_START_STRICT=1    enforce the TARGET values as failures
import assert from "node:assert/strict";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

const URL_PATH = "/campus/?lobby=1&npcSync=ng2&npcConversation=p0";
const BASELINE = process.env.LOBBY_START_BASELINE === "1";
const STRICT = process.env.LOBBY_START_STRICT === "1";
const THRESHOLDS = {
  normal: { target: 100, hard: 250 },
  throttled: { target: 250, hard: 600 }
};
const NAV_FUNCTIONS = ["segmentSafe", "walkable", "polygonOverlap", "route", "nearestCell",
  "networkRoute", "wanderRoute", "createNpcNavigator", "warmGrid"];
const report = {};

// Long tasks and the START probe live in the page from the first script so nothing is missed.
const probeScript = () => {
  window.__longTasks = [];
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) window.__longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch { /* longtask unsupported */ }
  window.__startProbe = { clicks: 0 };
  addEventListener("DOMContentLoaded", () => {
    // The loading screen flips to DONE in the same task that starts the NPC runtime, so this is the
    // earliest page-side time the lobby is up; page.evaluate would only run after any blocking task.
    const loading = document.getElementById("world-loading");
    if (loading) new MutationObserver(() => {
      if (loading.dataset.state === "DONE" && window.__lobbyShownAt === undefined) window.__lobbyShownAt = performance.now();
    }).observe(loading, { attributes: true, attributeFilter: ["data-state"] });
    const button = document.getElementById("main-gate-start");
    const lobby = document.getElementById("world-lobby");
    if (!button || !lobby) return;
    // Capture phase so the timestamp is taken before the START handler runs.
    button.addEventListener("pointerup", event => {
      window.__startProbe.pointerUp = event.timeStamp;
      window.__startProbe.handlerAt = performance.now();
    }, true);
    // The pressed state must appear as a direct result of pointerdown, not after the click.
    new MutationObserver(() => {
      if (button.dataset.activating === "true" && window.__startProbe.pressedAt === undefined)
        window.__startProbe.pressedAt = performance.now();
    }).observe(button, { attributes: true, attributeFilter: ["data-activating"] });
    new MutationObserver(() => {
      if (!lobby.hidden || window.__startProbe.hiddenAt !== undefined) return;
      const p0 = window.__INHAGAME_P0__;
      window.__startProbe.hiddenAt = performance.now();
      window.__startProbe.inputEnabledAtHide = p0?.controller?.inputEnabled ?? null;
      window.__startProbe.cinematicAtHide = p0?.getStatus?.().cinematic ?? null;
      window.__startProbe.lobbyActiveAtHide = p0?.getStatus?.().lobby?.active ?? null;
      window.__startProbe.transitionAtHide = p0?.getStatus?.().lobbyTransition?.active ?? null;
    }).observe(lobby, { attributes: true, attributeFilter: ["hidden"] });
    // Any click that still reaches the page after the tap would be a ghost click on game UI.
    window.addEventListener("click", () => { window.__startProbe.clicks++; });
  });
};

async function openLobby(smoke, { throttle = 1 } = {}) {
  const page = await smoke.context.newPage();
  const fatal = smoke.watch(page);
  const cdp = await smoke.context.newCDPSession(page);
  if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 250 });
  await page.addInitScript(probeScript);
  await page.goto(smoke.origin + URL_PATH, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  // The lobby-idle window starts when the lobby is shown, so world boot is not counted against it.
  await Promise.race([
    page.waitForFunction(() => window.__INHAGAME_P0__?.getStatus?.().lobby?.active === true &&
      window.__INHAGAME_P0__.getStatus().loading?.finished === true, null, { timeout: TIMEOUT_MS, polling: 20 }),
    fatal
  ]);
  await cdp.send("Profiler.start");
  const readyAt = await page.evaluate(() => window.__lobbyShownAt ?? performance.now());
  return { page, cdp, fatal, readyAt };
}

// Skips the Main Gate reveal if it is playing, then waits for gameplay input.
async function finishReveal(page) {
  if (await page.evaluate(() => window.__INHAGAME_P0__.getStatus().cinematic?.active === true))
    await page.locator("#cinematic-skip").click({ timeout: 10_000 });
  await page.waitForFunction(() => window.__INHAGAME_P0__.controller.inputEnabled === true &&
    window.__INHAGAME_P0__.getStatus().cinematic?.active !== true, null, { timeout: 15_000 });
}

const npcStatus = page => page.evaluate(() => window.__INHAGAME_P0__.getStatus().npcTest);

async function waitForNpcRuntime(page, fatal) {
  await Promise.race([
    page.waitForFunction(() => window.__INHAGAME_P0__?.getStatus?.().npcTest?.purposeful_count > 0,
      null, { timeout: TIMEOUT_MS, polling: 100 }),
    fatal
  ]);
}

// Self time per function name from a CPU profile, for the navigation hot spots.
function navSelfTime(profile) {
  const byId = new Map(profile.nodes.map(node => [node.id, node]));
  const self = Object.fromEntries(NAV_FUNCTIONS.map(name => [name, 0]));
  profile.samples.forEach((id, index) => {
    const name = byId.get(id)?.callFrame.functionName;
    if (Object.hasOwn(self, name)) self[name] += (Number(profile.timeDeltas[index]) || 0) / 1000;
  });
  const total = Object.values(self).reduce((sum, value) => sum + value, 0);
  return { totalMs: Math.round(total), byFunction: Object.fromEntries(Object.entries(self)
    .filter(([, value]) => value > 0).map(([name, value]) => [name, Math.round(value)])) };
}

// A task that straddles `from` (the lobby-shown instant) belongs to the window: it ends inside it.
const longTaskSummary = (tasks, from, to) => {
  const inside = tasks.filter(task => task.start + task.duration > from && task.start < to);
  return { count: inside.length, longestMs: Math.round(Math.max(0, ...inside.map(task => task.duration))) };
};

async function measureStart({ smoke, label, throttle }) {
  const { page, cdp, fatal, readyAt } = await openLobby(smoke, { throttle });
  try {
    await waitForNpcRuntime(page, fatal);
    // Lobby idle: let the NPC runtime construct and settle, as it would while a player reads the lobby.
    await page.waitForTimeout(3000);
    const idleEnd = await page.evaluate(() => performance.now());
    const { profile } = await cdp.send("Profiler.stop");
    const nav = navSelfTime(profile);

    const lobbyNpc = await npcStatus(page);
    const heldPhases = Object.values(lobbyNpc.purposeful).map(state => state.phase);
    if (!BASELINE) {
      assert.equal(heldPhases.length, lobbyNpc.purposeful_count);
      assert.ok(heldPhases.every(phase => phase === "SYNCING"),
        `${label}: NPC simulation must not sample routes while the lobby is open (${[...new Set(heldPhases)]})`);
    }

    const box = await page.locator("#main-gate-start").boundingBox();
    assert.ok(box, `${label}: MAIN_GATE button has a box`);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => window.__startProbe?.hiddenAt !== undefined, null, { timeout: 10_000, polling: 20 });
    const probe = await page.evaluate(() => ({ ...window.__startProbe }));
    // Activation = the first moment page code sees the tap (pointerup, capture phase). event.timeStamp is
    // the input time stamp; the gap to it is main-thread delay before any handler could run (rendering,
    // long tasks), reported separately as inputDelay.
    const activationToHidden = probe.hiddenAt - probe.handlerAt;
    const inputDelay = probe.handlerAt - probe.pointerUp;

    // Test B/C: input and transition state at the moment the lobby hid.
    assert.equal(probe.lobbyActiveAtHide, false, `${label}: lobby world is left in the same task`);
    // Since #259 START plays the skippable Main Gate reveal, which holds gameplay input until it ends or is
    // skipped. Input must be live at once without it; with it, the skip control must be there.
    if (probe.cinematicAtHide?.active) assert.equal(probe.cinematicAtHide.skipAvailable, true,
      `${label}: the Main Gate reveal that holds input is skippable`);
    else assert.equal(probe.inputEnabledAtHide, true, `${label}: gameplay input is enabled when the lobby hides`);
    assert.equal(probe.transitionAtHide, false, `${label}: no staged lobby transition at MAIN_GATE`);
    assert.equal(await page.evaluate(() => window.__INHAGAME_P0__.getStatus().lobbyTransition.active), false);
    if (!BASELINE) assert.ok(probe.pressedAt !== undefined && probe.pressedAt <= probe.handlerAt,
      `${label}: pressed state is applied before pointerup`);

    // Ghost click: nothing may reach the game after the tap.
    await page.waitForTimeout(700);
    if (!BASELINE) assert.equal(await page.evaluate(() => window.__startProbe.clicks), 0, `${label}: synthetic click is swallowed`);

    // Post-start window: the roster is placed in slices and then goes live.
    const afterStart = await page.evaluate(() => performance.now());
    await Promise.race([
      page.waitForFunction(() => Object.values(window.__INHAGAME_P0__.getStatus().npcTest.purposeful)
        .every(state => state.phase !== "SYNCING"), null, { timeout: TIMEOUT_MS, polling: 100 }),
      fatal
    ]);
    const liveAt = await page.evaluate(() => performance.now());
    const tasks = await page.evaluate(() => window.__longTasks);
    const live = await npcStatus(page);
    assert.equal(live.shared_schedule?.state, "SYNCED", `${label}: shared schedule stays synced`);
    await finishReveal(page);
    assert.equal(await page.evaluate(() => window.__INHAGAME_P0__.controller.inputEnabled), true);

    const result = {
      activationToHiddenMs: Math.round(activationToHidden * 10) / 10,
      inputDelayMs: Math.round(inputDelay * 10) / 10,
      lobbyIdleNavSelfMs: nav,
      lobbyLongTasks: longTaskSummary(tasks, readyAt, idleEnd),
      startWindowLongTasks: longTaskSummary(tasks, idleEnd, afterStart + 2000),
      npcLiveAfterStartMs: Math.round(liveAt - afterStart)
    };
    report[label] = result;
    const limits = THRESHOLDS[throttle > 1 ? "throttled" : "normal"];
    assert.ok(activationToHidden < limits.hard,
      `${label}: activation -> lobby hidden ${activationToHidden.toFixed(1)}ms exceeds hard limit ${limits.hard}ms`);
    if (activationToHidden >= limits.target) {
      const message = `${label}: activation -> lobby hidden ${activationToHidden.toFixed(1)}ms is above the ${limits.target}ms target`;
      if (STRICT) assert.fail(message);
      console.warn(`WARN ${message}`);
    }
    return result;
  } finally {
    await page.close();
  }
}

// How the desktop player starts: "Enter" / "Space" with the button focused via Tab, or a mouse "click".
async function desktopActivation(smoke, key) {
  const { page, fatal } = await openLobby(smoke);
  try {
    await waitForNpcRuntime(page, fatal);
    if (key === "click") await page.locator("#main-gate-start").click();
    else {
      let focused = false;
      for (let i = 0; i < 30 && !focused; i++) {
        await page.keyboard.press("Tab");
        focused = await page.evaluate(() => document.activeElement?.id === "main-gate-start");
      }
      assert.ok(focused, "Tab reaches the MAIN_GATE button");
      await page.keyboard.press(key);
    }
    await page.waitForFunction(() => document.getElementById("world-lobby").hidden === true, null, { timeout: 10_000 });
    await finishReveal(page);
    const state = await page.evaluate(() => ({
      lobbyActive: window.__INHAGAME_P0__.getStatus().lobby.active,
      transition: window.__INHAGAME_P0__.getStatus().lobbyTransition.active,
      input: window.__INHAGAME_P0__.controller.inputEnabled
    }));
    assert.deepEqual(state, { lobbyActive: false, transition: false, input: true }, `${key} activation`);
  } finally {
    await page.close();
  }
}

// One server per emulation; mobile and desktop differ only in the browser context.
const mobile = await startSmoke({
  viewport: { width: 390, height: 844 },
  contextOptions: { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
});
try {
  await measureStart({ smoke: mobile, label: "mobile-390x844", throttle: 1 });
  await measureStart({ smoke: mobile, label: "mobile-390x844-cpu4x", throttle: 4 });
} finally {
  await mobile.close();
}

const desktop = await startSmoke({ viewport: { width: 1280, height: 720 } });
try {
  await desktopActivation(desktop, "Enter");
  await desktopActivation(desktop, "Space");
  await desktopActivation(desktop, "click");
} finally {
  await desktop.close();
}

console.log(JSON.stringify(report, null, 2));
console.log("main lobby start latency smoke: PASS");
