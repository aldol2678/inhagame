// Real pinned PlayCanvas geometry and lifecycle QA. Null-device results are NOT pixels.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
globalThis.document={addEventListener(){},removeEventListener(){},createElement(){return {width:0,height:0,getContext(){return {measureText:t=>({width:t.length*45}),fillText(){}}}};}};
const engine=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(s,c,next){return next(s==='playcanvas'?engine:s,c);}});
const pc=await import('playcanvas');
const {CampusChunkRenderer}=await import('../../src/campus-chunk-renderer.js');
const {RenderChunkRegistry}=await import('../../src/render-chunk-registry.js');
const {SEAT_ANCHORS,SEAT_TOP_Y}=await import('../../src/seat-anchors.js');
const {MAIN_HALL_WALKWAYS}=await import('../../src/main-hall-walkway-layout.js');
const {SITE_FEATURES}=await import('../../src/basic-campus.js');
const {VIEW_DISTANCE_PRESETS}=await import('../../src/view-distance.js');
const meshes=root=>root.findComponents('render').flatMap(c=>c.meshInstances);
const fingerprint=root=>meshes(root).map(m=>createHash('sha256').update(new Uint8Array(m.mesh.vertexBuffer.storage)).digest('hex'));
function flatTops(root,p,space){
  const heights=[];
  for(const m of meshes(root)){
    const positions=[],indices=[];m.mesh.getPositions(positions);m.mesh.getIndices(indices);
    const matrix=new pc.Mat4().copy(space.getWorldTransform()).invert().mul(m.node.getWorldTransform()),point=new pc.Vec3();
    for(let j=0;j<positions.length;j+=3){matrix.transformPoint(point.set(positions[j],positions[j+1],positions[j+2]),point);positions.splice(j,3,point.x,point.y,point.z);}
    for(let i=0;i<indices.length;i+=3){
      const [a,b,c]=indices.slice(i,i+3).map(j=>positions.slice(j*3,j*3+3));
      if(Math.max(a[1],b[1],c[1])-Math.min(a[1],b[1],c[1])>1e-7)continue;
      const cross=(u,v,w)=>(v[0]-u[0])*(w[2]-u[2])-(v[2]-u[2])*(w[0]-u[0]),q=[p.x,0,p.z];
      if(cross(a,b,c)>=-1e-8)continue;
      if([cross(a,b,q),cross(b,c,q),cross(c,a,q)].every(n=>n<=1e-6))heights.push(a[1]);
    }
  }
  return heights;
}
const canvas={id:'campus-surroundings-null',width:256,height:256},app=new pc.AppBase(canvas),options=new pc.AppOptions();
options.graphicsDevice=new pc.NullGraphicsDevice(canvas);options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];app.init(options);
const report={engine:pc.version,device:'NullGraphicsDevice; no visual evidence',cycles:[]};
try{
  for(let cycle=0;cycle<3;cycle++){
    const parent=new pc.Entity('SurroundingsProbe');parent.setLocalScale(1,1,cycle%2?-1:1);app.root.addChild(parent);
    const registry=new RenderChunkRegistry(),renderer=new CampusChunkRenderer(app,parent,registry);
    const pond=renderer.base.children.filter(e=>e.name.startsWith('pond_surroundings_base_'));
    const walks=renderer.base.children.filter(e=>e.name.startsWith('main_hall_walkways_'));
    assert.equal(pond.length,5,'persistent pond base must be mounted independently of the student renderer');
    assert.equal(walks.length,1,'both shared approaches must be mounted exactly once');
    const targets=[...pond,...walks],geometry=targets.flatMap(fingerprint);
    for(const seat of SEAT_ANCHORS.filter(s=>s.id.startsWith('SEAT_INKYUNG_TREE_')))
      assert.ok(pond.some(e=>flatTops(e,seat.position,parent).some(y=>Math.abs(y-SEAT_TOP_Y)<1e-6)),seat.id+' visible seat missing');
    for(const line of MAIN_HALL_WALKWAYS){const [a,b]=line.points;
      for(const t of [.02,.5,.98]){
        const p={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};
        assert.ok(flatTops(renderer.base,p,parent).some(y=>y>=.020&&y<=.030),'approach plus receiving surface coverage missing');
      }
      const incoming=SITE_FEATURES.find(f=>f.id===line.sourceId).vertices.at(-2),length=Math.hypot(a.x-incoming.x,a.z-incoming.z);
      for(const p of [{x:a.x+(incoming.x-a.x)*.5/length,z:a.z+(incoming.z-a.z)*.5/length},b]){
        const groundTops=flatTops(renderer.base,p,parent).filter(y=>y>=0&&y<.2);
        assert.ok(groundTops.length&&Math.max(...groundTops)<=.030001,'adjacent source paving must meet the shared flat-ground band');
      }
    }
    const handle=renderer.create(registry.chunks.find(q=>q.facilities.includes('bldg_07')));
    for(const policy of [VIEW_DISTANCE_PRESETS.SHORT,VIEW_DISTANCE_PRESETS.MAX]){
      renderer.setViewPolicy(policy);renderer.setState(handle,'ACTIVE');renderer.update(1);
      renderer.setState(handle,'VISTA');renderer.update(1);
      assert.ok(targets.every(e=>e.enabled),'distance must not hide active seats or approach paving');
      assert.deepEqual(targets.flatMap(fingerprint),geometry,'no rebuild or shared-source mutation');
    }
    renderer.destroy(handle);assert.equal(renderer.fades.size,0);
    const buffers=targets.flatMap(meshes).map(m=>m.mesh);parent.destroy();
    assert.ok(buffers.every(m=>m.vertexBuffer===null),'all caller-owned buffers disposed');
    report.cycles.push({cycle,reflection:cycle%2?-1:1,seats:32,approaches:2,baseMeshes:targets.length,stable:true,disposed:true});
  }
  console.log(JSON.stringify(report,null,2));
}finally{app.destroy();}
