// Exact triangle/axis-aligned-box SAT. Inputs are expressed in the bench's frame.
// Shrink only 0.1 mm to distinguish surface contact from material penetration.
export function trianglePenetratesBox(triangle, half, epsilon = .0001) {
  const sub=(a,b)=>a.map((v,i)=>v-b[i]);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
  const basis=[[1,0,0],[0,1,0],[0,0,1]];
  const edges=triangle.map((v,i)=>sub(triangle[(i+1)%3],v));
  const axes=[...basis,cross(edges[0],edges[1]),...edges.flatMap(e=>basis.map(b=>cross(e,b)))];
  const size=half.map(v=>v-epsilon);
  return axes.every(axis=>{
    if(dot(axis,axis)<1e-16)return true;
    const projected=triangle.map(v=>dot(v,axis));
    const radius=size.reduce((n,v,i)=>n+v*Math.abs(axis[i]),0);
    return Math.min(...projected)<=radius && Math.max(...projected)>=-radius;
  });
}
