import { BACK_APPROACH_SEGMENTS, BACK_APPROACH_ROADS } from './back-approach-layout.js';
import { approachSurface } from './back-approach-surface.js';
import { FLAT_GROUND_Y as G } from './flat-ground-surface.js';

const asphalt='#747d7b',edge='#b4b4a8',yellow='#d8b453';
export function fillBackApproaches(b){
  for(const s of BACK_APPROACH_SEGMENTS){
    const f=s.frame,h=s.road.width/2,avenue=s.road.style==='avenue';
    const roadSurface=(batch,c,frame,u0,u1,v0,v1,y)=>approachSurface(batch,c,s,u0,u1,v0,v1,y,y>=.124);
    const paved=s.road.id==='inha_77_entrance'||s.road.style==='shared',passage=s.road.style==='passage';
    // Narrow lanes are shared surfaces with drainage edges, without center lines.
    roadSurface(b,edge,f,-.13,f.length+.13,-h-.25,h+.25,G.UNDERLAY);
    roadSurface(b,passage?(s.road.id==='west_shop_passage'?'#688578':'#a0a297'):paved?edge:s.road.tags.surface==='concrete'?'#a0a297':asphalt,f,-.12,f.length+.12,-h,h,G.SURFACE);
    if(avenue){
      for(const side of [-1,1]){
        roadSurface(b,edge,f,0,f.length,side>0?h+.1:-h-1.4,side>0?h+1.4:-h-.1,G.EDGE);
        roadSurface(b,yellow,f,.3,f.length-.3,side*(h-.14)-.035,side*(h-.14)+.035,G.PAINT);
      }
      roadSurface(b,yellow,f,.15,f.length-.15,-.035,.035,G.PAINT);
    }else if(passage){
      for(const side of [-1,1])roadSurface(b,'#818a82',f,0,f.length,side*h-.035,side*h+.035,G.PAINT);
    }else if(paved){
      for(const side of [-1,1]){
        roadSurface(b,'#659ab4',f,0,f.length,side>0?h-.42:-h,side>0?h:-h+.42,G.EDGE);
        if(s.road.id!=='inha_77_entrance')roadSurface(b,yellow,f,0,f.length,side*(h-.43)-.025,side*(h-.43)+.025,G.DETAIL);
      }
      for(let u=.5;u<f.length;u+=.5)roadSurface(b,'#929992',f,u,Math.min(u+.018,f.length),-h,h,G.PAINT);
      for(let v=-h+.5;v<h;v+=.5)roadSurface(b,'#929992',f,0,f.length,v,v+.018,G.PAINT);
      if(s.road.id!=='inha_77_entrance')for(let u=9;u<f.length-.5;u+=12)roadSurface(b,'#659ab4',f,u,u+.35,-h,h,G.DETAIL);
    }else{
      for(const side of [-1,1])roadSurface(b,'#555c5d',f,.2,f.length-.2,side*h-.05,side*h+.05,G.PAINT);
      for(let u=5;u<f.length-1;u+=8){
        roadSurface(b,'#555c5d',f,u,u+.32,-h-.17,-h+.08,G.PAINT);
        for(let j=0;j<4;j++)roadSurface(b,edge,f,u+j*.08,u+j*.08+.025,-h-.14,-h+.05,G.DETAIL);
      }
    }
    if(s.id==='west_47_lane_1'){
      // April 2026 lane markings: flat alternating hump paint and a one-way arrow.
      for(let v=-h;v<h;v+=.28)roadSurface(b,Math.round((v+h)/.28)%2?edge:yellow,f,7,8.3,v,Math.min(v+.28,h),G.DETAIL);
      roadSurface(b,edge,f,13,14.5,-.075,.075,G.DETAIL);
      for(const side of [-1,1]){
        const points=[f.at(14.1,side*.38),f.at(14.8),f.at(14.1)];
        if(side<0)points.reverse();
        b.triangle(edge,...points.map(p=>[p.x,G.DETAIL,p.z]));
      }
    }
  }
  // Flat joins cover the wedge between adjacent segments at bends.
  for(const road of BACK_APPROACH_ROADS){
    const segments=BACK_APPROACH_SEGMENTS.filter(s=>s.road===road);
    for(let i=1;i<segments.length;i++)for(const side of [-1,1]){
      const a=segments[i-1],c=segments[i],p=c.frame.at(0),v=a.frame.at(a.frame.length,side*road.width/2),w=c.frame.at(0,side*road.width/2);
      const pts=[[p.x,G.SURFACE,p.z],[v.x,G.SURFACE,v.z],[w.x,G.SURFACE,w.z]];
      const up=(pts[1][2]-pts[0][2])*(pts[2][0]-pts[0][0])-(pts[1][0]-pts[0][0])*(pts[2][2]-pts[0][2]);
      if(Math.abs(up)<1e-8)continue;if(up<0)pts.reverse();b.triangle(road.style==='passage'?'#a0a297':road.id==='inha_77_entrance'||road.style==='shared'?edge:asphalt,...pts);
    }
  }
  return b;
}

