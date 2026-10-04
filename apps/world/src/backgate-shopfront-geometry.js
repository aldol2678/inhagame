// Independently authored neutral architecture on existing public gameplay envelopes.
// The dimensions are not a facade survey. No image, shop identity or texture is used.
import { box, quad } from './public-qa-geometry.js';

const WALLS = ['#d5d2c6', '#c7b29a', '#ac7965', '#b4b4a8'];
const TRIM = '#ece9df', FRAME = '#505b5b', GLASS = '#396773', ROOF = '#687472';
const SIGNS = ['#536b7a', '#6c5942', '#505b5b'];

export function shopfrontProfile(id) {
  // Stable per ID, independent of stream order, time, randomness or neighboring plots.
  let seed = 2166136261;
  for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  return {wall: WALLS[seed % WALLS.length], variant: (seed >>> 3) % 3,
    sign: SIGNS[(seed >>> 6) % SIGNS.length], doorSide: seed & 1 ? 1 : -1};
}

export function shopfrontEnvelope(q) {
  const origin=q.frame.at(0),v=q.frame.at(0,1);
  // The terminal polygon begins at local v=1, unlike other culture plots (v=0).
  const front=q.polygon ? Math.min(...q.polygon.map(p=>(p.x-origin.x)*(v.x-origin.x)+(p.z-origin.z)*(v.z-origin.z))) : q.front;
  const ring=q.polygon || [[-q.w/2,front],[q.w/2,front],[q.w/2,front+q.d],[-q.w/2,front+q.d]].map(p=>q.frame.at(...p));
  return {front,ring};
}

function windows(q, profile) {
  const count=profile.variant===2?2:Math.max(2,Math.floor(q.w/1.5));
  const pitch=(q.w-.6)/count,width=pitch*(profile.variant===1?.68:.76);
  return [3.2,4.75].flatMap(y=>Array.from({length:count},(_,i)=>({u:-q.w/2+.3+(i+.5)*pitch,y,w:width,h:.96})));
}

export function fillShopfrontBase(batch, q) {
  const p=shopfrontProfile(q.id),{front,ring}=shopfrontEnvelope(q);
  // Persistent opaque shell: exact original corners and top, even at FAR / culled detail.
  const area=ring.reduce((sum,a,i)=>sum+a.x*ring[(i+1)%ring.length].z-ring[(i+1)%ring.length].x*a.z,0);
  for(let i=0;i<ring.length;i++) {
    const a=ring[i],b=ring[(i+1)%ring.length];
    const face=[[a.x,0,a.z],[b.x,0,b.z],[b.x,q.h,b.z],[a.x,q.h,a.z]];
    batch.quad(p.wall,...(area>0?face.reverse():face));
  }
  quad(batch,ring,q.h,ROOF);
  // Closed glazing and door, not an enterable interior or a new interaction.
  box(batch,q.frame,0,front-.025,1.025,q.w-.44,1.65,.05,GLASS);
  box(batch,q.frame,p.doorSide*(q.w/2-.78),front-.058,1.025,.86,1.65,.025,'#486271');
  box(batch,q.frame,0,front-.032,.12,q.w,.24,.064,FRAME);
  box(batch,q.frame,0,front-.045,2.23,q.w-.20,.42,.09,p.sign);
  for(const w of windows(q,p))box(batch,q.frame,w.u,front-.022,w.y,w.w,w.h,.044,GLASS);
  // Vertical roof/parapet band stays within the original six-unit top.
  box(batch,q.frame,0,front-.025,q.h-.16,q.w,.30,.05,TRIM);
  if(p.variant===1)box(batch,q.frame,0,front-.026,3.97,q.w,.10,.052,TRIM);
  return batch;
}

export function fillShopfrontNear(batch, q) {
  const p=shopfrontProfile(q.id),{front}=shopfrontEnvelope(q);
  for(const w of windows(q,p)) {
    for(const dy of [-1,1])box(batch,q.frame,w.u,front-.054,w.y+dy*(w.h/2+.035),w.w+.12,.07,.108,TRIM);
    box(batch,q.frame,w.u,front-.051,w.y,.045,w.h,.058,FRAME);
  }
  // Ground-floor piers and the closed entrance's frame; no canopy projects into the lane.
  const door=p.doorSide*(q.w/2-.78);
  for(const u of [-q.w/2+.16,q.w/2-.16,door-.46,door+.46])
    box(batch,q.frame,u,front-.068,1.035,.065,1.73,.076,FRAME);
  box(batch,q.frame,0,front-.07,1.88,q.w-.26,.065,.08,TRIM);
  box(batch,q.frame,0,front-.065,2.50,q.w-.12,.10,.13,TRIM);
  if(p.variant===2)for(const side of [-1,1])
    box(batch,q.frame,side*(q.w/2-.15),front-.027,4.0,.16,3.5,.054,TRIM);
  return batch;
}

export function fillShopfrontDetail(batch, q) {
  const p=shopfrontProfile(q.id),{front}=shopfrontEnvelope(q);
  const door=p.doorSide*(q.w/2-.78);
  box(batch,q.frame,door-p.doorSide*.25,front-.103,1.0,.025,.25,.04,TRIM);
  // Sparse mullions/reveals, confined to the facade rather than sidewalk props.
  for(const w of windows(q,p))box(batch,q.frame,w.u,front-.047,w.y-.15,w.w-.08,.035,.05,FRAME);
  if(p.wall==='#ac7965')for(const y of [2.75,3.96,5.49])
    box(batch,q.frame,0,front-.012,y,q.w-.24,.018,.024,'#6c5942');
  return batch;
}
