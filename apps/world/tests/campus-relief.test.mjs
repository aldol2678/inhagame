import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
// The stair mesh batch imports the renderer only to build GPU meshes; these checks read its plain arrays.
registerHooks({resolve(s,c,next){return s==='playcanvas'?{url:'data:text/javascript,export const unused=1',shortCircuit:true}:next(s,c)}});
const { fillHallStairs } = await import('../src/main-hall-stairs.js');
const { FacilityMeshBatch } = await import('../src/facility-mesh-batch.js');
const { HALL_FOUNDATION_HEIGHT, MAIN_HALL_APPROACH: hall } = await import('../src/main-hall-approach.js');
const { campusReliefHeight, forEachReliefTriangle } = await import('../src/campus-relief.js');
const { HALL_ENTRY_WALK } = await import('../src/main-hall-walkway-layout.js');
const { AGORA, roadviewGroundHeight: ground } = await import('../src/roadview-layout.js');
const { NORTH_APPROACHES } = await import('../src/north-campus-layout.js');
const { campusNavPolylines, isCampusSegmentClear } = await import('../src/navigation/campus-navigation.js');
const { PlayerController } = await import('../src/player-controller.js');
const { SPORTS_FLOOR, SPORTS_SIDE_ENTRIES } = await import('../src/stadium-stands-layout.js');
const { GARDEN_ENTRANCES, GARDEN_FLOOR } = await import('../src/library-garden-layout.js');

const close=(a,b,msg)=>assert.ok(Math.abs(a-b)<1e-6,msg??(a+' vs '+b));
const at=(side,out)=>hall.frame.at(hall.frame.length/2+side,out);

test('every upward stone tread and planted bank triangle supports the player at its face',()=>{
  const batch=fillHallStairs(new FacilityMeshBatch());
  const heights=new Set();
  for(const color of ['#d2cfc2','#bcb7a7','#84905e']){
    const {positions,indices,normals}=batch.groups.get(color);
    for(let i=0;i<indices.length;i+=3){
      const tri=indices.slice(i,i+3).map(k=>positions.slice(3*k,3*k+3));
      assert.ok(normals[3*indices[i]+1]>0,'upward face');
      // Test interior barycentric positions, including the two planes of the side bevel.
      for(const weights of [[.34,.33,.33],[.05,.25,.7]]){
        const [x,y,z]=[0,1,2].map(k=>tri.reduce((s,p,j)=>s+p[k]*weights[j],0));
        close(ground(x,z),y);
        if(color==='#d2cfc2') heights.add(+y.toFixed(4));
      }
    }
  }
  assert.equal(heights.size,hall.steps);
  close(HALL_FOUNDATION_HEIGHT+.2,hall.height);
  close(ground(HALL_ENTRY_WALK[0].x,HALL_ENTRY_WALK[0].z),0);
  close(ground(HALL_ENTRY_WALK.at(-1).x,HALL_ENTRY_WALK.at(-1).z),hall.height);
  assert.ok(isCampusSegmentClear(HALL_ENTRY_WALK[0],HALL_ENTRY_WALK.at(-1)));
});

test('walk up, jump on the landing, then descend without losing ground contact',()=>{
  globalThis.window={addEventListener(){}};
  globalThis.document={getElementById(){return null;}};
  let p={...at(0,hall.landing+hall.run+1),y:1.15};
  const entity={getLocalPosition:()=>({...p}),setLocalPosition(x,y,z){p={x,y,z};},setLocalEulerAngles(){}};
  const controller=new PlayerController(entity,{bindInput:false});
  const walk=out=>{
    const to=at(0,out);
    for(let i=0;i<400;i++){
      const dx=to.x-p.x,dz=to.z-p.z,d=Math.hypot(dx,dz);
      if(d<.08){controller.clearAssistedMovement();return;}
      controller.setAssistedMovement({x:dx,z:dz});
      controller.update(Math.min(1/60,d/7),0);
      close(p.y-1.15,ground(p.x,p.z));assert.ok(controller.grounded);
    }
    assert.fail('waypoint inaccessible');
  };
  walk(1.0);close(p.y-1.15,hall.height);
  controller.jumpQueued=true;controller.update(1/60);assert.ok(p.y>1.15+hall.height);
  for(let i=0;i<135;i++)controller.update(1/60);
  assert.ok(controller.grounded);close(p.y-1.15,hall.height);
  walk(hall.landing+hall.run+1);close(p.y,1.15);
});

test('landform triangles and grounding coincide throughout the campus and tie into level paths',()=>{
  const ways=new Set();let triangles=0;
  forEachReliefTriangle((way,a,b,c)=>{
    ways.add(way);triangles++;
    const p=[0,1,2].map(k=>(a[k]+b[k]+c[k])/3);
    close(ground(p[0],p[2]),p[1]);
    assert.ok((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])>0);
  });
  assert.ok(ways.size>=10 && triangles>500);
  for(const line of campusNavPolylines())for(let k=1;k<line.points.length;k++){
    const a=line.points[k-1],b=line.points[k],n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z));
    for(let i=0;i<=n;i++)close(campusReliefHeight(a.x+(b.x-a.x)*i/n,a.z+(b.z-a.z)*i/n),0,line.id);
  }
  for(const e of SPORTS_SIDE_ENTRIES){const p=e.frame.at(e.u,-e.run-.2);close(ground(p.x,p.z),SPORTS_FLOOR);}
  for(const e of GARDEN_ENTRANCES){const p=e.frame.at(e.u,e.run+.2);close(ground(p.x,p.z),GARDEN_FLOOR);}
});
test('each northern entrance and the raised court support the same treads they draw',()=>{
  for(const q of [...NORTH_APPROACHES,{...AGORA,landing:0,u:(AGORA.stairStart+AGORA.stairEnd)/2}]){
    for(let i=0;i<q.steps;i++)for(const fraction of [.15,.85]){
      const p=q.frame.at(q.u,q.landing+q.run*(i+fraction)/q.steps);
      close(ground(p.x,p.z),q.height*(1-i/q.steps),q.id);
    }
  }
});
