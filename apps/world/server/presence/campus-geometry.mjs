import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { OBSTACLES } from '../../src/campus-layout.js';
import { canOccupy, moveAroundObstacles } from '../../src/world-collision.js';
import { triangulatePolygon } from '../../src/reality-adapter.js';
import { WALK_SHAPE, PLAYER_ORIGIN_Y } from '../../src/player-dimensions.js';
import { EXTERIOR_WORLD_BOUNDS } from '../../src/world-exterior-bounds.js';
import { roadviewGroundHeight } from '../../src/roadview-layout.js';
import { constrainPondWalk, overPondWater } from '../../src/landmark-detail-layout.js';
import { MAIN_GATE_SPAWN, BACK_GATE_SPAWN } from '../../src/campus-spawn.js';

// Hash canonical collider data, this policy and statically named local module/JSON inputs.
// Dynamic loader paths are not claimed as a complete dependency graph. No browser transform/pose.
export function sourceClosure(roots) {
  const files = new Map();
  function visit(url) {
    if (files.has(url.pathname)) return;
    const source = readFileSync(url, 'utf8');
    files.set(url.pathname, createHash('sha256').update(source).digest('hex'));
    for (const match of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+\.(?:m?js|json))['"]/g)) visit(new URL(match[1], url));
    for (const match of source.matchAll(/new URL\(['"](\.[^'"]+\.json)['"],\s*import\.meta\.url\)/g)) visit(new URL(match[1],url));
  }
  for (const url of roots) visit(url);
  const sources = [...files].map(([path, sha256]) => [path.split('/apps/world/')[1],sha256]).sort(([a],[b])=>a.localeCompare(b));
  return sources;
}
export function geometryManifest() {
  const sources=sourceClosure([new URL('./campus-geometry.mjs',import.meta.url),new URL('../../data/reality/campus-buildings.json',import.meta.url),new URL('../../data/reality/campus-site.json',import.meta.url),...['world-collision.js','roadview-layout.js','landmark-detail-layout.js','campus-spawn.js'].map(path=>new URL('../../src/'+path,import.meta.url))]);
  const digest = createHash('sha256').update(JSON.stringify({sources,obstacles:OBSTACLES,bounds:EXTERIOR_WORLD_BOUNDS,shape:WALK_SHAPE})).digest('hex');
  return Object.freeze({ frame:'CAMPUS_LOCAL_XYZ', version:'closed-campus-walk-v1', digest, sources:Object.freeze(sources.map(Object.freeze)) });
}
export function createCampusGeometry() {
  const manifest=geometryManifest(), bounds=EXTERIOR_WORLD_BOUNDS;
  const ground = (x,z) => roadviewGroundHeight(x,z)+PLAYER_ORIGIN_Y;
  const valid = p => p && [p.x,p.y,p.z].every(Number.isFinite) && p.x>=bounds.minX+WALK_SHAPE.radius && p.x<=bounds.maxX-WALK_SHAPE.radius &&
    p.z>=bounds.minZ+WALK_SHAPE.radius && p.z<=bounds.maxZ-WALK_SHAPE.radius && !overPondWater(p.x,p.z) &&
    Math.abs(p.y-ground(p.x,p.z))<1e-7 && canOccupy(p);
  return Object.freeze({ manifest, valid,
    lineOfSight(a,b){return canonicalSightline({...a,y:a.y-.5},{...b,y:b.y+.65});},
    spawn(id) { const anchor=id==='MAIN_GATE'?MAIN_GATE_SPAWN:id==='BACK_GATE'?BACK_GATE_SPAWN:null;
      if(!anchor)throw Error('SPAWN_UNKNOWN'); const p={x:anchor.x,y:ground(anchor.x,anchor.z),z:anchor.z};
      if(!valid(p))throw Error('SPAWN_GEOMETRY_INVALID'); return p; },
    advance(from,dx,dz) {
      if(!valid(from))throw Error('POSITION_GEOMETRY_INVALID');
      const moved=moveAroundObstacles(from,dx,dz);
      const pond=constrainPondWalk(from,{...from,x:moved.x,z:moved.z});
      const p={x:pond.x,z:pond.z,y:ground(pond.x,pond.z)};
      // This conservative candidate cannot climb stairs/steep slopes, mount or jump.
      return valid(p)&&Math.abs(p.y-from.y)<=.12 ? p : {...from};
    }
  });
}

// A sight ray has no camera skin. Reusing the expanded camera sweep would falsely occlude nearby trees.
export function canonicalSightline(from,to,obstacles=OBSTACLES) {
  const a=[from.x,from.y,from.z],b=[to.x,to.y,to.z];
  if(![...a,...b].every(Number.isFinite))return false;
  const hits=planes=>{let enter=0,leave=1;for(const [n,limit] of planes){const start=n.reduce((s,v,i)=>s+v*a[i],0)-limit,delta=n.reduce((s,v,i)=>s+v*(b[i]-a[i]),0);
    if(Math.abs(delta)<1e-12){if(start>0)return false;}else if(delta<0)enter=Math.max(enter,-start/delta);else leave=Math.min(leave,-start/delta);
  }return enter<=leave&&enter<=1&&leave>=0;};
  for(const body of obstacles){const vertical=[[[0,1,0],body.maxY],[[0,-1,0],-body.minY]];
    if(!body.polygon){if(hits([...vertical,[[1,0,0],body.maxX],[[-1,0,0],-body.minX],[[0,0,1],body.maxZ],[[0,0,-1],-body.minZ]]))return false;continue;}
    const ids=triangulatePolygon(body.polygon);
    for(let i=0;i<ids.length;i+=3){const points=ids.slice(i,i+3).map(id=>body.polygon[id]);
      const area=points.reduce((s,p,j)=>{const q=points[(j+1)%3];return s+p.x*q.z-q.x*p.z;},0);
      const planes=points.map((p,j)=>{const q=points[(j+1)%3],dx=q.x-p.x,dz=q.z-p.z,n=area>0?[dz,0,-dx]:[-dz,0,dx];return[n,n[0]*p.x+n[2]*p.z];});
      if(hits([...planes,...vertical]))return false;
    }
  }return true;
}
