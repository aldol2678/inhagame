import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ITEM_CATALOG, getItemDefinition, catalogAuthorityRow } from '../src/collection/item-catalog.js';
import { createInventoryPanel } from '../src/inventory/inventory-panel.js';
import { renderCollectionBook } from '../src/collection/collection-book-view.js';
import { createFakeDocument } from './support/fake-dom.mjs';
const icons = await import('../src/collection/item-icon.js').catch(() => ({}));
const ACTIVE8 = ['head.inha_cap','top.inha_basic','back.freshman_bag','badge.main_gate','head.induck_cap',
  'material.campus_leaf','material.fish_carp','material.artifact_fragment_01'];
const root = new URL('../assets/item-icons/active8-v1/', import.meta.url);
const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
const byClass = (node, name) => walk(node).filter(n => n.className.split(/\s+/).includes(name));
const images = node => walk(node).filter(n => n.tagName === 'IMG');
const row = (itemId, quantity = 1) => ({ itemId, quantity, catalogStatus:'ACTIVE', sourceType:'QUEST', acquiredAt:'2026-10-01T00:00:00Z' });

// Removing a catalog icon, changing an ID/path, or altering shipped pixels must fail this contract.
test('exact ACTIVE8 catalog entries bind versioned icons without changing grant authority', () => {
  assert.deepEqual(ITEM_CATALOG.filter(d => d.iconAssetId).map(d => d.itemId), ACTIVE8);
  assert.deepEqual(ITEM_CATALOG.filter(d => d.status === 'ACTIVE').map(d => d.itemId), ACTIVE8);
  for (const id of ACTIVE8) {
    const d = getItemDefinition(id);
    assert.equal(d.iconAssetId, `icon.${id}.v1`);
    assert.equal('iconAssetId' in catalogAuthorityRow(d), false);
  }
  for (const d of ITEM_CATALOG.filter(d => !ACTIVE8.includes(d.itemId))) assert.equal(d.iconAssetId, null);
});

test('all 32 committed RGBA exports exactly match reviewed source hashes, sizes and IDs', () => {
  assert.ok(existsSync(new URL('manifest.json', root)), 'source asset manifest is committed');
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root)));
  assert.deepEqual(manifest.items.map(d => d.itemId), ACTIVE8);
  for (const item of manifest.items) {
    assert.equal(item.proposedIconAssetId, getItemDefinition(item.itemId).iconAssetId);
    assert.deepEqual(item.exports.map(e => e.width), [32,64,128,256]);
    for (const entry of item.exports) {
      const bytes = readFileSync(new URL(entry.path, root));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.path);
      assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a');
      assert.equal(bytes.readUInt32BE(16), entry.width);
      assert.equal(bytes.readUInt32BE(20), entry.height);
      assert.equal(bytes[25], 6, 'PNG truecolor with alpha');
      assert.equal(entry.fullyTransparentBorder, true);
    }
  }
});

// A malformed/unknown icon must never become an arbitrary URL request.
test('icon resolver accepts only matching fixed catalog bindings and existing local files', () => {
  assert.equal(typeof icons.resolveItemIcon, 'function');
  for (const id of ACTIVE8) {
    const icon = icons.resolveItemIcon(getItemDefinition(id));
    assert.equal(icon.itemId, id);
    assert.ok(existsSync(new URL(icon.src)), id);
    assert.match(icon.src, new RegExp(`/assets/item-icons/active8-v1/png/64/${id.replaceAll('.', '\\.')}\\.png$`));
    assert.ok(icon.srcSet.includes('/png/128/'));
  }
  for (const def of [null, {itemId:'head.future'}, {itemId:'head.inha_cap',iconAssetId:'https://other.invalid/pixel'},
    {...getItemDefinition('head.inha_cap'),itemId:'head.future'},
    {...getItemDefinition('head.inha_cap'),iconAssetId:'icon.head.induck_cap.v1'}]) assert.equal(icons.resolveItemIcon(def), null);
});

test('icon loading/error keeps an accessible same-size fallback and never loops requests', () => {
  assert.equal(typeof icons.createItemIcon, 'function');
  const doc = createFakeDocument();
  const definition = getItemDefinition('material.fish_carp');
  const icon = icons.createItemIcon({doc, definition});
  assert.equal(icon.getAttribute('role'), 'img');
  assert.equal(icon.getAttribute('aria-label'), '붕어 아이콘');
  const img = images(icon)[0], fallback = byClass(icon, 'item-icon-fallback')[0];
  assert.equal(img.hidden, true);
  assert.equal(fallback.hidden, false);
  assert.equal(img.alt, '');
  img.dispatch('load');
  assert.equal(img.hidden, false);
  assert.equal(fallback.hidden, true);
  const src = img.src;
  img.dispatch('error'); img.dispatch('error'); img.dispatch('load');
  assert.equal(img.hidden, true);
  assert.equal(fallback.hidden, false);
  assert.equal(icon.dataset.state, 'unavailable');
  assert.equal(icon.getAttribute('aria-label'), '붕어 이미지 없음');
  assert.equal(img.src, src, 'no fallback URL retry loop');
  const unknown = icons.createItemIcon({doc, name:'head.future'});
  assert.equal(images(unknown).length, 0);
  assert.equal(unknown.getAttribute('aria-label'), 'head.future 이미지 없음');
});

test('inventory keeps server order/quantity and readable names when icons load or break', () => {
  const doc = createFakeDocument(), panel = doc.createElement('section');
  const rows = [...ACTIVE8.map((id, i) => row(id, i + 1)), row('head.future')];
  const inventory = { state:'READY', accountId:'synthetic', snapshot:{items:rows}, onChange() {}, refresh() {} };
  const ui = createInventoryPanel({doc, panel, inventory}); ui.setOpen(true);
  const cards = byClass(panel, 'inventory-item');
  assert.equal(cards.length, 9);
  assert.deepEqual(cards.map(c => c.dataset.itemId), rows.map(r => r.itemId));
  assert.equal(images(panel).length, 8);
  assert.equal(byClass(panel, 'item-icon').length, 9);
  images(panel).forEach(img => img.dispatch('error'));
  assert.deepEqual(byClass(panel, 'inventory-item-name').map(n => n.textContent), [...ACTIVE8.map(id => getItemDefinition(id).displayName), 'head.future']);
  assert.deepEqual(byClass(panel, 'inventory-item-quantity').map(n => n.textContent), rows.map(r => `보유 ${r.quantity}`));
  ui.setOpen(false); ui.setOpen(true);
  assert.equal(images(panel).length, 8, 'close/reopen rebuilds safely');
});

test('collection icons reveal only discovered fish and currently owned mementos', () => {
  const doc = createFakeDocument();
  const book = {state:'READY',accountId:'synthetic',snapshot:{discoveredCount:1,trackableCount:2,entries:[
    {key:'collection.fish.carp',state:'DISCOVERED',title:'붕어'},
    {key:'unrevealed:1',state:'UNKNOWN',title:'아직 발견하지 못한 기록'},
    {key:'collection.fish.carp',state:'UNKNOWN',title:'아직 발견하지 못한 기록'},
    {key:'collection.place.biryong_tower',state:'OWNER_DERIVED',title:'비룡탑'}]}};
  const inventory = {state:'READY',accountId:'synthetic',snapshot:{items:[row('badge.main_gate'),row('badge.mcm_2026_landlord')]}};
  const root = renderCollectionBook({doc,book,inventory,retry(){}}).element;
  assert.equal(images(root).length, 2);
  const entries = byClass(root, 'collection-book-entry');
  assert.equal(images(entries[0]).length, 1);
  for (const entry of entries.slice(1)) {
    assert.equal(images(entry).length, 0, 'unrevealed and owner-derived records never fetch a content icon');
    assert.equal(byClass(entry, 'item-icon').length, 0);
  }
  images(root).forEach(img => img.dispatch('error'));
  assert.ok(byClass(root, 'inventory-item-name').some(n => n.textContent === '정문 첫걸음 배지'));
});
