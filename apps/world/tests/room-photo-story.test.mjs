import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRoomPhotoStory } from '../src/rooms/room-photo-story.js';
import { createRoomHud } from '../src/rooms/room-hud.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '../src/input/input-focus-manager.js';
import { createPhotoMode } from '../src/photo/photo-mode.js';
import { createPhotoCameraController } from '../src/photo/photo-camera-controller.js';
import { createFakeCameraEntity } from './support/fake-camera.mjs';
import { createFakeDocument } from './support/fake-dom.mjs';
const walk = el => [el,...el.children.flatMap(walk)];
function fixture(overrides = {}) {
  const doc = createFakeDocument(); doc.body = doc.createElement('body');
  const create = doc.createElement;
  doc.createElement = tag => {
    const el = create(tag); el.remove = () => { el.parent.children = el.parent.children.filter(n => n !== el); el.parent = null; };
    Object.defineProperty(el, 'isConnected', { get: () => doc.body.contains(el) }); return el;
  };
  const win = { listeners: new Map(), addEventListener: doc.addEventListener, dispatch: doc.dispatch,
    removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(n => n !== fn)); } };
  const opener = doc.createElement('button'), canvas = doc.createElement('canvas'); doc.body.append(opener,canvas); opener.focus();
  const state = { active: true, roomId: 'room-a', ownerUserId: 'alice', accountId: 'alice', role: 'owner', ready: true, ...overrides };
  const focus = createInputFocusManager(), camera = createFakeCameraEntity(), rig = createPhotoCameraController({ camera });
  const orbit = { camera, yaw: 0, pitch: .3, distance: 3, firstPerson: false };
  const mode = createPhotoMode({ orbit, rig, inputFocus: focus, getPosition: () => ({ x: 0, y: 1, z: 0 }),
    getState: () => ({ world: state.active, space: 'ROOM_PERSONAL_BASIC', region: 'campus', grounded: state.grounded !== false,
      transitioning: state.busy, accountId: state.accountId }) });
  const edits = [], opened = [], messages = []; let editorSuccess = true, albumSuccess = true;
  const story = createRoomPhotoStory({ doc, win, inputFocus: focus, photoMode: mode, getContext: () => state, fallbackFocus: canvas,
    openEditor: options => { edits.push(options); return editorSuccess; },
    openAlbum: record => { opened.push(record.id); mode.close(); return albumSuccess; }, onStatus: text => messages.push(text) });
  const control = id => walk(story.root).find(el => el.dataset.roomStory === id);
  const press = id => { assert.ok(control(id), `control ${id} exists`); control(id).click(); };
  function toPhoto() { story.open(); if (story.status().stage === 'mood') press('study'); if (story.status().stage === 'layout') press('keep-layout'); if (story.status().stage === 'light') press('keep-light'); press('photo'); }
  return { doc, win, state, focus, mode, story, opener, canvas, edits, opened, messages, control, press, toPhoto,
    editorFails: () => { editorSuccess = false; }, albumFails: () => { albumSuccess = false; } };
}
test('owner guide connects chosen mood to the existing explicit editor completion and physical controls', () => {
  const h = fixture(); assert.equal(h.story.open(), true); assert.equal(h.focus.can('MOVE'), false);
  h.press('relax'); h.press('edit'); assert.equal(h.story.status().open, false); assert.equal(h.edits[0].recommendationStyle, 'relax');
  h.edits[0].onDone(); assert.equal(h.story.status().stage, 'light'); assert.equal(h.story.status().open, true);
  h.press('adjust-light'); assert.equal(h.story.status().stage, 'compose'); assert.equal(h.focus.can('MOVE'), true); assert.equal(h.messages.length, 1);
  h.story.open(); h.press('photo'); assert.equal(h.mode.active, true); assert.equal(h.focus.snapshot().topOwners[0], 'photo-mode');
});
test('keeping current layout and current light needs no editor mutation or automatic photo', () => {
  const h = fixture(); h.story.open(); h.press('study'); h.press('keep-layout'); h.press('keep-light');
  assert.equal(h.story.status().stage, 'compose'); assert.equal(h.edits.length, 0); assert.equal(h.mode.active, false);
});
test('successful local storage selects exact photo; completion waits for actual album image viewing', () => {
  const h = fixture(); h.toPhoto(); const token = h.story.ticket(), record = { id: 'this-photo' };
  assert.equal(h.story.captured(record, token), true); assert.equal(h.story.status().stage, 'album');
  h.mode.close(); h.story.open(); h.press('album'); assert.deepEqual(h.opened, ['this-photo']);
  assert.equal(h.story.status().stage, 'album', 'opening a route is not proof an image loaded');
  assert.equal(h.story.albumViewed({ id: 'another-photo' }), false);
  assert.equal(h.story.albumViewed(record), true); assert.equal(h.story.status().stage, 'done');
});
for (const overrides of [{ role: 'visitor', ownerUserId: 'bob' }, { accountId: null, role: 'owner' }]) {
  test(`visitor/guest cannot enter owner guide; existing generic PhotoMode remains available: ${JSON.stringify(overrides)}`, () => {
    const h = fixture(overrides); assert.equal(h.story.open(),false); assert.equal(h.story.status().active,false);
    assert.equal(h.story.status().open,false);assert.equal(h.edits.length,0);
    assert.equal(h.mode.open(),true);assert.equal(h.story.ticket(),null);
  });
}
for (const change of [{ accountId: 'bob' }, { roomId: 'room-b' }, { ownerUserId: 'bob' }, { role: 'visitor' }, { busy: true }, { active: false }]) {
  test(`scope change invalidates late capture and editor callbacks: ${JSON.stringify(change)}`, () => {
    const h = fixture(); h.story.open(); h.press('study'); h.press('edit'); const staleDone = h.edits[0].onDone;
    h.toPhoto(); const token = h.story.ticket(); Object.assign(h.state, change); h.story.update();
    assert.equal(h.story.captured({ id: 'late-photo' }, token), false); staleDone();
    assert.equal(h.story.status().savedPhotoId, null); assert.equal(h.story.status().open, false);
  });
}
test('cancelled photo, stale token and subsequent photo do not complete or duplicate the guide', () => {
  const h = fixture(); h.toPhoto(); const old = h.story.ticket(); h.mode.close();
  assert.equal(h.story.captured({ id: 'cancelled' }, old), false); assert.equal(h.story.status().stage, 'compose');
  h.story.open(); h.press('photo'); assert.notDeepEqual(h.story.ticket(), old);
  assert.equal(h.story.captured({ id: 'stale' }, old), false); assert.equal(h.story.status().savedPhotoId, null);
});
test('storage failure and failed album open stay retryable without a false completion', () => {
  const h = fixture(); h.toPhoto(); assert.equal(h.story.captured(null, h.story.ticket()), false);
  h.mode.close(); h.story.open(); assert.match(walk(h.story.root).map(el => el.textContent).join(' '), /앨범에 저장되지/);
  h.press('photo'); h.story.captured({ id: 'saved' }, h.story.ticket()); h.mode.close(); h.albumFails(); h.story.open(); h.press('album');
  assert.equal(h.story.status().stage, 'album'); assert.equal(h.story.status().open, true);
});
test('unrelated camera use and absent ticket cannot claim story completion', () => {
  const h = fixture(); h.story.update(); h.mode.open(); assert.equal(h.story.ticket(), null);
  assert.equal(h.story.captured({ id: 'unrelated' }, null), false); assert.equal(h.story.status().savedPhotoId, null);
});
test('blocked editor remains visible as disabled and can recover after the layout read', () => {
  const h = fixture({ ready: false }); h.story.open(); h.press('study'); assert.equal(h.control('edit').disabled, true);
  h.press('edit'); assert.equal(h.edits.length, 0); h.state.ready = true; h.story.update(); assert.equal(h.control('edit').disabled, false);
  h.editorFails(); h.press('edit'); assert.equal(h.story.status().open, true); assert.equal(h.story.status().stage, 'layout');
});
test('airborne camera entry explains its block and preserves the guide', () => {
  const h = fixture({ grounded: false }); h.toPhoto(); assert.equal(h.mode.active, false); assert.equal(h.story.status().open, true);
  assert.match(walk(h.story.root).map(el => el.textContent).join(' '), /착지한 뒤/);
});
test('guide keeps Tab within buttons, Escape restores focus and modal takeover does not steal focus', () => {
  const h = fixture(); h.story.open(); const first = h.control('close'), last = h.control('relax'); first.focus();
  h.story.root.dispatch('keydown', { key: 'Tab', shiftKey: true }); assert.equal(h.doc.activeElement, last);
  h.story.root.dispatch('keydown', { key: 'Tab' }); assert.equal(h.doc.activeElement, first);
  h.story.root.dispatch('keydown', { key: 'Escape' }); assert.equal(h.doc.activeElement, h.opener); assert.equal(h.focus.size, 0);
  h.story.open(); h.canvas.focus(); const other = h.focus.claim('system', INPUT_FOCUS_POLICY.SYSTEM_LOCK);
  assert.equal(h.story.status().open, false); assert.equal(h.doc.activeElement, h.canvas); assert.equal(h.focus.size, 1); h.focus.release(other);
});
test('BFCache pagehide clears progress/focus; stale DOM buttons cannot revive old room state', () => {
  const h = fixture(); h.story.open(); const oldButton = h.control('study'); h.press('relax');
  h.win.dispatch('pagehide', { persisted: true }); assert.equal(h.story.status().open, false); assert.equal(h.focus.size, 0);
  h.story.open(); oldButton.click(); assert.equal(h.story.status().stage, 'mood'); assert.equal(h.story.status().mood, null);
  h.story.destroy(); assert.equal(h.story.open(), false); assert.equal(h.focus.size, 0);
});
test('HUD reuses the owner room action rail and never offers the guide to visitors', () => {
  const h = fixture(), root = h.doc.createElement('section'); let stories = 0;
  const hud = createRoomHud({ root, doc: h.doc, onStory: () => stories++ });
  hud.update({ active: true, phase: 'READY', role: 'visitor' });
  const buttons = walk(root).filter(n => n.tagName === 'BUTTON'); assert.deepEqual(buttons.map(n => n.textContent), ['나가기']);
  hud.update({active:true,phase:'READY',role:'owner'});
  walk(root).find(n => n.textContent === '방의 한 장면').click(); assert.equal(stories,1);
});
test('integration preserves local-only metadata and exact image-loaded album completion', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const phone = await readFile(new URL('../src/phone/smartphone.js', import.meta.url), 'utf8');
  const story = await readFile(new URL('../src/rooms/room-photo-story.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(main, /roomStoryTicket: roomPhotoStory\?\.ticket\(\)/);
  assert.match(main, /onAlbumViewed: record => roomPhotoStory\?\.albumViewed\(record\)/);
  assert.match(phone, /at===uiEpoch&&!destroyed&&image.naturalWidth>0\)onAlbumViewed\(record\)/);
  assert.doesNotMatch(story, /fetch\(|\.rpc\(|localStorage|indexedDB|sendBeacon|save\(/);
  assert.match(css, /room-photo-story-card[^}]*max-height: calc\(100dvh - 32px\)[^}]*overflow-y: auto/s);
  assert.match(css, /room-photo-story button[^}]*min-height: 44px/s);
});
test('retained same-session buttons and repeated editor callbacks cannot rewind later steps', () => {
  const h = fixture(); h.story.open(); const oldMood=h.control('study'); h.press('relax');
  oldMood.click(); assert.equal(h.story.status().mood,'relax'); h.press('edit');
  h.edits[0].onDone();h.press('keep-light');h.edits[0].onDone();assert.equal(h.story.status().stage,'compose');
  h.story.destroy();h.story.update();assert.equal(h.story.status().active,false);
});
test('a second shot failure/cancel cannot inherit the first successfully saved photo', () => {
  const h = fixture(); h.toPhoto(); const first = h.story.ticket(); h.story.captured({id:'first'},first);
  assert.equal(h.story.status().stage,'album'); const second = h.story.ticket();
  assert.equal(h.story.status().stage,'compose');assert.equal(h.story.status().savedPhotoId,null);
  assert.equal(h.story.captured({id:'late-first'},first),false);
  assert.equal(h.story.captured(null,second),false);h.mode.close();h.story.open();
  assert.equal(h.control('album'),undefined);assert.equal(h.story.status().stage,'compose');
});
test('camera and editor handoffs never leave return focus on a hidden guide button', () => {
  const h=fixture();h.story.open();h.press('study');h.control('edit').focus();h.press('edit');
  assert.equal(h.doc.activeElement,h.opener,'editor can snapshot a visible return target');
  h.edits[0].onDone();h.press('keep-light');h.control('photo').focus();h.press('photo');
  assert.equal(h.story.root.contains(h.doc.activeElement),false,'photo panel never snapshots hidden guide controls');
});
test('owner capability loss hides the guide immediately and regained ownership starts a new run', () => {
  const h=fixture();h.story.open();h.press('study');const stale=h.control('edit');
  h.state.role='visitor';h.story.update();assert.equal(h.story.status().active,false);assert.equal(h.story.status().open,false);assert.equal(h.focus.size,0);
  assert.equal(h.story.open(),false);h.state.role='owner';h.story.open();stale.click();
  assert.equal(h.story.status().stage,'mood');assert.equal(h.edits.length,0);
  h.state.ownerUserId='bob';assert.equal(h.story.open(),false);assert.equal(h.story.status().active,false);
});
