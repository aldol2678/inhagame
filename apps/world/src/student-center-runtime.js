// Real-campus adapter for the reviewed v09 building. Stateless: actor altitude is
// only a ceiling for querying real surfaces; it can never become a cached floor.
import {studentConnectedFrame} from './student-center-frame.js';
import {supports,support,footprint} from './student-center-connected-data.js';
import {createStudentConnectedWalk} from './student-center-connected.js';
import {WALK_SHAPE} from './player-dimensions.js';

const frame=studentConnectedFrame(),walk=createStudentConnectedWalk({space:'world'});
const EPS=1e-6;
export function inStudentCampusRegion(x,z){
 const q=frame.toLocal([x,0,z]);
 return q[0]>=-36&&q[0]<=31&&q[2]>=-28&&q[2]<=29;
}
// Returns null outside the bounded building area. Under an upper floor the ground
// remains the lower floor/terrain; a high camera or jumping actor cannot lift it.
export function studentCampusGroundHeight(x,z,maxHeight=0){
 if(!inStudentCampusRegion(x,z)||!Number.isFinite(maxHeight))return null;
 const q=frame.toLocal([x,0,z]),b=footprint(q[0],q[2]);
 const heights=[...new Set(supports.filter(s=>s.height/2<=maxHeight+EPS&&s.x1>=b.x0&&s.x0<=b.x1&&s.z1>=b.z0&&s.z0<=b.z1).map(s=>s.height))].sort((a,b)=>b-a);
 for(const h of heights){const s=support(b,h);if(s&&Math.abs(s.height-h)<EPS)return h/2;}
 return 0;
}
// Grounded walking follows actual treads before the ordinary collision sweep can
// mistake their risers for walls. Mounts/airborne motion keep full static collision.
export function studentCampusStep(position,dx,dz,{grounded=true}={}){
 if(!grounded||(!inStudentCampusRegion(position.x,position.z)&&!inStudentCampusRegion(position.x+dx,position.z+dz)))return null;
 const feet=position.y-WALK_SHAPE.footOffset;
 const h=studentCampusGroundHeight(position.x,position.z,feet)??0;
 if(Math.abs(feet-h)>EPS)return null;
 const check=walk.inspect(position.x,position.z,h);
 if(!check.supported||!check.clear)return null;
 const next=walk.step({x:position.x,z:position.z,elevation:h},position.x+dx,position.z+dz);
 return {...next,previousElevation:h};
}
