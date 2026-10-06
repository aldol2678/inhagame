// Same current-campus renderer, old/new presentation only. No private fixtures.
import { BACK_ALLEY_BLOCKS } from '../../src/back-alley-layout.js';
import { MARKET_BUILDINGS, GEONMULJU_BUILDING } from '../../src/back-market-layout.js';
import { cameraFor, frontOf, expectedRaster, VIEWPORTS } from './backgate-shopfront-qa-plan.mjs';
import { ROAD_VIEWS } from './backgate-road-qa-plan.mjs';
export { cameraFor, frontOf, expectedRaster, VIEWPORTS };
export { roadCameraFor, roadViewCorners } from './backgate-road-qa-plan.mjs';
export const BASELINE='3b95e37f3dec477ebe7e06456907176bb81a63a2';
export const CURRENT_MAIN='995364fa5a403fcd290d1bf7357b78f85692c447';
export const BASELINE_PATHS=Object.freeze([
  '/src/back-alley-geometry.js','/src/back-market-geometry.js',
  '/src/back-street-geometry.js','/src/culture-street-geometry.js',
  '/src/north-side-gate-geometry.js','/src/campus-road-blockout.js'
]);
export const TARGETS=[...BACK_ALLEY_BLOCKS,...MARKET_BUILDINGS.filter(q=>q!==GEONMULJU_BUILDING)];
export const VIEWS=[
  {name:'alley-67',plot:BACK_ALLEY_BLOCKS.find(q=>q.id.includes('inha_67_entrance')),prefixes:['back_alley_base_','back_alley_near_','back_alley_detail_']},
  ...['cafe'].map(style=>({name:`market-${style}`,plot:MARKET_BUILDINGS.find(q=>q.style===style),prefixes:['back_market_base_','back_market_near_','back_market_detail_']})),
  ...ROAD_VIEWS.map(view=>({...view,kind:'road',prefixes:view.name==='side-gate'?['north_side_gate_']:view.name==='culture-paving'?['culture_street_paving_']:['back_street_paving_','back_street_signals_','back_street_base_758b89']}))
];
export function assertHosted(env){
  if(env.GITHUB_ACTIONS!=='true'||env.RUNNER_ENVIRONMENT!=='github-hosted')throw Error('Backgate restoration browser QA is GitHub-hosted only; never bypass local browser restrictions');
  if(!/^[a-f0-9]{40}$/.test(env.EXPECTED_BACKGATE_HEAD||''))throw Error('Exact public candidate head required');
}

// All poses are meaningful ALL-tier comparisons; repeat BASE only where the
// buildings actually change LOD, on desktop. Persistent road layers need no duplicate.
export const tiersFor=(view,viewport)=>view.plot&&viewport.name==='desktop'?['ALL','BASE']:['ALL'];
export const EXPECTED_PAIRS=VIEWPORTS.reduce((sum,viewport)=>sum+VIEWS.reduce((n,view)=>n+tiersFor(view,viewport).length,0),0);
export const EXPECTED_SCREENSHOTS=EXPECTED_PAIRS*2;

// The pinned baseline has no rendered side-crossing signals or zebra, although
// its collision poles exist. New geometry must always contribute visible pixels.
export function expectedContribution(view,variant){
  if(!['old','new'].includes(variant))throw Error('Unknown comparison variant');
  return variant!=='old'||view.name!=='side-crossing';
}
