import test from 'node:test';
import assert from 'node:assert/strict';
import { WALK_SHAPE, HUMAN_HEIGHT } from '../src/player-dimensions.js';
import { createDormShopInteraction, DORM_SHOP_ENTRY } from '../src/shop/dorm-shop-interaction.js';
import { DORM_1_LOBBY_OBSTACLES, DORM_1_LOBBY_SPAWN, DORM_1_LOBBY_EXIT, DORM_1_LOBBY_MY_ROOM, DORM_1_LOBBY_FRIEND_ROOM } from '../src/rooms/dorm1-lobby-layout.js';

const greeting = () => ({ show(view) { this.view = view; return true; }, close() { this.closed = true; } });
const ready = () => ({ space: 'ROOM_DORM1_LOBBY', position: { x: 0, z: 0.85 }, grounded: true, available: true, accountId: 'a', blocked: false });
test('dorm reception opens exact furniture shop via one shared F/mobile action', () => {
  let state = ready(); const opened = [];
  const dialogue = greeting();
  const entry = createDormShopInteraction({ dialogue, getState: () => state, openShop: id => { opened.push(id); return true; } });
  const action = entry.contextAction(); assert.equal(action.label, '윤가온 · 가구점'); assert.equal(action.trigger(), true);
  assert.equal(opened.length, 0, 'greeting does not open the shop automatically');
  assert.equal(dialogue.view.onBrowse(), true);
  assert.deepEqual(opened, ['shop.dorm_furniture']);
  state.space = 'ROOM_PERSONAL_BASIC'; assert.equal(action.trigger(), false, 'old callback cannot open from another room');
  assert.equal(entry.contextAction(), null);
});
test('dorm reception excludes guest, blocked, floating, far and behind-counter states', () => {
  let state = ready(); let opened = 0;
  const dialogue = greeting();
  const entry = createDormShopInteraction({ dialogue, getState: () => state, openShop: () => { opened++; return true; } });
  state.available = false; assert.equal(entry.contextAction().disabled, true); assert.equal(entry.contextAction().trigger(), false);
  for (const overrides of [{ blocked: true }, { grounded: false }, { position: { x: 5, z: 0.85 } }, { position: { x: 0, z: 1.8 } }]) {
    state = { ...ready(), ...overrides }; assert.equal(entry.contextAction(), null);
  }
  assert.equal(opened, 0);
});
test('reception approach is clear from lobby spawn and separate from doors', () => {
  for (let z = DORM_1_LOBBY_SPAWN.position.z; z <= DORM_SHOP_ENTRY.position.z; z += 0.05) {
    for (const box of DORM_1_LOBBY_OBSTACLES) {
      if (box.minY >= HUMAN_HEIGHT || box.maxY <= 0) continue;
      assert.ok(!(0 > box.minX - WALK_SHAPE.radius && 0 < box.maxX + WALK_SHAPE.radius && z > box.minZ - WALK_SHAPE.radius && z < box.maxZ + WALK_SHAPE.radius), `${box.id} blocks approach at ${z}`);
    }
  }
  for (const door of [DORM_1_LOBBY_EXIT, DORM_1_LOBBY_MY_ROOM, DORM_1_LOBBY_FRIEND_ROOM]) {
    assert.ok(Math.hypot(door.position.x, door.position.z - DORM_SHOP_ENTRY.position.z) > door.radius + DORM_SHOP_ENTRY.radius);
  }
});

test('main reads room-local coordinates despite the mirrored dorm root', async () => {
  const { readFileSync } = await import('node:fs');
  const { default: vm } = await import('node:vm');
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const body = source.match(/const dormShop = createDormShopInteraction\(\{[\s\S]*?getState: \(\) => \(\{([\s\S]*?)\}\),/)[1];
  const getState = vm.runInNewContext(`() => ({${body}})`, {
    rooms: { currentSpace: 'ROOM_DORM1_LOBBY', status: () => ({ busy: false }) },
    player: { getLocalPosition: () => ({ x: 0, z: .85 }), getPosition: () => ({ x: 0, z: -.85 }) },
    controller: { grounded: true, mounted: false }, shop: { accountId: 'a' }, online: { supabase: {} },
    shopPanel: { open: false }, seats: { isSeated: false }, combatRuntime: { active: false },
    lobbyWorld: { active: false }, lobbyTransition: { active: false }, inputFocus: { can: () => true }
  });
  const dialogue = greeting();
  const entry = createDormShopInteraction({ dialogue, getState, openShop: () => true });
  assert.equal(getState().position.z, .85);
  assert.equal(entry.contextAction().trigger(), true);
  assert.equal(dialogue.view.onBrowse(), true);
  assert.equal(entry.canAccess(), true);
});

for (const mode of ['legacy', 'split']) test(`dorm greeting uses existing ${mode} shop without bypassing gates`, () => {
  let state = ready(), currentMode = mode, opened = 0;
  const dialogue = greeting();
  const entry = createDormShopInteraction({ dialogue, getState: () => state, getMode: () => currentMode,
    openShop: id => { assert.equal(id, DORM_SHOP_ENTRY.shopId); opened++; return true; } });
  const action = entry.contextAction(); assert.equal(action.trigger(), true);
  assert.equal(entry.contextAction(), null); assert.equal(action.trigger(), false, 'one dialogue only');
  const browse = dialogue.view.onBrowse;
  state.blocked = true; // The dialogue itself owns the UI input gate.
  assert.equal(browse(), true); assert.equal(browse(), false); assert.equal(opened, 1);
  state.blocked = false;
  for (const unavailable of ['checking', 'unavailable', 'unknown']) {
    currentMode = unavailable; assert.equal(entry.contextAction(), null); assert.equal(action.trigger(), false);
  }
});

test('greeting closes on logout, room exit, new mount/seat and capability loss', () => {
  for (const change of [{ accountId: null, available: false }, { accountId: 'b' }, { space: 'campus' },
    { grounded: false }, { invalid: true }, { position: { x: 0, z: 2.7 } }, { position: { x: 7, z: 0 } }]) {
    let state = ready(), opened = 0;
    const dialogue = greeting();
    const entry = createDormShopInteraction({ dialogue, getState: () => state, openShop: () => { opened++; return true; } });
    entry.contextAction().trigger(); const browse = dialogue.view.onBrowse;
    state = { ...state, ...change }; entry.update();
    assert.equal(entry.open, false); assert.equal(browse(), false); assert.equal(opened, 0);
  }
});

test('account ABA and close/reopen invalidate retained greeting buttons', () => {
  let state = ready(), opened = 0;
  const dialogue = greeting();
  const entry = createDormShopInteraction({ dialogue, getState: () => state, openShop: () => { opened++; return true; } });
  entry.contextAction().trigger(); const old = dialogue.view;
  state.accountId = 'b'; entry.invalidate(); state.accountId = 'a'; entry.invalidate();
  entry.contextAction().trigger(); const latest = dialogue.view;
  assert.equal(old.onBrowse(), false); assert.equal(old.onClose(), false); assert.equal(entry.open, true);
  latest.onClose(); assert.equal(entry.open, false); assert.equal(latest.onBrowse(), false);
  entry.contextAction().trigger(); const removed = dialogue.view; entry.destroy();
  assert.equal(removed.onBrowse(), false); assert.equal(entry.contextAction(), null); assert.equal(entry.canAccess(), false);
  assert.equal(opened, 0);
});
