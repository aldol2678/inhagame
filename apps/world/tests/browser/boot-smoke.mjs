// World browser boot smoke. One load of /campus/ proves the
// real boot path runs: every module imports, boot() finishes, the renderer and scene exist, the
// render loop and player controller run, and the core HUD mounts, with no page error, console
// error or failed same-origin request. GPU-enabled runs prefer WebGPU; GPU-less CI must fall back to WebGL2.
//
// Offline: see harness.mjs (committed dev-server.mjs, pinned PlayCanvas, supabase-js stubbed,
// /api/* 204, every other off-origin request aborted). No production, login or secret.
//
//   npm ci --prefix apps/world/tests/browser
//   WORLD_SMOKE_BROWSER=msedge WORLD_SMOKE_HEADED=1 node apps/world/tests/browser/boot-smoke.mjs
import assert from "node:assert/strict";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

// Validate the inline quest action at mobile/desktop widths before the full world boot.
await import("./next-discovery-smoke.mjs");

const started = Date.now();
const smoke = await startSmoke();
let status = null;

try {
  const page = await smoke.context.newPage();
  const fatalError = smoke.watch(page);

  await page.goto(`${smoke.origin}/campus/`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  // Settled means either boot() finished (the loading screen reached READY) or its catch branch
  // published the UNAVAILABLE status. An import or link error publishes nothing and fires pageerror.
  await Promise.race([
    page.waitForFunction(() => {
      const status = window.__INHAGAME_P0__?.getStatus?.();
      return status?.renderer === "UNAVAILABLE" || status?.loading?.finished === true;
    }, null, { timeout: TIMEOUT_MS, polling: 100 }),
    fatalError
  ]);
  status = await page.evaluate(() => window.__INHAGAME_P0__.getStatus());
  assert.notEqual(status.renderer, "UNAVAILABLE", `boot() failed: ${status.error}`);

  // P1 Music runtime config is loaded asynchronously and must fail closed without blocking boot.
  await Promise.race([
    page.waitForFunction(() => {
      const state = window.__INHAGAME_P0__?.getStatus?.().audio?.music?.configState;
      return state === "ready" || state === "degraded";
    }, null, { timeout: TIMEOUT_MS, polling: 50 }),
    fatalError
  ]);
  const musicRuntime = await page.evaluate(() => window.__INHAGAME_P0__.getStatus().audio.music);
  assert.equal(musicRuntime.configState, "ready", `production music config failed: ${musicRuntime.lastError}`);
  assert.equal(musicRuntime.configProjectId, "inha-world-music-runtime");
  assert.equal(musicRuntime.activeSources, 0, "unbound main-gate start keeps production Music silent");
  assert.equal(musicRuntime.cueId, null, "unbound main-gate start resolves no Cue");
  if (process.env.WORLD_SMOKE_DISABLE_WEBGPU === "1")
    assert.equal(status.renderer, "WebGL2", "Campus falls back to WebGL2 when WebGPU is unavailable");
  else
    assert.equal(status.renderer, "WebGPU", "Campus prefers the WebGPU renderer when available");
  assert.equal(status.loading.phase, "READY", "loading screen reached READY");
  assert.equal(status.loading.essentialReady, true, "essential world marked ready");

  // Scene and render loop: one app canvas bound to the graphics device, entities under the root,
  // streamed campus chunks, and frames advancing.
  const frameBefore = await page.evaluate(() => window.__INHAGAME_P0__.app.frame);
  await Promise.race([
    page.waitForFunction(before => window.__INHAGAME_P0__.app.frame >= before + 3, frameBefore, { timeout: 15_000 }),
    fatalError
  ]);
  const scene = await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    const canvas = document.getElementById("application");
    const p = d.player.getLocalPosition();
    return {
      canvases: document.querySelectorAll("canvas").length,
      appCanvas: canvas instanceof HTMLCanvasElement && d.app.graphicsDevice.canvas === canvas,
      canvasSize: [canvas.width, canvas.height],
      rootChildren: d.app.root.children.length,
      playerInScene: d.player.parent?.parent === d.app.root,
      position: [p.x, p.y, p.z],
      chunkStates: d.streaming.getMetrics().counts,
      inputEnabled: d.controller.inputEnabled,
      lobbyActive: d.lobbyWorld.active
    };
  });
  assert.equal(scene.canvases, 1, "exactly one canvas");
  assert.ok(scene.appCanvas, "#application is the PlayCanvas graphics device canvas");
  assert.ok(scene.canvasSize[0] > 0 && scene.canvasSize[1] > 0, "canvas has a drawing buffer");
  assert.ok(scene.rootChildren > 0, "scene root has entities");
  const residentChunks = Object.entries(scene.chunkStates).filter(([state]) => state !== "UNLOADED").reduce((sum, [, n]) => sum + n, 0);
  assert.ok(residentChunks > 0, `campus chunks streamed in around the spawn (${JSON.stringify(scene.chunkStates)})`);
  assert.ok(scene.playerInScene, "player is in the campus coordinate frame");
  assert.ok(scene.position.every(Number.isFinite), "player position is finite");
  assert.equal(scene.lobbyActive, false, "plain /campus/ boots straight into the world");
  assert.equal(scene.inputEnabled, true, "player input is enabled");

  // Usable: holding W moves the player through the real keyboard -> controller -> update-loop path.
  await page.locator("#application").focus();
  await page.keyboard.down("w");
  try {
    await Promise.race([
      page.waitForFunction(([x, z]) => {
        const p = window.__INHAGAME_P0__.player.getLocalPosition();
        return Math.hypot(p.x - x, p.z - z) > 0.5;
      }, [scene.position[0], scene.position[2]], { timeout: 10_000 }),
      fatalError
    ]);
  } finally {
    await page.keyboard.up("w");
  }

  // P1 PC Camera acceptance: the real Chromium page must acquire Pointer Lock only from an explicit
  // gameplay click, release it when a blocking UI claims focus, wait for another click to reacquire,
  // and return to an unlocked READY hint after the browser Escape gesture.
  const pointerLockInitial = await page.evaluate(() => {
    const status = window.__INHAGAME_P0__.getStatus();
    const hint = document.getElementById("pointer-lock-hint");
    return {
      pointerLock: status.pointerLock,
      hint: status.pointerLockHint,
      hintVisible: !!hint && !hint.hidden && hint.getClientRects().length > 0,
      hintText: hint?.textContent ?? "",
      focusClass: status.inputFocus.focusClass
    };
  });
  assert.equal(pointerLockInitial.pointerLock.supported, true, "desktop Chromium exposes Pointer Lock");
  assert.equal(pointerLockInitial.pointerLock.finePointer, true, "desktop smoke is a fine-pointer environment");
  assert.equal(pointerLockInitial.pointerLock.desired, true, "GAMEPLAY requests Pointer Lock");
  assert.equal(pointerLockInitial.pointerLock.locked, false, "boot never auto-locks the pointer");
  assert.equal(pointerLockInitial.pointerLock.awaitingGesture, true, "Pointer Lock waits for user gesture");
  assert.equal(pointerLockInitial.focusClass, "GAMEPLAY");
  assert.equal(pointerLockInitial.hintVisible, true, "click-to-lock guidance is visible before acquisition");
  assert.match(pointerLockInitial.hintText, /게임 화면 클릭/);

  const canvasBox = await page.locator("#application").boundingBox();
  assert.ok(canvasBox && canvasBox.width > 0 && canvasBox.height > 0, "game canvas has a clickable box");
  const gameplayPoint = {
    x: Math.floor(canvasBox.width / 2),
    y: Math.floor(canvasBox.height / 2)
  };
  await page.locator("#application").click({ position: gameplayPoint });
  await Promise.race([
    page.waitForFunction(() =>
      document.pointerLockElement === document.getElementById("application") &&
      window.__INHAGAME_P0__?.getStatus?.().pointerLock?.locked === true,
      null, { timeout: 10_000, polling: 50 }),
    fatalError
  ]);
  const pointerLocked = await page.evaluate(() => {
    const status = window.__INHAGAME_P0__.getStatus();
    const hint = document.getElementById("pointer-lock-hint");
    return {
      pointerLock: status.pointerLock,
      hintVisible: !!hint && !hint.hidden && hint.getClientRects().length > 0
    };
  });
  assert.equal(pointerLocked.pointerLock.locked, true, "canvas click acquires the real browser Pointer Lock");
  assert.equal(pointerLocked.hintVisible, false, "guidance disappears while locked");

  // Programmatic button activation avoids mouse-target ambiguity while the pointer is locked; the
  // resulting Settings lifecycle is otherwise the same real DOM/InputFocus path as a user click.
  await page.evaluate(() => document.getElementById("open-settings")?.click());
  await Promise.race([
    page.waitForFunction(() => {
      const status = window.__INHAGAME_P0__?.getStatus?.();
      return document.pointerLockElement === null &&
        status?.pointerLock?.locked === false &&
        status?.pointerLock?.desired === false &&
        status?.inputFocus?.focusClass === "BLOCKING_UI" &&
        document.getElementById("view-settings")?.hidden === false;
    }, null, { timeout: 10_000, polling: 50 }),
    fatalError
  ]);
  const pointerUi = await page.evaluate(() => ({
    status: window.__INHAGAME_P0__.getStatus(),
    inputEnabled: window.__INHAGAME_P0__.controller.inputEnabled
  }));
  assert.equal(pointerUi.inputEnabled, false, "blocking Settings disables player movement");
  assert.equal(pointerUi.status.pointerLock.locked, false, "blocking UI releases Pointer Lock immediately");

  await page.evaluate(() => document.getElementById("close-settings")?.click());
  await Promise.race([
    page.waitForFunction(() => {
      const status = window.__INHAGAME_P0__?.getStatus?.();
      const hint = document.getElementById("pointer-lock-hint");
      return status?.inputFocus?.focusClass === "GAMEPLAY" &&
        status?.pointerLock?.desired === true &&
        status?.pointerLock?.locked === false &&
        status?.pointerLockHint?.state === "READY" &&
        !!hint && !hint.hidden;
    }, null, { timeout: 10_000, polling: 50 }),
    fatalError
  ]);
  const requestsBeforeReacquire = await page.evaluate(() => window.__INHAGAME_P0__.getStatus().pointerLock);
  assert.equal(requestsBeforeReacquire.awaitingGesture, true,
    "closing UI restores GAMEPLAY desire without forbidden automatic reacquire");

  await page.locator("#application").click({ position: gameplayPoint });
  await Promise.race([
    page.waitForFunction(() =>
      document.pointerLockElement === document.getElementById("application") &&
      window.__INHAGAME_P0__?.getStatus?.().pointerLock?.locked === true,
      null, { timeout: 10_000, polling: 50 }),
    fatalError
  ]);

  // Headless Chromium does not reliably route the browser-owned Escape gesture through
  // Playwright's page.keyboard API. Use the real browser exitPointerLock() API here; the unit
  // acceptance above separately covers the Esc-style pointerlockchange path and no-retry rule.
  await page.evaluate(() => document.exitPointerLock());
  await Promise.race([
    page.waitForFunction(() => {
      const status = window.__INHAGAME_P0__?.getStatus?.();
      return document.pointerLockElement === null &&
        status?.pointerLock?.locked === false &&
        status?.pointerLock?.desired === true &&
        status?.pointerLockHint?.state === "READY";
    }, null, { timeout: 10_000, polling: 50 }),
    fatalError
  ]);

  // P2 desktop Chat acceptance: inject a browser-smoke-only signed-in facade into the public
  // debug runtime so the real ChatPanel/InputFocus/Pointer Lock DOM lifecycle can be exercised
  // without production auth or network access. The original offline chat object is restored below.
  const chatPreview = await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    d.__smokeOriginalChat = d.online.chat;
    d.online.chat = {
      signedIn: true,
      canChat: true,
      ownBubble() { return null; },
      submit(input) { return { result: "sent", text: String(input ?? "").trim() }; }
    };
    d.chatPanel.refreshAvailability();
    d.chatPanel.renderFeed(Array.from({ length: 15 }, (_, index) => ({
      name: index % 2 ? "밥" : "앨리스",
      text: `브라우저 채팅 ${index + 1}`,
      self: index % 3 === 0
    })));

    const rect = node => {
      if (!node || node.hidden || !node.getClientRects().length) return null;
      const box = node.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const overlaps = (a, b) => !!a && !!b &&
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const feed = document.getElementById("chat-feed");
    const feedRect = rect(feed);
    const clusterRect = rect(document.querySelector(".social-cluster"));
    const minimapRect = rect(document.getElementById("minimap"));
    const questRects = [
      rect(document.getElementById("tour")),
      rect(document.getElementById("npc-quest")),
      rect(document.getElementById("main2-quest"))
    ].filter(Boolean);

    return {
      mode: feed?.dataset.mode ?? null,
      faded: feed?.dataset.faded ?? null,
      count: feed?.children.length ?? -1,
      visible: !!feedRect,
      feedRect,
      clusterRect,
      lowerLeft: !!feedRect && feedRect.left <= 40 && feedRect.top > innerHeight * .45,
      clearsSocial: !overlaps(feedRect, clusterRect),
      clearsMinimap: !overlaps(feedRect, minimapRect),
      clearsQuests: questRects.every(box => !overlaps(feedRect, box)),
      opacity: feed ? getComputedStyle(feed).opacity : null
    };
  });
  assert.equal(chatPreview.mode, "PREVIEW", "desktop chat starts in preview mode");
  assert.equal(chatPreview.faded, "false", "new chat activity revives the preview");
  assert.equal(chatPreview.count, 5, "desktop preview renders only the latest five messages");
  assert.equal(chatPreview.visible, true, "desktop chat preview is visible");
  assert.equal(chatPreview.lowerLeft, true, `chat preview occupies lower-left HUD zone: ${JSON.stringify(chatPreview.feedRect)}`);
  assert.equal(chatPreview.clearsSocial, true, "chat preview clears the desktop social button row");
  assert.equal(chatPreview.clearsMinimap, true, "chat preview does not overlap Mini-map");
  assert.equal(chatPreview.clearsQuests, true, "chat preview does not overlap active quest HUDs");
  assert.equal(chatPreview.opacity, "1", "fresh preview is fully readable before the fade timer");

  // CHAT must take input authority from a genuinely locked GAMEPLAY state.
  await page.locator("#application").click({ position: gameplayPoint });
  await Promise.race([
    page.waitForFunction(() =>
      document.pointerLockElement === document.getElementById("application") &&
      window.__INHAGAME_P0__?.getStatus?.().pointerLock?.locked === true,
      null, { timeout: 10_000, polling: 50 }),
    fatalError
  ]);
  await page.keyboard.press("Enter");
  await Promise.race([
    page.waitForFunction(() => {
      const d = window.__INHAGAME_P0__;
      const status = d?.getStatus?.();
      return d?.chatPanel?.open === true &&
        status?.inputFocus?.focusClass === "CHAT" &&
        status?.inputFocus?.owners?.chat === true &&
        status?.pointerLock?.locked === false &&
        status?.pointerLock?.desired === false &&
        d?.controller?.inputEnabled === false &&
        document.activeElement?.id === "chat-input";
    }, null, { timeout: 10_000, polling: 50 }),
    fatalError
  ]);
  const chatExpanded = await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    const feed = document.getElementById("chat-feed");
    const form = document.getElementById("chat-form");
    return {
      open: d.chatPanel.open,
      count: feed?.children.length ?? -1,
      mode: feed?.dataset.mode ?? null,
      faded: feed?.dataset.faded ?? null,
      formVisible: !!form && !form.hidden && form.getClientRects().length > 0,
      inputFocused: document.activeElement?.id === "chat-input"
    };
  });
  assert.equal(chatExpanded.open, true);
  assert.equal(chatExpanded.count, 12, "Enter expands the local log to twelve recent messages");
  assert.equal(chatExpanded.mode, "EXPANDED");
  assert.equal(chatExpanded.faded, "false", "expanded chat never inherits preview fade");
  assert.equal(chatExpanded.formVisible, true);
  assert.equal(chatExpanded.inputFocused, true);

  await page.keyboard.down("w");
  const typingGuard = await page.evaluate(() => ({
    keyRegistered: window.__INHAGAME_P0__.controller.keys.has("KeyW"),
    jumpQueued: window.__INHAGAME_P0__.controller.jumpQueued
  }));
  await page.keyboard.up("w");
  assert.equal(typingGuard.keyRegistered, false, "W typed into chat never reaches PlayerController");
  assert.equal(typingGuard.jumpQueued, false);

  await page.keyboard.press("Escape");
  await Promise.race([
    page.waitForFunction(() => {
      const d = window.__INHAGAME_P0__;
      const status = d?.getStatus?.();
      const feed = document.getElementById("chat-feed");
      return d?.chatPanel?.open === false &&
        status?.inputFocus?.focusClass === "GAMEPLAY" &&
        status?.inputFocus?.owners?.chat === false &&
        status?.pointerLock?.desired === true &&
        status?.pointerLock?.locked === false &&
        d?.controller?.inputEnabled === true &&
        feed?.dataset.mode === "PREVIEW" &&
        feed?.children.length === 5;
    }, null, { timeout: 10_000, polling: 50 }),
    fatalError
  ]);
  const chatReturned = await page.evaluate(() => ({
    awaitingGesture: window.__INHAGAME_P0__.getStatus().pointerLock.awaitingGesture,
    previewFaded: window.__INHAGAME_P0__.chatPanel.previewFaded
  }));
  assert.equal(chatReturned.awaitingGesture, true,
    "closing Chat restores Pointer Lock desire but waits for the next gameplay click");
  assert.equal(chatReturned.previewFaded, false, "closing Chat returns to a fresh five-line preview");

  // P3 Input Integration acceptance: exercise the real CHAT → HUD menu → Settings → GAMEPLAY
  // handoff. Every transition must keep one input owner in authority, release Pointer Lock while
  // blocked, and return to cursor-free GAMEPLAY without an automatic lock reacquire.
  await page.keyboard.press("Enter");
  await Promise.race([
    page.waitForFunction(() => {
      const d = window.__INHAGAME_P0__;
      const status = d?.getStatus?.();
      return d?.chatPanel?.open === true &&
        status?.inputFocus?.focusClass === "CHAT" &&
        status?.inputFocus?.owners?.chat === true &&
        status?.pointerLock?.desired === false &&
        status?.pointerLock?.locked === false &&
        d?.controller?.inputEnabled === false;
    }, null, { timeout: 10_000, polling: 50 }),
    fatalError
  ]);

  await page.locator("#hud-menu-toggle").click();
  await Promise.race([
    page.waitForFunction(() => {
      const d = window.__INHAGAME_P0__;
      const status = d?.getStatus?.();
      const menu = document.getElementById("hud-menu");
      return d?.chatPanel?.open === false &&
        status?.inputFocus?.focusClass === "BLOCKING_UI" &&
        status?.inputFocus?.owners?.chat === false &&
        status?.inputFocus?.owners?.hudMenu === true &&
        status?.inputFocus?.topOwners?.includes?.("hud-menu") &&
        status?.pointerLock?.desired === false &&
        status?.pointerLock?.locked === false &&
        d?.controller?.inputEnabled === false &&
        menu?.hidden === false;
    }, null, { timeout: 10_000, polling: 50 }),
    fatalError
  ]);
  const chatToMenu = await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    const status = d.getStatus();
    return {
      focusClass: status.inputFocus.focusClass,
      chatOwner: status.inputFocus.owners.chat,
      menuOwner: status.inputFocus.owners.hudMenu,
      topOwners: status.inputFocus.topOwners,
      movementEnabled: d.controller.inputEnabled,
      pointerLock: status.pointerLock
    };
  });
  assert.equal(chatToMenu.focusClass, "BLOCKING_UI",
    "HUD menu takes authority directly from CHAT without falling through GAMEPLAY");
  assert.equal(chatToMenu.chatOwner, false, "opening HUD menu releases CHAT owner");
  assert.equal(chatToMenu.menuOwner, true, "HUD menu owns BLOCKING_UI input authority");
  assert.deepEqual(chatToMenu.topOwners, ["hud-menu"]);
  assert.equal(chatToMenu.movementEnabled, false, "movement stays blocked across CHAT → menu handoff");
  assert.equal(chatToMenu.pointerLock.desired, false, "menu keeps Pointer Lock undesired");

  // Use the real menu action. View Settings acquires its owner on the target button click before the
  // menu's bubbling handler releases hud-menu, so the handoff must never expose GAMEPLAY.
  await page.locator("#open-settings").click();
  await Promise.race([
    page.waitForFunction(() => {
      const d = window.__INHAGAME_P0__;
      const status = d?.getStatus?.();
      return document.getElementById("hud-menu")?.hidden === true &&
        document.getElementById("view-settings")?.hidden === false &&
        status?.inputFocus?.focusClass === "BLOCKING_UI" &&
        status?.inputFocus?.owners?.hudMenu === false &&
        status?.inputFocus?.owners?.viewSettings === true &&
        status?.inputFocus?.topOwners?.includes?.("view-settings") &&
        status?.pointerLock?.desired === false &&
        status?.pointerLock?.locked === false &&
        d?.controller?.inputEnabled === false;
    }, null, { timeout: 10_000, polling: 50 }),
    fatalError
  ]);
  const menuToSettings = await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    const status = d.getStatus();
    return {
      focusClass: status.inputFocus.focusClass,
      menuOwner: status.inputFocus.owners.hudMenu,
      settingsOwner: status.inputFocus.owners.viewSettings,
      topOwners: status.inputFocus.topOwners,
      movementEnabled: d.controller.inputEnabled,
      pointerLock: status.pointerLock
    };
  });
  assert.equal(menuToSettings.focusClass, "BLOCKING_UI");
  assert.equal(menuToSettings.menuOwner, false, "HUD menu releases after destination owner acquires");
  assert.equal(menuToSettings.settingsOwner, true, "View Settings owns the handoff destination");
  assert.deepEqual(menuToSettings.topOwners, ["view-settings"]);
  assert.equal(menuToSettings.movementEnabled, false, "movement never leaks during menu → Settings");
  assert.equal(menuToSettings.pointerLock.desired, false);

  await page.locator("#close-settings").click();
  await Promise.race([
    page.waitForFunction(() => {
      const d = window.__INHAGAME_P0__;
      const status = d?.getStatus?.();
      return document.getElementById("view-settings")?.hidden === true &&
        status?.inputFocus?.focusClass === "GAMEPLAY" &&
        status?.inputFocus?.owners?.viewSettings === false &&
        status?.pointerLock?.desired === true &&
        status?.pointerLock?.locked === false &&
        status?.pointerLock?.awaitingGesture === true &&
        d?.controller?.inputEnabled === true;
    }, null, { timeout: 10_000, polling: 50 }),
    fatalError
  ]);
  const integrationReturned = await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    const status = d.getStatus();
    return {
      focusClass: status.inputFocus.focusClass,
      topOwners: status.inputFocus.topOwners,
      movementEnabled: d.controller.inputEnabled,
      pointerLock: status.pointerLock
    };
  });
  assert.equal(integrationReturned.focusClass, "GAMEPLAY");
  assert.deepEqual(integrationReturned.topOwners, []);
  assert.equal(integrationReturned.movementEnabled, true);
  assert.equal(integrationReturned.pointerLock.desired, true);
  assert.equal(integrationReturned.pointerLock.locked, false,
    "returning from integrated UI flow never auto-reacquires Pointer Lock");
  assert.equal(integrationReturned.pointerLock.awaitingGesture, true,
    "integrated UI flow waits for the next explicit gameplay click");

  await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    d.chatPanel.renderFeed([]);
    d.online.chat = d.__smokeOriginalChat;
    delete d.__smokeOriginalChat;
    d.chatPanel.refreshAvailability();
  });

  // Essential HUD: the two world action slots (F / M) and the top HUD are mounted and wired.
  const hud = await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    const el = id => document.getElementById(id);
    const shown = node => !!node && !node.hidden && node.getClientRects().length > 0;
    return {
      contextAction: el("context-action") instanceof HTMLButtonElement && typeof d.contextActions?.set === "function",
      transportAction: el("transport-action") instanceof HTMLButtonElement && typeof d.transportActions?.set === "function",
      hudMenuToggle: shown(el("hud-menu-toggle")),
      zone: el("zone")?.textContent ?? null,
      rendererLabel: el("renderer")?.textContent ?? null,
      loadingState: el("world-loading")?.dataset.state ?? null
    };
  });
  assert.ok(hud.contextAction, "#context-action slot mounted and wired");
  assert.ok(hud.transportAction, "#transport-action slot mounted and wired");
  assert.ok(hud.hudMenuToggle, "HUD menu toggle is visible");
  assert.ok(hud.zone && hud.zone !== "-" && hud.zone !== "초기화 실패", `location chip was updated (got ${JSON.stringify(hud.zone)})`);
  assert.equal(hud.rendererLabel, status.renderer, "HUD renderer label matches the device");
  assert.equal(hud.loadingState, "DONE", "loading overlay finished");

  // P0-E: Nearby remains usable for guests and explains why the signed-in list is empty.
  await page.locator("#nearby-toggle").click();
  assert.equal(await page.locator("#nearby-panel").isVisible(), true, "Nearby panel opens");
  assert.match(await page.locator("#nearby-panel").textContent(), /로그인하면 주변 플레이어/);
  await page.locator("#nearby-panel .nearby-close").click();
  assert.equal(await page.locator("#nearby-panel").isVisible(), false, "Nearby panel closes");

  // P1 first Production Music pilot: place the real player inside the canonical Biryong radius,
  // unlock the actual shared AudioContext, fetch/decode the committed MP3 and prove the semantic
  // Place Binding resolves. Moving back to Main Gate must fade the source out again.
  await page.evaluate(async () => {
    const d = window.__INHAGAME_P0__;
    const { BIRYONG_CENTER } = await import("/src/biryong/biryong-layout.js");
    d.player.setLocalPosition(BIRYONG_CENTER.x, 1.15, BIRYONG_CENTER.z);
    d.places.update(d.player.getLocalPosition());
    d.app.fire("update", 0.016);
  });
  await page.locator("#application").click({ position: { x: 8, y: 8 } });
  await Promise.race([
    page.waitForFunction(() => {
      const music = window.__INHAGAME_P0__?.getStatus?.().audio?.music;
      return music?.context !== "closed" &&
        music?.cueId === "cue.biryong-tower.explore" &&
        music?.assetId === "music.biryong-tower-01" &&
        music?.activeSources >= 1 &&
        music?.degraded === false;
    }, null, { timeout: TIMEOUT_MS, polling: 100 }),
    fatalError
  ]);
  const biryongMusic = await page.evaluate(() => window.__INHAGAME_P0__.getStatus().audio.music);
  assert.equal(biryongMusic.targetType, "place");
  assert.equal(biryongMusic.targetId, "PLACE_BIRYONG_TOWER");
  assert.equal(biryongMusic.bindingId, "binding.biryong-tower.explore");
  assert.equal(biryongMusic.cueId, "cue.biryong-tower.explore");
  assert.equal(biryongMusic.assetId, "music.biryong-tower-01");
  assert.equal(biryongMusic.activeSources, 1, "Biryong production MP3 is decoded and playing");

  await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    d.player.setLocalPosition(0, 1.15, -98);
    d.places.update(d.player.getLocalPosition());
    d.app.fire("update", 0.016);
  });
  await Promise.race([
    page.waitForFunction(() =>
      window.__INHAGAME_P0__?.getStatus?.().audio?.music?.activeSources === 0,
      null, { timeout: 10_000, polling: 100 }),
    fatalError
  ]);
  const mainGateMusic = await page.evaluate(() => window.__INHAGAME_P0__.getStatus().audio.music);
  assert.equal(mainGateMusic.cueId, null, "leaving Biryong clears the specific Music Cue");
  assert.equal(mainGateMusic.activeSources, 0, "Biryong source is cleaned after fade-out");

  {
  await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    d.controller.keys.clear(); d.controller.clearAssistedMovement();
    d.player.setLocalPosition(0, d.controller.groundY, -98);
    d.controller.grounded = true; d.app.fire("update", .016);
  });

  // Mobility Batch A1: real book -> summon -> mount controls -> render/network kind.
  await page.evaluate(() => {
    const d=window.__INHAGAME_P0__;
    d.controller.keys.clear();
    document.getElementById("open-mobility-book").click();
  });
  await page.locator("#mobility-book-panel").waitFor({state:"visible"});
  await page.locator(".mobility-filter[data-filter='GROUND']").click();
  await page.locator(".mobility-search").fill("킥보드");
  const kickCard=page.locator('[data-mobility-id="vehicle.kickboard.campus_prototype"]');
  assert.equal(await kickCard.count(),1);
  await kickCard.locator(".mobility-card-main").click();
  assert.equal(await page.locator(".mobility-detail .mobility-secondary").first().isDisabled(),true,
    "test-only kickboard cannot become an owned active mount");
  await kickCard.locator(".mobility-favorite").click();
  assert.equal(await kickCard.locator(".mobility-favorite").getAttribute("aria-pressed"),"true");
  await page.locator(".mobility-primary").click();
  await page.locator("#mobility-book-panel").waitFor({state:"hidden"});
  const kickRide=await page.evaluate(async()=>{
    const d=window.__INHAGAME_P0__;
    const {getCampusKickboardParkedPose}=await import("/src/mounts/campus-kickboard-world.js");
    const a=getCampusKickboardParkedPose();
    if(!a)return {summoned:false};
    d.player.setLocalPosition(a.x,a.y+d.controller.groundY,a.z);
    const before=d.controller.mounted;
    const boarded=d.controller.transportAction();
    d.app.fire("update",.016);
    return {summoned:true,before,boarded,mountId:d.controller.mountId,
      jumpHidden:document.getElementById("jump").hidden,
      riderVisible:d.player.findByName("Rider_CampusKickboard")?.enabled,
      parkedHidden:!d.app.root.findByName("Parked_CampusKickboard")?.enabled};
  });
  assert.deepEqual(kickRide,{summoned:true,before:false,boarded:true,
    mountId:"mount.campus_kickboard.prototype",jumpHidden:true,riderVisible:true,parkedHidden:true});
  const kickedOff=await page.evaluate(()=>{
    const d=window.__INHAGAME_P0__;
    const start=d.player.getLocalPosition().clone();
    d.controller.keys.add("KeyW");d.controller.keys.add("Space");
    for(let i=0;i<10;i++)d.controller.update(.016,0);
    d.controller.keys.clear();
    const moved=d.player.getLocalPosition().distance(start)>0.05;
    const grounded=d.controller.grounded;
    const dismounted=d.controller.transportAction();
    d.app.fire("update",.016);
    return {moved,grounded,dismounted,mountId:d.controller.mountId};
  });
  assert.deepEqual(kickedOff,{moved:true,grounded:true,dismounted:true,mountId:null});
  }

  {
  await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    d.controller.keys.clear(); d.controller.clearAssistedMovement();
    d.player.setLocalPosition(0, d.controller.groundY, -98);
    d.controller.grounded = true; d.app.fire("update", .016);
  });

  // Mobility Batch A1: real book -> summon -> mount controls -> render/network kind.
  await page.evaluate(() => {
    const d=window.__INHAGAME_P0__;
    d.controller.keys.clear();
    document.getElementById("open-mobility-book").click();
  });
  await page.locator("#mobility-book-panel").waitFor({state:"visible"});
  await page.locator(".mobility-filter[data-filter='GROUND']").click();
  await page.locator(".mobility-search").fill("카트");
  const kickCard=page.locator('[data-mobility-id="vehicle.kart.campus_prototype"]');
  assert.equal(await kickCard.count(),1);
  await kickCard.locator(".mobility-card-main").click();
  assert.equal(await page.locator(".mobility-detail .mobility-secondary").first().isDisabled(),true,
    "test-only kart cannot become an owned active mount");
  await kickCard.locator(".mobility-favorite").click();
  assert.equal(await kickCard.locator(".mobility-favorite").getAttribute("aria-pressed"),"true");
  await page.locator(".mobility-primary").click();
  await page.locator("#mobility-book-panel").waitFor({state:"hidden"});
  const kickRide=await page.evaluate(async()=>{
    const d=window.__INHAGAME_P0__;
    const {getCampusKartParkedPose}=await import("/src/mounts/campus-kart-world.js");
    const a=getCampusKartParkedPose();
    if(!a)return {summoned:false};
    d.player.setLocalPosition(a.x,a.y+d.controller.groundY,a.z);
    const before=d.controller.mounted;
    const boarded=d.controller.transportAction();
    d.app.fire("update",.016);
    return {summoned:true,before,boarded,mountId:d.controller.mountId,
      jumpHidden:document.getElementById("jump").hidden,
      riderVisible:d.player.findByName("Rider_CampusKart")?.enabled,
      parkedHidden:!d.app.root.findByName("Parked_CampusKart")?.enabled};
  });
  assert.deepEqual(kickRide,{summoned:true,before:false,boarded:true,
    mountId:"mount.campus_kart.prototype",jumpHidden:true,riderVisible:true,parkedHidden:true});
  const kickedOff=await page.evaluate(()=>{
    const d=window.__INHAGAME_P0__;
    const start=d.player.getLocalPosition().clone();
    d.controller.keys.add("KeyW");d.controller.keys.add("Space");
    for(let i=0;i<10;i++)d.controller.update(.016,0);
    d.controller.keys.clear();
    const moved=d.player.getLocalPosition().distance(start)>0.05;
    const grounded=d.controller.grounded;
    const dismounted=d.controller.transportAction();
    d.app.fire("update",.016);
    return {moved,grounded,dismounted,mountId:d.controller.mountId};
  });
  assert.deepEqual(kickedOff,{moved:true,grounded:true,dismounted:true,mountId:null});
  }

  {
  await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    d.controller.keys.clear(); d.controller.clearAssistedMovement();
    d.player.setLocalPosition(0, d.controller.groundY, -98);
    d.controller.grounded = true; d.app.fire("update", .016);
  });

  // A3: named dock, real Mobility Book, water runtime and safe shore exit.
  await page.evaluate(async()=>{
    const d=window.__INHAGAME_P0__,{INKYUNG_DOCK}=await import("/src/mounts/duck-boat-motion.js");
    d.player.setLocalPosition(INKYUNG_DOCK.shore.x,1.15,INKYUNG_DOCK.shore.z);
    d.app.fire("update",.016);
    document.getElementById("open-mobility-book").click();
  });
  await page.locator("#mobility-book-panel").waitFor({state:"visible"});
  await page.locator(".mobility-filter[data-filter='WATER']").click();
  await page.locator(".mobility-search").fill("오리배");
  await page.locator('[data-mobility-id="vessel.inkyung_duckboat"] .mobility-card-main').click();
  assert.equal(await page.locator(".mobility-detail .mobility-secondary").first().isDisabled(),true);
  await page.locator(".mobility-primary").click();
  const boat=await page.evaluate(()=>{
    const d=window.__INHAGAME_P0__;const boarded=d.controller.transportAction();d.app.fire("update",.016);
    const visual=d.player.findByName("Rider_DuckBoat")?.enabled;
    const y=d.player.getLocalPosition().y;
    const jumpHidden=document.getElementById("jump").hidden;
    const dismounted=d.controller.transportAction();
    return {boarded,visual,y,jumpHidden,dismounted};
  });
  assert.ok(Math.abs(boat.y-1.175)<1e-8); delete boat.y;
  assert.deepEqual(boat,{boarded:true,visual:true,jumpHidden:true,dismounted:true});
  }

  {
  await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    d.controller.keys.clear(); d.controller.clearAssistedMovement();
    d.player.setLocalPosition(0, d.controller.groundY, -98);
    d.controller.grounded = true; d.app.fire("update", .016);
  });

  // A4: actual Book station guidance, boarding and a complete autopilot station trip.
  await page.evaluate(()=>document.getElementById("open-mobility-book").click());
  await page.locator(".mobility-search").fill("");
  await page.locator(".mobility-filter[data-filter='TRANSIT']").click();
  await page.locator('[data-mobility-id="transit.campus_shuttle"] .mobility-card-main').click();
  assert.equal(await page.locator(".mobility-detail .mobility-secondary").first().isDisabled(),true);
  await page.locator(".mobility-primary").click();
  assert.equal(await page.locator("#mobility-book-panel").isVisible(), false, "station guidance closes the Book");
  const transit=await page.evaluate(()=>{
    const d=window.__INHAGAME_P0__,c=d.controller;
    for(let i=0;i<400&&!c.shuttle.boardingAllowed;i++)c.update(.1,0);
    const station=c.shuttle.currentStation;
    d.player.setLocalPosition(station.platform.x,1.15,station.platform.z);
    const boarded=c.transportAction();d.app.fire("update",.016);
    const visual=d.player.findByName("Rider_CampusShuttle")?.enabled;
    const runHidden=document.getElementById("run").hidden;
    c.keys.add("KeyD");c.keys.add("Space");
    for(let i=0;i<400&&!(c.shuttle.currentStation.id!==station.id&&c.shuttle.boardingAllowed);i++)c.update(.1,0);
    c.keys.clear();
    const destination=c.shuttle.currentStation.id;
    const dismounted=c.transportAction();d.app.fire("update",.016);
    return {boarded,visual,runHidden,arrived:destination!==station.id,dismounted};
  });
  assert.deepEqual(transit,{boarded:true,visual:true,runHidden:true,arrived:true,dismounted:true});
  }

  {
  await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    d.controller.keys.clear(); d.controller.clearAssistedMovement();
    d.player.setLocalPosition(0, d.controller.groundY, -98);
    d.controller.grounded = true; d.app.fire("update", .016);
  });


  // A5: real Book -> large safe summon -> buoyancy -> landed exit.
  await page.evaluate(()=>document.getElementById("open-mobility-book").click());
  await page.locator(".mobility-filter[data-filter='AIR']").click();
  await page.locator(".mobility-search").fill("열기구");
  const balloonCard=page.locator('[data-mobility-id="aircraft.balloon.campus_prototype"]');
  await balloonCard.locator(".mobility-card-main").click();
  assert.equal(await page.locator(".mobility-detail .mobility-secondary").first().isDisabled(),true);
  await balloonCard.locator(".mobility-favorite").click();
  assert.equal(await balloonCard.locator(".mobility-favorite").getAttribute("aria-pressed"),"true");
  await page.locator(".mobility-primary").click();
  await page.locator("#mobility-book-panel").waitFor({state:"hidden"});
  const balloon=await page.evaluate(async()=>{
    const d=window.__INHAGAME_P0__,c=d.controller;
    const {getCampusBalloonParkedPose}=await import("/src/mounts/campus-balloon-world.js");
    const a=getCampusBalloonParkedPose();if(!a)return{summoned:false};
    d.player.setLocalPosition(a.x,a.y+c.groundY,a.z);
    const boarded=c.transportAction();d.app.fire("update",.016);
    const visual=d.player.findByName("Rider_CampusBalloon")?.enabled,runHidden=document.getElementById("run").hidden;
    c.keys.add("Space");for(let i=0;i<200;i++)c.update(.016,0);c.keys.clear();
    const rose=d.player.getLocalPosition().y>a.y+c.groundY+1;
    const exitRefused=c.dismountBalloon()===false;
    c.descendHeld=true;for(let i=0;i<1000&&!c.grounded;i++)c.update(.016,0);c.descendHeld=false;
    const landed=c.grounded,dismounted=c.transportAction();d.app.fire("update",.016);
    return{summoned:true,boarded,visual,runHidden,rose,exitRefused,landed,dismounted};
  });
  assert.deepEqual(balloon,{summoned:true,boarded:true,visual:true,runHidden:true,rose:true,exitRefused:true,landed:true,dismounted:true});
  }

  // NG1: ordinary campus must not mount the preview observer.
  assert.equal(await page.locator("#npc-social-ng1").count(), 0,
    "ordinary campus URL does not mount the NG1 observer");

  // Explicit preview query mounts the read-only observer. NPC runtime loading is asynchronous after
  // World READY, and headless CI may throttle its frame loop, so browser acceptance waits for the
  // preview API and then uses the preview-only deterministic fast-forward.
  await page.close();
  const socialPage = await smoke.context.newPage();
  const socialFatal = smoke.watch(socialPage);
  await socialPage.goto(`${smoke.origin}/campus/?npcSocial=ng1`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await Promise.race([
    socialPage.waitForFunction(() =>
      typeof window.__NPC_SOCIAL_NG1__?.status === "function" &&
      typeof window.__NPC_SOCIAL_NG1__?.advanceTicks === "function",
      null, { timeout: TIMEOUT_MS, polling: 100 }),
    socialFatal
  ]);
  const socialReady = await socialPage.evaluate(() => window.__NPC_SOCIAL_NG1__.status());
  console.log("NG1 preview runtime ready", JSON.stringify({
    tick: socialReady.tick, liveGroups: socialReady.liveGroups
  }));
  const advanced = await socialPage.evaluate(() => window.__NPC_SOCIAL_NG1__.advanceTicks(40));
  assert.ok(advanced.tick >= 40, "NG1 preview fast-forward advances the social clock");
  assert.ok(advanced.liveGroups >= 1, "NG1 preview fast-forward produces an observable group");
  const social = await socialPage.evaluate(() => ({
    status: window.__NPC_SOCIAL_NG1__.status(),
    panel: document.getElementById("npc-social-ng1")?.textContent ?? "",
    panelVisible: !!document.getElementById("npc-social-ng1")?.getClientRects().length
  }));
  assert.equal(social.panelVisible, true, "NG1 Group Observatory is visible in explicit preview");
  assert.ok(social.status.liveGroups >= 1, "NG1 preview exposes an emergent NPC group");
  assert.match(social.panel, /NPC 모임 관찰/);
  assert.match(social.panel, /현재 모임/);
  assert.match(social.panel, /최근 사회 사건/);

  // NG1.5: group formation and physical meetup behavior must share one NPC runtime clock.
  // The preview step drives the same update(dt) path as live NPCs, including schedules,
  // Purposeful movement, NG1 social evolution and the NG1.5 bridge.
  await socialPage.close();
  const behaviorPage = await smoke.context.newPage();
  const behaviorFatal = smoke.watch(behaviorPage);
  await behaviorPage.goto(`${smoke.origin}/campus/?npcSocial=ng15&npcConversation=p0`,
    { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await Promise.race([
    behaviorPage.waitForFunction(() =>
      typeof window.__NPC_SOCIAL_NG1__?.status === "function" &&
      typeof window.__NPC_SOCIAL_NG15__?.status === "function" &&
      typeof window.__NPC_SOCIAL_NG15__?.advanceSeconds === "function" &&
      typeof window.__NPC_SOCIAL_NG1__?.advanceTicks !== "function",
      null, { timeout: TIMEOUT_MS, polling: 100 }),
    behaviorFatal
  ]);

  const behaviorStarted = await behaviorPage.evaluate(() => {
    for (let step = 0; step < 90; step++) {
      window.__NPC_SOCIAL_NG15__.advanceSeconds(1, .1, { render: false, includeSocial: false });
      const bridge = window.__NPC_SOCIAL_NG15__.status();
      if (!bridge?.active) continue;
      const runtime = window.__INHAGAME_P0__?.getStatus?.().npcTest;
      return {
        elapsedGameSeconds: step + 1,
        bridge,
        members: Object.fromEntries((bridge.active.memberNpcIds ?? []).map(id => [id, runtime.purposeful[id]]))
      };
    }
    return {
      elapsedGameSeconds: 90,
      bridge: window.__NPC_SOCIAL_NG15__.status(),
      social: window.__NPC_SOCIAL_NG1__.status(),
      members: {}
    };
  });
  assert.ok(behaviorStarted.bridge.active,
    `NG1.5 did not select a meetup on the shared NPC clock: ${JSON.stringify(behaviorStarted)}`);
  assert.ok(Object.values(behaviorStarted.members).every(member =>
    member.interrupted && member.currentGoal === "GROUP_MEETUP"),
    "NG1.5 members are physically following meetup detours at normal NPC speed");

  const behaviorComplete = await behaviorPage.evaluate(() => {
    for (let step = 0; step < 90; step++) {
      const result = window.__NPC_SOCIAL_NG15__.advanceSeconds(1, .1, { render: false, includeSocial: false });
      const bridge = result.bridge;
      if ((bridge?.completedGroups?.length ?? 0) >= 1) {
        return { elapsedGameSeconds: step + 1, bridge, social: result.social };
      }
      if (!bridge?.active && bridge?.lastOutcome && bridge.lastOutcome.outcome !== "COMPLETED") {
        return { elapsedGameSeconds: (step + 1) / 10, bridge, social: result.social };
      }
    }
    return {
      elapsedGameSeconds: 90,
      bridge: window.__NPC_SOCIAL_NG15__.status(),
      social: window.__NPC_SOCIAL_NG1__.status()
    };
  });
  assert.ok(behaviorComplete.bridge.completedGroups.length >= 1,
    `NG1.5 meetup did not complete on the shared NPC clock: ${JSON.stringify(behaviorComplete)}`);
  // completedGroups is the durable completion authority. During a 1-second fast-forward batch,
  // another due regular group may immediately postpone and replace lastOutcome after the first
  // group has already completed and returned to its schedule.
  console.log("NG1.5 behavior bridge", JSON.stringify({
    elapsedGameSeconds: behaviorComplete.elapsedGameSeconds,
    completedGroups: behaviorComplete.bridge.completedGroups,
    lastOutcome: behaviorComplete.bridge.lastOutcome
  }));

  assert.equal(await behaviorPage.locator('#npc-observed-bubble').count(), 1,
    'observational P0 mounts through the actual NPC runtime on an opted-in Preview');
  assert.ok(await behaviorPage.evaluate(() =>
    window.__INHAGAME_P0__.getStatus().npcTest.observed_conversation),
    'P0 state is exposed through the runtime status');
  const { checkObservedBubble } = await import('./npc-observed-bubble-smoke.mjs');
  await checkObservedBubble(smoke);
  assert.deepEqual(smoke.problems, [], "no page errors, console errors or failed same-origin requests");
  console.log(JSON.stringify({ scene, hud, musicRuntime }, null, 2));
  console.log(`world boot smoke: PASS in ${((Date.now() - started) / 1000).toFixed(1)}s ` +
    `(renderer ${status.renderer}, place ${status.placeZone ?? "none"}, ${residentChunks} chunk(s) resident)`);
} catch (error) {
  console.error("world boot smoke: FAIL");
  if (smoke.problems.length) console.error(smoke.problems.map(line => `  - ${line}`).join("\n"));
  if (status) console.error(`  last status: ${JSON.stringify({ renderer: status.renderer, loading: status.loading, error: status.error })}`);
  throw error;
} finally {
  await smoke.close();
}


