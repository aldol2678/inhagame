// Local, public-only WorldForge interchange. No editor API, promotion or live fetch.
const url = new URL('../data/reality/worldforge-campus-buildings.manifest.json',import.meta.url);
const manifest = typeof window === 'undefined'
  ? JSON.parse((await import('node:fs')).readFileSync(url,'utf8'))
  : await (async()=>{const r=await fetch(url);if(!r.ok)throw Error(`WorldForge building import failed: ${r.status}`);return r.json();})();

// Convert the native meter/+Z-south export exactly once, before rendering.
const point = p => Object.freeze({x:p.x/2,z:-p.z/2-90});
const ring = r => Object.freeze(r.map(point));
const imported = new Map(manifest.buildings.map(b=>[b.id,Object.freeze({
  rings:Object.freeze(b.rings.map(ring)),
  parts:Object.freeze(b.parts.map(p=>ring(p.footprint))),
  height:b.heightMeters/2
})]));
const samePoint = (a,b) => Number.isFinite(a.x)&&Number.isFinite(a.z)&&Math.abs(a.x-b.x)<1e-7&&Math.abs(a.z-b.z)<1e-7;
// Native WorldForge normalizes part winding. Cyclic rotation/reversal preserves
// the polygon; a reordered interior vertex or changed boundary does not.
const sameRing = (a,b) => a.length===b.length&&b.some((p,start)=>samePoint(a[0],p)&&[1,-1].some(direction=>
  a.every((q,i)=>samePoint(q,b[(start+direction*i+b.length)%b.length]))));
const equalRings = (a,b) => a.length===b.length&&a.every((r,i)=>sameRing(r,b[i]));
const sameParts = (a,b) => {
  if(a.length!==b.length)return false;
  const remaining=[...b];
  return a.every(r=>{const index=remaining.findIndex(q=>sameRing(r,q));if(index<0)return false;remaining.splice(index,1);return true;});
};

/** Rendering consumes the validated Draft export. Gameplay remains canonical;
 * a stale/mismatched import must fail visibly rather than create invisible walls.
 */
export function resolveWorldForgeBuilding(f) {
  const geometry=imported.get(f.id);
  if(!geometry)return null;
  if(Math.abs(geometry.height-f.height)>1e-7||!equalRings(geometry.rings,f.rings)||!sameParts(geometry.parts,f.parts)){
    throw Error(`WorldForge building geometry mismatch: ${f.id}`);
  }
  return Object.freeze({...f,...geometry});
}
