import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FACILITIES} from '../src/campus-facilities.js';
import {BUILDINGS,MAIN_ENTRANCE} from '../src/basic-campus.js';
import {PLACE_ZONES,PlaceZoneRegistry,getPlaceZoneAt} from '../src/place-zone-registry.js';
import {RenderChunkRegistry,RENDER_CHUNKS,distanceToChunkBounds} from '../src/render-chunk-registry.js';
import {RenderChunkStreaming,STREAMING_POLICY} from '../src/render-chunk-streaming.js';
import {LEGACY_PLACE_DEFAULTS,placeIdForTour,legacyTelemetryTarget} from '../src/legacy-zone-compat.js';
import {OBSTACLES} from '../src/campus-layout.js';
import {resolveHeight} from '../src/world-collision.js';

test('semantic landmarks including Agora resolve to their actual campus area',()=>{
  const expected={bldg_01:'AREA_MAIN_HALL',bldg_jungseok:'AREA_JUNGSEOK_WOONAM',
    fac_agora_courtyard:'AREA_AGORA_6_9',bldg_06:'AREA_AGORA_6_9',bldg_09:'AREA_AGORA_6_9',
    bldg_07:'AREA_INKYUNG_STUDENT_CENTER',lmk_pond_gazebo:'AREA_INKYUNG_STUDENT_CENTER',
    bldg_02_north:'AREA_BUILDING_2_4',bldg_02_south:'AREA_BUILDING_2_4',bldg_04:'AREA_BUILDING_2_4',
    fac_stadium:'AREA_SPORTS',bldg_05:'AREA_BUILDING_5_WEST',lmk_woonam_aircraft:'AREA_MAIN_HALL'};
  const all=[...FACILITIES,...BUILDINGS.map(f=>({...f,center:{x:f.vertices.reduce((s,p)=>s+p.x,0)/f.vertices.length,z:f.vertices.reduce((s,p)=>s+p.z,0)/f.vertices.length}}))];
  for(const f of all){
    const owner=PLACE_ZONES.filter(z=>z.members.includes(f.id));assert.equal(owner.length,1,f.id);
    assert.equal(getPlaceZoneAt(f.center)?.id,expected[f.id]||owner[0].id,f.id);
  }
  assert.equal(getPlaceZoneAt(MAIN_ENTRANCE).id,'AREA_MAIN_HALL');
  assert.equal(getPlaceZoneAt({x:0,z:-98}).id,'AREA_MAIN_GATE');
  assert.equal(getPlaceZoneAt({x:126,z:35}).id,'AREA_INKYUNG_STUDENT_CENTER');
  assert.equal(getPlaceZoneAt({x:1000,z:0}),null);
});

test('place events and channel keys are independent of render chunk IDs',()=>{
  const places=new PlaceZoneRegistry(),events=[];
  const off=places.onPlaceZoneChanged((a,b)=>events.push([a?.id??null,b?.id??null]));
  places.update({x:0,z:-98});places.update({x:0,z:-98});
  places.update(MAIN_ENTRANCE);
  assert.deepEqual(events,[[null,'AREA_MAIN_GATE'],['AREA_MAIN_GATE','AREA_MAIN_HALL']]);
  const current=places.getCurrentPlaceZone();
  assert.equal(current.futureRealtimeChannelKey,`world:campus:${current.id}`);
  const renderer={create:()=>({}),setState(){},destroy(){}};
  const stream=new RenderChunkStreaming(new RenderChunkRegistry(),renderer);
  for(const x of [-1000,0,1000])stream.update(1,{x,z:0});
  assert.strictEqual(places.getCurrentPlaceZone(),current);
  assert.ok(Object.keys(stream.snapshot()).every(id=>id.startsWith('RC_')));
  assert.ok(PLACE_ZONES.every(z=>z.id.startsWith('AREA_')));
  off();places.update({x:1000,z:0});assert.equal(events.length,2);
  assert.equal(places.getCurrentPlaceZone(),null);
  const source=readFileSync(new URL('../src/place-zone-registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/from ['"].*(?:render-chunk|playcanvas)/);
});

test('legacy mapping remains explicit and supports saved tour callers and deployed telemetry',()=>{
  assert.deepEqual(LEGACY_PLACE_DEFAULTS,{C01_GATE:'AREA_MAIN_GATE',C02_MAIN_HALL:'AREA_MAIN_HALL',C03_CENTRAL:'AREA_INKYUNG_STUDENT_CENTER'});
  assert.equal(placeIdForTour('C01_GATE'),'AREA_MAIN_GATE');
  assert.equal(placeIdForTour('AREA_AGORA_6_9'),'AREA_AGORA_6_9');
  for(const zone of PLACE_ZONES)assert.ok(Object.keys(LEGACY_PLACE_DEFAULTS).includes(legacyTelemetryTarget(zone)));
  assert.equal(legacyTelemetryTarget(null),null);
});

test('chunk distance uses nearest bounds, not the center of a large chunk',()=>{
  const bounds={minX:0,maxX:200,minZ:0,maxZ:100};
  assert.equal(distanceToChunkBounds({x:201,z:50},bounds),1);
  assert.equal(distanceToChunkBounds({x:5,z:3},bounds),0);
  assert.equal(distanceToChunkBounds({x:203,z:104},bounds),5);
});

const box={id:'RC_TEST',bounds:{minX:0,maxX:64,minZ:0,maxZ:64}};
function fixture(){
  const destroyed=[],created=[];
  const renderer={create(c){const h={id:c.id,states:[]};created.push(h);return h;},setState(h,s){h.states.push(s);},destroy(h){destroyed.push(h);}};
  const streaming=new RenderChunkStreaming(new RenderChunkRegistry([box]),renderer);
  return {streaming,created,destroyed,at:d=>streaming.update(.25,{x:64+d,z:32})};
}

test('load/unload hysteresis resists oscillation then restores a far chunk',()=>{
  const f=fixture();f.at(149);
  for(let i=0;i<40;i++){f.at(151);f.at(149);}
  assert.equal(f.created.length,1);assert.equal(f.destroyed.length,0);
  f.at(181);assert.equal(f.destroyed.length,1);assert.equal(f.streaming.snapshot().RC_TEST,'UNLOADED');
  f.at(151);assert.equal(f.created.length,1);
  f.at(149);assert.equal(f.created.length,2);assert.notStrictEqual(f.created[0],f.created[1]);
});

test('ACTIVE NEAR VISTA changes reuse chunk handles with tier hysteresis',()=>{
  const f=fixture();f.at(0);const h=f.created[0];
  for(let i=0;i<40;i++){f.at(36);f.at(34);}
  assert.deepEqual(h.states,['ACTIVE']);
  f.at(51);assert.equal(h.states.at(-1),'NEAR');
  f.at(49);assert.equal(h.states.at(-1),'NEAR');
  f.at(34);assert.equal(h.states.at(-1),'ACTIVE');
  f.at(106);assert.equal(h.states.at(-1),'VISTA');
  f.at(86);assert.equal(h.states.at(-1),'VISTA');
  f.at(84);assert.equal(h.states.at(-1),'NEAR');
  assert.equal(f.created.length,1);assert.equal(f.destroyed.length,0);
  assert.ok(STREAMING_POLICY.detailExit-STREAMING_POLICY.detailEnter>18*.25);
  assert.ok(STREAMING_POLICY.unload-STREAMING_POLICY.load>18*.25);
});

test('chunk ownership contains whole assets exactly once and collision is independent of residency',()=>{
  assert.equal(new Set(RENDER_CHUNKS.map(c=>c.id)).size,RENDER_CHUNKS.length);
  for(const f of FACILITIES){
    const owners=RENDER_CHUNKS.filter(c=>c.facilities.includes(f.id));assert.equal(owners.length,1);
    for(const p of f.rings[0]||[f.center])assert.equal(distanceToChunkBounds(p,owners[0].bounds),0);
  }
  const before=OBSTACLES;
  const f=fixture();f.at(0);f.at(1000);
  assert.strictEqual(OBSTACLES,before);
  const b=BUILDINGS[0],p={x:MAIN_ENTRANCE.x+MAIN_ENTRANCE.inward.x*8,z:MAIN_ENTRANCE.z+MAIN_ENTRANCE.inward.z*8,y:30};
  assert.equal(resolveHeight(p,1.15),b.height+1.15);
});
