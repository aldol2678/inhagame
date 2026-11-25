// Continuous play journey against a local static build. Usage: node journey.cjs <profile> <port> <outdir>
const fs = require('fs'), path = require('path');
const { open, status, boot, devices } = require('./lib.cjs');
const [profile = 'pc', port = '8021', outDir = '.'] = process.argv.slice(2);
const PROFILES = {
  pc: { context: { viewport: { width: 1280, height: 720 } }, touch: false },
  android: { context: { ...devices['Pixel 7'] }, touch: true },
  'android-landscape': { context: { ...devices['Pixel 7 landscape'] }, touch: true },
  ipad: { context: { ...devices['iPad Pro 11 landscape'] }, touch: true },
  'ipad-portrait': { context: { ...devices['iPad Pro 11'] }, touch: true }
};
const P = PROFILES[profile];
const quality = process.env.QUALITY ?? 'very_low';
fs.mkdirSync(outDir, { recursive: true });
const rows = [];
const rec = (step, ok, data) => { rows.push({ step, ok, data }); console.log((ok ? 'PASS ' : 'FAIL ') + step + ' ' + JSON.stringify(data ?? {}).slice(0, 700)); };
const pos = page => page.evaluate(() => { const p = window.__INHAGAME_P0__.player.getLocalPosition(); return { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) }; });
const ctl = page => page.evaluate(() => { const c = window.__INHAGAME_P0__.controller; return { mounted: c.mounted, mountId: c.mountId, grounded: c.grounded, landing: c.landing, inputEnabled: c.inputEnabled, hud: c.hudState }; });
const face = (page, x, z) => page.evaluate(([x, z]) => { const P0 = window.__INHAGAME_P0__, p = P0.player.getLocalPosition(); P0.orbit.yaw = Math.atan2(-(x - p.x), z - p.z); }, [x, z]);
const teleport = (page, x, z) => page.evaluate(async ([x, z]) => {
  const { roadviewGroundHeight } = await import('/src/roadview-layout.js');
  const P0 = window.__INHAGAME_P0__; P0.player.setLocalPosition(x, 1.15 + roadviewGroundHeight(x, z), z); P0.controller.velocityY = 0;
}, [x, z]);
// Trusted multi-touch through CDP so pointer capture behaves as on a device.
const touches = new Map(); let cdp = null;
async function touch(page, id, point) {
  cdp ??= await page.context().newCDPSession(page);
  const had = touches.has(id);
  if (point) touches.set(id, point); else touches.delete(id);
  const type = point ? (had ? 'touchMove' : 'touchStart') : (touches.size ? 'touchMove' : 'touchEnd');
  if (!point && touches.size) { // release one finger while others stay down
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [...touches].map(([id, p]) => ({ id, x: p.x, y: p.y })) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...touches].map(([id, p]) => ({ id, x: p.x, y: p.y })) });
    return;
  }
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...touches].map(([id, p]) => ({ id, x: p.x, y: p.y })) });
}
async function hold(page, dir, on) {
  if (!P.touch) return on ? page.keyboard.down(dir === 'fwd' ? 'KeyW' : 'KeyS') : page.keyboard.up(dir === 'fwd' ? 'KeyW' : 'KeyS');
  const box = await page.locator('#joystick').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  if (!on) return touch(page, 1, null);
  await touch(page, 1, { x: cx, y: cy });
  for (const f of [0.3, 0.6, 0.9]) await touch(page, 1, { x: cx, y: cy + (dir === 'fwd' ? -1 : 1) * box.height * 0.5 * f });
}
async function walkUntil(page, target, pred, { timeout = 150000, dir = 'fwd', label = '' } = {}) {
  const t0 = Date.now(), trace = [];
  await hold(page, dir, true);
  let ok = false;
  try {
    while (Date.now() - t0 < timeout) {
      if (target && dir === 'fwd') await face(page, target.x, target.z);
      await page.waitForTimeout(700);
      const p = await pos(page); trace.push(p);
      if (await pred(p)) { ok = true; break; }
    }
  } finally { await hold(page, dir, false); }
  return { ok, ms: Date.now() - t0, first: trace[0], last: trace.at(-1), samples: trace.length, trace };
}
const press = async (page, key, sel) => P.touch ? page.locator(sel).tap({ timeout: 15000 }) : page.keyboard.press(key);
(async () => {
  const { browser, ctx, page, log, origin } = await open({ port: +port, context: P.context });
  await ctx.addInitScript(q => { try { if (q && !localStorage.getItem('__qa_q')) { localStorage.setItem('__qa_q', '1'); localStorage.setItem('inha-world-graphics-quality-v1', q); } } catch {} }, quality === 'auto' ? '' : quality);
  const shot = name => page.screenshot({ path: path.join(outDir, profile + '-' + name + '.png') }).catch(e => console.log('shot failed', e.message));
  try {
    const b = await boot(page, origin);
    let s = await status(page);
    rec('A1 boot READY', b.recovery.state === 'READY', { ms: b.ms, renderer: s.renderer, tier: s.graphics.tier, pref: s.graphics.preference, reason: s.graphics.autoReason, lobby: s.lobby.active, model: s.lobbyPlayer?.modelState });
    await page.locator('#world-loading').waitFor({ state: 'hidden', timeout: 60000 });
    await shot('01-lobby');
    rec('A2 lobby quest card', s.lobbyQuest?.source === 'FIRST_TOUR', s.lobbyQuest);
    await (P.touch ? page.locator('#main-gate-start').tap() : page.locator('#main-gate-start').click());
    await page.locator('#world-lobby').waitFor({ state: 'hidden', timeout: 60000 });
    await page.waitForFunction(() => { const s = window.__INHAGAME_P0__.getStatus(); return !s.lobby.active && !s.lobbyTransition.active && window.__INHAGAME_P0__.controller.inputEnabled; }, null, { timeout: 60000 });
    const p0 = await pos(page); s = await status(page);
    rec('B1 main gate entry', Math.hypot(p0.x, p0.z + 98) < 3 && s.placeZone === 'AREA_MAIN_GATE', { p0, zone: s.placeZone, tour: s.tourStage, hud: s.movementHud });
    await shot('02-entered');
    if (P.touch) rec('B2 touch controls visible', await page.locator('#joystick').isVisible() && await page.locator('#jump').isVisible(), { joystick: await page.locator('#joystick').boundingBox(), jump: await page.locator('#jump').boundingBox(), viewport: page.viewportSize() });
    // C: walk through the gate (real input)
    let w = await walkUntil(page, { x: 0, z: -70 }, async () => (await status(page)).tourStage >= 1);
    rec('C1 walk through main gate → tour 1/2', w.ok, { ms: w.ms, first: w.first, last: w.last, speed: +(Math.hypot(w.last.x - w.first.x, w.last.z - w.first.z) / (w.ms / 1000)).toFixed(2) });
    await shot('03-gate-passed');
    // D: main hall stairs
    const stair = await page.evaluate(async () => {
      const { MAIN_HALL_APPROACH: t } = await import('/src/main-hall-approach.js');
      const { MAIN_ENTRANCE } = await import('/src/basic-campus.js');
      const mid = t.frame.length / 2;
      return { foot: t.frame.at(mid, t.landing + t.run + 3), top: t.frame.at(mid, 0.5), height: t.height, entrance: { x: MAIN_ENTRANCE.x, z: MAIN_ENTRANCE.z } };
    });
    await teleport(page, stair.foot.x, stair.foot.z);
    await page.waitForTimeout(1500);
    const foot = await pos(page);
    w = await walkUntil(page, stair.top, async p => Math.hypot(p.x - stair.top.x, p.z - stair.top.z) < 0.9, { timeout: 120000 });
    const ys = w.trace.map(p => p.y), maxDrop = Math.max(0, ...ys.slice(1).map((y, i) => ys[i] - y));
    rec('D1 climb main hall stairs', w.ok && Math.abs(w.last.y - (1.15 + stair.height)) < 0.06 && maxDrop < 0.05, { foot, last: w.last, expectedTopY: 1.15 + stair.height, maxDrop, ys: [...new Set(ys)].slice(0, 20), ms: w.ms });
    await shot('04-stairs-top');
    s = await status(page);
    rec('D2 quest tour complete 2/2', s.tourStage === 2, { tour: s.tourStage, zone: s.placeZone, hud: await page.locator('#quest-hud').innerText().catch(() => null) });
    w = await walkUntil(page, stair.foot, async p => Math.hypot(p.x - stair.foot.x, p.z - stair.foot.z) < 1.2, { timeout: 120000 });
    rec('D3 descend stairs to ground', w.ok && Math.abs(w.last.y - 1.15) < 0.06, { last: w.last, ms: w.ms });
    // F: NPC dialogue (Inkyung daily student)
    let npc = await page.evaluate(() => window.__INHAGAME_INKYUNG_DAILY__.status());
    const a = npc.actors.call;
    await teleport(page, a.x - 1.0, a.z - 0.6);
    await page.waitForFunction(() => window.__INHAGAME_INKYUNG_DAILY__.status().ready || window.__INHAGAME_INKYUNG_DAILY__.status().failed, null, { timeout: 90000 }).catch(() => {});
    npc = await page.evaluate(() => window.__INHAGAME_INKYUNG_DAILY__.status());
    rec('F1 NPC assets load near Inkyung pond', npc.ready && !npc.failed && npc.visible, { ready: npc.ready, failed: npc.failed, visible: npc.visible, at: await pos(page) });
    await page.waitForFunction(() => window.__INHAGAME_P0__.getStatus().contextAction?.id?.startsWith('inkyung-daily-'), null, { timeout: 30000 }).catch(() => {});
    s = await status(page);
    rec('F2 talk prompt offered', String(s.contextAction).startsWith('inkyung-daily-'), { contextAction: s.contextAction, button: await page.locator('#context-action').innerText().catch(() => null) });
    await shot('05-npc-prompt');
    await press(page, 'KeyF', '#context-action');
    await page.locator('#inkyung-daily-panel, [id^="inkyung-daily"][role="dialog"]').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
    npc = await page.evaluate(() => window.__INHAGAME_INKYUNG_DAILY__.status());
    const panelText = await page.evaluate(() => { const c = document.getElementById('inkyung-daily-close'); const p = c?.parentElement; return p && !p.hidden ? p.innerText : null; });
    rec('F3 dialogue opens with line', !!(npc.activeTalk || npc.pendingTalk) && !!panelText, { activeTalk: npc.activeTalk, pendingTalk: npc.pendingTalk, panelText });
    await shot('06-npc-dialogue');
    const before = await pos(page);
    await hold(page, 'fwd', true); await page.waitForTimeout(1500); await hold(page, 'fwd', false);
    const during = await pos(page);
    rec('F4 movement locked while talking', Math.hypot(during.x - before.x, during.z - before.z) < 0.05, { before, during });
    await (P.touch ? page.locator('#inkyung-daily-close').tap() : page.keyboard.press('Escape'));
    await page.waitForFunction(() => !window.__INHAGAME_INKYUNG_DAILY__.status().activeTalk && !window.__INHAGAME_INKYUNG_DAILY__.status().pendingTalk, null, { timeout: 20000 }).catch(() => {});
    npc = await page.evaluate(() => window.__INHAGAME_INKYUNG_DAILY__.status());
    s = await status(page);
    rec('F5 dialogue closes and input returns', !npc.activeTalk && !npc.pendingTalk && s.inputFocus?.topOwners?.length === 0, { activeTalk: npc.activeTalk, inputFocus: s.inputFocus });
    // G: Annyongi (dragon) mount / flight / landing / dismount on the open main-gate plaza
    await teleport(page, 0, -70); await page.waitForTimeout(1500);
    s = await status(page);
    rec('G0 mount offered on open ground', s.transportAction === 'mount' && await page.locator('#transport-action').isVisible(), { transportAction: s.transportAction, button: await page.locator('#transport-action').innerText().catch(() => null) });
    await press(page, 'KeyM', '#transport-action');
    await page.waitForFunction(() => window.__INHAGAME_P0__.controller.mounted, null, { timeout: 15000 }).catch(() => {});
    let c = await ctl(page);
    rec('G1 Annyongi mounted', c.mounted && /dragon|annyong/i.test(String(c.mountId)), { ...c, body: await page.evaluate(() => ({ ...document.body.dataset })) });
    await shot('07-mounted');
    await press(page, 'KeyM', '#transport-action');
    await page.waitForFunction(() => !window.__INHAGAME_P0__.controller.mounted, null, { timeout: 15000 }).catch(() => {});
    c = await ctl(page);
    rec('G1b ground dismount', !c.mounted && c.mountId == null && c.hud === 'WALK', c);
    await page.waitForTimeout(600);
    await press(page, 'KeyM', '#transport-action');
    await page.waitForFunction(() => window.__INHAGAME_P0__.controller.mounted, null, { timeout: 15000 }).catch(() => {});
    const g0 = await pos(page);
    if (P.touch) { const j = await page.locator('#jump').boundingBox(); await touch(page, 2, { x: j.x + j.width / 2, y: j.y + j.height / 2 }); }
    else await page.keyboard.down('Space');
    await face(page, 0, -40); await hold(page, 'fwd', true); await page.waitForTimeout(6000);
    if (P.touch) { touches.clear(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    else { await hold(page, 'fwd', false); await page.keyboard.up('Space'); }
    const g1 = await pos(page); c = await ctl(page);
    rec('G2 flight ascends and travels', g1.y - g0.y > 0.5 && Math.hypot(g1.x - g0.x, g1.z - g0.z) > 0.5 && c.hud === 'MOUNT_FLIGHT', { g0, g1, ...c, descendVisible: await page.locator('#descend').isVisible().catch(() => null) });
    await shot('08-flight');
    await press(page, 'KeyM', '#transport-action');
    await page.waitForTimeout(400);
    const landingState = await ctl(page);
    await page.waitForFunction(() => { const c = window.__INHAGAME_P0__.controller; return c.grounded && !c.landing; }, null, { timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(800);
    c = await ctl(page); const g3 = await pos(page);
    const ground = await page.evaluate(async ([x, z]) => (await import('/src/roadview-layout.js')).roadviewGroundHeight(x, z), [g3.x, g3.z]);
    rec('G3 landing from flight ends on the ground, dismounted', landingState.landing === true && !c.mounted && c.grounded && c.hud === 'WALK' && Math.abs(g3.y - 1.15 - ground) < 0.06, { landingState, g3, ground, ...c });
    w = await walkUntil(page, { x: g3.x, z: g3.z + 6 }, async p => Math.hypot(p.x - g3.x, p.z - g3.z) > 1.5, { timeout: 30000 });
    rec('G5 walking works after dismount', w.ok, { last: w.last, ms: w.ms });
    await shot('09-dismounted');
    // H: local save and reconnect
    await page.waitForTimeout(3500);
    const saved = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => /resume|tour|quest/i.test(k)).map(k => [k, localStorage.getItem(k)])));
    const here = await pos(page);
    const record = JSON.parse(saved['inhagame-world-resume-v1:guest'] ?? 'null');
    rec('H1 position saved locally', !!record && Math.hypot(record.x - here.x, record.z - here.z) < 1.5, { saved, here });
    const sessionBefore = await page.evaluate(() => localStorage.getItem('inhaworld-guest-session-v1'));
    const b2 = await boot(page, origin);
    await page.locator('#world-loading').waitFor({ state: 'hidden', timeout: 60000 });
    s = await status(page);
    const resumeVisible = await page.locator('#resume-last-location').isVisible();
    rec('H2 reconnect shows resume and keeps quest/session', b2.recovery.state === 'READY' && resumeVisible && s.resume.state === 'VALID' && s.tourStage === 2,
      { ms: b2.ms, resume: s.resume, tour: s.tourStage, lobbyQuest: s.lobbyQuest, resumeText: resumeVisible ? await page.locator('#resume-last-location').innerText() : null });
    const sessionAfter = await page.evaluate(() => localStorage.getItem('inhaworld-guest-session-v1'));
    rec('H2b [auth] guest session id survives reload', sessionBefore === sessionAfter, { sessionBefore, sessionAfter });
    await shot('10-reconnect-lobby');
    await (P.touch ? page.locator('#resume-last-location').tap() : page.locator('#resume-last-location').click());
    await page.locator('#world-lobby').waitFor({ state: 'hidden', timeout: 60000 });
    await page.waitForFunction(() => { const s = window.__INHAGAME_P0__.getStatus(); return !s.lobby.active && !s.lobbyTransition.active && window.__INHAGAME_P0__.controller.inputEnabled; }, null, { timeout: 60000 });
    const back = await pos(page);
    rec('H3 resume restores saved position', Math.hypot(back.x - record.x, back.z - record.z) < 0.5 && Math.abs(back.y - record.y) < 0.4, { back, record });
    w = await walkUntil(page, { x: back.x, z: back.z + 6 }, async p => Math.hypot(p.x - back.x, p.z - back.z) > 1.5, { timeout: 30000 });
    rec('H4 controls work after resume', w.ok, { last: w.last });
    await shot('11-resumed');
    // I: graphics context loss and recovery
    const size = b => b.length;
    const beforeBytes = size(await page.screenshot());
    await page.evaluate(() => { window.__qaExt = window.__INHAGAME_P0__.app.graphicsDevice.gl.getExtension('WEBGL_lose_context'); window.__qaExt.loseContext(); });
    await page.waitForTimeout(6500);
    const notice = await page.evaluate(() => { const n = document.getElementById('graphics-recovery-notice'); return n && !n.hidden ? n.innerText : null; });
    const lostBytes = size(await page.screenshot({ path: path.join(outDir, profile + '-12-context-lost.png') }));
    rec('I1 player is told when graphics are lost', !!notice, { notice, lostBytes, beforeBytes, diagnostics: await page.evaluate(() => window.__INHA_WORLD_RUNTIME_DIAGNOSTICS__.status().recentErrors) });
    await page.evaluate(() => window.__qaExt.restoreContext());
    await page.waitForTimeout(6000);
    await page.evaluate(() => { window.__INHAGAME_P0__.orbit.yaw += 1.2; });
    await page.waitForTimeout(2000);
    const restoredBytes = size(await page.screenshot({ path: path.join(outDir, profile + '-13-context-restored.png') }));
    const noticeAfter = await page.evaluate(() => { const n = document.getElementById('graphics-recovery-notice'); return n && !n.hidden ? n.innerText : null; });
    const after = await pos(page);
    w = await walkUntil(page, null, async p => Math.hypot(p.x - after.x, p.z - after.z) > 1.0, { timeout: 30000 });
    rec('I2 context restore resumes rendering and play', restoredBytes > 1.5 * lostBytes && w.ok && !noticeAfter, { restoredBytes, lostBytes, walked: w.ok, noticeAfter, lost: await page.evaluate(() => window.__INHAGAME_P0__.app.graphicsDevice.gl.isContextLost()) });
  } catch (e) { rec('EXCEPTION', false, { message: e.message.slice(0, 500) }); await shot('99-exception'); }
  fs.writeFileSync(path.join(outDir, profile + '-journey.json'), JSON.stringify({ profile, quality, rows, log }, null, 1));
  console.log('LOG', JSON.stringify(log).slice(0, 1500));
  await browser.close();
})();
