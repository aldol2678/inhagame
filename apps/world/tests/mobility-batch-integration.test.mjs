import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerController} from '../src/player-controller.js';
import {getCampusKickboardParkedPose, parkCampusKickboardAt, CAMPUS_KICKBOARD_ID} from '../src/mounts/campus-kickboard-world.js';
import {getCampusKartParkedPose, parkCampusKartAt, CAMPUS_KART_ID} from '../src/mounts/campus-kart-world.js';

test('co-located prototypes board the latest summoned vehicle and release kart driver seats', () => {
  const nodes = new Map(['run', 'jump', 'descend'].map(id => [id, {hidden:false, setAttribute(){}}]));
  globalThis.window = {addEventListener(){}};
  globalThis.document = {body:{dataset:{}}, getElementById:id => nodes.get(id) ?? null};
  const p = {x:-1000,y:1.15,z:-1000};
  const c = new PlayerController({getLocalPosition:()=>({...p}),
    setLocalPosition:(x,y,z)=>Object.assign(p,{x,y,z}), getLocalEulerAngles:()=>({y:0}), setLocalEulerAngles(){}});
  c.setMovementSpace({id:'campus',allowMount:true,bounds:{minX:-2000,maxX:2000,minZ:-2000,maxZ:2000},
    obstacles:[],groundHeight:()=>0,constrain:(_p,next)=>next});
  for (const kind of ['kickboard', 'kart', 'kickboard', 'kart']) {
    const kart = kind === 'kart';
    assert.ok(kart ? c.summonKartNearPlayer() : c.summonKickboardNearPlayer());
    const pose = kart ? getCampusKartParkedPose() : getCampusKickboardParkedPose();
    // Deliberately overlap both props: the selected summon must win the shared M action.
    parkCampusKickboardAt(pose); parkCampusKartAt(pose);
    Object.assign(p,{x:pose.x,y:pose.y+c.groundY,z:pose.z});
    assert.ok(c.transportAction());
    assert.equal(c.mountId,kart ? CAMPUS_KART_ID : CAMPUS_KICKBOARD_ID);
    assert.equal(c.dismountBike(),false,'bike exit must not bypass prototype cleanup');
    assert.equal(nodes.get('jump').hidden,true);
    assert.equal(nodes.get('run').hidden,false);
    assert.ok(c.transportAction());
    assert.equal(c.mounted,false);
    assert.equal(c.kartSeats.canDrive('local-player'),false);
    assert.equal(nodes.get('jump').hidden,false);
  }
});
