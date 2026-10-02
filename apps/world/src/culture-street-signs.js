import { CULTURE_BUILDINGS, CULTURE_GATE } from './culture-street-layout.js';
import { streetSign, facadeSign } from './street-sign-layout.js';
import { buildStreetSigns } from './street-sign-renderer.js';

export function buildCultureSigns(root,ids,{canopy=false}={}) {
  const records=canopy?[-1,1].map(side=>{
    const center=CULTURE_GATE.frame.at(side*2.49),out=CULTURE_GATE.frame.at(side*3.49);
    return streetSign({id:`culture_title_${side}`,label:'인하문화의거리',center,outward:{x:out.x-center.x,z:out.z-center.z},width:4.2,bottom:3.77,top:4.35});
  }):CULTURE_BUILDINGS.filter(q=>ids.includes(q.id)).map(q=>facadeSign(q,{width:q.style==='round'?4.4:q.w-.65}));
  buildStreetSigns(root,records,canopy?'culture_street_lettering':'culture_shop_signs');
}
