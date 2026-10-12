import {BUILDINGS,HALL_FRONT,LIBRARY_FRONT,LIBRARY_ROOF_PARTS} from '../../src/basic-campus.js';
import {LIBRARY_APPROACHES} from '../../src/roadview-layout.js';

const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
export function landmarkDiagnosticCaption(state) {
 const building=state.id==='bldg_01'?'Main Hall':'Jeongseok';
 const label={currentmain:'current main',baseline108:'literal #108',previous144:'literal #144',baseline108materials:'#108 · current materials',previous144materials:'#144 · current materials',preexterior:'pre-exterior main',candidate:'candidate'}[state.presentation];
 return `${building} · ${label}\n${state.reflected?'reflected Z':'control Z'} · ${state.mode}`;
}
// PlayCanvas refreshes cached camera matrices during prerender. Diagnostic
// bounds must be projected only after a real frame has consumed camera changes.
export function waitForDiagnosticFrame(app,timeoutMs=6000){
 return new Promise((resolve,reject)=>{
  const finish=()=>{clearTimeout(timer);resolve();};
  const timer=setTimeout(()=>{app.off('postrender',finish);reject(new Error('Diagnostic camera frame deadline exceeded'));},timeoutMs);
  app.once('postrender',finish);app.renderNextFrame=true;
 });
}
const roofPoints=part=>part.vertices.flatMap(p=>[part.y-part.height/2,part.y+part.height/2].map(y=>[p.x,y,p.z]));
function sourcePoints(id){
 const b=BUILDINGS.find(b=>b.id===id);
 if(!b)throw new Error('Unscoped photo landmark '+id);
 const points=(b.rings?b.rings.flat():b.vertices).flatMap(p=>[0,b.height].map(y=>[p.x,y,p.z]));
 return id==='bldg_jungseok'?points.concat(LIBRARY_ROOF_PARTS.flatMap(roofPoints)):points;
}
export function photoLandmarkView(id,aspect=1,{points,mode='full'}={}){
 let position,target;
 if(mode==='canopy'&&id==='bldg_jungseok'){
  const p=LIBRARY_FRONT.at(8,14),t=LIBRARY_FRONT.at(0,1.1);
  position=[p.x,1.8,p.z];target=[t.x,4.3,t.z];points=roofPoints(LIBRARY_ROOF_PARTS.find(p=>p.id==='library_entry_canopy'));
 }else if(mode==='west'&&id==='bldg_jungseok'){
  const [a,b]=BUILDINGS.find(b=>b.id===id).vertices,dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
  const ring=BUILDINGS.find(b=>b.id===id).vertices,area=ring.reduce((sum,p,i)=>sum+p.x*ring[(i+1)%ring.length].z-ring[(i+1)%ring.length].x*p.z,0);
  const sign=area>0?1:-1;target=[(a.x+b.x)/2,8.5,(a.z+b.z)/2];
  position=[target[0]+sign*dz/length*42,12,target[2]-sign*dx/length*42];
 }else if(mode==='entry'&&id==='bldg_jungseok'){
  const p=LIBRARY_FRONT.at(4,11),t=LIBRARY_FRONT.at(0,.8);position=[p.x,3.4,p.z];target=[t.x,2.8,t.z];
  points=jeongseokExteriorRegions().allowed.filter(region=>['lower-glazing','entry-doors','entry-canopy'].includes(region.name)).flatMap(region=>region.points);
 }else if(id==='bldg_01'){const h=HALL_FRONT,x=(h.a.x+h.b.x)/2,z=(h.a.z+h.b.z)/2;position=[x-h.inward.x*48,14,z-h.inward.z*48];target=[x,5,z];}
 else if(id==='bldg_jungseok'){const p=LIBRARY_FRONT.at(0,40),t=LIBRARY_FRONT.at(0,-4);position=[p.x,21,p.z];target=[t.x,9,t.z];}
 else throw new Error('Unscoped photo landmark '+id);
 points??=sourcePoints(id);
 // Fit every actual mesh-bound corner, not a distance/aspect heuristic. Keep the
 // established viewing direction and reflection semantics; only the QA camera moves.
 const offset=position.map((x,i)=>x-target[i]),back=offset.map(x=>x/Math.hypot(...offset));
 const side=[back[2],0,-back[0]],right=side.map(x=>x/Math.hypot(...side));
 const up=[back[1]*right[2],back[2]*right[0]-back[0]*right[2],-back[1]*right[0]];
 const tan=Math.tan(48*Math.PI/360),margin=.84;
 let distance=Math.hypot(...offset);
 for(const point of points){const delta=point.map((x,i)=>x-target[i]),toward=dot(delta,back);
  distance=Math.max(distance,toward+Math.abs(dot(delta,right))/(tan*aspect*margin),toward+Math.abs(dot(delta,up))/(tan*margin));}
 return {position:target.map((x,i)=>x+back[i]*distance),target,points,mode};
}

// These independent QA envelopes describe only the reviewed exterior surfaces.
// Never derive an allow region from candidate mesh bounds: an accidental oversized
// mesh would otherwise authorize its own pixel changes. Navigation frames stay canonical.
const volumePoints=(at,u0,u1,v0,v1,y0,y1)=>[u0,u1].flatMap(u=>[v0,v1].flatMap(v=>[y0,y1].map(y=>{const p=at(u,v);return [p.x,y,p.z];})));
export function jeongseokExteriorRegions(){
 const canopy=LIBRARY_ROOF_PARTS.find(part=>part.id==='library_entry_canopy');
 const ring=BUILDINGS.find(building=>building.id==='bldg_jungseok').vertices;
 return {
  allowed:[
   {name:'lower-glazing',points:volumePoints(LIBRARY_FRONT.at,-2.7,2.7,-.06,.62,1,3.32)},
   {name:'entry-doors',points:volumePoints(LIBRARY_FRONT.at,-4,4,-.40,2.35,1.65,4.5)},
   {name:'entry-canopy',points:roofPoints(canopy)},
   ...LIBRARY_APPROACHES.map(t=>({name:t.id+'-stairs',points:volumePoints(t.frame.at,0,t.frame.length,-.025,t.landing+t.run+.025,0,t.height+.455)}))
  ],
  protected:[
   {name:'upper-building',points:ring.flatMap(p=>[5,17].map(y=>[p.x,y,p.z])).concat(LIBRARY_ROOF_PARTS.filter(part=>part.id!=='library_entry_canopy').flatMap(roofPoints))},
   {name:'west-facade',points:ring.slice(0,2).flatMap(p=>[.9,16.25].map(y=>[p.x,y,p.z]))}
  ]
 };
}
export function projectedConvexHull(points){
 const sorted=points.map(p=>({x:p.x,y:p.y})).sort((a,b)=>a.x-b.x||a.y-b.y);
 const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
 const half=list=>{const result=[];for(const point of list){while(result.length>1&&cross(result.at(-2),result.at(-1),point)<=0)result.pop();result.push(point);}return result;};
 return [...half(sorted).slice(0,-1),...half([...sorted].reverse()).slice(0,-1)];
}
export function insideProjectedRegion(x,y,polygon,padding=0){
 if(polygon.length<3)return false;
 for(let i=0;i<polygon.length;i++){
  const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dy=b.y-a.y;
  if(dx*(y-a.y)-dy*(x-a.x)<-padding*Math.hypot(dx,dy))return false;
 }
 return true;
}
export function projectJeongseokExteriorRegions(project,reflected){
 const regions=jeongseokExteriorRegions();
 const convert=region=>{
  const points=region.points.map(([x,y,z])=>project([x,y,z*(reflected?-1:1)]));
  if(points.some(p=>![p.x,p.y,p.z].every(Number.isFinite)||p.z<=0))throw Error('Exterior ROI projection must be finite and in front of the active camera');
  return {name:region.name,polygon:projectedConvexHull(points),minDepth:Math.min(...points.map(p=>p.z))};
 };
 return {allowed:regions.allowed.map(convert),protected:regions.protected.map(convert),padding:2};
}
