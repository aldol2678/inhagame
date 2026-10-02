// Logical x/z coordinates use a reflected render root. Choose the text's right
// vector from its outward normal, rather than the building polygon winding.
export function streetSign({id,label,center,outward,width,bottom,top}) {
  const len=Math.hypot(outward.x,outward.z),nx=outward.x/len,nz=outward.z/len;
  const p=(side,y)=>[center.x-side*nz*width/2,y,center.z+side*nx*width/2];
  return {id,label,corners:[p(-1,bottom),p(1,bottom),p(1,top),p(-1,top)],normal:[nx,0,nz]};
}

export function facadeSign(q,{v=-.19,bottom=1.96,top=2.37,width=q.w-.65}={}) {
  const center=q.frame.at(0,v),out=q.frame.at(0,v-1);
  return streetSign({id:q.id,label:q.label,center,outward:{x:out.x-center.x,z:out.z-center.z},width,bottom,top});
}
