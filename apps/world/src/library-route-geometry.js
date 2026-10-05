import { fillLegacyGateGround } from './main-gate-surface-ownership.js';
import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { LIBRARY_BANK_CELLS, LIBRARY_ROUTE_CELLS, LIBRARY_ROUTE_GUARDS } from './library-route-layout.js';

export function buildLibraryRoute(root){
  const b=new FacilityMeshBatch(),top=p=>[p.x,p.y+.045,p.z],base=p=>[p.x,0,p.z];
  for(const q of LIBRARY_BANK_CELLS){
    const [a,c,d,e]=q.polygon;
    for(const vertices of [[a,c,d],[a,d,e]]){
      const [p,r,s]=vertices;
      if((r.z-p.z)*(s.x-p.x)-(r.x-p.x)*(s.z-p.z)<0)vertices.reverse();
      b.triangle('#718458',...vertices.map(p=>[p.x,p.y+.03,p.z]));
    }
  }
  for(const q of LIBRARY_ROUTE_CELLS){
    // This level approach is superseded by the editor-owned gate apron.
    if(q.line==='main_gate_walk_link'){
      fillLegacyGateGround(b,'#b5b2a4',q.polygon,.045);
      continue;
    }
    const [a,c,d,e]=q.polygon;
    // Preserve the physics diagonal even when a mitered slope is not planar.
    for(const vertices of [[a,c,d],[a,d,e]]){
      const [p,q,r]=vertices;
      if((q.z-p.z)*(r.x-p.x)-(q.x-p.x)*(r.z-p.z)<0)vertices.reverse();
      b.triangle('#b5b2a4',...vertices.map(top));
    }
    for(const [p,r] of [[a,c],[d,e]]){
      b.quad('#aaa99d',base(p),base(r),top(r),top(p));
      b.quad('#aaa99d',base(r),base(p),top(p),top(r));
    }
  }
  for(const q of LIBRARY_ROUTE_GUARDS){
    const p=(v,h)=>[v.x,v.y+h,v.z];
    b.tube('#c1c5bf',p(q.a,.05),p(q.a,.5),.025,6);
    for(const h of [.25,.5])b.tube('#c1c5bf',p(q.a,h),p(q.b,h),.027,6);
  }
  b.finish(root,'library_gate_route');
}
