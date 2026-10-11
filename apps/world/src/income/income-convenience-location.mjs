import { MARKET_EXISTING_SHOPS } from '../back-market-layout.js';
import { BACK_GATE } from '../back-gate-layout.js';
const building = MARKET_EXISTING_SHOPS.find(item => item.id === 'back_street_4');
if (!building || building.label !== '편의점') throw new Error('INCOME_LOCATION_MAPPING_CHANGED');
// User-selected game-world use of an existing illustrative facade, not a real tenant/brand claim.
export const INCOME_CONVENIENCE_LOCATION = Object.freeze({
  id: 'income.candidate.backgate_convenience', buildingId: building.id,
  label: '후문 앞 편의점 · 게임 내 후보', employerId: null, enabled: false,
  position: Object.freeze({ ...building.frame.at(0, -1), y: 0 }),
  facade: Object.freeze({ ...building.frame.at(0, 0), y: 1.5 }),
  gateDistance: Math.hypot(building.frame.at(0, -1).x - BACK_GATE.x, building.frame.at(0, -1).z - BACK_GATE.z),
  // Geometry-test approach around existing rail/tree. No automatic travel or server proof.
  approach: Object.freeze([[0,0],[4.5,0],[4.5,6.5],[10.5,6.5],[10.5,9.5]]
    .map(([x,z]) => Object.freeze({ x: BACK_GATE.x+x, z: BACK_GATE.z+z })))
});
