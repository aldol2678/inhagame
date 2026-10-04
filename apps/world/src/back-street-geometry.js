// Neutral commercial facades and restored streetscape on unchanged public envelopes.
import { BACK_STREET_BLOCKS, BACK_STREET_RAILS, BACK_STREET_SEGMENTS, crossingClear } from './back-street-layout.js';
import { BACK_SIGNAL_CROSSINGS } from './back-roadside-layout.js';
import { backApproachClear } from './back-approach-layout.js';
import { roadSurface } from './campus-road-geometry.js';
import { fillShopfrontBase, fillShopfrontNear, fillShopfrontDetail } from './backgate-shopfront-geometry.js';
import { FLAT_GROUND_Y as G } from './flat-ground-surface.js';

const concrete='#b4b4a8',white='#e6e4d3',yellow='#d8b453',metal='#505b5b',lens='#303735';
const point=(f,u,v,y)=>{const p=f.at(u,v);return[p.x,y,p.z];};
const box=(b,f,c,u,v,y,w,h,d)=>b.box(c,point(f,u,v,y),[w,h,d],f.yaw||0);

export function fillBackStreetPaving(b){
  // The gate/approach batches already own the asphalt and lane paint. A second
  // full-width surface here hid that paint and fought the existing ground layer.
  for(const s of BACK_STREET_SEGMENTS){
    const f=s.frame;
    for(let u=0;u<f.length;u+=.5){
      const end=Math.min(u+.5,f.length);
      const clear=(v0,v1)=>[f.at(u,v0),f.at(u,v1),f.at(end,v0),f.at(end,v1),f.at((u+end)/2,(v0+v1)/2)].every(p=>backApproachClear(p,.15));
      if(clear(3.6,6.35))roadSurface(b,concrete,f,u,end,3.6,6.35,G.EDGE);
      // Flush curb-edge accents, interrupted at crossings and approach mouths.
      if(!crossingClear(s.start+u)&&!crossingClear(s.start+end))for(const side of [-1,1]){
        const v=side*3.63;
        if(clear(v-.065,v+.065))roadSurface(b,white,f,u,Math.max(u,end-.04),v-.065,v+.065,G.DETAIL);
      }
    }
  }
  for(const crossing of BACK_SIGNAL_CROSSINGS){
    const f=crossing.frame;
    // The main zebra remains exclusively in fillBackGatePaving. Reconstruct
    // only the missing side zebra instead of overlaying another main crossing.
    if(crossing.id==='side')for(let i=0;i<10;i++){
      // Horizontal stripe long axis follows the road (u); only the pattern
      // rotates, while the crossing still spans the same sidewalks at v=±3.5.
      const v=-3.5+i*(6.6/9);
      roadSurface(b,white,f,-2.1,2.1,v,v+.4,G.DETAIL);
    }
    for(const side of [-1,1]){
      // Tactile pads own a layer above the neighboring drain/tile paint.
      roadSurface(b,yellow,f,-2.1,2.1,side>0?3.8:-4.25,side>0?4.25:-3.8,(G.PAINT+G.DETAIL)/2);
      roadSurface(b,yellow,f,-.2,.2,side>0?4.25:-4.9,side>0?4.9:-4.25,G.DETAIL);
      roadSurface(b,white,f,side>0?-3.4:3.1,side>0?-3.1:3.4,side>0?.22:-3.35,side>0?3.35:-.22,G.DETAIL);
    }
  }
  return b;
}

export function fillBackStreetBase(b){for(const q of BACK_STREET_BLOCKS)fillShopfrontBase(b,q);return b;}
export function fillBackStreetNear(b,ids){for(const q of BACK_STREET_BLOCKS.filter(q=>ids.includes(q.id)))fillShopfrontNear(b,q);return b;}
export function fillBackStreetDetail(b,ids){for(const q of BACK_STREET_BLOCKS.filter(q=>ids.includes(q.id)))fillShopfrontDetail(b,q);return b;}

export function fillBackStreetSignals(b){
  // Keep every divider within its existing 1.6 × .14 × .65 collision envelope.
  for(const q of BACK_STREET_RAILS){
    const end=q.w/2-.07;
    for(const u of [-end,end]){
      b.tube(metal,point(q.frame,u,0,0),point(q.frame,u,0,.65),.065,6);
      b.tube(yellow,point(q.frame,u,0,.43),point(q.frame,u,0,.54),.07,6);
    }
    for(const y of [.25,.59])b.tube(yellow,point(q.frame,-end,0,y),point(q.frame,end,0,y),.025,5);
  }
  for(const crossing of BACK_SIGNAL_CROSSINGS)for(const side of [-1,1]){
    const f=crossing.frame,u=side*3.3,v=side*4.15;
    // These four pole anchors already have authoritative roadside colliders.
    b.tube(metal,point(f,u,v,.02),point(f,u,v,3.55),.075,8);
    b.tube(metal,point(f,u,v,3.48),point(f,u,side*.35,3.48),.05,6);
    box(b,f,metal,u,side*1.55,3.24,.22,.30,1.24);
    for(let i=0;i<3;i++){
      const z=side*(1.19+i*.35);
      b.tube(lens,point(f,u-side*.112,z,3.24),point(f,u-side*.16,z,3.24),.103,8);
      b.tube(i===2?'#528b78':lens,point(f,u-side*.162,z,3.24),point(f,u-side*.17,z,3.24),.078,8);
    }
    // Opaque, static pedestrian icons. No timers, logic, lights or numeric rules.
    box(b,f,metal,u,v,1.5,.25,.52,.20);
    for(const y of [1.38,1.63])box(b,f,lens,u,v-side*.105,y,.18,.20,.02);
    const face=v-side*.12,red='#ac7965';
    box(b,f,red,u,face,1.68,.045,.05,.018);
    box(b,f,red,u,face,1.61,.065,.09,.018);
    for(const dx of [-.025,.025])box(b,f,red,u+dx,face,1.54,.019,.08,.018);
  }
  return b;
}
