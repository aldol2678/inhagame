import test from 'node:test';
import assert from 'node:assert/strict';
import { SHOP_ROUTES, SHOP_ROUTE_IDS, routesForNpc, relatedShopRoutes } from '../src/shop/shop-routes.js';

test('five regions, split Student Center departments, no fabricated fishing/photo sale routes', () => {
  assert.equal(new Set(SHOP_ROUTES.map(route => route.region)).size, 5);
  assert.deepEqual(relatedShopRoutes('shop.student_center').map(route => route.label), ['기념품', '패션']);
  assert.equal(SHOP_ROUTE_IDS.length, 4);
  assert.equal(new Set(SHOP_ROUTE_IDS).size, 4);
  for (const region of ['inkyung', 'library']) {
    const route = SHOP_ROUTES.find(candidate => candidate.region === region);
    assert.equal(route.status, 'PLANNED'); assert.equal(route.shopId, null);
  }
  assert.deepEqual(relatedShopRoutes('shop.dorm_furniture'), [], 'no cross-campus remote shop selector');
  assert.ok(!SHOP_ROUTE_IDS.includes('shop.room_finishes'), 'locked finish catalog remains separate');
});

test('NPC role alone cannot bind trade; exact NPC, vendor and shop are required', () => {
  assert.deepEqual(routesForNpc('npc-a', [{ npcId: 'npc-a', role: 'shop_worker', shopId: 'shop.dorm_furniture' }]), []);
  assert.deepEqual(routesForNpc('npc-b', [{ npcId: 'npc-a', vendorId: 'vendor-a', shopId: 'shop.dorm_furniture' }]), []);
  const routes = routesForNpc('npc-a', [{ npcId: 'npc-a', vendorId: 'vendor-a', shopId: 'shop.dorm_furniture' }]);
  assert.deepEqual(routes.map(route => route.id), ['dorm_furniture']);
  assert.deepEqual(routesForNpc('npc-a', [{ npcId: 'npc-a', vendorId: 'vendor-a', shopId: 'shop.invented' }]), []);
});

test('main keeps direct NPC purchases separate from HUD/entrance guidance and closes invalid access', async () => {
  const { readFileSync } = await import('node:fs');
  const { default: vm } = await import('node:vm');
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /shopButton\?\.addEventListener\("click",[\s\S]*?shopEntry\.enter\(\)/);
  assert.match(source, /openPanel: \(\) => shopEntry\.enter\(/);
  assert.match(source, /studentCenterVendors: true/);
  assert.doesNotMatch(source, /getShopRoutes:/);
  const condition = source.match(/  if \(shopPanel.open && activeShopAccess &&[\s\S]*?shopPanel.setOpen\(false\);\n  \}/)[0];
  for (const cause of ['access', 'room', 'realm', 'lobby', 'transition', 'mount', 'combat']) {
    let closes = 0;
    vm.runInNewContext(condition, {
      shopPanel: { open: true, setOpen: open => { assert.equal(open, false); closes++; } },
      activeShopAccess: () => cause !== 'access', rooms: { status: () => ({ busy: cause === 'room' }) },
      biryongRealm: { busy: cause === 'realm' }, lobbyWorld: { active: cause === 'lobby' },
      lobbyTransition: { active: cause === 'transition' }, controller: { mounted: cause === 'mount' },
      combatRuntime: { active: cause === 'combat' }
    });
    assert.equal(closes, 1, cause);
  }
});
