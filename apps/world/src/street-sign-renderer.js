import * as pc from 'playcanvas';


// One small local text atlas per resident layer. No downloaded map imagery or
// shop logos; Korean street lettering and generic storefront labels only.
export function buildStreetSigns(root, records, name='street_shop_signs') {
  if(!records.length)return;
  const labels=[...new Set(records.map(q=>q.label))];
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128*labels.length;
  const ctx=canvas.getContext('2d');
  ctx.font='bold 82px "Malgun Gothic", sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  labels.forEach((label,i)=>{
    ctx.fillStyle='#f5f0df';
    if(label==='인하문화의거리') {
      const first='인하',last='문화의거리',total=ctx.measureText(label).width,left=(1024-total)/2;
      ctx.textAlign='left';ctx.fillStyle='#e5b548';ctx.fillText(first,left,i*128+64);
      ctx.fillStyle='#659ab4';ctx.fillText(last,left+ctx.measureText(first).width,i*128+64);ctx.textAlign='center';
    } else ctx.fillText(label,512,i*128+64,960);
  });
  const device=pc.Application.getApplication().graphicsDevice;
  const texture=new pc.Texture(device,{width:canvas.width,height:canvas.height,mipmaps:false,minFilter:pc.FILTER_LINEAR,magFilter:pc.FILTER_LINEAR,addressU:pc.ADDRESS_CLAMP_TO_EDGE,addressV:pc.ADDRESS_CLAMP_TO_EDGE});
  texture.setSource(canvas);
  const material=new pc.StandardMaterial();material.diffuseMap=texture;material.opacityMap=texture;material.opacityMapChannel='a';
  material.emissiveMap=texture;material.emissive=new pc.Color(.4,.4,.4);material.alphaTest=.3;material.cull=pc.CULLFACE_BACK;material.update();
  const positions=[],normals=[],uvs=[],indices=[];
  for(const q of records) {
    // Canvas upload has top-left origin: bottom vertices sample the row's bottom.
    const row=labels.indexOf(q.label),v0=(row+1)/labels.length,v1=row/labels.length;
    const textWidth=Math.min(960,ctx.measureText(q.label).width)+24;
    const u0=(1024-textWidth)/2048,u1=1-u0;
    const corners=q.corners;
    const offset=positions.length/3;
    const right=corners[1].map((v,i)=>v-corners[0][i]),len=Math.hypot(right[0],right[2]);
    const normal=[right[2]/len,0,-right[0]/len];
    corners.forEach(p=>{positions.push(...p);normals.push(...normal);});
    // Reverse winding faces the street; back faces must not display mirrored text.
    uvs.push(u0,v0,u1,v0,u1,v1,u0,v1);indices.push(offset,offset+2,offset+1,offset,offset+3,offset+2);
  }
  const mesh=pc.createMesh(device,positions,{normals,uvs,indices});
  const entity=new pc.Entity(name);
  entity.addComponent('render',{type:'asset',castShadows:false,meshInstances:[new pc.MeshInstance(mesh,material)]});
  root.addChild(entity);
  entity.on('destroy',()=>{mesh.destroy();material.destroy();texture.destroy();});
}

