// Fresh geometry from the owner's field-reference PDF, photos 11/12. The photos
// establish visible appearance only, never coordinates, dimensions or hidden faces.
import {fillNeutralCampusBuilding,NEUTRAL_FACADE_COLORS} from './neutral-campus-buildings.js';

export const PHOTO_STUDENT_COLORS=Object.freeze({
  wall:'#ae8c79',roof:'#706c67',trim:'#e1ddd0',glass:'#355d62',
  recess:'#343d3c',stairRed:'#964c45',warmWindow:'#bfbca0'
});
const frontEdges=new Set([0,1,2,3,4,5,6,7,8]);

export function fillPhotoStudentCenter(batch,f,tier='BASE') {
  if(f.id!=='bldg_07'||!['BASE','NEAR'].includes(tier))return batch;
  const c=PHOTO_STUDENT_COLORS,ring=f.rings[0],height=f.height;
  const recolor=color=>color===NEUTRAL_FACADE_COLORS.wall?c.wall:color===NEUTRAL_FACADE_COLORS.roof?c.roof:color===NEUTRAL_FACADE_COLORS.glass?c.glass:c.trim;
  if(tier==='BASE'){
    // Preserve the validated WorldForge/canonical envelope, including its existing
    // faceted rounded bay. No terrain, height, walkable terrace or collider changes.
    fillNeutralCampusBuilding({quad:(color,...p)=>batch.quad(recolor(color),...p),triangle:(color,...p)=>batch.triangle(recolor(color),...p)},f,tier);
    return batch;
  }
  const area=ring.reduce((s,a,i)=>{const b=ring[(i+1)%ring.length];return s+a.x*b.z-b.x*a.z;},0);
  // Hidden/unconfirmed faces keep the generic rhythm; do not invent their likeness.
  const onObservedEdge=points=>[...frontEdges].some(i=>{
    const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dz=b.z-a.z;
    return points.every(([x,,z])=>Math.abs((x-a.x)*dz-(z-a.z)*dx)<1e-6);
  });
  fillNeutralCampusBuilding({quad:(color,...p)=>{if(!onObservedEdge(p))batch.quad(recolor(color),...p);}},f,tier);
  for(const i of frontEdges){
    const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
    const point=(u,y)=>[a.x+u*dx,y*height,a.z+u*dz];
    const panel=(color,u0,u1,y0,y1,rightY0=y0,rightY1=y1)=>{
      const p=[point(u0,y0),point(u0,y1),point(u1,rightY1),point(u1,rightY0)];
      batch.quad(color,...(area>0?p:p.reverse()));
    };
    if(i<=1){
      panel(c.stairRed,0,1,0,.97);
      // Broad alternating white stair parapets; their slope is illustrative,
      // fitted to existing edges rather than converted from pixel dimensions.
      for(const y of [.20,.43,.66]){
        const drop=i===0?.07:-.07;
        panel(c.trim,0,.35,y,y+.075);
        panel(c.trim,.35,.78,y,y+.075,y+drop,y+.075+drop);
        panel(c.trim,.78,1,y+drop,y+.075+drop);
      }
      continue;
    }
    if(i>=6){
      panel(c.glass,.4,.6,.12,.84);
      for(const y of [.28,.51]){
        panel(c.glass,.08,.92,y,y+.12);
        for(const u of [.25,.5,.75])panel(c.trim,u-.008,u+.008,y,y+.12);
        panel(c.trim,.08,.92,y,y+.009);
      }
      continue;
    }
    panel(c.recess,0,1,.40,.49);
    panel(c.recess,0,1,.10,.19);
    // Layered terrace parapet bands and thin rail lines. These are boundary
    // details only: no false physical stair, balcony slab or accessible doorway.
    for(const y of [.23,.52]){
      panel(c.trim,0,1,y,y+.022);
      panel(c.trim,0,1,y+.07,y+.077);
      const posts=Math.max(2,Math.ceil(length/2.4));
      for(let post=0;post<posts;post++)panel(c.trim,(post+.25)/posts,(post+.28)/posts,y+.022,y+.07);
    }
    for(const [row,y] of [.66,.82].entries()){
      panel(c.glass,.015,.985,y,y+.09);
      const panes=Math.max(3,Math.ceil(length/.85));
      for(let pane=1;pane<panes;pane++)panel(c.trim,pane/panes-.003,pane/panes+.003,y,y+.09);
      // Deterministic sparse light-colored panes, not emissive materials or lights.
      for(let pane=0;pane<panes;pane++)if((pane+i+row*3)%7===0)panel(c.warmWindow,(pane+.13)/panes,(pane+.86)/panes,y+.012,y+.077);
      panel(c.trim,.015,.985,y+.042,y+.047);
    }
    const storefronts=Math.max(2,Math.ceil(length/2.1));
    for(let pane=0;pane<storefronts;pane++)panel((pane+i)%4===0?c.warmWindow:c.glass,(pane+.09)/storefronts,(pane+.88)/storefronts,.012,.088);
  }
  return batch;
}
