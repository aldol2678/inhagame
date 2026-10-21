import { packWalkabilityGeometry } from '../../npc-factory/wasm-walkability-p01.mjs';
// Same immutable packing/buckets as WASM: controls for the benefit of caching geometry
// rather than attributing all allocation/math savings to the language boundary.
export function createPackedJsWalkability({geometry,fallback}) {
  const {config:c,records:r,edges:e,offsets:o,indices:ids}=packWalkabilityGeometry(geometry);
  const inBox=(x,z,k)=>x>=r[k]-c[4]&&x<=r[k+1]+c[4]&&z>=r[k+2]-c[4]&&z<=r[k+3]+c[4];
  const polygon=(x,z,k)=>{
    let inside=false;
    for(let i=r[k+4],end=i+r[k+5];i<end;i++){
      const at=i*7,ax=e[at],az=e[at+1],bx=e[at+2],bz=e[at+3],tx=e[at+4],tz=e[at+5],length=e[at+6];
      if((az>z)!==(bz>z)&&x<(bx-ax)*(z-az)/(bz-az)+ax)inside=!inside;
      const u=Math.max(0,Math.min(length,(x-ax)*tx+(z-az)*tz));
      if(Math.hypot(x-ax-u*tx,z-az-u*tz)<c[4])return true;
    }
    return inside;
  };
  return {evaluate(points){
    const out=new Uint8Array(points.length);
    for(let i=0;i<points.length;i++){
      const p=points[i],{x,z}=p;
      if(!Number.isFinite(x)||!Number.isFinite(z)||x<c[0]||x>c[1]||z<c[2]||z>c[3])continue;
      if(inBox(x,z,0)&&polygon(x,z,0))continue;
      out[i]=1;const cell=Math.floor((z-c[2])/8)*c[5]+Math.floor((x-c[0])/8);
      for(let j=o[cell];j<o[cell+1];j++){
        const k=ids[j]*6;
        if(inBox(x,z,k)&&(r[k+5]===0||polygon(x,z,k))){out[i]=+fallback(p);break;}
      }
    }return out;
  }};
}

