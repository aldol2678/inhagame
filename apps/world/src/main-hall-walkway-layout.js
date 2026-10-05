import { SITE_FEATURES } from './basic-campus.js';
import { CAMPUS_PATH_WIDTHS, roadFrame } from './campus-road-layout.js';
import { nearestPolylinePoint } from './library-garden-layout.js';

// The two pool-side avenues continue to the hall's transverse lane in the
// university-provided aerial published 2025-12-28. The photograph does not
// establish surveyed width, stair count or elevation. Existing source endpoints
// and the same nearest projection formerly used by the nav graph own this patch.
const across=SITE_FEATURES.find(f=>f.id==='site_481241692');
export const MAIN_HALL_WALKWAY_SOURCE_IDS=Object.freeze(['site_481241657','site_258995842',across.id]);
export const MAIN_HALL_WALKWAYS=Object.freeze(MAIN_HALL_WALKWAY_SOURCE_IDS.slice(0,2).map((sourceId,i)=>{
  const source=SITE_FEATURES.find(f=>f.id===sourceId),start=source.vertices.at(-1);
  const end=nearestPolylinePoint(start,across.vertices);
  const points=Object.freeze([Object.freeze({...start}),Object.freeze({...end})]);
  return Object.freeze({id:`main_hall_walkway_${i===0?'west':'east'}`,sourceId,
    points,width:CAMPUS_PATH_WIDTHS[sourceId]||3.5,frame:roadFrame(...points)});
}));
