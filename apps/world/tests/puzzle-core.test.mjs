import test from 'node:test';
import assert from 'node:assert/strict';
import {PUZZLE_STATUS,createPuzzleDefinition,createPuzzleRuntime} from '../src/minigames/core/puzzle-runtime.js';

function puzzle(overrides={}){
  return createPuzzleDefinition({
    puzzleId:'puzzle.water_path',rulesVersion:1,seed:'test-seed:1',
    initialState:{grid:[0,0],solved:false},
    applyAction(state,action){
      if(action.type!=='TURN'||![0,1].includes(action.index)||
        Object.keys(action).sort().join(',')!=='index,type')throw new Error('Invalid turn');
      const grid=[...state.grid];grid[action.index]=1-grid[action.index];
      return {grid,solved:grid.every(Boolean)};
    },
    evaluate(state){return {cleared:state.solved,failed:false};},
    ...overrides
  });
}
test('T0 deterministic completion and frozen snapshot',()=>{
  const r=createPuzzleRuntime(puzzle());
  assert.equal(r.snapshot().status,PUZZLE_STATUS.READY);
  r.start();
  const one=r.dispatch({type:'TURN',index:0});
  assert.equal(one.moves,1);assert.deepEqual(one.state.grid,[1,0]);
  const two=r.dispatch({type:'TURN',index:1});
  assert.equal(two.status,'CLEARED');assert.equal(two.moves,2);
  assert.deepEqual(two.state.grid,[1,1]);assert.equal(two.canUndo,false);
  assert.ok(Object.isFrozen(two.state));assert.ok(Object.isFrozen(two.state.grid));
  assert.equal('reward' in two,false);assert.equal('verified' in two,false);
  assert.throws(()=>r.dispatch({type:'TURN',index:0}),/Invalid puzzle transition/);
});
test('restart preserves seed and resets state after clear',()=>{
  const r=createPuzzleRuntime(puzzle());r.start();
  r.dispatch({type:'TURN',index:0});r.dispatch({type:'TURN',index:1});
  assert.equal(r.restart().status,'READY');assert.deepEqual(r.snapshot().state.grid,[0,0]);
  r.start();r.dispatch({type:'TURN',index:0});
  assert.deepEqual(r.dispatch({type:'TURN',index:1}).state.grid,[1,1]);
});
test('pause, resume and action gating',()=>{
  const r=createPuzzleRuntime(puzzle());
  assert.throws(()=>r.dispatch({type:'TURN',index:0}),/Invalid puzzle transition/);
  assert.throws(()=>r.pause(),/Invalid puzzle transition/);
  r.start();r.pause();
  assert.throws(()=>r.dispatch({type:'TURN',index:0}),/Invalid puzzle transition/);
  assert.throws(()=>r.start(),/Invalid puzzle transition/);
  assert.equal(r.resume().status,'PLAYING');assert.equal(r.dispatch({type:'TURN',index:0}).moves,1);
});
test('undo reverts state and move count',()=>{
  const r=createPuzzleRuntime(puzzle());r.start();
  assert.equal(r.undo().moves,0);
  r.dispatch({type:'TURN',index:0});
  assert.equal(r.undo().moves,0);assert.deepEqual(r.snapshot().state.grid,[0,0]);
  assert.equal(r.snapshot().canUndo,false);
  r.dispatch({type:'TURN',index:1});
  assert.deepEqual(r.snapshot().state.grid,[0,1]);
});
test('undo limit and terminal lock',()=>{
  const r=createPuzzleRuntime(puzzle({undoLimit:1}));r.start();
  r.dispatch({type:'TURN',index:0});r.dispatch({type:'TURN',index:0});
  assert.deepEqual(r.undo().state.grid,[1,0]);assert.equal(r.undo().moves,1);
  r.dispatch({type:'TURN',index:1});
  assert.equal(r.snapshot().status,'CLEARED');
  assert.throws(()=>r.undo(),/Invalid puzzle transition/);
});
test('cancel in any open state and restart',()=>{
  for(const mode of ['READY','PLAYING','PAUSED']){
    const r=createPuzzleRuntime(puzzle());
    if(mode!=='READY')r.start();
    if(mode==='PAUSED')r.pause();
    assert.equal(r.cancel().status,'CANCELLED');
    assert.throws(()=>r.resume(),/Invalid puzzle transition/);
    assert.equal(r.restart().status,'READY');
    assert.equal(r.start().status,'PLAYING');
  }
});
test('game-defined failure is terminal, no grants',()=>{
  const r=createPuzzleRuntime(puzzle({
    evaluate(state){return {cleared:false,failed:state.grid[0]===1};}
  }));
  r.start();const s=r.dispatch({type:'TURN',index:0});
  assert.equal(s.status,'FAILED');assert.equal('userId' in s,false);
  assert.equal('wallet' in s,false);
});
test('reducer and evaluator exceptions leave state unchanged',()=>{
  const r=createPuzzleRuntime(puzzle({
    applyAction(state,action){
      if(action.index===1)throw new Error('blocked');
      return {grid:[1,0],solved:false};
    },
    evaluate(state){
      if(state.grid[0])throw new Error('evaluator down');
      return {cleared:false,failed:false};
    }
  }));
  r.start();const prev=r.snapshot();
  assert.throws(()=>r.dispatch({type:'TURN',index:1}),/blocked/);
  assert.throws(()=>r.dispatch({type:'TURN',index:0}),/evaluator down/);
  assert.deepEqual(r.snapshot(),prev);
});
test('move limit is fail closed; undo still recovers',()=>{
  const r=createPuzzleRuntime(puzzle({maxMoves:1}));r.start();
  r.dispatch({type:'TURN',index:0});
  assert.throws(()=>r.dispatch({type:'TURN',index:1}),/move limit reached/);
  assert.equal(r.snapshot().moves,1);assert.equal(r.snapshot().status,'PLAYING');
  assert.equal(r.undo().moves,0);
});
test('destroy leaves no accessible state',()=>{
  const r=createPuzzleRuntime(puzzle());r.start();r.destroy();r.destroy();
  assert.throws(()=>r.snapshot(),/destroyed/);assert.throws(()=>r.restart(),/destroyed/);
});
