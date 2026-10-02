import { FACILITY_BOUNDS } from './campus-facilities.js';
import { CULTURE_BOUNDS } from './culture-street-layout.js';
import { MARKET_BOUNDS } from './back-market-layout.js';

const bounds=[FACILITY_BOUNDS,CULTURE_BOUNDS,MARKET_BOUNDS];
export const EXTERIOR_WORLD_BOUNDS=Object.freeze({
  minX:Math.min(...bounds.map(b=>b.minX)),maxX:Math.max(...bounds.map(b=>b.maxX)),
  minZ:Math.min(...bounds.map(b=>b.minZ)),maxZ:Math.max(...bounds.map(b=>b.maxZ))
});
