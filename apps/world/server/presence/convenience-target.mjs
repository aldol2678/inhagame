import { createHash } from 'node:crypto';
import { INCOME_CONVENIENCE_LOCATION as shop } from '../../src/income/income-convenience-location.mjs';
import { roadviewGroundHeight } from '../../src/roadview-layout.js';
import { PLAYER_ORIGIN_Y } from '../../src/player-dimensions.js';
// Deliberately no moving NPC013 / roster / meeting dependencies.
export const CONVENIENCE_TARGET = Object.freeze({id:'BACKGATE-NPC-001',version:'back_street_4-v1',
  position:Object.freeze({...shop.position,y:roadviewGroundHeight(shop.position.x,shop.position.z)})});
export function convenienceEligible(position,geometry) {
 const t=CONVENIENCE_TARGET.position;
 return geometry.valid(position) && Math.abs(position.y-PLAYER_ORIGIN_Y-t.y)<=1.5 &&
   Math.hypot(position.x-t.x,position.z-t.z)<=2.5 && geometry.lineOfSight(position,t);
}
export function convenienceGeometryRevision(geometry) {
 return createHash('sha256').update(JSON.stringify({geometry:geometry.manifest.digest,target:CONVENIENCE_TARGET})).digest('hex');
}
