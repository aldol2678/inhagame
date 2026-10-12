// Historical entrance vocabulary, newly authored procedural geometry only.
// The photo is a reference, never a shipped texture or a 2026 surveyed plan.
import { LIBRARY_FRONT } from './basic-campus.js';
import { LIBRARY_ENTRY_HEIGHT } from './library-route-layout.js';
import { LIBRARY_APPROACHES, librarySideRailStart } from './roadview-layout.js';

export const JEONGSEOK_ENTRY_EVIDENCE = Object.freeze({
  source: 'https://tong.visitkorea.or.kr/cms/resource/21/1577421_image2_1.jpg',
  sourceClass: 'HISTORICAL', observed: 'paired revolving entrances, flanking glazed doors, two stone piers, grey panel soffit',
  dimensions: 'GAME_ADAPTATION', currentSurvey: false,
  basement: 'UNKNOWN_LOCATION_NO_EXTERIOR_ROUTE', movingDoorPhysics: false
});

export const JEONGSEOK_ENTRY_LAYOUT = Object.freeze({
  floor: LIBRARY_ENTRY_HEIGHT, doorHeight: 1.24, facadeTop: 3.32,
  openingHalfWidth: 2.70, facadeV: .12,
  revolvingCenters: Object.freeze([-.86, .86]), revolvingRadius: .51, revolvingV: .14,
  ordinaryCenters: Object.freeze([-2.06, 2.06]), ordinaryWidth: .88,
  pierCenters: Object.freeze([-3.32, 3.32]), pierWidth: .50, pierV: .36,
  // Existing return at (-2.6,1.05), entry at (0,.45) and reader at (0,1)
  // retain their clear landing. No collider, trigger or authority is created.
  clearancePoints: Object.freeze([Object.freeze({u:-2.6,v:1.05}),Object.freeze({u:0,v:.45}),Object.freeze({u:0,v:1})])
});

export const JEONGSEOK_ENTRY_COLORS = Object.freeze({
  stone:'#d5d3c7', joint:'#a7aaa2', metal:'#aeb8b4', darkMetal:'#505b5b',
  glass:'#396773', lightGlass:'#548d99', paving:'#c9c8ba', tactile:'#c2aa63', panel:'#b4b4a8'
});

const point=(u,y,v)=>{const p=LIBRARY_FRONT.at(u,v);return [p.x,y,p.z];};
const box=(b,c,u,y,v,w,h,d,angle=0)=>b.box(c,point(u,y,v),[w,h,d],LIBRARY_FRONT.yaw+angle);

function ring(b,c,u,y,v,r,width,height){
  const n=24,at=(a,rad,h)=>point(u+Math.cos(a)*rad,h,v+Math.sin(a)*rad);
  for(let i=0;i<n;i++){
    const a=i/n*Math.PI*2,z=(i+1)/n*Math.PI*2,lo=y-height/2,hi=y+height/2;
    b.quad(c,at(a,r,lo),at(a,r,hi),at(z,r,hi),at(z,r,lo));
    b.quad(c,at(a,r-width,lo),at(z,r-width,lo),at(z,r-width,hi),at(a,r-width,hi));
    b.quad(c,at(a,r,hi),at(a,r-width,hi),at(z,r-width,hi),at(z,r,hi));
    b.quad(c,at(a,r,lo),at(z,r,lo),at(z,r-width,lo),at(a,r-width,lo));
  }
}

/** Static, replaceable entrance modules. Four display wings are a game choice. */
export function fillJeongseokEntry(batch,tier='BASE'){
  if(!['BASE','NEAR','DETAIL'].includes(tier))return batch;
  const l=JEONGSEOK_ENTRY_LAYOUT,c=JEONGSEOK_ENTRY_COLORS,y=l.floor,h=l.doorHeight;
  if(tier==='BASE'){
    // Recessed dark glazing hides the unchanged solid building shell; entry is a room transition.
    box(batch,c.glass,0,y+.78,l.facadeV,5.40,1.56,.07);
    box(batch,c.metal,0,y+h+.09,.22,5.42,.17,.18);
    for(const u of l.pierCenters){
      box(batch,c.stone,u,y+1.03,l.pierV,l.pierWidth,2.06,.52);
      box(batch,c.stone,u,y+2.34,l.pierV,.20,.56,.20);
    }
    for(const u of l.ordinaryCenters){
      box(batch,c.lightGlass,u,y+h/2,.30,l.ordinaryWidth,h,.05);
      for(const side of [-1,1])box(batch,c.metal,u+side*l.ordinaryWidth/2,y+h/2,.36,.035,h,.055);
      box(batch,c.metal,u,y+h,.36,l.ordinaryWidth,.035,.055);
      box(batch,c.metal,u,y+.025,.36,l.ordinaryWidth,.035,.055);
    }
    for(const u of l.revolvingCenters){
      ring(batch,c.metal,u,y+.045,l.revolvingV,l.revolvingRadius,.055,.055);
      ring(batch,c.metal,u,y+h,l.revolvingV,l.revolvingRadius,.07,.13);
      box(batch,c.metal,u,y+h/2,l.revolvingV,.045,h,.045);
      // Open front view and dark rear glazing make the round enclosures legible without
      // transparency sorting or a new material/light producer. The rotor never moves.
      for(const angle of [-45,45])box(batch,c.lightGlass,u,y+h/2,l.revolvingV,l.revolvingRadius*1.83,h-.10,.025,angle);
      for(const side of [-1,1])box(batch,c.metal,u+side*l.revolvingRadius,y+h/2,l.revolvingV,.033,h,.033);
    }
  }
  if(tier==='NEAR'){
    for(const u of l.ordinaryCenters){
      box(batch,c.metal,u+.12,y+.60,.405,.025,.35,.03);
      for(const yy of [.44,.76])box(batch,c.darkMetal,u+.12,y+yy,.38,.04,.025,.06);
    }
    for(const u of l.revolvingCenters)for(const angle of [-45,45]){
      box(batch,c.metal,u,y+.56,l.revolvingV,l.revolvingRadius*1.83,.025,.03,angle);
    }
    // Thin tile joints and a tactile warning line stay on the existing landing surface.
    for(let u=-3.75;u<=3.76;u+=.75)box(batch,c.joint,u,y+.004,.72,.008,.006,1.30);
    box(batch,c.joint,0,y+.005,.72,7.50,.006,.008);
    box(batch,c.tactile,0,y+.008,1.25,5.9,.012,.10);
    for(let u=-2.90;u<=2.91;u+=.10)box(batch,c.panel,u,y+.016,1.25,.025,.012,.055);
  }
  if(tier==='DETAIL'){
    for(const u of l.pierCenters)for(const yy of [.52,1.04,1.56])
      box(batch,c.joint,u,y+yy,l.pierV+.263,l.pierWidth,.009,.004);
    // Abstract gold letter strokes evoke the observed sign band without copying a photograph,
    // a school logo or the foreground sculpture. They create no information/interaction UI.
    for(let i=0;i<27;i++)box(batch,c.tactile,(i-13)*.105,y+h+.10,.317,.045,.070,.007);
  }
  return batch;
}

// Shared game stair geometry; no engine import, route or collider mutation.
export function fillLibraryApproaches(batch, approaches = LIBRARY_APPROACHES) {
  for (const t of approaches) {
    const stone='#d5d3c7', rail='#aeb8b4';
    const box=(color,u,out,y,w,d,h)=>{const p=t.frame.at(u,out);batch.box(color,[p.x,y,p.z],[w,h,d],t.frame.yaw);};
    const width=t.frame.length-2*t.inset,center=t.frame.length/2;
    box(stone,center,t.landing/2,t.height/2,width,t.landing,t.height);
    // Outward tread i agrees exactly with libraryStairHeight's floor() intervals.
    const run=t.run/t.steps;
    for(let i=0;i<t.steps;i++){
      const top=t.height*(1-i/t.steps);
      box(stone,center,t.landing+(i+.5)*run,top/2,width,run,top);
    }
    for(const side of [0,1]){
      const u=side?t.frame.length-t.inset/2:t.inset/2;
      box(stone,u,(t.landing+t.run)/2,t.height/2,t.inset,t.landing+t.run,t.height);
      const begin=librarySideRailStart(t,side),end=t.landing+t.run;
      const innerU=side?t.frame.length-t.inset+.06:t.inset-.06;
      const p=(out,y)=>{const p=t.frame.at(innerU,out);return [p.x,y,p.z];};
      for(const y of [t.height+.22,t.height+.43])batch.tube(rail,p(begin,y),p(end,y),.025,6);
      const count=Math.ceil((end-begin)/1.1);
      for(let i=0;i<=count;i++){
        const out=begin+(end-begin)*i/count;
        batch.tube(rail,p(out,t.height),p(out,t.height+.45),.025,6);
      }
    }
  }
  return batch;
}
