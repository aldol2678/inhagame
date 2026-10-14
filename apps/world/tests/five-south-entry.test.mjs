import test from 'node:test';
import assert from 'node:assert/strict';
import {FIVE,NORTH_APPROACHES,FIVE_SOUTH_ENTRY_APPROACH as approach,exteriorFrame,northApproachHeight} from '../src/north-campus-layout.js';
import {FIVE_CLOCK_PLACEMENT} from '../src/north-landmark-massing.js';
import {fillNorthEntrances} from '../src/north-campus-geometry.js';
import {fillFivePhotoEntry,NORTH_PHOTO_COLORS} from '../src/north-campus-photo-geometry.js';
import {ROAD_SEGMENTS,distanceToRoad} from '../src/campus-road-layout.js';
import {WALKWAY_SURFACES,WALKWAY_EXTERNAL_MASKS,WALKWAY_SOUTH_ANCHOR} from '../src/north-walkway-layout.js';
import {polygonOverlap} from '../src/polygon-collision.js';
import {SIDE_GATE_PATHS} from '../src/north-side-gate-layout.js';
import {createCampusNavigation,isCampusSegmentClear} from '../src/navigation/campus-navigation.js';
import {createNavigationState,NAV_STATUS} from '../src/navigation/navigation-state.js';
import {createPlayerAutoMove} from '../src/navigation/player-auto-move.js';
import {PlayerController} from '../src/player-controller.js';
const entry=NORTH_APPROACHES.find(e=>e.id==='five_south_entry');
const capture=fn=>{const calls=[];fn({box:(color,position,size,yaw)=>calls.push({color,position,size,yaw})});return calls;};
const onPaving=p=>ROAD_SEGMENTS.some(r=>distanceToRoad(p,r)<=r.road.width/2+r.road.shoulder+.01)||[...WALKWAY_SURFACES.flatMap(s=>s.rings),...WALKWAY_EXTERNAL_MASKS].some(r=>polygonOverlap(p.x,p.z,r,.01));

test('one existing entrance, canopy and supported steps share the clock axis; old entrance is removed',()=>{
 const front=exteriorFrame(FIVE.rings[0],FIVE_CLOCK_PLACEMENT.edge),axis=front.length*FIVE_CLOCK_PLACEMENT.along;
 const meshes=[...capture(fillFivePhotoEntry),...capture(b=>fillNorthEntrances(b,FIVE.id))];
 assert.equal(NORTH_APPROACHES.filter(e=>e.owner===FIVE.id).length,1);
 assert.equal(meshes.length,8,'four facade boxes and original landing plus three steps');
 const doors=meshes.filter(m=>m.color===NORTH_PHOTO_COLORS.darkGlass);assert.equal(doors.length,1);
 for(const m of meshes){const p=front.local({x:m.position[0],z:m.position[2]});assert.ok(Math.abs(p.u-axis)<=entry.width/2+.26);}
 for(const m of capture(b=>fillNorthEntrances(b,FIVE.id))){assert.ok(Math.abs(m.position[1]+m.size[1]/2-northApproachHeight(m.position[0],m.position[2]))<=entry.height/entry.steps+.001);}
 assert.equal(northApproachHeight(...Object.values(exteriorFrame(FIVE.rings[0],7).at(10,.4))),0,'no support left at former doorway');
 assert.ok(Math.abs(front.local(approach).u-axis)<1e-8);
 assert.ok(onPaving(approach),'destination lies on existing road surface, not a guessed junction');
});

for(const start of [SIDE_GATE_PATHS[0].frame.at(1.4),WALKWAY_SOUTH_ANCHOR])test(`real Auto Move reaches relocated south entry from ${start.x.toFixed(1)},${start.z.toFixed(1)} on paving`,()=>{
 globalThis.window={addEventListener(){}};globalThis.document={getElementById(){return null;}};
 try{
  const nav=createCampusNavigation(),route=nav.solver.solve(start,approach);assert.equal(route.mode,'NETWORK');
  for(let i=1;i<route.points.length;i++){
   const a=route.points[i-1],b=route.points[i];assert.ok(isCampusSegmentClear(a,b));
   const n=Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/.15);
   for(let j=0;j<=n;j++)assert.ok(onPaving({x:a.x+(b.x-a.x)*j/n,z:a.z+(b.z-a.z)*j/n}));
  }
  const p={...start,y:1.15},entity={getLocalPosition:()=>({...p}),setLocalPosition(x,y,z){Object.assign(p,{x,y,z});},setLocalEulerAngles(){}};
  const controller=new PlayerController(entity),clock={t:0,now(){return this.t;}};
  const state=createNavigationState({solver:nav.solver,clock,arrivalRadius:.35});
  const auto=createPlayerAutoMove({clock,setAssist:i=>controller.setAssistedMovement(i),clearAssist:()=>controller.clearAssistedMovement()});
  state.setDestination({...approach,id:'five-entry-test',title:'5호관 남측 출입구',approach,arrivalRadius:.35},{position:p,spaceId:'campus'});assert.ok(auto.start(state.getSnapshot()));
  for(let i=0;i<3600&&state.getSnapshot().status!==NAV_STATUS.ARRIVED;i++){
   clock.t+=1000/60;state.update({position:p,spaceId:'campus'});auto.update(state.getSnapshot(),p);controller.update(1/60,1.2);assert.ok(onPaving(p));
  }
  assert.equal(state.getSnapshot().status,NAV_STATUS.ARRIVED);assert.ok(Math.hypot(p.x-approach.x,p.z-approach.z)<.5);
 }finally{delete globalThis.window;delete globalThis.document;}
});
