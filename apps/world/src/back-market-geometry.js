import { MARKET_BUILDINGS, MARKET_EXISTING_SHOPS } from './back-market-layout.js';
import { fillInfillBase, fillInfillNear, fillInfillDetail } from './backgate-infill-geometry.js';

const light='#d6d1bf',dark='#555c5d',metal='#aeb5b1';
const point=(f,u,v,y)=>{const p=f.at(u,v);return [p.x,y,p.z];};
const box=(b,q,c,u,v,y,w,h,d)=>b.box(c,point(q.frame,u,v,y),[w,h,d],q.frame.yaw);

export function fillMarketBase(b) {
  for(const q of MARKET_BUILDINGS)fillInfillBase(b,q,'market');
  return b;
}
export function fillMarketNear(b,ids) {
  for(const q of MARKET_BUILDINGS.filter(q=>ids.includes(q.id)))fillInfillNear(b,q,'market');
  for(const q of MARKET_EXISTING_SHOPS.filter(q=>ids.includes(q.id))) {
    const w=Math.min(q.w-.55,6),front=q.signZ+.03;
    if(q.treatment==='awning') {
      box(b,q,q.sign,0,-.36,2.18,w,.11,.66);
      for(let u=-w/2+.15;u<w/2;u+=.55)box(b,q,light,u,-.37,2.242,.2,.015,.62);
      box(b,q,q.sign,0,-.67,2.12,w,.15,.035);
    } else if(q.treatment==='shutter') {
      // One closed bay beside an open shop entrance, not a blocked whole lane.
      box(b,q,metal,-w*.28,-.085,.92,w*.38,1.35,.04);
      for(let y=.3;y<1.6;y+=.105)box(b,q,dark,-w*.28,-.111,y,w*.38,.013,.016);
    } else if(q.treatment==='tile') {
      for(const side of [-1,1])for(let y=.2;y<1.55;y+=.25)box(b,q,light,side*w*.46,-.1,y,.27,.22,.06);
    } else {
      for(const side of [-1,1])for(let u=0;u<.55;u+=.14)box(b,q,'#9b7262',side*(w*.42+u*.3),-.105,.9,.08,1.35,.07);
    }
    // Thin light fixtures and small door headers remain mounted on the facade.
    for(const side of [-1,1])box(b,q,dark,side*w*.35,front-.09,2.32,.28,.045,.19);
    if(q.district==='67'||q.district==='91') {
      const u=w*.40;
      b.tube(metal,point(q.frame,u,-.16,2.43),point(q.frame,u,-.16,q.h-.16),.075,7);
      b.tube(metal,point(q.frame,u,-.16,q.h-.16),point(q.frame,u,-.32,q.h-.16),.075,7);
    }
  }
  return b;
}
export function fillMarketDetail(b,ids) {
  for(const q of MARKET_BUILDINGS.filter(q=>ids.includes(q.id)))fillInfillDetail(b,q,'market');
  for(const q of MARKET_EXISTING_SHOPS.filter(q=>ids.includes(q.id))) {
    const w=Math.min(q.w-.55,6);
    for(const side of [-1,1])box(b,q,light,side*w*.35,q.signZ-.15,2.315,.2,.018,.12);
    // Recessed menu/display rectangles stay inside the glazing bay.
    box(b,q,light,w*.24,-.102,.9,.35,.49,.02);
    for(let k=0;k<4;k++)box(b,q,dark,w*.24,-.118,1.04-k*.08,.24,.018,.008);
    if(q.district==='67'||q.district==='91')for(let y=2.6;y<q.h-.2;y+=.55)
      box(b,q,dark,w*.40,-.15,y,.20,.035,.19);
  }
  return b;
}
