// The photographed gate apron follows the editor's existing curb returns.
// Dimensions are visual estimates; the editor remains the coordinate authority.
import { mainGateProductionPath } from './editor/main-gate-production.js';

const approach=mainGateProductionPath('main_gate_approach');
const west=mainGateProductionPath('gate_curb_west');
const east=mainGateProductionPath('gate_curb_east');
const a=approach.vertices[0],b=approach.vertices.at(-1);
const length=Math.hypot(b.x-a.x,b.z-a.z);
const forward={x:(b.x-a.x)/length,z:(b.z-a.z)/length};
const lateral={x:-forward.z,z:forward.x};
const offset=(p,d)=>({x:p.x+lateral.x*d,z:p.z+lateral.z*d});
const distance=p=>(p.x-a.x)*forward.x+(p.z-a.z)*forward.z;
const extend=p=>({x:p.x+forward.x*(length-distance(p)),z:p.z+forward.z*(length-distance(p))});
// Preserve arbitrary paired curb edits; never duplicate their coordinates here.
const sections=west.vertices.map((p,i)=>{
  const q=east.vertices[i],span=Math.hypot(q.x-p.x,q.z-p.z);
  const dx=(q.x-p.x)/span,dz=(q.z-p.z)/span;
  return [{x:p.x+dx*west.width/2,z:p.z+dz*west.width/2},{x:q.x-dx*east.width/2,z:q.z-dz*east.width/2}];
});
const sign=Math.sign((sections[0][1].x-sections[0][0].x)*lateral.x+(sections[0][1].z-sections[0][0].z)*lateral.z);
sections.unshift([offset(a,-sign*approach.width/2),offset(a,sign*approach.width/2)]);
sections.push(sections.at(-1).map(extend));
export const MAIN_GATE_FORECOURT_RING=Object.freeze([
  ...sections.map(s=>s[0]),...sections.slice().reverse().map(s=>s[1])
].map(Object.freeze));
export const MAIN_GATE_FORECOURT_QUADS=Object.freeze(sections.slice(1).map((s,i)=>{
  const q=[sections[i][0],s[0],s[1],sections[i][1]];
  const [a,b,c]=q;
  if((b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z)<0)q.reverse();
  return Object.freeze(q);
}));

export function gateForecourtTreeClear(p,radius=1.9){
  const ring=MAIN_GATE_FORECOURT_RING;
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[j],b=ring[i],dx=b.x-a.x,dz=b.z-a.z;
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz)));
    if(Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t)<=radius)return false;
    if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside;
  }
  return !inside;
}
