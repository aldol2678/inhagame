import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DORM_SHOP_VENDOR as vendor } from '../src/shop/dorm-shop-vendor.js';
import { DORM_1_LOBBY_FURNITURE, DORM_1_LOBBY_OBSTACLES } from '../src/rooms/dorm1-lobby-layout.js';
import { canOccupy } from '../src/world-collision.js';
import { WALK_SHAPE, PLAYER_ORIGIN_Y } from '../src/player-dimensions.js';

test('shopkeeper is a fictional room-only identity distinct from all 48 campus people', () => {
  const raw = ['data/repaired/INKYUNG-20-A-R1.json', 'data/expansion/CAMPUS-28-P2A.json'].map(path =>
    readFileSync(new URL(`../npc-factory/${path}`, import.meta.url), 'utf8'));
  for (const text of raw) { assert.ok(!text.includes(vendor.name)); assert.ok(!text.includes(vendor.npcId)); }
  assert.equal(vendor.space, 'ROOM_DORM1_LOBBY'); assert.equal(vendor.shopId, 'shop.dorm_furniture');
  assert.equal(vendor.appearance.accessory, 'apron'); assert.equal(vendor.heading, 180);
});

test('vendor stands behind the counter with a body collision, leaving benches and doors alone', () => {
  const desk = DORM_1_LOBBY_FURNITURE.find(item => item.id === 'reception');
  assert.ok(vendor.position.z - vendor.bodyRadius > desk.at[2] + desk.size[2] / 2);
  assert.equal(canOccupy({ ...vendor.position, y: PLAYER_ORIGIN_Y }, WALK_SHAPE, DORM_1_LOBBY_OBSTACLES), false);
  assert.equal(canOccupy({ x: 0, y: PLAYER_ORIGIN_Y, z: .85 }, WALK_SHAPE, DORM_1_LOBBY_OBSTACLES), true);
  for (const bench of DORM_1_LOBBY_FURNITURE.filter(item => item.kind === 'bench')) {
    const approach = { x: bench.at[0], y: PLAYER_ORIGIN_Y, z: bench.at[2] - bench.size[2] / 2 - WALK_SHAPE.radius - .1 };
    assert.equal(canOccupy(approach, WALK_SHAPE, DORM_1_LOBBY_OBSTACLES), true);
    assert.ok(Math.hypot(bench.at[0] - vendor.position.x, bench.at[2] - vendor.position.z) > 4);
  }
});

test('main has one shared desk trigger, immediate account/focus invalidation and room/page cleanup', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.equal((main.match(/const dormShop = createDormShopInteraction/g) ?? []).length, 1);
  assert.equal((main.match(/contextActions.set\("dorm-furniture-shop"/g) ?? []).length, 2, 'same keyed slot: frame update and synchronous focus restoration');
  assert.match(main, /if \(shop.shopId === "shop.dorm_furniture"\) refreshDormShopAction\(\)/);
  assert.match(main, /change.reason === "account"\) dormShop.invalidate\(\)/);
  assert.match(main, /dormShop.open && snapshot.topOwners.some/);
  assert.match(main, /closePanels: \(\) => \{\s+dormShop.cancel\(\)/);
  assert.match(main, /dormShop.destroy\(\); dorm1Lobby.shopVendor.destroy\(\)/);
  assert.match(main, /photoMode.update\(\);\s+dormShop.update\(\)/);
});

// Same monitor dimensions as the production desk renderer. Front approach / QA camera rays
// to the head must pass beside the screen, not directly through its .42-unit silhouette.
test('shopkeeper face is offset clear of the reception monitor from front approaches', () => {
  const monitor={x:.45,z:1.9,width:.42};
  for(const camera of [{x:0,z:-1.9},{x:1.8,z:-1.9},{x:-.8,z:-1.9},{x:0,z:.85}]){
    const t=(monitor.z-camera.z)/(vendor.position.z-camera.z);
    const faceX=camera.x+(vendor.position.x-camera.x)*t;
    assert.ok(Math.abs(faceX-monitor.x)>monitor.width/2+.08,`face ray from ${JSON.stringify(camera)} clears monitor`);
  }
});
