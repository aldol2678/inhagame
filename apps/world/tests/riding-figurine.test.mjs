import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RIDING_FIGURINE_VISUAL as visual } from '../src/rooms/riding-figurine-assets.js';
import { FURNITURE_VISUALS, furnitureVisualForItem, requireFurnitureVisual } from '../src/rooms/furniture-visual-assets.js';
import { getItemDefinition, DEFAULT_ITEM_IDS } from '../src/collection/item-catalog.js';
import { FURNITURE_BY_ID, firstFurniturePosition, validateFurniture } from '../src/rooms/furniture-layout.js';
import { furnitureShopCategory } from '../src/shop/furniture-shop-categories.js';
import { validateFurniturePayload } from '../src/rooms/furniture-glb-contract.js';
const id=visual.itemId;
test('R5 is a distinct unique shop collectible with bounded floor/desk geometry',()=>{
 const item=getItemDefinition(id), geometry=FURNITURE_BY_ID.get(id);
 assert.equal(item.category,'FURNITURE');assert.equal(item.ownershipPolicy,'UNIQUE');
 assert.deepEqual(item.acquisition,[{source:'SHOP'}]);assert.equal(DEFAULT_ITEM_IDS.includes(id),false);
 assert.equal(furnitureShopCategory(id),'decor');
 assert.deepEqual([geometry.width,geometry.height,geometry.depth],[.32,.42,.34]);
 for(const surface of ['floor','desk']){
  const row=firstFurniturePosition(id,surface,[],[{itemId:id,quantity:1}]);
  assert.ok(row);assert.equal(validateFurniture([row],[{itemId:id,quantity:1}]),null);
  assert.equal(validateFurniture([row],[]),'ITEM_NOT_OWNED');
 }
 assert.ok(visual.min[0]>=-geometry.width/2&&visual.max[0]<=geometry.width/2);
 assert.ok(visual.min[1]>=0&&visual.max[1]<=geometry.height);
 assert.ok(visual.min[2]>=-geometry.depth/2&&visual.max[2]<=geometry.depth/2);
});
test('R5 pending private delivery cannot accidentally activate a sold fallback-only object',()=>{
 assert.ok(FURNITURE_VISUALS.includes(visual));assert.equal(visual.enabled,false);
 assert.equal(furnitureVisualForItem(id),null);assert.throws(()=>requireFurnitureVisual(visual),/UNTRUSTED/);
 assert.ok(Object.isFrozen(visual)&&Object.isFrozen(visual.min)&&Object.isFrozen(visual.max));
 assert.equal(visual.url,`/api/brand-asset?asset=${visual.version}-${visual.sha256.slice(0,12)}.glb`);
 assert.deepEqual([visual.triangles,visual.primitives,visual.materials],[124350,52,11]);
});
test('R5 uses the existing preview and owned-room loader rather than a shop-only asset path',()=>{
 const room=readFileSync(new URL('../src/rooms/personal-room-renderer.js',import.meta.url),'utf8');
 const shop=readFileSync(new URL('../src/shop/furniture-shop-preview.js',import.meta.url),'utf8');
 assert.match(room,/createFurnitureLayer\(app,root\)/);assert.match(shop,/createFurnitureLayer\(app, root/);
 const render=readFileSync(new URL('../src/rooms/furniture-renderer.js',import.meta.url),'utf8');
 assert.match(render,/figurine_plinth/);assert.match(render,/induck_rider/);
});
test('optional private pinned R5 delivery passes the unchanged strict GLB validator', {skip:!process.env.RIDING_FIGURINE_GLB},async()=>{
 const b=readFileSync(process.env.RIDING_FIGURINE_GLB);
 assert.deepEqual(await validateFurniturePayload(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),visual),{triangles:124350,primitives:52,materials:11});
 const bad=b.slice();bad[bad.length-1]^=1;
 await assert.rejects(validateFurniturePayload(bad.buffer.slice(bad.byteOffset,bad.byteOffset+bad.byteLength),visual),/HASH_MISMATCH/);
});

test('candidate indoor budget reports draw/triangle cost without treating outdoor limits as approval',async()=>{
 const {personalRoomAssetDiagnostics}=await import('../src/rooms/personal-room-asset-budget.js');
 const result=personalRoomAssetDiagnostics([],{fixedVisuals:[visual]});
 assert.equal(result.scope,'personal-room-only');assert.equal(result.physicalGpuValidated,false);
 assert.ok(JSON.stringify(result).includes('124350'));
});
