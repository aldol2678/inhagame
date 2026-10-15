import test from 'node:test';
import assert from 'node:assert/strict';
import { personalRoomSeatAnchors, personalRoomSeatZone, roomSeatPointIsClear, resolveRoomSeatStandPoint } from '../src/rooms/personal-room-seats.js';
import { furnitureBox } from '../src/rooms/furniture-layout.js';
import { createSeatInteraction } from '../src/seat-interaction.js';
import { canOccupy } from '../src/world-collision.js';
import { WALK_SHAPE } from '../src/player-dimensions.js';

const roomId = '11111111-1111-4111-8111-111111111111';
const id = 'd4000000-0000-4000-8000-0000000000d4';
const objectAt = yaw => ({ id, itemId: 'furniture.induck_chair', surface: 'floor', x: 0, z: 0, yaw });
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
function geometry(object, sourceKey = 'chair-r2@pinned-sha') {
  const r = object.yaw*Math.PI/180, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  const x = c*.6066427826881409+s*.47999998927116394;
  const z = s*.6066427826881409+c*.47999998927116394;
  return { box: { id, minX: object.x-x, maxX: object.x+x, minZ: object.z-z, maxZ: object.z+z, minY:.025, maxY:1.2519999980926514 },
    seatPosition:[0,.34,-.155], sourceKey };
}
const owned = options => personalRoomSeatAnchors({roomId,...options}).find(a=>a.interactableId===id);

test('active character chair uses transformed support and capsule-clear front exits at all eight yaws', () => {
  for(let yaw=0;yaw<360;yaw+=45) {
    const object=objectAt(yaw), g=geometry(object), placementGeometry=new Map([[id,g]]);
    const anchor=owned({objects:[object],placementGeometry});
    assert.ok(anchor, `yaw ${yaw}`);
    near(anchor.position.x,-.155*Math.sin(yaw*Math.PI/180));
    near(anchor.position.z,-.155*Math.cos(yaw*Math.PI/180));
    near(anchor.position.y,1.415);
    assert.equal(anchor.yaw,(yaw+180)%360);
    assert.ok(roomSeatPointIsClear(anchor.standPoint,[g.box]));
    assert.ok(canOccupy(anchor.standPoint,WALK_SHAPE,[g.box]));
    assert.ok(owned({objects:[object],placementGeometry,position:anchor.standPoint}), 'safe approach stays in interaction range');
    near(Math.hypot(anchor.standPoint.x-anchor.position.x,anchor.standPoint.z-anchor.position.z),yaw%90 ? 1.412475382566157 : .6649999892711639);
  }
});

test('missing geometry preserves legacy seat and empty map behavior exactly', () => {
  for(let yaw=0;yaw<360;yaw+=45) {
    const objects=[objectAt(yaw)];
    const legacy=personalRoomSeatAnchors({roomId,objects});
    assert.deepEqual(personalRoomSeatAnchors({roomId,objects,placementGeometry:new Map()}),legacy);
    const anchor=legacy.find(a=>a.interactableId===id);
    assert.equal(anchor.position.x,0); assert.equal(anchor.position.z,0);
    assert.ok(roomSeatPointIsClear(anchor.standPoint,[furnitureBox(objects[0])]));
  }
});

test('asymmetric envelope ray is measured from shifted seat, not half-width about placement pivot', () => {
  const object=objectAt(0), g=geometry(object); g.box.minZ=-.55; g.box.maxZ=.41;
  const anchor=owned({objects:[object],placementGeometry:new Map([[id,g]])});
  near(anchor.standPoint.z,-.89);
  assert.ok(roomSeatPointIsClear(anchor.standPoint,[g.box]));
});

test('source changes and GLB fallback invalidate occupied anchor and stand safely', () => {
  for(const transition of ['source','fallback','loaded']) {
    const object=objectAt(45), g=geometry(object);
    let placementGeometry=new Map([[id,g]]), blockers=[g.box], position={x:-1.108372473,y:1.15,z:-1.108372473};
    if(transition==='loaded') { placementGeometry=new Map(); blockers=[furnitureBox(object)]; position={x:-.8,y:1.15,z:-.8}; }
    const getAnchors=()=>personalRoomSeatAnchors({roomId,objects:[object],placementGeometry,obstacles:blockers,position});
    const first=getAnchors().find(a=>a.interactableId===id);
    const controller={grounded:true,mounted:false,moving:false,velocityY:0,jumpQueued:false,keys:new Set(),touchVector:{x:0,y:0}};
    const player={getLocalPosition:()=>position,setLocalPosition:(x,y,z)=>{position={x,y,z};},setLocalEulerAngles:()=>{}};
    const interaction=createSeatInteraction({player,controller,getAnchors,getSpaceId:()=>roomId,
      getPlaceZoneId:()=>personalRoomSeatZone(roomId),resolveStandPoint:a=>resolveRoomSeatStandPoint(a,blockers)});
    assert.equal(interaction.sitDown(first),true);
    if(transition==='loaded') { placementGeometry=new Map([[id,g]]); blockers=[g.box]; }
    else if(transition==='source') placementGeometry=new Map([[id,{...g,sourceKey:'chair-next@different-sha'}]]);
    else { placementGeometry=new Map(); blockers=[furnitureBox(object)]; }
    const next=getAnchors().find(a=>a.interactableId===id);
    assert.equal(first.id,next.id);
    assert.notEqual(first.geometryKey,next.geometryKey);
    assert.equal(interaction.beforeController(),false);
    assert.equal(interaction.seats.isSeated,false);
    assert.ok(roomSeatPointIsClear(position,blockers));
    assert.ok(canOccupy(position,WALK_SHAPE,blockers));
  }
});
