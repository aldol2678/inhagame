import { polygonOverlap } from './polygon-collision.js';
import { stadiumTrack } from './facility-ground-layout.js';

// Fit the source ring, including its split long edges. The longest individual
// edge is not necessarily the field axis. Court dimensions are visual estimates.
export function sportsFrame(f){
  const ring=f.rings[0];let best;
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],len=Math.hypot(b.x-a.x,b.z-a.z);if(len<1)continue;
    const tx=(b.x-a.x)/len,tz=(b.z-a.z)/len;
    const us=ring.map(p=>p.x*tx+p.z*tz),vs=ring.map(p=>-p.x*tz+p.z*tx);
    const u0=Math.min(...us),u1=Math.max(...us),v0=Math.min(...vs),v1=Math.max(...vs),area=(u1-u0)*(v1-v0);
    if(!best||area<best.area)best={tx,tz,u0,u1,v0,v1,area};
  }
  const {tx,tz,u0,u1,v0,v1}=best,cu=(u0+u1)/2,cv=(v0+v1)/2;
  const rotated=u1-u0<v1-v0;
  const at=(u,v)=>{const a=cu+(rotated?-v:u),b=cv+(rotated?u:v);return {x:a*tx-b*tz,z:a*tz+b*tx};};
  let w=(rotated?v1-v0:u1-u0)*(f.style==='stadium'?.94:.88),d=(rotated?u1-u0:v1-v0)*(f.style==='stadium'?.9:.82);
  // Keep fencing/track outer edge inside the irregular source area.
  for(let tries=0;tries<30;tries++){
    const corners=f.style==='stadium'?Array.from({length:128},(_,i)=>{
      const a=i*Math.PI/64;return at(Math.cos(a)*d/2+Math.sign(Math.cos(a))*(w-d)/2,Math.sin(a)*d/2);
    }):[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([u,v])=>at(u,v));
    if(corners.every(p=>polygonOverlap(p.x,p.z,ring)))break;
    w*=.97;d*=.97;
  }
  return {w,d,at,yaw:-Math.atan2(at(1,0).z-at(0,0).z,at(1,0).x-at(0,0).x)*180/Math.PI};
}
export function fillSports(batch,f,tier='BASE'){
  const {w,d,at,yaw}=sportsFrame(f),white='#eee9d8',p=(u,y,v)=>{const q=at(u,v);return [q.x,y,q.z];};
  const paint=(a,b,width=.055)=>{
    const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<1e-8)return;
    const x=-dz/len*width/2,z=dx/len*width/2;
    batch.quad(white,p(a[0]+x,.075,a[1]+z),p(b[0]+x,.075,b[1]+z),p(b[0]-x,.075,b[1]-z),p(a[0]-x,.075,a[1]-z));
  };
  const rect=(u0,u1,v0,v1)=>{const pts=[[u0,v0],[u1,v0],[u1,v1],[u0,v1]];pts.forEach((a,i)=>paint(a,pts[(i+1)%4]));};
  const circle=(u,v,r,start=0,end=Math.PI*2)=>{for(let i=0;i<48;i++){const a=start+(end-start)*i/48,b=start+(end-start)*(i+1)/48;paint([u+Math.cos(a)*r,v+Math.sin(a)*r],[u+Math.cos(b)*r,v+Math.sin(b)*r]);}};
  const goal=(u,halfWidth,side)=>{
    if(tier==='BASE')for(const v of [-halfWidth,halfWidth]){
      batch.tube(white,p(u,0,v),p(u,1.22,v),.045,6);
      batch.tube(white,p(u,1.22,v),p(u+side*.75,.12,v),.035,6);
    }
    if(tier==='BASE')batch.tube(white,p(u,1.22,-halfWidth),p(u,1.22,halfWidth),.045,6);
    if(tier==='NEAR'){
      for(let v=-halfWidth;v<=halfWidth;v+=.3)batch.tube('#c1c8b9',p(u,1.22,v),p(u+side*.75,.12,v),.009,4);
      for(let y=.12;y<1.22;y+=.22)batch.tube('#c1c8b9',p(u+side*.75*(1-y/1.22),y,-halfWidth),p(u+side*.75*(1-y/1.22),y,halfWidth),.009,4);
    }
  };
  if(f.style==='stadium'){
    // stadiumTrack adds 3 units beyond its nominal short-side half extent.
    const tw=w-6,td=d-6,b=td*.78;
    // Fit the painted corners inside the inner oval, leaving .2 units of grass.
    // Include half the line width, not just the pitch centerline.
    const radius=td/2-.6-.2,halfWidth=b/2+.055/2;
    const l=Math.min(tw-td*.42,tw-td+2*Math.sqrt(Math.max(0,radius*radius-halfWidth*halfWidth))-.055);
    if(tier==='BASE'){
      for(const q of stadiumTrack(tw,td,at))batch.quad(q.color,...q.vertices);
      rect(-l/2,l/2,-b/2,b/2);paint([0,-b/2],[0,b/2]);circle(0,0,Math.min(4.575,b*.23));
      for(const side of [-1,1]){
        const end=side*l/2;
        for(const [run,span] of [[l*.15,b*.60],[l*.055,b*.28]])rect(Math.min(end,end-side*run),Math.max(end,end-side*run),-span/2,span/2);
        circle(end-side*l*.11,0,.12);goal(end,Math.min(1.83,b*.15),side);
      }
    }else for(const side of [-1,1])goal(side*l/2,Math.min(1.83,b*.15),side);
  }else if(f.style==='basketball'){
    const count=3,cw=Math.min(7.5,w/count*.78),cl=Math.min(14,d*.83);
    for(let i=0;i<count;i++){
      const u=(i-(count-1)/2)*w/count;
      if(tier==='BASE'){
        rect(u-cw/2,u+cw/2,-cl/2,cl/2);paint([u-cw/2,0],[u+cw/2,0]);circle(u,0,Math.min(1.8,cw*.2));
        for(const side of [-1,1]){
          rect(u-cw*.2,u+cw*.2,Math.min(side*cl/2,side*(cl/2-2.9)),Math.max(side*cl/2,side*(cl/2-2.9)));
          circle(u,side*(cl/2-2.9),Math.min(1.8,cw*.2));
          batch.tube('#6b7678',p(u,0,side*(cl/2+.3)),p(u,1.9,side*(cl/2+.3)),.06,6);
          batch.box(white,p(u,1.8,side*(cl/2-.25)),[.9,.55,.07],yaw);
          for(let j=0;j<16;j++){const a=j*Math.PI/8,b=(j+1)*Math.PI/8;batch.tube('#b8653d',p(u+Math.cos(a)*.225,1.525,side*(cl/2-.6)+Math.sin(a)*.225),p(u+Math.cos(b)*.225,1.525,side*(cl/2-.6)+Math.sin(b)*.225),.018,4);}
        }
      }
    }
  }else{
    const count=f.style==='tennis'?3:1,l=Math.min(11.885,d*.85),b=Math.min(5.485,w/count*.8);
    for(let i=0;i<count;i++){
      const u=(i-(count-1)/2)*w/count;
      if(tier==='BASE'){
        rect(u-b/2,u+b/2,-l/2,l/2);rect(u-b*.38,u+b*.38,-l*.27,l*.27);paint([u,-l*.27],[u,l*.27]);
        for(const side of [-1,1])paint([u+side*b*.38,-l/2],[u+side*b*.38,l/2]);
        batch.tube(white,p(u-b/2-.2,.5,0),p(u+b/2+.2,.5,0),.035,6);
      }else for(let s=-b/2;s<b/2;s+=.25)batch.tube('#b6c0b9',p(u+s,.04,0),p(u+s,.48,0),.009,4);
    }
  }
  if(tier==='NEAR'){
    // Edge furniture is inset; a central opening on each side preserves access.
    for(const side of [-1,1]){
      // The Building 5 edge now opens directly onto the concrete stands.
      if(f.id==='fac_basketball'&&side===1)continue;
      const v=side*d/2;
      const end=f.style==='stadium'?(w-d)/2:w/2;
      for(let u=-end;u<=end;u+=2){
        if(Math.abs(u)<2)continue;
        batch.tube('#73847c',p(u,0,v),p(u,1.4,v),.035,5);
        if(Math.abs(u+1)>2&&u+2<=end)for(const y of [.55,1.35])batch.tube('#73847c',p(u,y,v),p(u+2,y,v),.018,4);
      }
      for(const u of [-end*.65,end*.65]){
        batch.box('#8c7461',p(u,.3,v-side*.7),[2,.13,.48],yaw);
        for(const offset of [-.7,.7])batch.box('#626d67',p(u+offset,.15,v-side*.7),[.1,.3,.4],yaw);
      }
    }
  }
}
