import assert from 'node:assert/strict';

// Keep expected assets independent of scene output: a missing loader must fail this gate.
export const EXPECTED_ROOM_LOADS = [
  {url:'/assets/rooms/personal-v2/fixed-chair-oak-linen.glb',type:'container'},
  {url:'/assets/kaykit/furniture-bits/table_medium.gltf',type:'container'},
  {url:'/assets/kaykit/furniture-bits/lamp_standing.gltf',type:'container'},
  {url:'/assets/kaykit/furniture-bits/shelf_B_large_decorated.gltf',type:'container'},
  {url:'/assets/rooms/personal-v2/WoodFloor051_Color_1K_Q30.webp',type:'texture'}
];
const modelNames=['personal_chair_oak_linen','personal_reading_table_kaykit','personal_floor_lamp_kaykit','personal_wall_shelf_kaykit'];
const fallbackNames=['chair_fallback','reading_table_fallback','floor_lamp_fallback','wall_shelf_fallback'];
const sorted=loads=>loads.map(({url,type})=>`${type}:${url}`).sort();
export function assertRoomVisualAssets(state,mode) {
  assert.ok(['loaded','fallback'].includes(mode));
  assert.equal(state.assetMode,mode);
  const loaded=mode==='loaded';
  assert.deepEqual(state.assetResults,[[loaded],[loaded,loaded,loaded],loaded],`${mode}: every model and floor loader must settle as expected`);
  assert.deepEqual(sorted(state.failedLoads),loaded?[]:sorted(EXPECTED_ROOM_LOADS),'only explicit loader-error mode may inject five failures');
  assert.deepEqual(state.models.map(e=>e.name),modelNames);
  assert.deepEqual(state.fallbacks.map(e=>e.name),fallbackNames);
  for(const model of state.models){
    assert.equal(model.present,loaded,`${model.name}: loaded hierarchy presence`);
    assert.equal(model.enabled,loaded,`${model.name}: loaded hierarchy visibility`);
    if(loaded)assert.ok(model.meshes>0,`${model.name}: actual render mesh instances`);
  }
  for(const fallback of state.fallbacks){
    assert.equal(fallback.present,true,`${fallback.name}: recovery hierarchy retained`);
    assert.equal(fallback.enabled,!loaded,`${fallback.name}: fallback visibility`);
    assert.ok(fallback.meshes>0,`${fallback.name}: fallback geometry retained`);
  }
}
