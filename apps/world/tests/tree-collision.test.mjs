import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {loadNpcPopulation} from '../npc-factory/npc-population-loader.mjs';
import {snapshotForPeriod,PULSE_PERIODS,safeDwell} from '../npc-factory/dev-runtime-state.mjs';
import {createNpcNavigator} from '../npc-factory/dev-navigation.mjs';
import {pondBankTrees,pondSeatTrees} from '../src/roadview-layout.js';
import {moveAroundObstacles} from '../src/world-collision.js';

const {batch,expansion}=await loadNpcPopulation({fetcher:async url=>new Response(await fs.readFile(new URL('..'+url,import.meta.url))),retryDelays:[]});
assert.equal(expansion,'READY');
const trunk=pondBankTrees()[4], r=.18;
const trees=[...pondBankTrees().map(t=>({...t,r:.18})),...pondSeatTrees().map(({center})=>({...center,r:.13}))];
const nav=createNpcNavigator(batch), at=(dx,dz)=>({x:trunk.x+dx,z:trunk.z+dz});

test('C04 photo guide remains near photo spot without entering a trunk in any period',()=>{
  for(const period of PULSE_PERIODS){
    const actors=snapshotForPeriod(batch,period).actors.filter(a=>a.position);
    const guide=actors.find(a=>a.id==='INKYUNG-NPC-002');
    assert.equal(guide.location,'inkyung_photo_point');
    assert.ok(Math.hypot(guide.position.x-trunk.x,guide.position.z-trunk.z)<2);
    for(const a of actors)for(const t of trees)
      assert.ok(Math.hypot(a.position.x-t.x,a.position.z-t.z)>=t.r+.65-1e-6,`${period} ${a.id}: trunk clearance`);
    for(const peer of actors.filter(a=>a.id!==guide.id&&a.location===guide.location))
      assert.ok(Math.hypot(peer.position.x-guide.position.x,peer.position.z-guide.position.z)>=1.1,'photo slots overlap');
  }
});
test('trunk is blocked for NPCs and cannot be crossed by a direct route',()=>{
  assert.equal(safeDwell(trunk),false);
  assert.equal(nav.walkable(trunk),false);
  assert.equal(nav.segmentSafe(at(0,-1.4),at(0,1.4)),false);
  const route=nav.route(at(0,-1.4),at(0,1.4));
  assert.ok(route&&route.length>1,'NPC can detour around trunk');
  assert.ok(route.every((p,i)=>nav.segmentSafe(i?route[i-1]:at(0,-1.4),p)));
  assert.equal(nav.walkable(at(0,-1.4)),true,'canopy alone does not block walking');
});
test('player stops at trunk but can pass under the crown',()=>{
  const far=moveAroundObstacles({...at(0,-1.4),y:1.15},0,2.8);
  assert.ok(far.z<trunk.z-r);
  const side=moveAroundObstacles({...at(.84,-1.4),y:1.15},0,2.8);
  assert.ok(side.z>trunk.z+.9);
});
