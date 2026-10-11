// Offline browser integration, not full-world/real-renderer or physical-device acceptance.
// Uses the shared off-origin-blocking harness. Synthetic furniture RPCs never leave the page;
// album originals/thumbnails use the real browser's disposable, account-scoped IndexedDB.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { positionOnSurface, validateFurniture } from '../../src/rooms/furniture-layout.js';

process.env.WORLD_SMOKE_DISABLE_WEBGPU ??= '1'; // Fixture is deliberately 2D; no GPU feature needed.
const output = process.env.ROOM_PHOTO_STORY_QA_OUTPUT || 'test-results/room-photo-story';
await mkdir(output, { recursive: true });
const sourcePaths = ['styles.css', 'phone.css', 'src/rooms/room-photo-story.js', 'src/rooms/room-hud.js',
  'src/rooms/furniture-client.js', 'src/rooms/furniture-editor.js', 'src/rooms/furniture-recommendations.js',
  'src/rooms/furniture-layout.js', 'src/rooms/personal-room-environment.js', 'src/photo/photo-mode.js',
  'src/photo/photo-camera-controller.js', 'src/photo/photo-input.js', 'src/photo/photo-capture.js',
  'src/photo/photo-mode-panel.js', 'src/phone/smartphone.js', 'src/phone/phone-album.js',
  'tests/browser/room-photo-story-harness.html', 'tests/browser/room-photo-story-fixture.mjs'];
const report = { status: 'RUNNING', head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceHashes: {}, cases: [], screenshots: [], downloads: [],
  scope: 'Production guide/editor/environment/photo/smartphone controllers and real local album. Synthetic accounts, RPCs, camera transform and 2D scene.',
  limits: ['No production service, remote furniture save, authenticated account or external upload is exercised.',
    'Touch is desktop Chromium emulation, not a physical device; safe-area cutouts are not emulated.',
    'BFCache coverage dispatches persisted pagehide/pageshow events; it does not prove browser BFCache eligibility/restoration.',
    'Synthetic position jumps approach the real environment controls; real room rendering, seating, walking and collision need separate acceptance.'] };
for (const path of sourcePaths) report.sourceHashes[path] = createHash('sha256')
  .update(await readFile(new URL(`../../${path}`, import.meta.url))).digest('hex');
if (process.env.ROOM_PHOTO_STORY_HEAD_SHA) assert.equal(report.head, process.env.ROOM_PHOTO_STORY_HEAD_SHA, 'requested checkout head');

const snap = page => page.evaluate(() => window.__ROOM_STORY_QA__.snapshot());
const coarse = new WeakMap();
const activate = (page, locator) => coarse.get(page) ? locator.tap() : locator.click();
const press = (page, id) => activate(page, page.locator(`[data-room-story="${id}"]`));
const saves = value => value.calls.filter(call => call.name === 'save_my_room_furniture_v1');
async function load(smoke, role = 'owner') {
  const page = await smoke.context.newPage(); smoke.watch(page);
  await page.goto(`${smoke.origin}/tests/browser/room-photo-story-harness.html?role=${role}`);
  await page.waitForFunction(() => window.__ROOM_STORY_QA__?.ready || window.__ROOM_STORY_QA__?.error);
  assert.equal(await page.evaluate(() => window.__ROOM_STORY_QA__.error ?? null), null);
  coarse.set(page, await page.evaluate(() => matchMedia('(pointer: coarse)').matches));
  const served = await page.evaluate(async paths => Object.fromEntries(await Promise.all(paths.map(async path => {
    const response = await fetch(`/${path}`); if (!response.ok) throw Error(`Missing source: ${path}`);
    const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
    return [path, Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('')];
  }))), sourcePaths);
  assert.deepEqual(served, report.sourceHashes, 'the browser received the current candidate sources');
  return page;
}
async function screenshot(page, name) {
  await page.screenshot({ path: `${output}/${name}.png` }); report.screenshots.push(`${name}.png`);
}
async function guideFits(page, label, viewport) {
  const card = page.locator('.room-photo-story-card');
  assert.equal(await card.isVisible(), true, `${label}: guide visible`);
  const box = await card.boundingBox();
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + .5 && box.y + box.height <= viewport.height + .5,
    `${label}: guide fits viewport: ${JSON.stringify(box)}`);
  const overflow = await card.evaluate(node => ({ card: node.scrollWidth > node.clientWidth + 1,
    document: document.documentElement.scrollWidth > innerWidth + 1 }));
  assert.deepEqual(overflow, { card: false, document: false }, `${label}: no horizontal overflow`);
  const buttons = card.locator('button');
  for (let i = 0; i < await buttons.count(); i++) {
    const button = buttons.nth(i); await button.scrollIntoViewIfNeeded();
    const rect = await button.boundingBox();
    assert.ok(rect.height >= 44 && rect.width >= 44, `${label}: 44px minimum button target`);
    assert.ok(rect.x >= box.x && rect.x + rect.width <= box.x + box.width + .5 && rect.y >= box.y && rect.y + rect.height <= box.y + box.height + .5,
      `${label}: every guide button can be scrolled into view`);
  }
  await card.evaluate(node => { node.scrollTop = 0; });
}
async function enterPhoto(page) {
  await page.locator('.room-hud-story').click();
  let stage = (await snap(page)).story.stage;
  if (stage === 'mood') { await press(page, 'study'); stage = 'layout'; }
  if (stage === 'layout') { await press(page, 'keep-layout'); stage = 'light'; }
  if (stage === 'light') await press(page, 'keep-light');
  await press(page, 'photo');
  await page.waitForFunction(() => window.__ROOM_STORY_QA__.photo.active);
}
function validManualMove(value) {
  for (const object of value.furniture.objects) {
    for (const [label, dx, dz] of [['→', .25, 0], ['←', -.25, 0], ['↑', 0, .25], ['↓', 0, -.25]]) {
      const patch = positionOnSurface(object.surface, object.x + dx, object.z + dz, object.yaw);
      if (patch.x === object.x && patch.z === object.z) continue;
      const next = value.furniture.objects.map(row => row.id === object.id ? { ...row, ...patch } : row);
      if (!validateFurniture(next, value.owned)) return { id: object.id, label, next };
    }
  }
  throw Error('Synthetic recommendation has no valid one-step manual move');
}
async function ownerEditor(page, choice, outcome, viewport) {
  await activate(page, page.locator('.room-hud-story')); await press(page, choice);
  if (viewport) await guideFits(page, 'layout', viewport);
  await press(page, 'edit');
  const before = await snap(page), inventory = structuredClone(before.owned);
  assert.equal(before.story.open, false); assert.equal(before.story.mood, choice);
  assert.equal(before.furniture.editing, true); assert.ok(before.furniture.objects.length > 0);
  assert.equal(saves(before).length, 0, 'owned recommendation is a draft, never automatic save');
  assert.equal(await page.locator(`[data-focus="recommend-${choice}"]`).getAttribute('aria-pressed'), 'true');
  assert.equal(validateFurniture(before.furniture.objects, inventory), null, 'preview uses only owned quantities and valid placements');
  const move = validManualMove(before);
  await page.locator('[data-focus="selection"]').selectOption(move.id);
  await page.getByRole('button', { name: `가구 이동 ${move.label}`, exact: true }).click();
  assert.deepEqual((await snap(page)).furniture.objects, move.next, 'existing manual editor changes the preview');
  assert.equal(saves(await snap(page)).length, 0);
  if (outcome === 'save') {
    await page.locator('#furniture-editor').getByRole('button', { name: '저장', exact: true }).click();
    await page.waitForFunction(() => !window.__ROOM_STORY_QA__.client.state().dirty && !window.__ROOM_STORY_QA__.client.state().pending);
    const saved = await snap(page); assert.equal(saves(saved).length, 1); assert.deepEqual(saved.stored.objects, move.next);
    await page.getByRole('button', { name: '완료 · 빛과 구도로', exact: true }).click();
  } else {
    await page.getByRole('button', { name: '완료 · 빛과 구도로', exact: true }).click();
    assert.equal((await snap(page)).story.stage, 'layout', 'dirty completion still requires the existing explicit decision');
    await page.getByRole('button', { name: '계속 꾸미기', exact: true }).click();
    assert.equal((await snap(page)).furniture.editing, true);
    await page.getByRole('button', { name: '완료 · 빛과 구도로', exact: true }).click();
    await page.getByRole('button', { name: '변경 버리고 닫기', exact: true }).click();
    const discarded = await snap(page); assert.equal(saves(discarded).length, 0);
    assert.deepEqual(discarded.furniture.objects, []); assert.deepEqual(discarded.stored.objects, []);
  }
  assert.equal((await snap(page)).story.stage, 'light'); assert.equal((await snap(page)).story.open, true);
  assert.deepEqual((await snap(page)).owned, inventory, 'guide/editor never consume or grant inventory');
}
async function seedDecoy(page) {
  return page.evaluate(async () => {
    const q = window.__ROOM_STORY_QA__;
    const blob = await new Promise(resolve => document.getElementById('application').toBlob(resolve, 'image/png'));
    return (await q.phone.capture({ blob }, { ...q.phone.captureContext(), capturedAtReal: '2099-01-01T00:00:00.000Z', locationName: '합성 최신 사진 (이번 촬영 아님)' })).id;
  });
}
async function captureShot(page, name) {
  const [download] = await Promise.all([page.waitForEvent('download'), activate(page, page.locator('[data-photo-control="capture"]'))]);
  await download.saveAs(`${output}/${name}.png`);
  assert.equal(await download.failure(), null);
  await page.waitForFunction(() => !window.__ROOM_STORY_QA__.panel.status().busy);
  const bytes = await readFile(`${output}/${name}.png`);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const result = { file: `${name}.png`, sha256, bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  report.downloads.push(result); return result;
}
async function ownerFlow(smoke, name, viewport) {
  const page = await load(smoke), entry = { name: `${name}: owner story`, checks: [] }; report.cases.push(entry);
  try {
    const decoyId = await seedDecoy(page);
    await page.locator('.room-hud-story').click(); await guideFits(page, 'mood', viewport);
    await screenshot(page, `${name}-mood`);
    // Modal keyboard containment, close and resume are real DOM events.
    const first = page.locator('#room-photo-story button').first(), last = page.locator('#room-photo-story button').last();
    await last.focus(); await page.keyboard.press('Tab'); assert.equal(await first.evaluate(node => node === document.activeElement), true);
    await first.focus(); await page.keyboard.press('Shift+Tab'); assert.equal(await last.evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Escape'); assert.equal((await snap(page)).story.open, false);
    await ownerEditor(page, 'study', 'save', viewport); await guideFits(page, 'light', viewport);
    entry.checks.push('mood → owned recommendation → manual move → explicit existing save → done; guide focus trap and resume');

    await press(page, 'adjust-light'); assert.equal((await snap(page)).story.stage, 'compose');
    assert.deepEqual((await snap(page)).focus.topOwners, []);
    await page.locator('#qa-light').click(); await page.locator('#qa-action').click();
    assert.equal((await snap(page)).environment.lightsOn, false);
    await page.locator('#qa-curtain').click(); await page.locator('#qa-action').click();
    assert.equal((await snap(page)).environment.curtainsOpen, false);
    await page.locator('.room-hud-story').click(); await guideFits(page, 'compose', viewport);
    await screenshot(page, `${name}-compose`); await press(page, 'photo');
    assert.equal((await snap(page)).photo, true); assert.deepEqual((await snap(page)).focus.topOwners, ['photo-mode']);
    const png = await captureShot(page, `${name}-exact-shot`);
    assert.equal(png.width, viewport.width); assert.equal(png.height, viewport.height);
    const captured = await snap(page), exactId = captured.story.savedPhotoId;
    assert.ok(exactId && exactId !== decoyId); assert.equal(captured.story.stage, 'album');
    assert.equal(captured.completions.at(-1).accepted, true);
    assert.equal(await page.evaluate(id => window.__ROOM_STORY_QA__.story.albumViewed({ id }), decoyId), false);
    await activate(page, page.locator('[data-photo-control="close"]'));
    assert.equal(await page.evaluate(() => {
      const active = document.activeElement;
      return !!active?.isConnected && active.getClientRects().length > 0 && !active.closest('#room-photo-story') && !active.closest('.photo-mode');
    }), true, 'photo close restores a live world/HUD focus target outside the hidden guide');
    await page.locator('.room-hud-story').click();
    await guideFits(page, 'album', viewport); await press(page, 'album');
    await page.waitForFunction(() => window.__ROOM_STORY_QA__.story.status().stage === 'done' && document.querySelector('.smartphone-photo')?.naturalWidth > 0);
    const viewed = await snap(page);
    assert.equal(viewed.phone.current.photoId, exactId, 'open the captured record, even with a newer decoy in the album');
    assert.ok(viewed.viewed.includes(exactId)); assert.equal(viewed.viewed.includes(decoyId), false);
    const image = await page.locator('.smartphone-photo').evaluate(async node => ({ width: node.naturalWidth, height: node.naturalHeight,
      sha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await (await fetch(node.src)).arrayBuffer())), n => n.toString(16).padStart(2, '0')).join('') }));
    assert.deepEqual(image, { width: png.width, height: png.height, sha256: png.sha256 }, 'album viewer displays the exact original PNG bytes');
    await screenshot(page, `${name}-album-exact-shot`);
    await page.getByRole('button', { name: '뒤로', exact: true }).click();
    assert.equal((await snap(page)).phone.current.appId, 'album'); assert.equal((await snap(page)).phone.current.photoId, undefined);
    await page.getByRole('button', { name: '스마트폰 닫기', exact: true }).click();
    await page.locator('.room-hud-story').click(); await guideFits(page, 'done', viewport);
    entry.checks.push('physical-control authority toggles session light/curtain; real PNG download and local album match byte-for-byte; exact loaded image completes guide; Back retains album list');
    const beforeCalls = saves(await snap(page)).length;
    await press(page, 'close');
    await page.evaluate(() => window.__ROOM_STORY_QA__.changeScope({ roomId: window.__ROOM_STORY_QA__.ROOM_B }));
    assert.equal((await snap(page)).environment.lightsOn, true); assert.equal((await snap(page)).environment.curtainsOpen, true);
    assert.equal((await snap(page)).story.savedPhotoId, null); assert.equal(saves(await snap(page)).length, beforeCalls);
    entry.checks.push('room change resets guide/light/curtain without a furniture save'); entry.status = 'PASS';
  } finally { await page.close(); }
}
async function discardAndRoles(smoke, name, viewport) {
  const owner = await load(smoke); try { await ownerEditor(owner, 'relax', 'discard', viewport); await guideFits(owner, 'discard → light', viewport); }
  finally { await owner.close(); }
  for (const role of ['guest', 'visitor']) {
    const page = await load(smoke, role);
    try {
      assert.equal(await page.locator('.room-hud-story').count(), 0, `${role}: no owner guide entry`);
      assert.equal(await page.evaluate(() => window.__ROOM_STORY_QA__.story.open()), false, `${role}: direct guide entry is denied`);
      assert.equal((await snap(page)).story.open, false);
      assert.equal(await page.locator('[data-room-story="edit"]').count(), 0);
      assert.equal(await page.locator('[data-room-story="layout"]').count(), 0);
      assert.equal(await page.evaluate(() => window.__ROOM_STORY_QA__.editor.openEditor()), false, 'client refuses non-owner edits too');
      await page.locator('#application').focus(); await page.keyboard.press('KeyP');
      assert.equal((await snap(page)).photo, true, 'the existing generic camera remains available');
      await page.locator('[data-photo-control="close"]').click(); assert.equal((await snap(page)).story.savedPhotoId, null);
      assert.equal(saves(await snap(page)).length, 0);
    } finally { await page.close(); }
  }
  report.cases.push({ name: `${name}: discard and roles`, status: 'PASS', checks: ['explicit dirty-discard uses existing confirmation; guest/visitor cannot open the owner-only guide or editor; existing generic camera stays available'] });
}
async function staleCompletion(smoke, cause) {
  const page = await load(smoke), entry = { name: `stale completion: ${cause}`, checks: [] }; report.cases.push(entry);
  try {
    // Retain a real editor continuation, then close the editor without completing the guide.
    await page.locator('.room-hud-story').click(); await press(page, 'study'); await press(page, 'edit');
    await page.locator('#furniture-editor').getByRole('button', { name: '닫기', exact: true }).click();
    await page.getByRole('button', { name: '변경 버리고 닫기', exact: true }).click();
    await enterPhoto(page);
    await page.evaluate(() => window.__ROOM_STORY_QA__.holdCaptureCompletion());
    await page.locator('[data-photo-control="capture"]').click();
    await page.waitForFunction(() => window.__ROOM_STORY_QA__.snapshot().captureHeld);
    const capturedCount = (await snap(page)).captures.length;
    if (cause === 'cancel') await page.locator('[data-photo-control="close"]').click();
    else if (cause === 'account') await page.evaluate(() => window.__ROOM_STORY_QA__.changeScope({ accountId: window.__ROOM_STORY_QA__.USER_B, ownerUserId: window.__ROOM_STORY_QA__.USER_B }));
    else if (cause === 'room') await page.evaluate(() => window.__ROOM_STORY_QA__.changeScope({ roomId: window.__ROOM_STORY_QA__.ROOM_B }));
    else await page.evaluate(() => window.__ROOM_STORY_QA__.simulateBfcache());
    await page.evaluate(() => window.__ROOM_STORY_QA__.releaseCaptureCompletion());
    await page.waitForFunction(() => window.__ROOM_STORY_QA__.snapshot().completions.length > 0);
    let value = await snap(page);
    assert.equal(value.completions.at(-1).accepted, false); assert.equal(value.story.savedPhotoId, null);
    assert.equal(value.story.open, false); assert.equal(value.phone.open, false); assert.equal(value.photo, false);
    assert.equal(value.captures.length, capturedCount); assert.equal(saves(value).length, 0);
    if (cause !== 'cancel') {
      await page.evaluate(() => window.__ROOM_STORY_QA__.callEditorCompletion()); value = await snap(page);
      assert.equal(value.story.open, false); assert.notEqual(value.story.stage, 'done');
    }
    if (cause === 'account') assert.deepEqual(await page.evaluate(() => window.__ROOM_STORY_QA__.phone.album.list()), [], 'prior account photo is not visible in new account');
    await enterPhoto(page); assert.equal((await snap(page)).photo, true, 'a fresh attempt remains available');
    await page.locator('[data-photo-control="close"]').click();
    assert.deepEqual((await snap(page)).focus.topOwners, []);
    entry.checks.push('a genuinely saved local-photo callback arriving late cannot advance/open stale guide or album',
      'fresh photo entry recovers without a focus leak'); entry.status = 'PASS';
  } finally { await page.close(); }
}
async function bfcacheDraft(smoke) {
  const page = await load(smoke);
  try {
    await page.locator('.room-hud-story').click(); await press(page, 'relax'); await press(page, 'edit');
    const recommendation = (await snap(page)).furniture.objects;
    const move = validManualMove(await snap(page));
    await page.locator('[data-focus="selection"]').selectOption(move.id);
    await page.getByRole('button', { name: `가구 이동 ${move.label}`, exact: true }).click();
    const before = await snap(page);
    assert.equal(before.furniture.dirty, true); assert.equal(await page.locator('[data-focus="undo"]').isEnabled(), true);
    await page.evaluate(() => window.__ROOM_STORY_QA__.simulateBfcache());
    await page.evaluate(() => window.__ROOM_STORY_QA__.callEditorCompletion());
    const resumed = await snap(page);
    assert.deepEqual(resumed.furniture, before.furniture, 'persisted lifecycle keeps the exact unsaved furniture draft');
    assert.equal(await page.evaluate(() => window.__ROOM_STORY_QA__.editor.guided), false);
    assert.equal(await page.locator('#furniture-editor').getByRole('button', { name: '완료', exact: true }).isVisible(), true);
    assert.equal(resumed.story.open, false); assert.equal(resumed.story.savedPhotoId, null);
    assert.deepEqual(resumed.focus.topOwners, ['furniture-editor'], 'the preserved editor keeps input ownership');
    await page.locator('[data-focus="undo"]').click(); assert.deepEqual((await snap(page)).furniture.objects, recommendation);
    await page.locator('[data-focus="redo"]').click(); assert.deepEqual((await snap(page)).furniture.objects, before.furniture.objects);
    assert.equal(saves(await snap(page)).length, 0);
    await page.getByRole('button', { name: '완료', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '계속 꾸미기', exact: true }).isVisible(), true);
    await page.getByRole('button', { name: '변경 버리고 닫기', exact: true }).click();
    assert.equal((await snap(page)).story.open, false, 'ordinary completion cannot resurrect the detached guide');
    report.cases.push({ name: 'persisted BFCache editor draft', status: 'PASS',
      checks: ['persisted lifecycle detaches only guide continuation; exact draft, undo/redo and editor input ownership survive; ordinary completion cannot reopen stale guide'] });
  } finally { await page.close(); }
}

let activeSmoke = null, started = false;
try {
  // Dynamic import ensures dependency/launcher failure produces a BLOCKED report, not a false PASS.
  const { startSmoke } = await import('./harness.mjs');
  for (const [name, viewport, mobile] of [
    ['desktop', { width: 1280, height: 720 }, false],
    ['portrait', { width: 390, height: 844 }, true],
    ['landscape', { width: 844, height: 390 }, true]
  ]) {
    activeSmoke = await startSmoke({ viewport, contextOptions: { isMobile: mobile, hasTouch: mobile, acceptDownloads: true } }); started = true;
    await ownerFlow(activeSmoke, name, viewport); await discardAndRoles(activeSmoke, name, viewport);
    if (!mobile) {
      for (const cause of ['cancel', 'account', 'room', 'bfcache-events']) await staleCompletion(activeSmoke, cause);
      await bfcacheDraft(activeSmoke);
    }
    assert.deepEqual(activeSmoke.problems, []); await activeSmoke.close(); activeSmoke = null;
  }
  report.status = 'PASS'; console.log('PASS: offline room photo story UI/lifecycle/local-album integration (see report limits).');
} catch (error) {
  report.status = started ? 'FAIL' : 'BLOCKED'; report.error = String(error.stack ?? error);
  console.error(`${report.status}: ${report.error}`); process.exitCode = 1;
} finally {
  await activeSmoke?.close(); await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
}
