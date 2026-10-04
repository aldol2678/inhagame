import * as pc from 'playcanvas';
import {buildMainHallBlockout} from './main-hall-blockout.js';

export const JEONGSEOK_CANDIDATE=Object.freeze({
  buildingId:'bldg_jungseok',
  tiers:Object.freeze(['BASE','NEAR','DETAIL']),
  coordinateSpace:'CANONICAL_CAMPUS_WORLD_UNITS',
  collisionAuthority:'UNCHANGED_CANONICAL_SOURCE',
  sourceCommit:'316c8ff95f7a12618ec8db61342d153f3cbb29ea',
  appearance:'RECOVERED_PHOTO_INFORMED_EXTERIOR',
  interior:'NOT_INFERRED'
});

const owners=new WeakMap();

// Opt-in mount of the recovered Jeongseok renderer. The caller chooses this OR
// the existing renderer for bldg_jungseok and owns the returned group. Coordinates
// remain campus-local; do not apply another metre conversion or Z reflection.
// The original mesh batching, materials, LOD and mesh cleanup remain authoritative.
export function buildJeongseokCandidate(root,tier='BASE'){
  if(!JEONGSEOK_CANDIDATE.tiers.includes(tier))throw new RangeError('Unknown Jeongseok tier: '+tier);
  let tiers=owners.get(root);
  if(!tiers){tiers=new Map();owners.set(root,tiers);}
  const existing=tiers.get(tier);
  if(existing?.parent===root)return existing;
  const group=new pc.Entity('bldg_jungseok_candidate_'+tier);
  root.addChild(group);
  try{buildMainHallBlockout(group,[JEONGSEOK_CANDIDATE.buildingId],tier);}
  catch(error){group.destroy();throw error;}
  tiers.set(tier,group);
  group.once('destroy',()=>{if(tiers.get(tier)===group)tiers.delete(tier);});
  return group;
}
