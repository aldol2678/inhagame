// P4 Mobile Adaptation acceptance: 360px coarse-pointer layout must keep Chat clear of
// the joystick, Social Cluster and right-side movement actions while preserving the shared
// CHAT input-focus contract. Offline only; see harness.mjs.
import assert from "node:assert/strict";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

const smoke = await startSmoke({
  viewport: { width: 360, height: 800 },
  contextOptions: { hasTouch: true, isMobile: true }
});

const overlaps = (a, b) => !!a && !!b &&
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

const insideViewport = (box, viewport) => !box ||
  box.left >= 0 && box.top >= 0 && box.right <= viewport.width && box.bottom <= viewport.height;

const rectSnapshot = async page => page.evaluate(() => {
  const rect = node => {
    if (!node || node.hidden || !node.getClientRects().length) return null;
    const box = node.getBoundingClientRect();
    return {
      left: box.left, top: box.top, right: box.right, bottom: box.bottom,
      width: box.width, height: box.height
    };
  };
  return {
    viewport: { width: innerWidth, height: innerHeight },
    hud: {
      mode: document.body.dataset.hudMode,
      overlay: document.body.dataset.hudOverlay,
      inputFocus: document.body.dataset.hudInputFocus
    },
    minimapFilter: getComputedStyle(document.getElementById("minimap")).filter,
    coarse: matchMedia("(pointer: coarse)").matches,
    fine: matchMedia("(pointer: fine)").matches,
    joystick: rect(document.getElementById("joystick")),
    social: rect(document.querySelector(".social-cluster")),
    run: rect(document.getElementById("run")),
    jump: rect(document.getElementById("jump")),
    feed: rect(document.getElementById("chat-feed")),
    form: rect(document.getElementById("chat-form"))
  };
});

try {
  const page = await smoke.context.newPage();
  const fatalError = smoke.watch(page);

  await page.goto(`${smoke.origin}/campus/`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await Promise.race([
    page.waitForFunction(() => window.__INHAGAME_P0__?.getStatus?.().loading?.finished === true,
      null, { timeout: TIMEOUT_MS, polling: 100 }),
    fatalError
  ]);

  const mobileStatus = await page.evaluate(() => window.__INHAGAME_P0__.getStatus());
  const initial = await rectSnapshot(page);
  assert.deepEqual(initial.viewport, { width: 360, height: 800 });
  assert.deepEqual(initial.hud, { mode: "EXPLORE", overlay: "NONE", inputFocus: "GAMEPLAY" });
  assert.match(initial.minimapFilter, /\b8px 20px\b/, "Explore minimap polish is active without an overlay");
  assert.equal(initial.coarse, true, "mobile smoke exposes a coarse pointer");
  assert.equal(initial.fine, false, "mobile smoke is not a fine-pointer environment");
  assert.ok(initial.joystick, "mobile joystick is visible");
  assert.ok(initial.social, "mobile Social Cluster is visible");
  assert.ok(initial.run && initial.jump, "mobile RUN/JUMP actions are visible");
  assert.equal(overlaps(initial.joystick, initial.social), false,
    `Social Cluster clears joystick: ${JSON.stringify(initial)}`);
  assert.equal(mobileStatus.pointerLock.finePointer, false);
  assert.equal(mobileStatus.pointerLock.supported, false,
    "coarse-pointer mobile never enables the Pointer Lock runtime");
  assert.equal(mobileStatus.pointerLock.awaitingGesture, false,
    "coarse-pointer mobile never waits for a Pointer Lock gesture");
  assert.equal(mobileStatus.pointerLock.locked, false);

  await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    d.__mobileSmokeOriginalChat = d.online.chat;
    d.online.chat = {
      signedIn: true,
      canChat: true,
      ownBubble() { return null; },
      submit(input) { return { result: "sent", text: String(input ?? "").trim() }; }
    };
    d.chatPanel.refreshAvailability();
    d.chatPanel.renderFeed(Array.from({ length: 15 }, (_, index) => ({
      name: index % 2 ? "밥" : "앨리스",
      text: `모바일 채팅 ${index + 1}`,
      self: index % 3 === 0
    })));
  });

  const preview = await rectSnapshot(page);
  assert.ok(preview.feed, "mobile chat preview is visible after activity");
  assert.equal(overlaps(preview.feed, preview.joystick), false,
    `Chat preview clears joystick: ${JSON.stringify(preview)}`);
  assert.equal(overlaps(preview.feed, preview.social), false,
    `Chat preview clears Social Cluster: ${JSON.stringify(preview)}`);
  assert.equal(overlaps(preview.feed, preview.run), false,
    `Chat preview clears RUN: ${JSON.stringify(preview)}`);
  assert.equal(overlaps(preview.feed, preview.jump), false,
    `Chat preview clears JUMP: ${JSON.stringify(preview)}`);
  assert.ok(insideViewport(preview.feed, preview.viewport), "mobile Chat preview stays inside viewport");

  await page.locator("#chat-toggle").click();
  await Promise.race([
    page.waitForFunction(() => {
      const d = window.__INHAGAME_P0__;
      const status = d?.getStatus?.();
      const form = document.getElementById("chat-form");
      return d?.chatPanel?.open === true &&
        status?.inputFocus?.focusClass === "CHAT" &&
        status?.inputFocus?.owners?.chat === true &&
        d?.controller?.inputEnabled === false &&
        !!form && !form.hidden && form.getClientRects().length > 0 &&
        document.activeElement?.id === "chat-input";
    }, null, { timeout: 10_000, polling: 50 }),
    fatalError
  ]);

  const expanded = await rectSnapshot(page);
  assert.deepEqual(expanded.hud, { mode: "EXPLORE", overlay: "CHAT", inputFocus: "CHAT" });
  assert.match(expanded.minimapFilter, /\b7px 18px\b/, "Chat restores the base minimap style");
  assert.ok(expanded.form && expanded.feed, "expanded mobile Chat renders form and feed");
  for (const [name, control] of [
    ["joystick", expanded.joystick],
    ["Social Cluster", expanded.social],
    ["RUN", expanded.run],
    ["JUMP", expanded.jump]
  ]) {
    assert.equal(overlaps(expanded.form, control), false,
      `Chat form clears ${name}: ${JSON.stringify(expanded)}`);
    assert.equal(overlaps(expanded.feed, control), false,
      `Chat feed clears ${name}: ${JSON.stringify(expanded)}`);
  }
  assert.ok(insideViewport(expanded.form, expanded.viewport), "mobile Chat form stays inside viewport");
  assert.ok(insideViewport(expanded.feed, expanded.viewport), "mobile expanded feed stays inside viewport");

  const expandedStatus = await page.evaluate(() => window.__INHAGAME_P0__.getStatus());
  assert.equal(expandedStatus.inputFocus.focusClass, "CHAT");
  assert.equal(expandedStatus.pointerLock.desired, false);
  assert.equal(expandedStatus.pointerLock.locked, false);

  await page.keyboard.press("Escape");
  await Promise.race([
    page.waitForFunction(() => {
      const d = window.__INHAGAME_P0__;
      const status = d?.getStatus?.();
      return d?.chatPanel?.open === false &&
        status?.inputFocus?.focusClass === "GAMEPLAY" &&
        status?.inputFocus?.owners?.chat === false &&
        d?.controller?.inputEnabled === true;
    }, null, { timeout: 10_000, polling: 50 }),
    fatalError
  ]);

  const recovered = await rectSnapshot(page);
  assert.deepEqual(recovered.hud, initial.hud, "Escape restores Explore HUD context and gameplay focus");
  assert.equal(recovered.minimapFilter, initial.minimapFilter, "Escape restores Explore minimap polish");

  await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    d.chatPanel.renderFeed([]);
    d.online.chat = d.__mobileSmokeOriginalChat;
    delete d.__mobileSmokeOriginalChat;
    d.chatPanel.refreshAvailability();
  });

  assert.deepEqual(smoke.problems, [], "mobile HUD smoke has no page/console/request errors");
  console.log("mobile HUD smoke: PASS", JSON.stringify({ initial, preview, expanded, recovered }));
} finally {
  await smoke.close();
}
