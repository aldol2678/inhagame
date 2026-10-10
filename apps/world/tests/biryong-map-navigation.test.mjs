import test from 'node:test';
import assert from 'node:assert/strict';
import * as layout from '../src/biryong/biryong-realm-layout.js';
import { BIRYONG_REALM_P0_BOUNDS, BIRYONG_REALM_PLACE_ZONES, BIRYONG_VILLAGE_BUILDINGS, BIRYONG_VILLAGE_ROADS, BIRYONG_VILLAGE_WATER_CHANNELS } from '../src/biryong/biryong-village-layout.js';
import { createNavigationState } from '../src/navigation/navigation-state.js';
import { createBiryongVillageNpcNavigator } from '../src/biryong/biryong-village-npc-navigation.js';

const mapModule = await import('../src/biryong/biryong-map-data.js').catch(() => ({}));
const navModule = await import('../src/biryong/biryong-navigation.js').catch(() => ({}));
const region = 'BIRYONG_REALM';

test('station footprint remains the existing rendered body and never changes movement collision', () => {
  assert.deepEqual(layout.BIRYONG_STATION_BUILDING, { id: 'biryong_station_building', x: 0, y: 2.2, z: 25, width: 20, height: 4.4, depth: 8 });
});

test('Biryong map reuses exactly six implemented zones and one return stop', () => {
  assert.equal(typeof mapModule.createBiryongMapDataSource, 'function');
  const map = mapModule.createBiryongMapDataSource();
  assert.equal(map.id, region);
  assert.equal(map.indoor, false);
  assert.deepEqual(map.bounds, BIRYONG_REALM_P0_BOUNDS);
  const pois = map.poiRegistry().list();
  assert.equal(pois.length, 7);
  assert.deepEqual(new Set(pois.map(p => p.placeZoneId)), new Set(BIRYONG_REALM_PLACE_ZONES.map(z => z.id)));
  const exit = pois.find(p => p.poiId === 'poi.biryong-realm.return');
  assert.deepEqual([exit.x, exit.z], [layout.BIRYONG_STATION_RETURN_STOP.x, layout.BIRYONG_STATION_RETURN_STOP.z]);
  assert.ok(pois.every(p => p.visible && p.validPosition && p.presentation === 'NORMAL'));
  assert.doesNotMatch(JSON.stringify(pois), /청림|청우원|들판|테마파크|항구|biryong-tower/);
  for (const building of BIRYONG_VILLAGE_BUILDINGS) {
    assert.deepEqual(map.geometry().find(g => g.id === building.id)?.rings, [building.polygon]);
  }
  for (const road of BIRYONG_VILLAGE_ROADS) assert.ok(map.geometry().some(g => g.id.startsWith(road.id + '.')));
  for (const water of BIRYONG_VILLAGE_WATER_CHANNELS) assert.ok(map.geometry().some(g => g.id.startsWith(water.id + '.')));
  assert.ok(map.geometry().some(g => g.id === 'biryong_station_building'));
});

test('every Biryong POI is reachable from arrival and return via footprint-safe segments', () => {
  assert.equal(typeof navModule.createBiryongNavigation, 'function');
  const provider = navModule.createBiryongNavigation();
  const map = mapModule.createBiryongMapDataSource();
  for (const from of [layout.BIRYONG_STATION_SPAWN, layout.BIRYONG_STATION_RETURN_STOP, {x: 0,z: 75}]) {
    for (const poi of map.poiRegistry().list()) {
      const target = provider.poiTarget(poi, region);
      assert.equal(target.mapSourceId, region);
      const route = provider.solver.solve(from, target.approach);
      assert.equal(route.ok, true, poi.poiId);
      assert.deepEqual(route.points.at(-1), target.approach);
      for (let i=1; i<route.points.length; i++) assert.equal(provider.segmentSafe(route.points[i-1], route.points[i]), true, `${poi.poiId} segment ${i}`);
    }
  }
  const acrossStation = provider.solver.solve({x:0,z:0}, {x:0,z:40});
  assert.equal(acrossStation.ok, true);
  assert.ok(acrossStation.points.some(p => Math.abs(p.x) > 10), 'must walk around existing station mesh');
  assert.equal(provider.solver.solve({x:0,z:0},{x:0,z:25}).ok, false);
});

test('map targets reject campus ids, unknown POIs, solids, outer bounds and future sources', () => {
  assert.equal(typeof navModule.createBiryongNavigation, 'function');
  const provider = navModule.createBiryongNavigation();
  const poi = mapModule.createBiryongMapDataSource().poiRegistry().list()[0];
  assert.equal(provider.poiTarget(poi, 'campus'), null);
  assert.equal(provider.poiTarget({...poi,poiId:'poi.forest'},region),null);
  // Position input cannot override the authoritative POI target.
  assert.deepEqual(provider.poiTarget({...poi,x:9999,z:9999},region),provider.poiTarget(poi,region));
  for(const p of [{x:0,z:25},{x:25,z:65},{x:500,z:500},{x:NaN,z:0},{x:-56,z:104},{x:54,z:84}]) assert.equal(provider.mapPointTarget(p,region).supported,false);
  assert.equal(provider.mapPointTarget({x:0,z:40},'campus').supported,false);
  assert.equal(provider.mapPointTarget({x:0,z:40},region).supported,true);
});

test('navigation state pauses explicit unsafe routes without a straight-line fallback and recovers', () => {
  let blocked = true, now = 0;
  const solver = {solve: (a,b) => blocked ? {ok:false,reason:'BLOCKED',points:[]} : {ok:true,mode:'NETWORK',points:[a,b],distance:40}};
  const nav = createNavigationState({solver,guidanceSpaceId:region,clock:{now:()=>now}});
  const target={id:'point:realm',mapSourceId:region,x:0,z:40};
  const first = nav.setDestination(target,{position:{x:0,z:0},spaceId:region});
  assert.equal(first.status,'PAUSED');
  assert.equal(first.pauseReason,'ROUTE_UNAVAILABLE');
  assert.deepEqual(first.routePoints,[]);
  blocked=false; now=2000;
  const recovered=nav.update({position:{x:0,z:0},spaceId:region});
  assert.equal(recovered.status,'GUIDING');
  assert.equal(recovered.pauseReason,null);
  assert.equal(nav.update({position:{x:0,z:40},spaceId:'campus'}).status,'PAUSED');
  assert.notEqual(nav.getSnapshot().status,'ARRIVED','same local coordinates in Campus never complete Biryong guidance');
});

test('custom navigation obstacles leave existing NPC defaults unchanged', () => {
  const npc = createBiryongVillageNpcNavigator();
  const added=[{id:'test',polygon:[{x:-1,z:-1},{x:1,z:-1},{x:1,z:1},{x:-1,z:1}],minY:0,maxY:4}];
  const custom=createBiryongVillageNpcNavigator({obstacles:added});
  assert.equal(npc.walkable({x:0,z:0}),true);
  assert.equal(custom.walkable({x:0,z:0}),false);
  assert.equal(npc.walkable({x:0,z:0}),true);
});

test('a failed regional route changes to a cross-region pause on return without stale snapshot',()=>{
  const nav=createNavigationState({solver:{solve:()=>({ok:false,points:[]})},guidanceSpaceId:region});
  nav.setDestination({id:'blocked',mapSourceId:region,x:0,z:40},{position:{x:0,z:0},spaceId:region});
  const paused=nav.update({position:{x:0,z:0},spaceId:'campus'});
  assert.equal(paused.currentSpaceId,'campus');
  assert.equal(paused.pauseReason,'SPACE_MISMATCH');
});

test('manual movement near market hall immediately rebuilds an unsafe retained route',()=>{
  const provider=navModule.createBiryongNavigation();
  const map=mapModule.createBiryongMapDataSource();
  const target=provider.poiTarget(map.poiRegistry().get('poi.biryong-realm.market'));
  const nav=createNavigationState({solver:provider.solver,guidanceSpaceId:region,clock:{now:()=>0}});
  nav.setDestination(target,{position:{x:0,z:0},spaceId:region});
  const snapshot=nav.update({position:{x:-16,z:70},spaceId:region});
  assert.equal(snapshot.status,'GUIDING');
  for(let i=1;i<snapshot.routePoints.length;i++)assert.equal(provider.segmentSafe(snapshot.routePoints[i-1],snapshot.routePoints[i]),true,'retained route cuts market hall');
  assert.equal(provider.segmentSafe({x:-16,z:70},snapshot.nextWaypoint),true);
  assert.equal(snapshot.rerouteCount,1);
});

test('strict route next-waypoint lookahead cannot skip a nearby corner into a blocked segment',()=>{
  const corner={x:.5,z:0},goal={x:.5,z:2};
  const solver={solve:from=>({ok:true,mode:'NETWORK',points:[from,corner,goal],distance:2.5}),
    segmentSafe:(from,to)=>!(from.x===0&&to.z>0)};
  const nav=createNavigationState({solver,guidanceSpaceId:region});
  const snapshot=nav.setDestination({id:'corner',mapSourceId:region,...goal,arrivalRadius:.1},{position:{x:0,z:0},spaceId:region});
  assert.deepEqual(snapshot.nextWaypoint,corner);
});

test('regional segments continuously exclude a rounded workshop corner missed by coarse sampling',()=>{
  const provider=navModule.createBiryongNavigation();
  const from={x:19,z:57},unsafeNext={x:-4.5,z:90},target={x:-10,z:112};
  const closest={x:17.314013709063214,z:59.367555217060165};
  assert.equal(provider.walkable(closest),false);
  assert.equal(provider.segmentSafe(from,unsafeNext),false);
  const route=provider.solver.solve(from,target);assert.equal(route.ok,true);
  for(let i=1;i<route.points.length;i++){
    const a=route.points[i-1],b=route.points[i],steps=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.005);
    for(let j=0;j<=steps;j++)assert.equal(provider.walkable({x:a.x+(b.x-a.x)*j/steps,z:a.z+(b.z-a.z)*j/steps}),true);
  }
});
