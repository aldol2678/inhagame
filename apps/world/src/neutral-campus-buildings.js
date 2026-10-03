// Fresh procedural presentation from public footprint/height/floor facts only.
// These generic facades do not reproduce the real buildings or any visual reference.
import { triangulatePolygon } from './reality-adapter.js';

export const NEUTRAL_FACADE_COLORS = Object.freeze({
  wall:'#d7d3c7', trim:'#ece9df', glass:'#396773', roof:'#6f7775'
});

// Scope is pinned to the 21 public facilities validated in the WorldForge Draft.
// Existing main hall/library and surrounding shop blocks are deliberately excluded.
const ids = new Set([
  'bldg_02_south','bldg_02_north','bldg_04','bldg_05','bldg_60th',
  'bldg_06','bldg_09','bldg_07','bldg_hitech','bldg_seoho','bldg_nabille',
  'bldg_lawschool','bldg_rotc','bldg_continuing','bldg_dream1','bldg_hawaii',
  'bldg_c','bldg_dream2','bldg_dream3','bldg_dorm1','bldg_dorm2'
]);
export const isNeutralCampusBuilding = f => f.kind === 'building' && ids.has(f.id);

const profiles = Object.freeze([
  Object.freeze({ name:'regular-grid', bay:3.4, width:.62, height:.54 }),
  Object.freeze({ name:'horizontal-ribbon', bay:4.4, width:.88, height:.42 }),
  Object.freeze({ name:'vertical-pairs', bay:2.5, width:.48, height:.72 })
]);

export function neutralFacadeProfile(f) {
  // Stable IDs choose a fresh generic rhythm, never the withheld style field.
  const seed = [...f.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return profiles[seed % profiles.length];
}

/** BASE is a coarse closed envelope (two shared materials); NEAR is window/trim
 * decals (two shared depth-biased materials). DETAIL adds nothing. The caller's
 * existing chunk residency/fade policy owns the decals; far views stay inexpensive.
 * Both tiers remain exactly on the boundary with no new gameplay colliders.
 * Courtyard wall normals point into the opening for either source ring winding.
 */
export function fillNeutralCampusBuilding(batch, f, tier='BASE') {
  if (tier !== 'BASE' && tier !== 'NEAR') return batch;
  const colors = NEUTRAL_FACADE_COLORS, profile = neutralFacadeProfile(f);
  const floors = Math.max(1, Math.min(16, Math.round(f.floors || f.height / 2.5)));
  const plinth = Math.min(.6, f.height*.08), cornice = Math.min(.35, f.height*.05);
  const step = (f.height-plinth-cornice)/floors;
  for (const [ringIndex, ring] of f.rings.entries()) {
    const area2 = ring.reduce((s, a, i) => {
      const b = ring[(i+1)%ring.length]; return s+a.x*b.z-b.x*a.z;
    }, 0);
    const forward = (area2 > 0) !== (ringIndex > 0);
    for (const [i, a] of ring.entries()) {
      const b = ring[(i+1)%ring.length], dx = b.x-a.x, dz = b.z-a.z;
      const length = Math.hypot(dx, dz);
      if (length < 1e-8) continue;
      const point = (u, y) => [a.x+dx*u, y, a.z+dz*u];
      const tile = (color, left, right, bottom, top) => {
        if (right-left < 1e-10 || top-bottom < 1e-10) return;
        const p = [point(left,bottom),point(left,top),point(right,top),point(right,bottom)];
        batch.quad(color, ...(forward ? p : p.reverse()));
      };
      if (tier === 'BASE') { tile(colors.wall,0,1,0,f.height); continue; }
      tile(colors.trim,0,1,0,plinth);
      tile(colors.trim,0,1,f.height-cornice,f.height);
      const bays = Math.max(1,Math.ceil(length/profile.bay));
      for (let floor = 0; floor < floors; floor++) {
        const bottom = plinth+floor*step, top = plinth+(floor+1)*step;
        // Very short source edges stay solid; changing the footprint to fit windows
        // would invent a shape and can cover a concave setback.
        if (length < .8) continue;
        const sill = bottom+step*(1-profile.height)/2;
        const lintel = sill+step*profile.height;
        for (let bay = 0; bay < bays; bay++) {
          const left = bay/bays, right = (bay+1)/bays;
          const margin = (1-profile.width)/(2*bays);
          tile(colors.glass,left+margin,right-margin,sill,lintel);
        }
      }
    }
  }
  // Reuse the existing hole-safe parts; the source rings and all gameplay colliders
  // remain untouched. One roof material merges even 5호관's 42 roof pieces.
  if(tier==='BASE')for (const part of f.parts) {
    const indices = triangulatePolygon(part);
    for (let i = 0; i < indices.length; i += 3) {
      batch.triangle(colors.roof, ...indices.slice(i,i+3).map(index => [part[index].x,f.height,part[index].z]));
    }
  }
  return batch;
}
