import test from 'node:test';
import assert from 'node:assert/strict';
import { createCookingFeature } from '../src/rooms/cooking-feature.js';
import { createFakeDocument, FakeElement } from './support/fake-dom.mjs';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROOM = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', MUTATION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
FakeElement.prototype.querySelectorAll = function(selector) { return walk(this).slice(1).filter(n => n.tagName === selector.toUpperCase()); };
function rig({ actor = A, bound = actor } = {}) {
  const doc = createFakeDocument(); doc.body = doc.createElement('body');
  const h = { actor, reads: 0, cooks: 0, inventory: { accountId: bound, state: 'READY' } };
  h.refresh = async () => { h.inventory.state = 'READY'; return true; };
  h.inventory.refresh = async reason => { assert.equal(reason, 'cooking'); h.reads++; return h.refresh(); };
  h.feature = createCookingFeature({ doc, getUserId: () => h.actor, inventory: h.inventory, isAvailable: () => true,
    getRoomState: () => ({ accountId: h.actor, ownerUserId: h.actor, roomId: ROOM, space: 'ROOM_PERSONAL_BASIC',
      role: 'owner', ready: true, objects: [{ id: MUTATION, itemId: 'furniture.cooking_station', surface: 'floor', x: -6, z: 0, yaw: 0 }] }),
    getClient: () => ({ rpc: async (name, args) => {
      assert.equal(name, 'cook_my_world_recipe_v1'); h.cooks++;
      return { data: { status: 'SUCCESS', userId: h.actor, roomId: ROOM, requestId: args.p_request_id, recipeId: args.p_recipe_id,
        definitionVersion: 1, layoutRevision: 1, inventory: { status: 'SUCCESS', userId: h.actor, mutationId: MUTATION,
          mutationType: 'COOK', sourceType: 'CRAFTING', sourceRef: args.p_recipe_id, idempotencyKey: `recipe:${h.actor}:${args.p_request_id}`,
          entries: [{ direction: 'CONSUME', itemId: 'material.fish_carp', quantity: 1, quantityBefore: 2, quantityAfter: 1 },
            { direction: 'GRANT', itemId: 'consumable.grilled_carp', quantity: 1, quantityBefore: 0, quantityAfter: 1 }] } } };
    } }) });
  h.panel = doc.body.children[0]; h.button = text => walk(h.panel).find(n => n.tagName === 'BUTTON' && n.textContent === text);
  assert.equal(h.feature.handler(), true); return h;
}
test('assembled feature refuses actor B with Inventory still bound to A before any read', async () => {
  const h = rig({ actor: B, bound: A });
  assert.equal(await h.feature.client.cook(), true); assert.equal(h.reads, 0);
  assert.equal(h.feature.client.state().receipt.userId, B); assert.equal(h.feature.client.state().inventoryStatus, 'UNAVAILABLE');
  assert.equal(h.button('붕어구이 만들기').disabled, true); assert.equal(await h.feature.client.cook(), false); assert.equal(h.cooks, 1);
  assert.equal(await h.feature.client.retryInventory(), false); assert.equal(h.reads, 0);
  h.inventory.accountId = B; assert.equal(await h.feature.client.retryInventory(), true);
  assert.equal(h.button('붕어구이 만들기').disabled, false); assert.equal(h.cooks, 1);
});
test('assembled feature refuses Inventory account replacement while refresh is in flight', async () => {
  const h = rig(); let finish, entered;
  const refreshing = new Promise(resolve => { entered = resolve; });
  h.refresh = () => { entered(); return new Promise(resolve => { finish = resolve; }); };
  const cooking = h.feature.client.cook(); await refreshing;
  h.inventory.accountId = B; finish(true); assert.equal(await cooking, true);
  assert.equal(h.feature.client.state().receipt.status, 'SUCCESS'); assert.equal(h.feature.client.state().inventoryStatus, 'UNAVAILABLE');
  assert.equal(h.button('붕어구이 만들기').disabled, true); assert.equal(h.cooks, 1);
});
test('assembled feature discards old actor completion after authenticated actor changes during refresh', async () => {
  const h = rig(); let finish, entered;
  const refreshing = new Promise(resolve => { entered = resolve; });
  h.refresh = () => { entered(); return new Promise(resolve => { finish = resolve; }); };
  const cooking = h.feature.client.cook(); await refreshing;
  h.actor = B; h.inventory.accountId = B; finish(true);
  assert.equal(await cooking, false); assert.equal(h.feature.client.state().receipt, null);
  assert.equal(h.feature.client.state().inventoryStatus, 'IDLE'); assert.equal(h.feature.panel.open, false);
});
test('assembled feature treats refresh true with UNAVAILABLE state as unconfirmed and read-locks cooking', async () => {
  const h = rig(); h.refresh = async () => { h.inventory.state = 'UNAVAILABLE'; return true; };
  await h.feature.client.cook(); assert.equal(h.feature.client.state().inventoryStatus, 'UNAVAILABLE');
  assert.equal(h.button('붕어구이 만들기').disabled, true); assert.equal(await h.feature.client.cook(), false);
  assert.equal(h.cooks, 1);
});
test('assembled feature accepts only same-actor true READY and can recover from an unavailable read', async () => {
  const h = rig(); h.refresh = async () => { h.inventory.state = 'UNAVAILABLE'; return false; };
  await h.feature.client.cook(); assert.equal(h.feature.client.state().inventoryStatus, 'UNAVAILABLE');
  h.refresh = async () => { assert.equal(h.inventory.state, 'UNAVAILABLE'); h.inventory.state = 'READY'; return true; };
  assert.equal(await h.feature.client.retryInventory(), true); assert.equal(h.feature.client.state().inventoryStatus, 'READY');
  assert.equal(h.button('붕어구이 만들기').disabled, false); assert.equal(h.cooks, 1, 'no auto-cook after confirmation');
});
