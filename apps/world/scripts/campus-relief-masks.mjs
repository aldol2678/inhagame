// Emit the current game's fixed-grade geometry for the offline relief bake.
import { OBSTACLES, WORLD_BOUNDS } from '../src/campus-layout.js';
import { SITE_FEATURES } from '../src/basic-campus.js';
import { FACILITIES } from '../src/campus-facilities.js';
import { CAMPUS_ROADS, CAMPUS_PATH_WIDTHS } from '../src/campus-road-layout.js';
import { campusNavPolylines } from '../src/navigation/campus-navigation.js';
import { POND_RING, LIBRARY_APPROACHES, MAIN_HALL_APPROACH, rectInFrame } from '../src/roadview-layout.js';
import { LIBRARY_BANK_CELLS, LIBRARY_ROUTE_CELLS } from '../src/library-route-layout.js';
import { LIBRARY_GREENS } from '../src/library-garden-layout.js';
import { SPORTS_CUT_RING } from '../src/stadium-stands-layout.js';
import { forestSoilRing } from '../src/heidegger-forest-geometry.js';
const polygons=[POND_RING,SPORTS_CUT_RING,...LIBRARY_GREENS.map(q=>q.polygon),
  ...[...LIBRARY_BANK_CELLS,...LIBRARY_ROUTE_CELLS].map(q=>q.polygon),
  ...FACILITIES.flatMap(f=>f.rings),...OBSTACLES.map(q=>q.polygon).filter(Boolean),
  ...SITE_FEATURES.filter(f=>f.kind==='reflecting_pool').map(f=>f.vertices),
  ...[...LIBRARY_APPROACHES,MAIN_HALL_APPROACH].map(q=>rectInFrame(q.frame,0,q.frame.length,0,q.landing+q.run)),
  forestSoilRing(FACILITIES.find(f=>f.id==='lmk_heidegger_forest').center)];
const roads=new Map(CAMPUS_ROADS.map(q=>[q.id,q.width+2*q.shoulder]));
const paths=campusNavPolylines().map(p=>({points:p.points,
  width:roads.get(p.id)??(p.source==='SITE_FEATURES_PATH'?(CAMPUS_PATH_WIDTHS[p.id]??3.5)+2.1:4)}));
const points=FACILITIES.filter(f=>f.kind==='landmark').map(f=>({...f.center,radius:8}));
console.log(JSON.stringify({polygons,paths,points,bounds:WORLD_BOUNDS}));
