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
const BACKGATE_LEGACY_SCOPE=Object.freeze({
  extension:'',base:CURRENT_MAIN,
  allowedRuntimeChanges:Object.freeze([...BASELINE_PATHS.map(p=>'apps/world'+p),'apps/world/src/backgate-infill-geometry.js']),
  requiredSourceHeads:Object.freeze([])
});
const BACKGATE_RELEASE_SCOPE=Object.freeze({
  extension:'release-2026-10-13',
  branch:'release/2026-10-13-ci-runtime-diagnostics',
  base:'2ceb251c11538c80dcfc020c4af4b91948e2caf2',
  allowedRuntimeChanges:Object.freeze([
    'campus-material-profile.js','minimap/minimap-data.js','navigation/campus-navigation.js',
    'north-campus-geometry.js','north-campus-photo-geometry.js','north-walkway-geometry.js',
    'north-walkway-layout.js','north-walkway-surface.js','render-chunk-registry.js',
    'north-landmark-massing.js','north-campus-layout.js',
    'campus-road-blockout.js','north-walkway-batching.js','north-walkway-renderer.js','north-walkway-indexing.js'
  ].map(p=>'apps/world/src/'+p).concat([
    'apps/world/data/reality/north-walkway.provenance.json',
    'apps/world/data/reality/north-landmark-restoration.provenance.json'
  ])),
  requiredSourceHeads:Object.freeze([
    'd436d8f5db161875930db53b7c589c1dab91fc7d',
    '1dcd85d9370b82a32ea29a0992c45618e5a82f5e',
    '912a6d354464e6536029b631a587ab5f64c0ac5c',
    '8f00074c8736a100bd229a1bd29a74e8bfd9698d'
  ])
});
export function backgateScope(env={}){
  const extension=env.WORLD_BACKGATE_SCOPE_EXTENSION||'';
  const requestedBase=env.WORLD_BACKGATE_SCOPE_BASE||'';
  if(!extension){
    if(requestedBase)throw Error('Backgate scope base requires an explicit approved extension');
    return BACKGATE_LEGACY_SCOPE;
  }
  if(extension!==BACKGATE_RELEASE_SCOPE.extension)throw Error('Unsupported backgate scope extension');
  if(env.GITHUB_HEAD_REF!==BACKGATE_RELEASE_SCOPE.branch)throw Error('Backgate release scope requires its reviewed branch');
  if(requestedBase!==BACKGATE_RELEASE_SCOPE.base)throw Error('Backgate release scope requires its reviewed immutable base');
  return BACKGATE_RELEASE_SCOPE;
}
export function validateBackgateScope(scope,changedPaths,{mergeBase,manifest=''}={}){
  if(scope!==BACKGATE_LEGACY_SCOPE&&scope!==BACKGATE_RELEASE_SCOPE)throw Error('Unrecognized backgate scope');
  for(const changed of changedPaths){
    if(!scope.allowedRuntimeChanges.includes(changed))throw Error('unrelated runtime change: '+changed);
  }
  if(scope.extension==='release-2026-10-13'){
    if(mergeBase!==scope.base)throw Error('Backgate release scope base must be an ancestor of the exact head');
    const actual=[...changedPaths].sort(),expected=[...scope.allowedRuntimeChanges].sort();
    if(actual.length!==expected.length||actual.some((p,i)=>p!==expected[i]))throw Error('Backgate release runtime/data diff must exactly match its reviewed paths');
    for(const sha of [scope.base,...scope.requiredSourceHeads]){
      if(!manifest.includes('`'+sha+'`'))throw Error('Backgate release manifest must record exact reviewed source '+sha);
    }
  }
}

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
