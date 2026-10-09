import * as pc from 'playcanvas';
import { campusBaseContactGeometry,campusTreeContactGeometry,CONTACT_BUDGET } from './campus-contact-shading-layout.js';
import { contactVisibility } from './campus-contact-shading-geometry.js';

export function createCampusContactShading({app,base,getGraphicsTier=()=> 'medium',getSnowAccumulation=()=>0,enabled=true}) {
  const entries=new Map();
  const add=(root,name,data,near=false)=>{
    if(!data?.indices.length)return null;
    const material=new pc.StandardMaterial();material.name=name;
    material.diffuse=new pc.Color(0,0,0);material.useLighting=false;
    material.opacityMapVertexColor=true;material.opacityMapVertexColorChannel='a';
    material.blendType=pc.BLEND_NORMAL;material.depthWrite=false;
    material.update();
    const mesh=new pc.Mesh(app.graphicsDevice);
    mesh.setPositions(data.positions);mesh.setNormals(data.normals);mesh.setColors(data.colors);
    mesh.setIndices(data.indices);mesh.update(pc.PRIMITIVE_TRIANGLES);
    const entity=new pc.Entity(name);
    entity.addComponent('render',{type:'asset',castShadows:false,receiveShadows:false,
      meshInstances:[new pc.MeshInstance(mesh,material)]});
    root.addChild(entity);
    const entry={entity,material,data,near,fade:near?0:1,opacity:-1};
    entries.set(entity,entry);
    entity.once('destroy',()=>{entries.delete(entity);mesh.destroy();material.destroy();});
    return entry;
  };
  add(base,'campus_contact_base',campusBaseContactGeometry());
  let tier='medium',snow=0;
  function apply(entry) {
    const opacity=contactVisibility({tier,snow,fade:entry.fade,near:entry.near,enabled});
    if(entry.opacity===opacity)return;
    entry.opacity=opacity;entry.entity.enabled=opacity>0;
    entry.material.opacity=opacity;entry.material.update();
  }
  function update() {
    tier=getGraphicsTier();snow=getSnowAccumulation();
    for(const entry of entries.values())apply(entry);
  }
  update();
  return {
    addTrees(root,chunk) {
      const entry=add(root,`campus_contact_${chunk.id}`,campusTreeContactGeometry(chunk),true);
      if(!entry)return null;
      apply(entry);
      return fade=>{entry.fade=fade;apply(entry);};
    },
    update,
    setEnabled(value){enabled=Boolean(value);update();},
    status(){
      const batches=[...entries.values()].map(e=>({name:e.entity.name,near:e.near,
        enabled:e.entity.enabled,opacity:e.opacity,fade:e.fade,triangles:e.data.triangles,
        bufferBytes:e.data.bufferBytes,sources:e.data.sources,skipped:e.data.skipped}));
      return {enabled,tier,snow,budget:CONTACT_BUDGET,batches,
        meshes:batches.length,activeMeshes:batches.filter(b=>b.enabled).length,
        triangles:batches.reduce((s,b)=>s+b.triangles,0),bufferBytes:batches.reduce((s,b)=>s+b.bufferBytes,0)};
    }
  };
}
