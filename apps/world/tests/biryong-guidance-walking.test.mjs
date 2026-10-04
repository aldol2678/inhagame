import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerController } from '../src/player-controller.js';
import { PLAYER_ORIGIN_Y } from '../src/player-dimensions.js';
import { BIRYONG_REALM_MOVEMENT_SPACE } from '../src/biryong/biryong-realm-world-adapter.js';
import { createBiryongMapDataSource } from '../src/biryong/biryong-map-data.js';
import { createBiryongNavigation } from '../src/biryong/biryong-navigation.js';

test('actual PlayerController walks every regional destination route and back without collision or teleport',()=>{
  const saved=Object.fromEntries(['window','document','HTMLElement'].map(key=>[key,globalThis[key]]));
  globalThis.window={addEventListener(){}};
  globalThis.document={body:{dataset:{worldRegion:'BIRYONG_REALM'}},getElementById(){return null;}};
  globalThis.HTMLElement=class {};
  let position={x:0,y:PLAYER_ORIGIN_Y,z:0},rotation={x:0,y:0,z:0};
  const player={getLocalPosition:()=>({...position}),setLocalPosition(x,y,z){position={x,y,z};},
    getLocalEulerAngles:()=>({...rotation}),setLocalEulerAngles(x,y,z){rotation={x,y,z};}};
  try {
    const controller=new PlayerController(player);controller.setMovementSpace(BIRYONG_REALM_MOVEMENT_SPACE);
    controller.inputEnabled=true;controller.grounded=true;
    const provider=createBiryongNavigation();
    let ticks=0;
    for(const poi of createBiryongMapDataSource().poiRegistry().list()){
      const destination=provider.poiTarget(poi).approach;
      for(const target of [destination,{x:0,z:0}]){
        const route=provider.solver.solve(position,target);assert.equal(route.ok,true,poi.poiId);
        for(const waypoint of route.points.slice(1)){
          let arrived=false;
          for(let i=0;i<15000;i++){
            const dx=waypoint.x-position.x,dz=waypoint.z-position.z,distance=Math.hypot(dx,dz);
            if(distance<.01){arrived=true;break;}
            const scale=Math.min(1,distance/(controller.walkSpeed/60))/distance;
            controller.touchVector.x=dx*scale;controller.touchVector.y=-dz*scale;
            controller.update(1/60,0);ticks++;
            assert.ok(Number.isFinite(position.x)&&Number.isFinite(position.z));
            assert.ok(provider.walkable(position),`${poi.poiId} route left safe footprint`);
            assert.ok(Math.abs(position.y-PLAYER_ORIGIN_Y)<1e-6);
          }
          assert.equal(arrived,true,`${poi.poiId} movement got stuck`);
        }
        assert.ok(Math.hypot(position.x-target.x,position.z-target.z)<.02);
      }
    }
    assert.ok(ticks>1000);
  } finally {for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
