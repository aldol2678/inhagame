import { BACK_WEST_BUILDINGS } from './back-west-layout.js';
import { buildPolygonMeshGeometry, buildPolygonSurfaceGeometry } from './reality-adapter.js';

const light='#d6d1bf',dark='#555c5d',glass='#42798c';
const point=(f,u,v,y)=>{const p=f.at(u,v);return [p.x,y,p.z];};
const box=(b,f,c,u,v,y,w,h,d)=>b.box(c,point(f,u,v,y),[w,h,d],f.yaw);
function mesh(b,color,g){
  for(let i=0;i<g.indices.length;i+=3)b.triangle(color,...g.indices.slice(i,i+3).map(n=>g.positions.slice(n*3,n*3+3)));
}
const bays=f=>Array.from({length:Math.max(1,Math.floor((f.length-.6)/1.5))},(_,i)=>.3+(i+.5)*(f.length-.6)/Math.max(1,Math.floor((f.length-.6)/1.5)));
export function fillBackWestBase(b){
  for(const q of BACK_WEST_BUILDINGS){
    mesh(b,q.color,buildPolygonMeshGeometry(q.polygon,{height:q.height}));
    mesh(b,'#6a827b',buildPolygonSurfaceGeometry(q.polygon,{y:q.height+.015}));
    for(const f of q.edges){
      box(b,f,q.color,f.length/2,-.065,q.height+.1,f.length,.2,.13);
      for(let floor=1;floor<q.levels;floor++)for(const u of bays(f))
        box(b,f,glass,u,.025,floor*1.5+.95,q.style==='commercial'?1.12:.85,.88,.05);
    }
    const f=q.front;if(!f)continue;
    const shop=q.style!=='residential',width=shop?f.length-.45:Math.min(1.1,f.length-.5);
    box(b,f,shop?glass:dark,f.length/2,.04,.97,width,1.45,.08);
    // Shallow thresholds leave the mapped alley/passage open.
    box(b,f,light,f.length/2,.15,.13,width,.04,.3);
  }
  return b;
}
export function fillBackWestNear(b,ids){
  for(const q of BACK_WEST_BUILDINGS.filter(q=>ids.includes(q.id))){
    for(const f of q.edges){
      for(let floor=1;floor<q.levels;floor++){
        for(const u of bays(f)){
          const y=floor*1.5+.95,w=q.style==='commercial'?1.12:.85;
          for(const side of [-1,1])box(b,f,light,u+side*w/2,.06,y,.04,.94,.045);
          for(const dy of [-.46,.46])box(b,f,light,u,.07,y+dy,w+.06,.05,.07);
          box(b,f,light,u,.07,y,.035,.88,.04);
        }
      }
    }
    const f=q.front;if(!f)continue;
    const shop=q.style!=='residential',u=f.length/2,sign=q.style==='cafe'?'#555c5d':q.style==='commercial'?'#426b70':'#66866b';
    if(shop){
      box(b,f,sign,u,.14,1.87,f.length-.2,.35,.22);
      box(b,f,light,u,.23,2.09,f.length,.09,.46);
      for(const x of bays(f))box(b,f,light,x,.10,.97,.045,1.45,.04);
    }else{
      box(b,f,'#426b70',u,.25,1.82,1.4,.1,.5);
      box(b,f,light,u,.09,.97,.04,1.45,.04);
    }
    if(q.levels>1){
      box(b,f,light,f.length-.5,.16,2.6,.55,.35,.28);
      box(b,f,dark,f.length-.5,.31,2.6,.42,.24,.02);
    }
    b.tube(dark,point(f,.13,.1,.2),point(f,.13,.1,q.height),.025,5);
    if(q.style==='cafe'){
      for(const y of [.32,.65])b.tube(dark,point(f,.2,.38,y),point(f,f.length*.37,.38,y),.022,5);
      for(let x=.2;x<f.length*.37;x+=.38)b.tube(dark,point(f,x,.38,.15),point(f,x,.38,.65),.018,5);
    }
  }
  return b;
}
export function fillBackWestDetail(b,ids){
  for(const q of BACK_WEST_BUILDINGS.filter(q=>ids.includes(q.id))){
    const f=q.front;if(!f)continue;
    box(b,f,light,f.length/2+.17,.13,.88,.025,.23,.04);
    if(q.style==='residential'){
      // Sparse brick courses and ground-floor bars, kept in the close tier.
      for(let y=.35;y<q.height-.2;y+=.22)box(b,f,'#8e7362',f.length/2,.018,y,f.length,.013,.015);
      for(const u of bays(f).filter(u=>Math.abs(u-f.length/2)>.9)){
        box(b,f,glass,u,.025,.85,.72,.62,.05);
        for(let dx=-.3;dx<=.31;dx+=.15)box(b,f,light,u+dx,.09,.85,.025,.66,.035);
      }
    }
    if(q.levels>1)for(let k=0;k<5;k++)box(b,f,light,f.length-.69+k*.095,.33,2.6,.018,.24,.02);
    // Facade service wires, not an invented continuous span across entrances.
    for(let k=0;k<8;k++)b.tube(dark,point(f,k*f.length/8,.15,2.28-.1*Math.sin(k*Math.PI/8)),
      point(f,(k+1)*f.length/8,.15,2.28-.1*Math.sin((k+1)*Math.PI/8)),.01,4);
  }
  return b;
}
