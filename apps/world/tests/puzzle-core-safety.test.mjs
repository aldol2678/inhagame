import test from 'node:test';
import assert from 'node:assert/strict';
import {createPuzzleDefinition,createPuzzleRuntime} from '../src/minigames/core/puzzle-runtime.js';
const base={
  puzzleId:'puzzle.test',rulesVersion:1,seed:'abc:123',initialState:{x:0},
  applyAction(state){return {x:state.x+1};},
  evaluate(){return {cleared:false,failed:false};}
};
const make=(overrides={})=>createPuzzleDefinition({...base,...overrides});
const playing=(def=make())=>{const r=createPuzzleRuntime(def);r.start();return r;};
test('invalid identifiers, versions and limits reject at creation',()=>{
  for(const id of ['puzzle.','activity.fishing.inkyung','puzzle.X','puzzle.test.__proto__'])
    assert.throws(()=>make({puzzleId:id}),/Invalid puzzleId/);
  for(const rulesVersion of [0,-1,0.5,Number.MAX_SAFE_INTEGER,NaN])
    assert.throws(()=>make({rulesVersion}),/Invalid rulesVersion/);
  for(const seed of ['','../unsafe','*','한글'])
    assert.throws(()=>make({seed}),/Invalid seed/);
  assert.throws(()=>make({maxMoves:0}),/Invalid maxMoves/);
  assert.throws(()=>make({undoLimit:-1}),/Invalid undoLimit/);
  assert.throws(()=>make({evaluate:null}),/requires synchronous/);
});
test('initial state is copied and snapshot deep frozen',()=>{
  const initialState={x:0,arr:[{kind:'a'}]};
  const r=createPuzzleRuntime(make({initialState}));
  initialState.arr[0].kind='overwritten';
  assert.equal(r.snapshot().state.arr[0].kind,'a');
  assert.ok(Object.isFrozen(r.snapshot().state.arr[0]));
  assert.throws(()=>{r.snapshot().state.x=300;},TypeError);
});
test('action cannot smuggle account, reward or SourceRef',()=>{
  for(const bad of [{rewardAmount:100},{nested:{wallet:true}},
    {accountId:'another-user'},{itemId:'badge.test'},{sourceRef:'fishing.inkyung.north_01'}]){
    const r=playing();
    assert.throws(()=>r.dispatch(bad),/forbidden field/);
    assert.equal(r.snapshot().moves,0);
  }
});
test('callback receives detached frozen input',()=>{
  let savedAction;
  const r=playing(make({applyAction(state,action){
    savedAction=action;assert.ok(Object.isFrozen(state));
    assert.ok(Object.isFrozen(action));return {x:state.x+1};
  }}));
  const action={type:'INC',count:1};r.dispatch(action);action.count=999;
  assert.equal(savedAction.count,1);assert.equal(r.snapshot().state.x,1);
});
test('cyclic, unsupported, non-finite and oversized actions fail closed',()=>{
  const cyclic={};cyclic.self=cyclic;
  for(const action of [cyclic,{v:undefined},{v:NaN},{v:Infinity},
    {v:()=>true},{v:new Date()},{v:'x'.repeat(3000)}]){
    const r=playing();assert.throws(()=>r.dispatch(action));
    assert.equal(r.snapshot().moves,0);
  }
});
test('invalid reducers or evaluators never commit a frame',()=>{
  for(const output of [undefined,null,NaN,{x:Infinity},{x:()=>42},['x']]){
    const r=playing(make({applyAction:()=>output}));
    assert.throws(()=>r.dispatch({type:'GO'}));
    assert.equal(r.snapshot().status,'PLAYING');assert.equal(r.snapshot().moves,0);
  }
  for(const bad of [{cleared:true},{cleared:true,failed:true},
    {cleared:false,failed:false,coins:999},{cleared:'yes',failed:false}]){
    const r=createPuzzleRuntime(make({
      evaluate:(_,meta)=>meta.moves?bad:{cleared:false,failed:false}
    }));
    r.start();assert.throws(()=>r.dispatch({type:'GO'}),/evaluate must return/);
    assert.equal(r.snapshot().moves,0);
  }
});
test('initially solved or failed levels cannot start',()=>{
  for(const outcome of [{cleared:true,failed:false},{cleared:false,failed:true}]){
    const r=createPuzzleRuntime(make({evaluate:()=>outcome}));
    assert.throws(()=>r.start(),/initial state is terminal/);
    assert.equal(r.snapshot().status,'READY');
  }
});
test('no-op does not count or add history',()=>{
  const r=playing(make({applyAction:state=>state}));
  assert.throws(()=>r.dispatch({type:'GO'}),/no state change/);
  assert.equal(r.snapshot().moves,0);assert.equal(r.snapshot().canUndo,false);
});
test('runtime interface contains no network, wallet or persistence hooks',()=>{
  const r=playing();
  assert.deepEqual(Object.keys(r).sort(),
    ['cancel','destroy','dispatch','pause','restart','resume','snapshot','start','undo'].sort());
  const s=r.dispatch({type:'GO'});
  assert.deepEqual(Object.keys(s).sort(),
    ['canUndo','moves','puzzleId','rulesVersion','seed','state','status'].sort());
});
