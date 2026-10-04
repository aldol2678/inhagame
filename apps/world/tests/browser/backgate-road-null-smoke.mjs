// Real pinned engine and actual persistent renderer. Null device is not pixel QA.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
globalThis.document={addEventListener(){},removeEventListener(){},createElement(){return{width:0,height:0,getContext(){return{measureText:text=>({width:text.length*45}),fillText(){}}}}}};
const engine=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(s,c,next){return next(s==='playcanvas'?engine:s,c)}});
const pc=await import('playcanvas');
const {CampusChunkRenderer}=await import('../../src/campus-chunk-renderer.js');
const {RenderChunkRegistry}=await import('../../src/render-chunk-registry.js');
const {campusMaterialCacheStatus}=await import('../../src/campus-render-kit.js');
const {ROAD_OWNER_PREFIXES,ROAD_VIEWS,roadOwnerName,roadCameraFor,roadViewCorners}=await import('./backgate-road-qa-plan.mjs');
const canvas={id:'backgate-road-null',width:1280,height:720},app=new pc.AppBase(canvas),options=new pc.AppOptions();options.graphicsDevice=new pc.NullGraphicsDevice(canvas);options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];app.init(options);
const report={engine:pc.version,device:'NullGraphicsDevice',visualEvidence:false,cycles:[],projectionChecks:0};
const fingerprint=meshes=>meshes.map(mi=>createHash('sha256').update(new Uint8Array(mi.mesh.vertexBuffer.storage)).digest('hex'));
let warmed;
try{
  for(let cycle=0;cycle<3;cycle++){
    const frame=new pc.Entity('CampusCoordinateFrame');frame.setLocalScale(1,1,-1);app.root.addChild(frame);
    const registry=new RenderChunkRegistry(),renderer=new CampusChunkRenderer(app,frame,registry);
    const owners=renderer.base.children.filter(e=>roadOwnerName(e.name)),meshes=owners.flatMap(e=>e.render.meshInstances);
    const groups=ROAD_OWNER_PREFIXES.map(prefix=>{
      const rows=owners.filter(e=>e.name.startsWith(prefix));assert.ok(rows.length>0,prefix);
      let vertices=0,triangles=0;
      for(const e of rows){
        assert.equal(Boolean(e.collision),false);if(prefix.endsWith('paving_'))assert.equal(e.render.castShadows,false);
        for(const mi of e.render.meshInstances){const p=[],n=[],ix=[];mi.mesh.getPositions(p);mi.mesh.getNormals(n);mi.mesh.getIndices(ix);assert.ok(p.length&&p.length===n.length&&[...p,...n].every(Number.isFinite));vertices+=p.length/3;triangles+=ix.length/3;assert.equal(mi.material.opacity,1);assert.equal(mi.material.depthWrite,true);}
      }
      return{prefix,meshes:rows.length,vertices,triangles};
    });
    const before=fingerprint(meshes),chunk=registry.chunks.find(c=>c.streetscape.some(id=>id.startsWith('back_street_'))),handle=renderer.create(chunk);
    renderer.setState(handle,'ACTIVE');renderer.update(1);renderer.setState(handle,'VISTA');renderer.update(1);assert.deepEqual(fingerprint(meshes),before);renderer.destroy(handle);assert.equal(renderer.fades.size,0);
    const count=campusMaterialCacheStatus().materialCount;if(warmed!==undefined)assert.equal(count,warmed);warmed=count;
    for(const view of ROAD_VIEWS)for(const viewport of [{width:1280,height:720},{width:390,height:844},{width:844,height:390}]){
      const plan=roadCameraFor(view,viewport),camera=new pc.Entity('RoadQACamera');app.root.addChild(camera);camera.addComponent('camera');camera.camera.projection=pc.PROJECTION_ORTHOGRAPHIC;camera.camera.orthoHeight=plan.orthoHeight;camera.camera.aspectRatioMode=pc.ASPECT_MANUAL;camera.camera.aspectRatio=viewport.width/viewport.height;camera.camera.nearClip=plan.nearClip;camera.camera.farClip=plan.farClip;camera.setPosition(...plan.position);camera.lookAt(...plan.target);
      const vm=new pc.Mat4().copy(camera.getWorldTransform()).invert(),vp=new pc.Mat4().mul2(camera.camera.projectionMatrix,vm);
      for(const p of roadViewCorners(view)){const world=new pc.Vec3(...p),clip=vp.transformPoint(world),depth=-vm.transformPoint(world).z;assert.ok(Math.abs(clip.x)<.96&&Math.abs(clip.y)<.96,view.name+' cropped in '+viewport.width+'x'+viewport.height);assert.ok(depth>plan.nearClip&&depth<plan.farClip);}
      camera.destroy();report.projectionChecks++;
    }
    const owned=meshes.map(mi=>mi.mesh);frame.destroy();assert.ok(owned.every(mesh=>mesh.vertexBuffer===null));report.cycles.push({cycle,groups,materialCount:count,cleanup:true,stableAcrossLod:true});
  }
  console.log(JSON.stringify(report,null,2));
}finally{app.destroy()}
