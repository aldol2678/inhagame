import test from 'node:test';
import assert from 'node:assert/strict';
import {createPuzzleRuntime} from '../src/minigames/core/puzzle-runtime.js';
import {
  createWaterPathDefinition,validateWaterPath,waterPathMask,
  WATER_PATH_RULES_VERSION,WATER_PATH_PUZZLE_ID
} from '../src/minigames/games/water-path.js';
import {mountWaterPathPanel} from '../src/minigames/games/water-path-view.js';

const DIR = [[-1,0],[0,1],[1,0],[0,-1]];
function edge(a,b,n) {
  const r=Math.floor(a/n),c=a%n,s=Math.floor(b/n),d=b%n;
  return DIR.findIndex(([dr,dc])=>r+dr===s&&c+dc===d);
}
function solution(state) {
  const n=state.size,last=n*n-1;
  const path=[0],answers=[];
  function dfs(index) {
    if(index===last) {
      const rotations=[];
      for(let i=0;i<path.length;i++) {
        const current=path[i],before=i?edge(current,path[i-1],n):-1,
          after=i+1<path.length?edge(current,path[i+1],n):-1;
        const needed=(before<0?0:1<<before)|(after<0?0:1<<after);
        let found=-1;
        for(let rotation=0;rotation<4;rotation++) {
          if(waterPathMask(state.tiles[current].kind,rotation)===needed)found=rotation;
        }
        if(found<0)return false;
        rotations.push(found);
      }
      const tiles=state.tiles.map(t=>({...t}));
      path.forEach((cell,i)=>{tiles[cell].rotation=rotations[i];});
      if(validateWaterPath({size:n,tiles}).cleared) {
        answers.push({tiles,path:[...path]});return true;
      }
      return false;
    }
    for(const delta of [1,n]) {
      const next=index+delta;
      if(delta===1&&index%n===n-1||next>last)continue;
      path.push(next);
      if(dfs(next))return true;
      path.pop();
    }
    return false;
  }
  assert.equal(dfs(0),true,'generated level must have a reachable valid solution');
  return answers[0];
}
test('versions, stable seed and immediate start state',()=>{
  for(const n of [3,4])for(const seed of ['test.1','test.2','test.3']){
    const a=createWaterPathDefinition({size:n,seed});
    const b=createWaterPathDefinition({size:n,seed});
    assert.equal(a.puzzleId,WATER_PATH_PUZZLE_ID);
    assert.equal(a.rulesVersion,WATER_PATH_RULES_VERSION);
    assert.deepEqual(a.initialState,b.initialState);
    assert.equal(validateWaterPath(a.initialState).cleared,false);
    assert.ok(Object.isFrozen(a.initialState.tiles[0]));
  }
});
test('generated 3x3 and 4x4 have complete valid solutions for 60 seeds',()=>{
  for(const size of [3,4])for(let k=0;k<30;k++){
    const def=createWaterPathDefinition({size,seed:'qa.'+k});
    const solved=solution(def.initialState);
    assert.equal(validateWaterPath({size,tiles:solved.tiles}).cleared,true);
  }
});
test('all four orientations rotate port directions correctly',()=>{
  assert.deepEqual([0,1,2,3].map(r=>waterPathMask('START',r)),[1,2,4,8]);
  assert.deepEqual([0,1,2,3].map(r=>waterPathMask('STRAIGHT',r)),[5,10,5,10]);
  assert.deepEqual([0,1,2,3].map(r=>waterPathMask('ELBOW',r)),[3,6,12,9]);
  assert.equal(waterPathMask('BLOCK',2),0);
});
test('successful T0 play uses PA-G1 runtime and yields no grants',()=>{
  const definition=createWaterPathDefinition({size:3,seed:'qa.complete'});
  const goal=solution(definition.initialState);
  const runtime=createPuzzleRuntime(definition);
  runtime.start();
  const n=runtime.snapshot().state.size;
  for(const cell of goal.path) {
    for(let turn=0;turn<3;turn++) {
      if(runtime.snapshot().status==='CLEARED')break;
      const current=runtime.snapshot().state.tiles[cell].rotation;
      if(current===goal.tiles[cell].rotation)break;
      runtime.dispatch({type:'ROTATE_TILE',row:Math.floor(cell/n),col:cell%n});
    }
    if(runtime.snapshot().status==='CLEARED')break;
  }
  assert.equal(runtime.snapshot().status,'CLEARED');
  assert.equal('coins' in runtime.snapshot(),false);
  assert.equal('verified' in runtime.snapshot(),false);
});
test('endpoints and active leaks are validated; unconnected decoys ignored',()=>{
  const def=createWaterPathDefinition({size:3,seed:'qa.leak'});
  const solved=solution(def.initialState);
  const tiles=solved.tiles.map(t=>({...t}));
  const output=validateWaterPath({size:3,tiles});
  assert.deepEqual(output,{cleared:true,goalConnected:true,leaks:0,activeTiles:solved.path.length});
  tiles[0].rotation=(tiles[0].rotation+2)&3;
  const rejected=validateWaterPath({size:3,tiles});
  assert.equal(rejected.cleared,false);
  assert.ok(rejected.leaks>0);
});
test('unsupported game sizes, seeds, actions and board tampering fail closed',()=>{
  for(const size of [0,2,5,3.5])assert.throws(()=>createWaterPathDefinition({size}),/3x3/);
  for(const seed of ['', '../secret', '한글'])assert.throws(()=>createWaterPathDefinition({seed}),/seed/);
  assert.throws(()=>waterPathMask('BAD',0),/Invalid pipe/);
  const def=createWaterPathDefinition();
  const r=createPuzzleRuntime(def);r.start();
  for(const action of [{type:'ROTATE_TILE',row:0,col:0,reward:5},
    {type:'ROTATE_TILE',row:-1,col:0},
    {type:'ROTATE_TILE',row:0,col:8},
    {type:'ROTATE_TILE',row:0.5,col:0},
    {type:'FINISH',row:0,col:0}])assert.throws(()=>r.dispatch(action));
  assert.equal(r.snapshot().moves,0);
  const broken={size:3,tiles:def.initialState.tiles.map(t=>({...t}))};
  broken.tiles[1]={kind:'START',rotation:0};
  assert.throws(()=>validateWaterPath(broken),/Duplicate endpoint/);
  broken.tiles[1]={kind:'BLOCK',rotation:0,coins:10};
  assert.throws(()=>validateWaterPath(broken),/tile shape/);
});
test('blocked tiles are not rotatable, Undo and Restart stay in local domain',()=>{
  const def=createWaterPathDefinition({size:4,seed:'qa.undo'});
  const r=createPuzzleRuntime(def);r.start();
  const index=def.initialState.tiles.findIndex(t=>t.kind==='BLOCK');
  if(index>=0)assert.throws(()=>r.dispatch({type:'ROTATE_TILE',row:Math.floor(index/4),col:index%4}),/Blocked/);
  r.dispatch({type:'ROTATE_TILE',row:0,col:0});
  assert.equal(r.snapshot().moves,1);
  r.undo();assert.deepEqual(r.snapshot().state,def.initialState);
  r.restart();assert.equal(r.snapshot().status,'READY');
});
class FakeNode {
  constructor(tag,doc){this.tag=tag;this.ownerDocument=doc;this.children=[];this.attributes={};this.style={};this.listeners={};this.disabled=false;this.textContent='';}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(k,fn){this.listeners[k]=fn;}
  click(){if(!this.disabled)this.listeners.click?.();}
  remove(){this.removed=true;}
}
test('standalone panel supports start, keyboard-native buttons and safe disposal',()=>{
  const doc={createElement(tag){return new FakeNode(tag,doc);}};
  const host=new FakeNode('main',doc);
  const panel=mountWaterPathPanel(host,{size:3,seed:'qa.panel'});
  const root=host.children[0];
  assert.equal(root.tag,'section');
  assert.equal(panel.snapshot().status,'READY');
  root.children[2].children.find(x=>x.textContent==='시작').click();
  assert.equal(panel.snapshot().status,'PLAYING');
  const first=root.children[1].children[0];
  assert.equal(first.tag,'button');
  assert.equal(first.attributes['aria-label'].includes('1행 1열'),true);
  first.click();assert.equal(panel.snapshot().moves,1);
  root.children[2].children.find(x=>x.textContent==='처음부터').click();
  assert.equal(panel.snapshot().status,'READY');
  panel.destroy();panel.destroy();
  assert.equal(root.removed,true);
  assert.throws(()=>panel.snapshot(),/destroyed/);
});
