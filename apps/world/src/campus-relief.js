// Each nonzero grid vertex belongs to one mapped green area. Both triangles
// follow the SW–NE diagonal. The perimeter blends into the adjacent fixed grade.
import { RELIEF_PATCHES, RELIEF_SPACING as spacing } from './campus-relief-grid.js';

const key=(i,j)=>i*65536+j;
const heights=new Map();
const cells=new Map();
for(const {way,rows} of RELIEF_PATCHES){
  for(const [j,first,...samples] of rows)for(const [offset,centiWU] of samples.entries()){
    if(!centiWU)continue;
    const i=first+offset;
    heights.set(key(i,j),centiWU/100);
    for(const x of [i-1,i])for(const z of [j-1,j])cells.set(key(x,z),{x,z,way});
  }
}
const vertex=(i,j)=>heights.get(key(i,j))??0;
export function campusReliefHeight(x,z){
  const sx=x/spacing,sz=z/spacing,i=Math.floor(sx),j=Math.floor(sz);
  if(!cells.has(key(i,j)))return 0;
  const u=sx-i,v=sz-j,sw=vertex(i,j),ne=vertex(i+1,j+1);
  return u>=v ? sw*(1-u)+vertex(i+1,j)*(u-v)+ne*v
              : sw*(1-v)+vertex(i,j+1)*(v-u)+ne*u;
}
export function forEachReliefTriangle(emit){
  const point=(i,j)=>[i*spacing,vertex(i,j),j*spacing];
  for(const {x,z,way} of cells.values()){
    const sw=point(x,z),nw=point(x,z+1),ne=point(x+1,z+1),se=point(x+1,z);
    if(sw[1]||nw[1]||ne[1])emit(way,sw,nw,ne);
    if(sw[1]||ne[1]||se[1])emit(way,sw,ne,se);
  }
}
