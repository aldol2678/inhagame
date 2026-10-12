import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDocument } from './support/fake-dom.mjs';
import { BIRYONG_PUBLIC_ACCESS_ENABLED } from '../src/biryong/biryong-access-policy.js';
import { createBiryongRealmTransition } from '../src/biryong/biryong-realm-transition.js';
import { createBackgateTransitPanel } from '../src/transit/backgate-transit-panel.js';
import { BACKGATE_TRANSIT } from '../src/transit/backgate-transit-layout.js';
import { bindResumeEntry, enterResume } from '../src/lobby/lobby-resume.js';

test('Biryong public release is held and both fresh entry and saved-region resume fail closed', () => {
  assert.equal(BIRYONG_PUBLIC_ACCESS_ENABLED, false);
  const effects = [];
  const world = {
    leaveCampus: () => effects.push('leave'),
    showBiryong: () => effects.push('show'),
    placePlayer: () => effects.push('place')
  };
  const region = createBiryongRealmTransition({ world, campusReturnAnchor: { x: 0, y: 1.15, z: 0 } });
  assert.equal(region.enter(), false);
  const record = { version: 2, regionId: 'BIRYONG_REALM', x: 0, y: 1.15, z: 75, yawDeg: 0, cameraYaw: 0, savedAt: 10000 };
  assert.equal(region.resume(record), false);
  assert.equal(region.inCampus, true);
  assert.deepEqual(effects, []);
  assert.deepEqual(region.status().stats, { enters: 0, exits: 0 });
});

test('Biryong stop stays informational, with disabled boarding on desktop and touch', () => {
  assert.equal(BACKGATE_TRANSIT.gameStatus, 'COMING_SOON');
  const doc = createFakeDocument();
  const panel = doc.createElement('section');
  let calls = 0;
  const ui = createBackgateTransitPanel({ panel, doc, onBoard: () => { calls++; return true; } });
  assert.equal(ui.setOpen(true), true);
  const button = panel.children[3].children[2];
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, '출시 준비 중');
  assert.equal(ui.status().boardingEnabled, false);
  assert.equal(ui.status().gameStatus, 'COMING_SOON');
  assert.match(panel.children[4].textContent, /캠퍼스 안정화 이후 공개 예정/);
  button.click();
  assert.equal(calls, 0);
  assert.equal(ui.open, true);
  ui.destroy();
});

test('last-location Biryong record is not cleared, but the lobby offers no bypass', () => {
  const record = { version: 2, regionId: 'BIRYONG_REALM', x: 0, y: 1.15, z: 75, yawDeg: 0, savedAt: 10000 };
  const button = { hidden: false };
  const entry = bindResumeEntry({ button, resume: { state: 'VALID', record } });
  assert.equal(button.hidden, true);
  assert.equal(entry.available, false);
  assert.equal(entry.start(), false);
  assert.equal(record.regionId, 'BIRYONG_REALM');
  assert.equal(enterResume({
    player: {}, orbit: {}, lobbyWorld: { active: true }, record,
    regionTransition: { resume: () => { throw Error('must not be called'); } }
  }), false);
});
