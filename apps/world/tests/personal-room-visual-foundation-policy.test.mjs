import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRoomVisualAssets,EXPECTED_ROOM_LOADS} from './browser/personal-room-visual-foundation-policy.mjs';
function state(mode='loaded'){
 const loaded=mode==='loaded';
 return {assetMode:mode,assetResults:[[loaded],[loaded,loaded,loaded],loaded],failedLoads:loaded?[]:structuredClone(EXPECTED_ROOM_LOADS),
 models:['personal_chair_oak_linen','personal_reading_table_kaykit','personal_floor_lamp_kaykit','personal_wall_shelf_kaykit'].map(name=>({name,present:loaded,enabled:loaded,meshes:loaded?1:0})),
 fallbacks:['chair_fallback','reading_table_fallback','floor_lamp_fallback','wall_shelf_fallback'].map(name=>({name,present:true,enabled:!loaded,meshes:1}))};
}
test('success and intentional fallback are separate acceptance cases',()=>{
 for(const mode of ['loaded','fallback'])assert.doesNotThrow(()=>assertRoomVisualAssets(state(mode),mode));
 assert.throws(()=>assertRoomVisualAssets(state('fallback'),'loaded'));
});
for(const [name,mutate] of [
 ['chair loader failure',s=>s.assetResults[0][0]=false],
 ['missing decor loader',s=>s.assetResults[1].pop()],
 ['floor texture failure',s=>s.assetResults[2]=false],
 ['missing loaded chair',s=>s.models[0].present=false],
 ['hidden loaded chair',s=>s.models[0].enabled=false],
 ['empty loaded chair',s=>s.models[0].meshes=0],
 ['fallback still visible',s=>s.fallbacks[0].enabled=true]
])test(`success rejects ${name}`,()=>{const s=state();mutate(s);assert.throws(()=>assertRoomVisualAssets(s,'loaded'));});
test('fallback requires exact five intentional failures and visible recovery geometry',()=>{
 for(const mutate of [s=>s.failedLoads.pop(),s=>s.failedLoads.push(s.failedLoads[0]),s=>s.failedLoads[0].type='texture',s=>s.models[0].present=true,s=>s.fallbacks[0].enabled=false,s=>s.fallbacks[0].meshes=0]){
  const s=state('fallback');mutate(s);assert.throws(()=>assertRoomVisualAssets(s,'fallback'));
 }
});
