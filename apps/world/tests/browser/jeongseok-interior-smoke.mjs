// JSL-B Jeongseok 1F/B1 interior browser QA: the real /campus/ boot, real Room Transition, real
// PlayCanvas scenes, native keyboard / touch input. Offline (harness.mjs): supabase-js is stubbed,
// so no account, database or production call exists; the interior runs in the local
// VISUAL_PREVIEW mode (?jeongseok=jsl-b on a preview host). This is NOT server-protected access QA
// (JSL-A is a separate PR) and emulated mobile viewports are NOT physical-device results.
//
//   npm ci --prefix apps/world/tests/browser
//   EXPECTED_JSL_B_HEAD=$(git rev-parse HEAD) WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/jeongseok-interior-smoke.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

const output = path.resolve(process.env.JSL_B_QA_OUTPUT || "test-results/jeongseok-interior");
await mkdir(output, { recursive: true });
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (process.env.EXPECTED_JSL_B_HEAD) assert.equal(head, process.env.EXPECTED_JSL_B_HEAD, "browser must test the exact candidate head");
const STEP_TIMEOUT_MS = 45_000;
const LOBBY = "ROOM_JEONGSEOK_LOBBY", READING = "ROOM_JEONGSEOK_B1_READING", CREATIVE = "ROOM_JEONGSEOK_B1_CREATIVE";
const report = { head, scope: "Offline Chromium, VISUAL_PREVIEW_LOCAL_ONLY entry, emulated mobile viewports; not physical devices, not server access",
  startedAt: new Date().toISOString(), environment: {}, closedMode: null, viewports: [], screenshots: [], status: "RUNNING" };
const viewports = [
  { label: "desktop", width: 1280, height: 720, mobile: false },
  { label: "portrait", width: 390, height: 844, mobile: true },
  { label: "landscape", width: 844, height: 390, mobile: true }
];

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
    input: d.controller.inputEnabled, zone: document.getElementById("zone")?.textContent ?? null,
    placeZone: d.getStatus().placeZone ?? null, rootChildren: d.app.root.children.length, interior: j,
    phone: d.smartphone?.shell?.state ?? null, mounted: d.controller.mounted };
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
// Native movement: held key on desktop, a trusted CDP touch drag on the joystick on mobile.
async function move(ctx, viewport, { key = "KeyW", dx = 0, dy = -40, ms = 1400 } = {}) {
  const before = await state(ctx.page);
  if (!viewport.mobile) {
    await ctx.page.keyboard.down(key);
    await ctx.page.waitForTimeout(ms);
    await ctx.page.keyboard.up(key);
  } else {
    const cdp = await ctx.page.context().newCDPSession(ctx.page);
    const rect = await ctx.page.locator("#joystick").boundingBox();
    assert.ok(rect, "joystick visible on mobile");
    const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy, id: 7 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx + dx, y: cy + dy, id: 7 }] });
    await ctx.page.waitForTimeout(ms);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  }
  await ctx.page.waitForTimeout(200);
  const after = await state(ctx.page);
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
  // 1. Default mode (no QA flag): closed, no door, no programmatic entry.
  {
    const smoke = await startSmoke({ viewport: { width: 1280, height: 720 } });
    try {
      const ctx = await boot(smoke, "");
      const entrance = await ctx.page.evaluate(async () => (await import("/src/jeongseok/interior-rooms.js")).JEONGSEOK_ENTRANCE.position);
      await teleport(ctx.page, entrance.x, entrance.z, 0, 2.8);
      await ctx.page.waitForTimeout(1200);
      const s = await state(ctx.page);
      const programmatic = await ctx.page.evaluate(() => window.__INHAGAME_P0__.rooms.enter("ROOM_JEONGSEOK_LOBBY", { entranceId: "JEONGSEOK_ENTRANCE" }));
      assert.notEqual(s.action, "jeongseok-door"); assert.equal(programmatic, false);
      assert.equal(s.interior.policy.mode, "CLOSED_PENDING_JSL_A");
      assert.equal(await ctx.page.evaluate(() => typeof window.__INHAGAME_JEONGSEOK_INTERIOR__.failNextBuild), "undefined", "no QA hooks outside preview");
      report.closedMode = { status: "PASS", action: s.action, programmaticEnter: programmatic, mode: s.interior.policy.mode, renderer: ctx.renderer };
      assert.deepEqual(smoke.problems, []);
    } finally { await smoke.close(); }
  }

  for (const viewport of viewports) {
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
      const { entrance, campusReturn, lobbyPortals, readingLink } = await ctx.page.evaluate(async () => {
        const m = await import("/src/jeongseok/interior-rooms.js");
        return { entrance: m.JEONGSEOK_ENTRANCE.position, campusReturn: m.JEONGSEOK_CAMPUS_RETURN.position,
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

      // 3. Walk north through a gate lane with native input; flaps are visual only.
      await ctx.page.waitForTimeout(900);
      const walk = await move(ctx, viewport, { ms: 1800 });
      assert.ok(walk.moved > 0.3, `native movement in the lobby (${walk.moved})`);
      result.checks.lobbyMovement = { status: "PASS", moved: walk.moved, from: walk.before.position, to: walk.after.position };
      result.checks.flapAngles = await ctx.page.evaluate(() => window.__INHAGAME_JEONGSEOK_INTERIOR__.activeFlapAngles());
      assertCameraInside(walk.after, SHELLS[LOBBY], "lobby walk");

      // 4. Collision: push into the information desk and a wall; never through, never below the floor.
      await teleport(ctx.page, -6.0, 1.4, 180);
      await ctx.page.waitForTimeout(500);
      const desk = await move(ctx, viewport, { ms: 1400 });
      assert.ok(desk.after.position.z > 0.3 + 0.2, `desk blocks (z=${desk.after.position.z})`);
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
      assert.ok(Math.hypot(s.position.x - 5.5, s.position.z - 5.5) < 0.2, "lands at the Creative Space transfer in the lobby");
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

        // 10. Account change while in B1 → straight back to campus.
        await teleport(ctx.page, lobbyPortals[1].position.x, lobbyPortals[1].position.z - 0.3, 0);
        await useAction(ctx, viewport, { id: "jeongseok-portal", label: /Creative/, space: CREATIVE });
        await ctx.page.evaluate(() => window.__INHAGAME_JEONGSEOK_INTERIOR__.simulateAccountChange("qa-account-b"));
        await waitFor(ctx, () => window.__INHAGAME_P0__.rooms.currentSpace === "campus" && !window.__INHAGAME_P0__.rooms.status().busy, null, "forced exit");
        s = await state(ctx.page);
        assert.ok(Math.hypot(s.position.x - campusReturn.x, s.position.z - campusReturn.z) < 0.3);
        assert.equal(s.interior.stats.forcedExits, 1);
        result.checks.accountChangeForcedExit = "PASS";

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
      result.status = "PASS";
    } catch (error) {
      result.status = "FAIL"; result.error = error.stack || String(error);
      throw error;
    } finally { await smoke.close(); }
  }
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL"; report.error = error.stack || String(error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, "jeongseok-interior-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, head, viewports: report.viewports.map(v => ({ viewport: v.viewport, status: v.status, renderer: v.renderer, perf: v.perf })), error: report.error?.split("\n")[0] }, null, 2));
}
