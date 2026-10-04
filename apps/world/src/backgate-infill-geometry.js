// Rear-gate infill facade vocabulary, re-authored on the current public plots.
// Historical roof/window rhythms are reference only: no former layout, imagery,
// tenancy/brand data, material owner or interaction is imported.
import { box } from './public-qa-geometry.js';

const WALLS=['#ac7965','#d5d2c6','#b4b4a8','#c7b29a'];
const TRIM='#ece9df',FRAME='#505b5b',GLASS='#396773',ROOF='#687472';
const SIGNS=['#536b7a','#6c5942','#505b5b'];

export function infillProfile(q,kind) {
  const alley=kind==='alley',index=q.index||0;
  const wall=alley?WALLS[index%WALLS.length]:({brick:WALLS[0],stone:WALLS[1],panel:WALLS[2],cafe:WALLS[3]}[q.style]||WALLS[1]);
  const rows=[];
  for(let y=alley?2.85:3.2;y<q.h-.6;y+=alley?1.5:1.55)rows.push(y);
  const columns=alley?2:Math.max(2,Math.floor((q.w-.5)/1.3));
  const pitch=(q.w-.6)/columns;
  return {alley,wall,sign:SIGNS[index%SIGNS.length],rows,columns,pitch,
    width:alley?Math.min(.92,pitch-.16):pitch-.14,
    signY:alley?1.87:2.17,roofHeight:q.h+(alley?.3:.18)};
}
const paneList=(q,p)=>p.rows.flatMap(y=>Array.from({length:p.columns},(_,i)=>({u:-q.w/2+.3+(i+.5)*p.pitch,y})));

export function fillInfillBase(b,q,kind) {
  const p=infillProfile(q,kind),f=q.frame,rim=p.roofHeight-q.h;
  // Current q.w/q.d/q.h remain the body authority. The rim is confined to the
  // already-existing collider's vertical allowance, without outward overhang.
  box(b,f,0,q.d/2,q.h/2,q.w,q.h,q.d,p.wall);
  // The inner roof cap meets the unchanged landing plane; the colored rim
  // reads as a parapet band without introducing hovering above a recess.
  box(b,f,0,q.d/2,p.roofHeight-.015,q.w-.24,.03,q.d-.24,ROOF);
  for(const v of [.06,q.d-.06])box(b,f,0,v,q.h+rim/2,q.w,rim,.12,p.wall);
  for(const u of [-q.w/2+.06,q.w/2-.06])box(b,f,u,q.d/2,q.h+rim/2,.12,rim,q.d-.24,p.wall);
  // Glazing and a closed door persist in BASE; none implies a new enterable room.
  box(b,f,0,-.025,.94,q.w-.44,1.42,.05,GLASS);
  box(b,f,-q.w*.2,-.054,.94,.72,1.34,.028,'#486271');
  box(b,f,0,-.035,.12,q.w,.24,.07,FRAME);
  // Preserve the existing sign atlas plane (-.232 alley, -.19 market).
  box(b,f,0,p.alley?-.12:-.09,p.signY,q.w-.2,p.alley?.4:.52,p.alley?.20:.16,p.sign);
  for(const pane of paneList(q,p))box(b,f,pane.u,-.026,pane.y,p.width,.9,.052,GLASS);
  return b;
}

export function fillInfillNear(b,q,kind) {
  const p=infillProfile(q,kind),f=q.frame;
  for(const pane of paneList(q,p)) {
    box(b,f,pane.u,-.063,pane.y-.5,p.width+.12,.08,.10,TRIM);
    for(const side of [-1,1])box(b,f,pane.u+side*(p.width/2+.027),-.066,pane.y,.054,.96,.08,TRIM);
  }
  for(const u of [-q.w/2+.17,-q.w*.2-.39,-q.w*.2+.39,q.w/2-.17])
    box(b,f,u,-.06,.94,.055,1.48,.04,FRAME);
  box(b,f,0,-.13,p.signY+(p.alley?.26:.32),q.w-.1,.08,.28,TRIM);
  // Compact wall service unit and a shallow cafe visor, clear of every road.
  box(b,f,q.w*.30,-.15,p.alley?2.48:2.78,.55,.31,.24,TRIM);
  box(b,f,q.w*.30,-.28,p.alley?2.48:2.78,.43,.21,.018,FRAME);
  if(q.style==='cafe')box(b,f,0,-.28,2.54,q.w-.12,.09,.54,p.sign);
  return b;
}

export function fillInfillDetail(b,q,kind) {
  const p=infillProfile(q,kind),f=q.frame,y=p.alley?2.48:2.78;
  box(b,f,-q.w*.2+.20,-.107,.9,.025,.24,.035,TRIM);
  for(let k=0;k<4;k++)box(b,f,q.w*.30-.15+k*.1,-.295,y,.018,.18,.013,TRIM);
  for(const pane of paneList(q,p))box(b,f,pane.u,-.062,pane.y-.15,p.width-.10,.03,.043,FRAME);
  if(p.wall===WALLS[0])for(const level of p.rows)
    box(b,f,0,-.011,level+.59,q.w-.22,.018,.022,'#6c5942');
  return b;
}
