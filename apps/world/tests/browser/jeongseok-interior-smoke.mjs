// Jeongseok public lobby + 1F/B1 browser QA: real /campus/ boot, Room Transition, PlayCanvas,
// native keyboard / touch input and actual runtime collision. Offline (harness.mjs): supabase-js
// is stubbed, so no account, database or production call exists. Shipped mode remains CLOSED; test-only constructor DI
// enables SERVER_GRANT for guest/public behavior. ?jeongseok=jsl-b is a LOCAL VISUAL_PREVIEW of all rooms,
// NOT a server-grant/authorization claim. Emulated mobile viewports are NOT physical devices.
//
//   npm ci --prefix apps/world/tests/browser
//   EXPECTED_JSL_B_HEAD=$(git rev-parse HEAD) WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/jeongseok-interior-smoke.mjs
// Optional focused reruns: JSL_B_MODES=public,synthetic,preview JSL_B_VIEWPORTS=desktop,portrait,landscape
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";
import { installJeongseokServerMode, installSyntheticJeongseokAccess } from "./jeongseok-synthetic-access.mjs";

const output = path.resolve(process.env.JSL_B_QA_OUTPUT || "test-results/jeongseok-interior");
await mkdir(output, { recursive: true });
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (process.env.EXPECTED_JSL_B_HEAD) assert.equal(head, process.env.EXPECTED_JSL_B_HEAD, "browser must test the exact candidate head");
const STEP_TIMEOUT_MS = 45_000;
const LOBBY = "ROOM_JEONGSEOK_LOBBY", READING = "ROOM_JEONGSEOK_B1_READING", CREATIVE = "ROOM_JEONGSEOK_B1_CREATIVE";
const report = { head, scope: "Offline Chromium: shipped CLOSED proof, test-only SERVER_GRANT rollout DI guest/public checks, synthetic Auth/RPC integration, VISUAL_PREVIEW_LOCAL_ONLY tour; emulated mobile, no real server-authority or physical-device claim",
  startedAt: new Date().toISOString(), environment: {}, publicLobby: [], syntheticAuthority: [], viewports: [], screenshots: [], status: "RUNNING" };
const viewports = [
  { label: "desktop", width: 1280, height: 720, mobile: false },
  { label: "portrait", width: 390, height: 844, mobile: true },
  { label: "landscape", width: 844, height: 390, mobile: true }
].filter(v => !process.env.JSL_B_VIEWPORTS || process.env.JSL_B_VIEWPORTS.split(",").includes(v.label));
const modeEnabled = name => !process.env.JSL_B_MODES || process.env.JSL_B_MODES.split(",").includes(name);
report.selectedModes = ["public", "synthetic", "preview"].filter(modeEnabled);
report.selectedViewports = viewports.map(v => v.label);
assert.ok(viewports.length && report.selectedModes.length, "select at least one known viewport and mode");

async function boot(smoke, query) {
  const page = await smoke.context.newPage();
  const fatal = smoke.watch(page);
  await page.goto(`${smoke.origin}/campus/${query}`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await Promise.race([page.waitForFunction(() => window.__INHAGAME_P0__?.getStatus?.().loading?.finished === true
    || window.__INHAGAME_P0__?.getStatus?.().renderer === "UNAVAILABLE", null, { timeout: TIMEOUT_MS, polling: 100 }), fatal]);
  const renderer = await page.evaluate(() => window.__INHAGAME_P0__.getStatus().renderer);
  assert.notEqual(renderer, "UNAVAILABLE", "campus boot");
  return { page, fatal, renderer };
}
const waitFor = async (ctx, fn, arg, label) => Promise.race([
  ctx.page.waitForFunction(fn, arg, { timeout: STEP_TIMEOUT_MS, polling: 50 }).catch(error => { throw new Error(`${label}: ${error.message}`); }),
  ctx.fatal
]);
const state = page => page.evaluate(() => {
  const d = window.__INHAGAME_P0__, p = d.player.getLocalPosition(), c = d.orbit.camera.getPosition();
  const j = window.__INHAGAME_JEONGSEOK_INTERIOR__.status();
  return { space: d.rooms.currentSpace, busy: d.rooms.status().busy, action: d.contextActions.active?.id ?? null,
    actionLabel: d.contextActions.active?.label ?? null, position: { x: p.x, y: p.y, z: p.z }, camera: { x: c.x, y: c.y, z: c.z },
    frame: d.app.frame, input: d.controller.inputEnabled, zone: document.getElementById("zone")?.textContent ?? null,
    placeZone: d.getStatus().placeZone ?? null, rootChildren: d.app.root.children.length, interior: j,
    phone: d.smartphone?.shell?.state ?? null, mounted: d.controller.mounted,
    gate: d.jeongseok.gate.snapshot(), grounded: d.controller.grounded,
    closedGateCollider: (d.controller.space.obstacles ?? []).some(box => box.id === "jsl_lobby_closed_gate") };
});
const teleport = (page, x, z, yaw = 0, y = 1.15) => page.evaluate(([x, z, yaw, y]) => {
  const d = window.__INHAGAME_P0__;
  d.controller.velocityY = 0; d.player.setLocalPosition(x, y, z); d.player.setLocalEulerAngles(0, yaw, 0);
  d.orbit.yaw = Math.atan2(-Math.sin(yaw * Math.PI / 180), Math.cos(yaw * Math.PI / 180));
}, [x, z, yaw, y]);
async function shot(ctx, viewport, name, extra = {}) {
  const file = `${viewport.label}-${name}.png`;
  await ctx.page.waitForTimeout(400);
  await ctx.page.screenshot({ path: path.join(output, file) });
  const bytes = await readFile(path.join(output, file));
  report.screenshots.push({ file, viewport: viewport.label, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length,
    state: await state(ctx.page), ...extra });
}
async function useAction(ctx, viewport, { id, label, space }) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await waitFor(ctx, ([wantId, wantLabel]) => {
      const active = window.__INHAGAME_P0__.contextActions.active;
      return active?.id === wantId && new RegExp(wantLabel).test(active.label ?? "");
    }, [id, label.source], `${space}: ${id} action`);
    if (viewport.mobile) await ctx.page.locator("#context-action").tap();
    else await ctx.page.keyboard.press("KeyF");
    const changed = await ctx.page.waitForFunction(want => window.__INHAGAME_P0__.rooms.currentSpace === want && !window.__INHAGAME_P0__.rooms.status().busy,
      space, { timeout: 12_000, polling: 50 }).then(() => true, () => false);
    if (changed) return attempt;
  }
  throw new Error(`${id} never reached ${space}: ${JSON.stringify(await state(ctx.page))}`);
}
// Both requirements are needed: wall time alone can contain zero simulation frames on CI.
function nativeMovementObserved({ startFrame, startedAt, minimumMs, minimumFrames }) {
  return window.__INHAGAME_P0__.app.frame >= startFrame + minimumFrames && performance.now() - startedAt >= minimumMs;
}
// Native movement: held key on desktop, a trusted CDP touch drag on the joystick on mobile.
async function move(ctx, viewport, { key = "KeyW", dx = 0, dy = -40, ms = 1400, until = null } = {}) {
  const before = await state(ctx.page);
  const observation = report.lastMovement = { viewport: viewport.label, beforeFrame: before.frame, beforePosition: before.position,
    kind: until ? "condition" : "native-frames", minimumMs: until ? null : ms, minimumFrames: until ? null : 6, timeoutMs: 10000 };
  const hold = async () => {
    if (until) return ctx.page.waitForFunction(until, null, { timeout: 10000, polling: 50 });
    // Read the baseline only after key/touch down. Keep the original duration, and require
    // real frames while that same native input remains held; never inject motion or collision.
    const start = await ctx.page.evaluate(() => ({ startFrame: window.__INHAGAME_P0__.app.frame, startedAt: performance.now() }));
    observation.startFrame = start.startFrame;
    return ctx.page.waitForFunction(nativeMovementObserved, { ...start, minimumMs: ms, minimumFrames: 6 }, { timeout: 10000, polling: 50 });
  };
  if (!viewport.mobile) {
    await ctx.page.keyboard.down(key);
    try { await hold(); } finally { await ctx.page.keyboard.up(key); }
  } else {
    const cdp = await ctx.page.context().newCDPSession(ctx.page);
    const rect = await ctx.page.locator("#joystick").boundingBox();
    assert.ok(rect, "joystick visible on mobile");
    const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy, id: 7 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx + dx, y: cy + dy, id: 7 }] });
    try { await hold(); } finally {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
    }
  }
  await ctx.page.waitForTimeout(200);
  const after = await state(ctx.page);
  observation.afterFrame = after.frame; observation.afterPosition = after.position;
  return { before, after, moved: Math.hypot(after.position.x - before.position.x, after.position.z - before.position.z) };
}
async function frames(page, ms = 3000) {
  return page.evaluate(ms => new Promise(resolve => {
    const deltas = []; let last = performance.now(); const end = last + ms;
    const tick = t => { deltas.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else {
      const sorted = [...deltas].sort((a, b) => a - b), q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
      const d = window.__INHAGAME_P0__;
      resolve({ samples: deltas.length, medianMs: q(0.5), p95Ms: q(0.95), maxMs: sorted.at(-1),
        drawCalls: d.app.stats?.drawCalls?.total ?? null, heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null });
    } };
    requestAnimationFrame(tick);
  }), ms);
}
// Camera inside the active room: world z is mirrored (room roots use scale z = -1).
function assertCameraInside(s, shell, label) {
  const local = { x: s.camera.x, y: s.camera.y, z: -s.camera.z };
  assert.ok(Math.abs(local.x) < shell.halfWidth && Math.abs(local.z) < shell.halfDepth, `${label}: camera inside the walls ${JSON.stringify(local)}`);
  assert.ok(local.y < shell.ceiling, `${label}: camera under the ceiling ${local.y}`);
}

const SHELLS = {
  [LOBBY]: { halfWidth: 11, halfDepth: 7.5, ceiling: 3.6 },
  [READING]: { halfWidth: 13, halfDepth: 9, ceiling: 1.75 },
  [CREATIVE]: { halfWidth: 13, halfDepth: 9, ceiling: 1.9 }
};

try {
  // 1. Shipped mode is CLOSED. Constructor-only rollout DI then verifies the future public lobby.
  for (const viewport of modeEnabled("public") ? viewports : []) {
    const smoke = await startSmoke({ viewport: { width: viewport.width, height: viewport.height },
      contextOptions: { isMobile: viewport.mobile, hasTouch: viewport.mobile } });
    const result = { viewport: viewport.label, status: "RUNNING", checks: {} };
    report.publicLobby.push(result);
    try {
      if (viewport === viewports[0]) {
        const closed = await boot(smoke, "?jeongseok=jsl-a");
        const shipped = await state(closed.page);
        assert.equal(shipped.interior.policy.mode, "CLOSED_PENDING_JSL_A", "unmodified main remains CLOSED, even with the old gate QA query");
        assert.equal(await closed.page.evaluate(() => window.__INHAGAME_P0__.rooms.enter("ROOM_JEONGSEOK_LOBBY")), false);
        assert.equal(await closed.page.evaluate(() => window.__INHAGAME_P0__.rooms.enter("ROOM_JEONGSEOK_B1_READING")), false);
        assert.deepEqual(shipped.interior.scenes.built, []);
        report.productionClosed = { status: "PASS", mode: shipped.interior.policy.mode, queryDoesNotActivate: true };
        await closed.page.close();
      }
      result.rolloutFixture = await installJeongseokServerMode(smoke.context);
      const ctx = await boot(smoke, "");
      const anchors = await ctx.page.evaluate(async () => {
        const rooms = await import("/src/jeongseok/interior-rooms.js");
        const lobby = await import("/src/jeongseok/lobby-layout.js");
        const gate = await import("/src/jeongseok/gate-layout.js");
        return { entrance: rooms.JEONGSEOK_ENTRANCE.position, campusReturn: rooms.JEONGSEOK_CAMPUS_RETURN.position,
          publicReturn: lobby.JEONGSEOK_PUBLIC_RETURN.position, boundary: lobby.JEONGSEOK_INNER_BOUNDARY_Z,
          lanes: lobby.JEONGSEOK_LOBBY_LAYOUT.gateLanes, guide: gate.JEONGSEOK_GUIDE.position, reader: gate.JEONGSEOK_GATE.position };
      });
      assert.equal((await state(ctx.page)).interior.policy.mode, "SERVER_GRANT_JSL_A");
      assert.equal(await ctx.page.evaluate(() => typeof window.__INHAGAME_JEONGSEOK_INTERIOR__.failNextBuild), "undefined", "no visual-preview fault hooks in SERVER_GRANT mode");
      const directCampusB1 = await ctx.page.evaluate(() => window.__INHAGAME_P0__.rooms.enter("ROOM_JEONGSEOK_B1_READING"));
      assert.equal(directCampusB1, false, "direct campus → B1 rejected");
      await teleport(ctx.page, anchors.entrance.x, anchors.entrance.z, 0, 2.8);
      await useAction(ctx, viewport, { id: "jeongseok-door", label: /공개 로비/, space: LOBBY });
      let s = await state(ctx.page);
      assert.equal(s.interior.policy.accountBound, false);
      assert.equal(s.interior.policy.session, false);
      assert.equal(s.closedGateCollider, true, "real room controller includes the closed-gate collider");
      const barrier = await ctx.page.evaluate(() => window.__INHAGAME_P0__.controller.space.obstacles.find(box => box.id === "jsl_lobby_closed_gate"));
      assert.ok(barrier.minX <= -11 && barrier.maxX >= 11 && barrier.minY <= 0 && barrier.maxY >= 3.6, "actual closed barrier covers side/jump bypass routes");
      assert.match(s.zone, /1층 로비/);
      result.checks.guestPublicEntry = "PASS";
      await shot(ctx, viewport, "public-01-guest-arrival");

      // No injected colliders or forced position correction: held native input stops at each lane.
      const lanes = [];
      for (const lane of anchors.lanes) {
        await teleport(ctx.page, lane.x, anchors.boundary - 1.25);
        await ctx.page.waitForTimeout(300);
        const walk = await move(ctx, viewport, { ms: 1100 });
        assert.ok(walk.moved > 0.1, `lane ${lane.x}: trusted input moved toward gate`);
        assert.ok(walk.after.position.z <= anchors.boundary - 0.2, `lane ${lane.x}: physical gate stops movement`);
        assert.equal(walk.after.interior.stats.forcedExits, walk.before.interior.stats.forcedExits, "collision, not correction, stops native movement");
        lanes.push({ x: lane.x, before: walk.before.position, after: walk.after.position, frames: [walk.before.frame, walk.after.frame] });
      }
      const flaps = await ctx.page.evaluate(() => window.__INHAGAME_JEONGSEOK_INTERIOR__.activeFlapAngles());
      // Each lane has a west/east hinge; assert coverage separately from closure.
      assert.equal(flaps.length, anchors.lanes.length * 2, "both flaps in every lane are inspected");
      assert.ok(flaps.every(angle => Number.isFinite(angle) && Math.abs(angle) < 0.01),
        `proximity cannot visually open closed flaps: ${JSON.stringify(flaps)}`);
      result.checks.closedGateCollision = { status: "PASS", lanes, flaps };
      await shot(ctx, viewport, "public-02-closed-inner-gates");

      // Direct nested B1 and restored/teleported protected-side positions cannot bypass policy.
      const directB1 = await ctx.page.evaluate(() => window.__INHAGAME_P0__.rooms.enterNested("ROOM_JEONGSEOK_B1_READING", {
        fromRoomId: "ROOM_JEONGSEOK_LOBBY", returnPosition: { x: 0, y: 1.15, z: -5.6 }, returnYaw: 0
      }));
      assert.equal(directB1, false);
      await teleport(ctx.page, 0, 1.2);
      await waitFor(ctx, ({ x, z }) => { const p = window.__INHAGAME_P0__.player.getLocalPosition(); return Math.hypot(p.x - x, p.z - z) < 0.2; }, anchors.publicReturn, "unauthorized position corrected to public lobby");
      s = await state(ctx.page);
      assert.equal(s.space, LOBBY); assert.equal(s.interior.protected, false); assert.equal(s.action === "jeongseok-portal", false);
      result.checks.directB1AndTeleportGuard = "PASS";

      // The public-side fictional NPC is physically reachable, with guest login guidance.
      await teleport(ctx.page, anchors.guide.x + 1.8, anchors.guide.z, 270);
      const guideWalk = await move(ctx, viewport, { until: () => window.__INHAGAME_P0__.contextActions.active?.id === "jeongseok-guide" });
      assert.ok(guideWalk.moved > 0.1, "native movement reaches the public guide");
      assert.equal(guideWalk.after.interior.stats.forcedExits, guideWalk.before.interior.stats.forcedExits);
      await waitFor(ctx, () => window.__INHAGAME_P0__.contextActions.active?.id === "jeongseok-guide", null, "public guide action");
      if (viewport.mobile) await ctx.page.locator("#context-action").tap(); else await ctx.page.keyboard.press("KeyF");
      await waitFor(ctx, () => window.__INHAGAME_P0__.smartphone.status().current?.view === "jeongseok", null, "guest guide phone");
      const guideText = await ctx.page.locator(".smartphone-content").innerText();
      assert.match(guideText, /로비 안내 NPC/); assert.match(guideText, /정식 계정 로그인/); assert.match(guideText, /인하대 이메일 인증/);
      assert.equal(await ctx.page.getByRole("button", { name: /방문증 발급하기/ }).count(), 0, "guest cannot purchase");
      // Normal-motion Phone opens with a 150ms translate/scale animation. Measure its
      // settled frame, as the other Phone suites do with reduced-motion, not a transient pose.
      await ctx.page.waitForFunction(() => document.querySelector(".smartphone-frame").getAnimations().every(animation => animation.playState === "finished"), null, { timeout: 5000 });
      const phoneBounds = await ctx.page.locator(".smartphone-frame").boundingBox();
      result.checks.publicGuideBounds = { viewport: { width: viewport.width, height: viewport.height }, frame: phoneBounds };
      assert.ok(phoneBounds.x >= 0 && phoneBounds.y >= 0 && phoneBounds.x + phoneBounds.width <= viewport.width + 1 && phoneBounds.y + phoneBounds.height <= viewport.height + 1, `guide UI fits viewport: ${JSON.stringify(result.checks.publicGuideBounds)}`);
      await shot(ctx, viewport, "public-03-guide-login");
      await ctx.page.getByRole("button", { name: "정석 출입 취소" }).click();
      await waitFor(ctx, () => window.__INHAGAME_P0__.smartphone.shell.state === "CLOSED" && window.__INHAGAME_P0__.controller.inputEnabled, null, "guide closes and restores movement");
      result.checks.publicGuideGuestLogin = "PASS";

      await teleport(ctx.page, anchors.reader.x, anchors.reader.z);
      await waitFor(ctx, () => window.__INHAGAME_P0__.contextActions.active?.id === "jeongseok-gate", null, "inner reader");
      if (viewport.mobile) await ctx.page.locator("#context-action").tap(); else await ctx.page.keyboard.press("KeyF");
      await waitFor(ctx, () => window.__INHAGAME_P0__.jeongseok.gate.snapshot().state === "AUTH_REQUIRED", null, "guest reader refusal");
      assert.match(await ctx.page.locator("#jeongseok-gate").innerText(), /로비는 자유롭게 이용.*안내 NPC/);
      assert.equal((await state(ctx.page)).closedGateCollider, true);
      result.checks.guestInnerGateRefusal = "PASS";
      await teleport(ctx.page, 0, -6.6, 180);
      await useAction(ctx, viewport, { id: "room-door", label: /캠퍼스/, space: "campus" });
      s = await state(ctx.page);
      assert.ok(Math.hypot(s.position.x - anchors.campusReturn.x, s.position.z - anchors.campusReturn.z) < 0.3);
      assert.equal(s.interior.scenes.built.length, 0);
      assert.deepEqual(smoke.problems, []);
      result.status = "PASS"; console.log(`public lobby ${viewport.label}: PASS`);
    } catch (error) { result.status = "FAIL"; result.error = error.stack || String(error);
      try { const pages = smoke.context.pages(); if (pages.length) {
        const page = pages.at(-1); result.diagnostic = await state(page);
        await page.screenshot({ path: path.join(output, `${viewport.label}-${result.authority ? "synthetic" : "public"}-failure.png`) });
      } } catch { /* preserve original failure */ }
      result.movementDiagnostic = report.lastMovement; }
    finally { await smoke.close(); }
  }

  // 2. The normal main/auth/RPC parsing/gate/room/collision path with SYNTHETIC replies only.
  // Constructor-only rollout DI; no access-policy replacement or injected collider. Not real server-authority QA.
  for (const viewport of modeEnabled("synthetic") ? viewports.filter(v => !v.mobile) : []) {
    const smoke = await startSmoke({ viewport: { width: viewport.width, height: viewport.height } });
    const result = { viewport: viewport.label, status: "RUNNING", authority: "SYNTHETIC_SUPABASE_REPLIES_NO_SERVER_CLAIM", checks: {} };
    report.syntheticAuthority.push(result);
    try {
      result.rolloutFixture = await installJeongseokServerMode(smoke.context);
      await installSyntheticJeongseokAccess(smoke.context);
      const ctx = await boot(smoke, "");
      await waitFor(ctx, () => { const d = window.__INHAGAME_P0__; return d.jeongseok.access.state === "READY" &&
        d.jeongseok.access.accountId === window.__JSL_SYNTHETIC__.first; }, null, "synthetic account through real online identity");
      const a = await ctx.page.evaluate(async () => {
        const m = await import("/src/jeongseok/interior-rooms.js"), l = await import("/src/jeongseok/lobby-layout.js");
        const g = await import("/src/jeongseok/gate-layout.js");
        return { entrance: m.JEONGSEOK_ENTRANCE.position, guide: g.JEONGSEOK_GUIDE.position, reader: g.JEONGSEOK_GATE.position,
          lane: l.JEONGSEOK_LOBBY_LAYOUT.gateLanes[2], portal: l.JEONGSEOK_LOBBY_PORTALS[0],
          b1Exit: m.JEONGSEOK_LAYOUTS.ROOM_JEONGSEOK_B1_READING.exit.position, publicReturn: l.JEONGSEOK_PUBLIC_RETURN.position };
      });
      await teleport(ctx.page, a.entrance.x, a.entrance.z, 0, 2.8);
      await useAction(ctx, viewport, { id: "jeongseok-door", label: /공개 로비/, space: LOBBY });
      const atReader = async () => {
        await teleport(ctx.page, a.lane.x, a.reader.z);
        await waitFor(ctx, () => window.__INHAGAME_P0__.contextActions.active?.id === "jeongseok-gate", null, "synthetic inner reader");
      };
      const tagAndEnter = async () => {
        await atReader();
        const before = await ctx.page.evaluate(() => window.__JSL_SYNTHETIC__.status().calls.filter(c => c.name === "get_jeongseok_access_v1").length);
        await ctx.page.keyboard.press("KeyF");
        await waitFor(ctx, () => window.__INHAGAME_P0__.jeongseok.gate.snapshot().state === "READY_TO_ENTER" && window.__INHAGAME_P0__.smartphone.shell.state === "CLOSED", null, "synthetic tag ready");
        assert.equal((await state(ctx.page)).closedGateCollider, true, "green READY presentation alone cannot open collision");
        await waitFor(ctx, () => !window.__INHAGAME_P0__.contextActions.suspended, null, "reader input restored");
        await ctx.page.keyboard.press("KeyF");
        await waitFor(ctx, () => window.__INHAGAME_P0__.jeongseok.gate.snapshot().notice === "INNER_ACCESS_GRANTED", null, "fresh synthetic entry grant");
        await waitFor(ctx, () => !window.__INHAGAME_P0__.controller.space.obstacles.some(box => box.id === "jsl_lobby_closed_gate"), null, "actual gate collider removed");
        const after = await ctx.page.evaluate(() => window.__JSL_SYNTHETIC__.status().calls.filter(c => c.name === "get_jeongseok_access_v1").length);
        assert.ok(after >= before + 2, "tag and actual entry both use the real access client's RPC path");
        // Wait for real native-input crossing, not a fixed press duration at variable FPS.
        await ctx.page.keyboard.down("KeyW");
        try {
          await ctx.page.waitForFunction(() => window.__INHAGAME_P0__.player.getLocalPosition().z > -3.2, null, { timeout: 10000, polling: 50 });
        } finally { await ctx.page.keyboard.up("KeyW"); }
        const crossed = await state(ctx.page);
        assert.ok(crossed.position.z > -3.2, `native input crosses freshly opened inner gate (${crossed.position.z})`);
        assert.equal(crossed.interior.policy.crossed, true);
      };
      const enterB1 = async () => {
        await teleport(ctx.page, a.portal.position.x, a.portal.position.z - 0.3);
        await useAction(ctx, viewport, { id: "jeongseok-portal", label: /제2열람실/, space: READING });
      };
      const publicReturn = async label => {
        await waitFor(ctx, p => { const d = window.__INHAGAME_P0__, at = d.player.getLocalPosition(); return d.rooms.currentSpace === "ROOM_JEONGSEOK_LOBBY" &&
          !d.rooms.status().busy && Math.hypot(at.x - p.x, at.z - p.z) < 0.2; }, a.publicReturn, label);
        const s = await state(ctx.page); assert.equal(s.interior.policy.session, false); assert.equal(s.closedGateCollider, true);
      };

      // A prepared/closed server reply leaves the lobby available and actual inner gate closed.
      await ctx.page.evaluate(() => window.__JSL_SYNTHETIC__.setAccess({ gateStatus: "COMING_SOON" }));
      await atReader(); await ctx.page.keyboard.press("KeyF");
      await waitFor(ctx, () => window.__INHAGAME_P0__.jeongseok.gate.snapshot().state === "DISABLED", null, "synthetic coming-soon refusal");
      assert.equal((await state(ctx.page)).closedGateCollider, true);
      result.checks.comingSoonInnerGate = "PASS";
      await ctx.page.evaluate(() => window.__JSL_SYNTHETIC__.setAccess({ gateStatus: "ACTIVE" }));
      await teleport(ctx.page, a.guide.x + 0.85, a.guide.z);
      await waitFor(ctx, () => window.__INHAGAME_P0__.contextActions.active?.id === "jeongseok-guide", null, "synthetic guide");
      await ctx.page.keyboard.press("KeyF");
      await ctx.page.getByRole("button", { name: "방문증 발급하기 · 100 인덕코인" }).click();
      await ctx.page.getByRole("button", { name: "결제 확인 · 100 인덕코인 사용" }).click();
      await waitFor(ctx, () => window.__INHAGAME_P0__.jeongseok.gate.snapshot().notice === "ISSUED" && window.__INHAGAME_P0__.jeongseok.gate.snapshot().state === "IDLE", null, "synthetic guide issue");
      assert.equal((await state(ctx.page)).closedGateCollider, true, "guide purchase cannot open collision");
      assert.equal((await state(ctx.page)).interior.policy.session, false);
      const purchased = await ctx.page.evaluate(() => window.__JSL_SYNTHETIC__.status());
      assert.equal(purchased.purchases, 1); assert.equal(purchased.balance, 150);
      await shot(ctx, viewport, "synthetic-01-guide-issue-no-grant");
      await ctx.page.evaluate(() => window.__INHAGAME_P0__.smartphone.close());
      await tagAndEnter();
      await shot(ctx, viewport, "synthetic-02-native-inner-crossing");
      await enterB1();
      await teleport(ctx.page, a.b1Exit.x, a.b1Exit.z);
      await useAction(ctx, viewport, { id: "room-door", label: /1층 로비/, space: LOBBY });
      await publicReturn("synthetic B1 public-side return");
      result.checks.guidePurchaseSeparateReaderAndB1Return = "PASS";

      // Expiry uses the normal parsed server timestamp and frame update, not a test-only clock.
      await tagAndEnter(); await enterB1();
      await ctx.page.evaluate(async () => { window.__JSL_SYNTHETIC__.setAccess({ expiresAt: Date.now() + 1200 });
        await window.__INHAGAME_P0__.jeongseok.access.refresh("synthetic-expiry"); });
      await publicReturn("expired synthetic pass returns B1 to public lobby");
      result.checks.protectedPassExpiry = "PASS";

      // Verified mail uses the same internal gate path. Auth events revoke protected B1 in main.
      await ctx.page.evaluate(() => window.__JSL_SYNTHETIC__.setAccess({ verified: true, expiresAt: null }));
      await tagAndEnter(); await enterB1();
      await ctx.page.evaluate(() => window.__JSL_SYNTHETIC__.switchAccount("44444444-4444-4444-8444-444444444444"));
      await publicReturn("synthetic account switch returns B1 to public lobby");
      await waitFor(ctx, () => window.__INHAGAME_P0__.jeongseok.access.accountId === "44444444-4444-4444-8444-444444444444", null, "new synthetic account");
      result.checks.verifiedMailAndAccountSwitch = "PASS";
      await shot(ctx, viewport, "synthetic-03-revoked-public-return");
      assert.deepEqual(smoke.problems, []);
      result.status = "PASS"; console.log("synthetic main integration: PASS (no server-authority claim)");
    } catch (error) { result.status = "FAIL"; result.error = error.stack || String(error);
      try { const pages = smoke.context.pages(); if (pages.length) {
        const page = pages.at(-1); result.diagnostic = await state(page);
        await page.screenshot({ path: path.join(output, `${viewport.label}-${result.authority ? "synthetic" : "public"}-failure.png`) });
      } } catch { /* preserve original failure */ }
      result.movementDiagnostic = report.lastMovement; }
    finally { await smoke.close(); }
  }

  for (const viewport of modeEnabled("preview") ? viewports : []) {
    const smoke = await startSmoke({ viewport: { width: viewport.width, height: viewport.height },
      contextOptions: { isMobile: viewport.mobile, hasTouch: viewport.mobile } });
    const result = { viewport: viewport.label, size: `${viewport.width}x${viewport.height}`, checks: {}, perf: {} };
    report.viewports.push(result);
    try {
      const ctx = await boot(smoke, "?jeongseok=jsl-b");
      result.renderer = ctx.renderer;
      report.environment[viewport.label] = await ctx.page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl2");
        const ext = gl?.getExtension("WEBGL_debug_renderer_info");
        return { userAgent: navigator.userAgent, webgpu: !!navigator.gpu, gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, dpr: devicePixelRatio,
          graphicsTier: window.__INHAGAME_P0__.getStatus().graphics?.tier ?? null };
      });
      const { entrance, campusReturn, publicReturn, lobbyPortals, readingLink } = await ctx.page.evaluate(async () => {
        const m = await import("/src/jeongseok/interior-rooms.js");
        const l = await import("/src/jeongseok/lobby-layout.js");
        return { entrance: m.JEONGSEOK_ENTRANCE.position, campusReturn: m.JEONGSEOK_CAMPUS_RETURN.position, publicReturn: l.JEONGSEOK_PUBLIC_RETURN.position,
          lobbyPortals: m.JEONGSEOK_LAYOUTS.ROOM_JEONGSEOK_LOBBY.portals.map(p => ({ id: p.id, target: p.target, position: p.position })),
          readingLink: m.JEONGSEOK_LAYOUTS.ROOM_JEONGSEOK_B1_READING.portals[0].position };
      });
      const baseChildren = (await state(ctx.page)).rootChildren;
      const heapCampus = await ctx.page.evaluate(() => performance.memory?.usedJSHeapSize / 1048576 ?? null);

      // 2. Campus → lobby through the door (double input admits one entry).
      await teleport(ctx.page, entrance.x, entrance.z, 0, 2.8);
      await shot(ctx, viewport, "00-campus-jeongseok-door");
      const loadStart = Date.now();
      if (!viewport.mobile) {
        await waitFor(ctx, () => window.__INHAGAME_P0__.contextActions.active?.id === "jeongseok-door", null, "door action");
        await ctx.page.keyboard.press("KeyF"); await ctx.page.keyboard.press("KeyF");
        await waitFor(ctx, s => window.__INHAGAME_P0__.rooms.currentSpace === s && !window.__INHAGAME_P0__.rooms.status().busy, LOBBY, "lobby");
      } else await useAction(ctx, viewport, { id: "jeongseok-door", label: /정석학술정보관/, space: LOBBY });
      result.perf.enterLobbyMs = Date.now() - loadStart;
      let s = await state(ctx.page);
      assert.equal(s.interior.stats.entries, 1, "one entry for repeated input");
      assert.match(s.zone, /1층 로비/);
      assert.ok(Math.abs(s.position.y - 1.15) < 0.05, "standing on the lobby floor");
      result.checks.enterLobby = "PASS";
      await shot(ctx, viewport, "01-lobby-arrival");

      // 3. Preview-only: walk north with native input; open flaps do not imply server access.
      await ctx.page.waitForTimeout(900);
      const walk = await move(ctx, viewport, { ms: 1800 });
      assert.ok(walk.moved > 0.3, `native movement in the lobby (${walk.moved})`);
      result.checks.lobbyMovement = { status: "PASS", moved: walk.moved, from: walk.before.position, to: walk.after.position };
      result.checks.flapAngles = await ctx.page.evaluate(() => window.__INHAGAME_JEONGSEOK_INTERIOR__.activeFlapAngles());
      assertCameraInside(walk.after, SHELLS[LOBBY], "lobby walk");

      // 4. Collision: push into the information desk and a wall; never through, never below the floor.
      await teleport(ctx.page, -6.0, -3.4, 180);
      await ctx.page.waitForTimeout(500);
      const desk = await move(ctx, viewport, { ms: 1400 });
      assert.ok(desk.after.position.z > -4.3 + 0.2, `desk blocks (z=${desk.after.position.z})`);
      await teleport(ctx.page, -9.6, 4.0, 270);
      await ctx.page.waitForTimeout(400);
      const wall = await move(ctx, viewport, { ms: 1400 });
      assert.ok(wall.after.position.x > -11 + 0.45, `west wall blocks (x=${wall.after.position.x})`);
      assert.ok(Math.abs(wall.after.position.y - 1.15) < 0.05, "no fall through the floor");
      assertCameraInside(wall.after, SHELLS[LOBBY], "lobby wall");
      result.checks.collision = { status: "PASS", desk: desk.after.position, wall: wall.after.position };
      await shot(ctx, viewport, "02-lobby-wall-camera");

      // 5. Phone open/close inside the lobby keeps the room and restores movement.
      if (!viewport.mobile) {
        await ctx.page.keyboard.press("KeyN");
        await waitFor(ctx, () => window.__INHAGAME_P0__.smartphone.shell.state !== "CLOSED", null, "phone open");
        await shot(ctx, viewport, "03-lobby-phone-open");
        await ctx.page.keyboard.press("Escape");
        await waitFor(ctx, () => window.__INHAGAME_P0__.smartphone.shell.state === "CLOSED", null, "phone closed");
      } else {
        await ctx.page.locator("#phone-toggle").tap();
        await waitFor(ctx, () => window.__INHAGAME_P0__.smartphone.shell.state !== "CLOSED", null, "phone open");
        await shot(ctx, viewport, "03-lobby-phone-open");
        await ctx.page.evaluate(() => window.__INHAGAME_P0__.smartphone.close());
        await waitFor(ctx, () => window.__INHAGAME_P0__.smartphone.shell.state === "CLOSED", null, "phone closed");
      }
      await ctx.page.waitForTimeout(400);
      s = await state(ctx.page);
      assert.equal(s.space, LOBBY); assert.equal(s.input, true);
      result.checks.phone = "PASS";

      // 6. Lobby → B1 Second Reading Room (temporary transfer).
      await teleport(ctx.page, lobbyPortals[0].position.x, lobbyPortals[0].position.z - 0.3, 0);
      result.perf.lobby = await frames(ctx.page);
      await shot(ctx, viewport, "04-lobby-b1-transfer");
      await useAction(ctx, viewport, { id: "jeongseok-portal", label: /제2열람실/, space: READING });
      s = await state(ctx.page);
      assert.match(s.zone, /제2열람실/);
      await shot(ctx, viewport, "05-b1-reading-arrival");
      const readingWalk = await move(ctx, viewport, { ms: 1600 });
      assert.ok(readingWalk.moved > 0.3); assertCameraInside(readingWalk.after, SHELLS[READING], "reading walk");
      await teleport(ctx.page, 0, -2, 0);
      result.perf.reading = await frames(ctx.page);
      await shot(ctx, viewport, "06-b1-reading-main-aisle");
      // Into the carrel row's desk (x from 2.4) at its centre line.
      await teleport(ctx.page, 1.4, 4.8, 90);
      const carrel = await move(ctx, viewport, { ms: 1200 });
      assert.ok(carrel.after.position.x <= 2.4 - 0.2 + 0.02, `carrel row blocks (x=${carrel.after.position.x})`);
      assertCameraInside(carrel.after, SHELLS[READING], "reading low ceiling");
      await shot(ctx, viewport, "07-b1-reading-carrels");
      result.checks.reading = "PASS";

      // 7. B1 Reading → Creative Space (temporary B1 link), study and lecture zones, glass room.
      await teleport(ctx.page, readingLink.x - 0.3, readingLink.z, 90);
      await useAction(ctx, viewport, { id: "jeongseok-portal", label: /Creative/, space: CREATIVE });
      s = await state(ctx.page);
      assert.match(s.zone, /Creative Space/);
      await shot(ctx, viewport, "08-b1-creative-arrival");
      await teleport(ctx.page, -6, -6.4, 0);
      result.perf.creative = await frames(ctx.page);
      await shot(ctx, viewport, "09-b1-creative-study-zone");
      await teleport(ctx.page, 3.7, -4.6, 60);
      await shot(ctx, viewport, "10-b1-creative-lecture-zone");
      await teleport(ctx.page, -2.9, -4.9, 180);
      await shot(ctx, viewport, "11-b1-creative-glass-study-room");
      const column = await (async () => { await teleport(ctx.page, -9, -4.6, 0); return move(ctx, viewport, { ms: 1200 }); })();
      assert.ok(column.after.position.z < -3 - 0.45 + 0.05, `slat column blocks (z=${column.after.position.z})`);
      result.checks.creative = "PASS";

      // 8. Creative → lobby → campus at the safe return anchor; interiors released.
      await teleport(ctx.page, -6, -7.6, 180);
      await useAction(ctx, viewport, { id: "room-door", label: /1층 로비/, space: LOBBY });
      s = await state(ctx.page);
      assert.ok(Math.hypot(s.position.x - publicReturn.x, s.position.z - publicReturn.z) < 0.2, "B1 returns to the public-side lobby anchor");
      await teleport(ctx.page, 0, -6.6, 180);
      await useAction(ctx, viewport, { id: "room-door", label: /캠퍼스/, space: "campus" });
      await ctx.page.waitForTimeout(600);
      s = await state(ctx.page);
      assert.ok(Math.hypot(s.position.x - campusReturn.x, s.position.z - campusReturn.z) < 0.3, "safe campus return anchor");
      assert.ok(Math.abs(s.position.y - campusReturn.y) < 0.2, "on the landing, not below it");
      assert.equal(s.interior.scenes.built.length, 0, "interior scenes released on campus");
      assert.equal(s.rootChildren, baseChildren, "no leaked scene roots");
      result.perf.heapMB = { campusBefore: heapCampus, campusAfterRelease: await ctx.page.evaluate(() => performance.memory?.usedJSHeapSize / 1048576 ?? null) };
      await shot(ctx, viewport, "12-campus-return");
      result.checks.loop = "PASS";

      if (!viewport.mobile) {
        // 9. Load failure → rollback to campus, then a clean retry.
        await ctx.page.waitForTimeout(900);
        await ctx.page.evaluate(() => window.__INHAGAME_JEONGSEOK_INTERIOR__.failNextBuild());
        await teleport(ctx.page, entrance.x, entrance.z, 0, 2.8);
        await waitFor(ctx, () => window.__INHAGAME_P0__.contextActions.active?.id === "jeongseok-door", null, "door for failure");
        await ctx.page.keyboard.press("KeyF");
        await ctx.page.waitForTimeout(1500);
        s = await state(ctx.page);
        assert.equal(s.space, "campus"); assert.equal(s.busy, false); assert.equal(s.input, true);
        const message = await ctx.page.evaluate(() => document.getElementById("follow-status")?.textContent ?? "");
        await shot(ctx, viewport, "13-load-failure-rollback", { message });
        await ctx.page.waitForTimeout(900);
        await useAction(ctx, viewport, { id: "jeongseok-door", label: /정석/, space: LOBBY });
        result.checks.loadFailureRollback = { status: "PASS", message };

        // 10. Account change while in B1 → safe public lobby anchor (visual-preview lifecycle only).
        await teleport(ctx.page, lobbyPortals[1].position.x, lobbyPortals[1].position.z - 0.3, 0);
        await useAction(ctx, viewport, { id: "jeongseok-portal", label: /Creative/, space: CREATIVE });
        await ctx.page.evaluate(() => window.__INHAGAME_JEONGSEOK_INTERIOR__.simulateAccountChange("qa-account-b"));
        await waitFor(ctx, () => window.__INHAGAME_P0__.rooms.currentSpace === "ROOM_JEONGSEOK_LOBBY" && !window.__INHAGAME_P0__.rooms.status().busy, null, "forced public return");
        s = await state(ctx.page);
        assert.ok(Math.hypot(s.position.x - publicReturn.x, s.position.z - publicReturn.z) < 0.3);
        assert.equal(s.interior.stats.forcedExits, 1);
        result.checks.accountChangePublicReturn = "PASS";
        await teleport(ctx.page, 0, -6.6, 180);
        await useAction(ctx, viewport, { id: "room-door", label: /캠퍼스/, space: "campus" });

        // 11. Mounted: the door is never offered while riding.
        await ctx.page.waitForTimeout(900);
        await teleport(ctx.page, entrance.x, entrance.z, 0, 2.8);
        await ctx.page.keyboard.press("KeyM");
        const mounted = await ctx.page.waitForFunction(() => window.__INHAGAME_P0__.controller.mounted, null, { timeout: 6000 }).then(() => true, () => false);
        if (mounted) {
          await ctx.page.waitForTimeout(500);
          s = await state(ctx.page);
          assert.notEqual(s.action, "jeongseok-door");
          result.checks.mountedDoor = "PASS";
          await ctx.page.keyboard.press("KeyM");
        } else result.checks.mountedDoor = "UNKNOWN_MOUNT_UNAVAILABLE_AT_ENTRANCE";
      }
      assert.deepEqual(smoke.problems, [], `${viewport.label}: page problems`);
      result.status = "PASS"; console.log(`visual preview ${viewport.label}: PASS (no server-grant claim)`);
    } catch (error) {
      result.status = "FAIL"; result.error = error.stack || String(error); result.movementDiagnostic = report.lastMovement;
      try { const page = smoke.context.pages().at(-1); if (page) {
        result.diagnostic = await state(page);
        await page.screenshot({ path: path.join(output, `${viewport.label}-preview-failure.png`) });
      } } catch { /* preserve original failure */ }
    } finally { await smoke.close(); }
  }
  const failures = [...report.publicLobby, ...report.syntheticAuthority, ...report.viewports].filter(result => result.status === "FAIL");
  if (failures.length) throw new Error(`${failures.length} independent Jeongseok cases failed: ${failures.map(result => `${result.viewport}: ${result.error.split("\n")[0]}`).join("; ")}`);
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL"; report.error = error.stack || String(error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, "jeongseok-interior-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, head, publicLobby: report.publicLobby, syntheticAuthority: report.syntheticAuthority, viewports: report.viewports.map(v => ({ viewport: v.viewport, status: v.status, renderer: v.renderer, perf: v.perf })), error: report.error?.split("\n")[0] }, null, 2));
}
