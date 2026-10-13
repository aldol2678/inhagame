// PA-G1: pure T0-only puzzle runtime; no accounts, storage, networking, rewards or World input.
export const PUZZLE_STATUS = Object.freeze({
  READY:'READY', PLAYING:'PLAYING', PAUSED:'PAUSED',
  CLEARED:'CLEARED', FAILED:'FAILED', CANCELLED:'CANCELLED'
});
const ID=/^puzzle\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){0,3}$/;
const SEED=/^[a-zA-Z0-9_.:-]{1,128}$/;
const FORBIDDEN=new Set(['reward','rewardId','rewardAmount','currency','coins','wallet',
  'walletId','grant','itemId','lifeXp','lifeXP','questCompletion','collectionCompletion',
  'actorUserId','userId','accountId','sourceRef','attemptId','serverTime','verified','entitlement']);
function jsonCopy(value,label,maxBytes,deny=false){
  const budget={n:0};
  function visit(x,depth){
    if(++budget.n>4096||depth>12)throw new TypeError(label+' too complex');
    if(x===null||typeof x==='string'||typeof x==='boolean')return x;
    if(typeof x==='number'){if(!Number.isFinite(x))throw new TypeError(label+' non-finite');return x;}
    if(Array.isArray(x)){
      if(x.length>256)throw new TypeError(label+' oversized array');
      return x.map(item=>visit(item,depth+1));
    }
    if(typeof x!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(x)))
      throw new TypeError(label+' must be plain JSON');
    const keys=Object.keys(x);
    if(keys.length>128)throw new TypeError(label+' too many fields');
    const obj=Object.create(null);
    for(const key of keys){
      if(['__proto__','constructor','prototype'].includes(key)||(deny&&FORBIDDEN.has(key)))
        throw new TypeError(label+' forbidden field: '+key);
      obj[key]=visit(x[key],depth+1);
    }
    return obj;
  }
  const result=visit(value,0);
  if(JSON.stringify(result).length>maxBytes)throw new TypeError(label+' exceeds size limit');
  return result;
}
function freezeDeep(value){
  if(value&&typeof value==='object'){
    for(const key of Object.keys(value))freezeDeep(value[key]);
    Object.freeze(value);
  }
  return value;
}
function int(value,name,min,max){
  if(!Number.isSafeInteger(value)||value<min||value>max)throw new TypeError('Invalid '+name);
}
export function createPuzzleDefinition({
  puzzleId,rulesVersion,seed,initialState,applyAction,evaluate,maxMoves=500,undoLimit=50
}={}){
  if(typeof puzzleId!=='string'||!ID.test(puzzleId))throw new TypeError('Invalid puzzleId');
  int(rulesVersion,'rulesVersion',1,100000);
  if(typeof seed!=='string'||!SEED.test(seed))throw new TypeError('Invalid seed');
  int(maxMoves,'maxMoves',1,5000);int(undoLimit,'undoLimit',0,200);
  if(typeof applyAction!=='function'||typeof evaluate!=='function')
    throw new TypeError('Puzzle requires synchronous applyAction and evaluate functions');
  const initial=jsonCopy(initialState,'initialState',32768);
  if(!initial||typeof initial!=='object'||Array.isArray(initial))
    throw new TypeError('initialState must be an object');
  return Object.freeze({puzzleId,rulesVersion,seed,maxMoves,undoLimit,
    initialState:freezeDeep(initial),applyAction,evaluate});
}
function judge(definition,state,moves){
  const value=definition.evaluate(state,Object.freeze({
    puzzleId:definition.puzzleId,rulesVersion:definition.rulesVersion,seed:definition.seed,moves
  }));
  if(!value||typeof value!=='object'||Array.isArray(value)||
     typeof value.cleared!=='boolean'||typeof value.failed!=='boolean'||
     (value.cleared&&value.failed)||
     Object.keys(value).some(k=>k!=='cleared'&&k!=='failed'))
    throw new TypeError('evaluate must return {cleared:boolean, failed:boolean}');
  return value;
}
export function createPuzzleRuntime(definition){
  if(!definition||!Object.isFrozen(definition)||
     typeof definition.applyAction!=='function'||typeof definition.evaluate!=='function')
    throw new TypeError('Expected a puzzle definition');
  let status=PUZZLE_STATUS.READY,state=definition.initialState,moves=0,undoStack=[],destroyed=false;
  const live=()=>{if(destroyed)throw new Error('Puzzle runtime destroyed');};
  const expect=allowed=>{live();if(!allowed.includes(status))throw new Error('Invalid puzzle transition from '+status);};
  function snapshot(){
    live();
    return Object.freeze({puzzleId:definition.puzzleId,rulesVersion:definition.rulesVersion,
      seed:definition.seed,status,moves,canUndo:status==='PLAYING'&&undoStack.length>0,state});
  }
  function start(){
    expect(['READY']);
    const result=judge(definition,state,moves);
    if(result.cleared||result.failed)throw new Error('Puzzle initial state is terminal');
    status='PLAYING';return snapshot();
  }
  function dispatch(action){
    expect(['PLAYING']);
    if(moves>=definition.maxMoves)throw new Error('Puzzle move limit reached');
    const input=freezeDeep(jsonCopy(action,'action',2048,true));
    if(!input||Array.isArray(input)||typeof input!=='object')throw new TypeError('action must be an object');
    const next=freezeDeep(jsonCopy(definition.applyAction(state,input),'nextState',32768));
    if(!next||typeof next!=='object'||Array.isArray(next))throw new TypeError('nextState must be an object');
    if(JSON.stringify(state)===JSON.stringify(next))throw new Error('Puzzle action produced no state change');
    const nextMoves=moves+1,result=judge(definition,next,nextMoves);
    if(definition.undoLimit>0){
      undoStack.push(state);
      if(undoStack.length>definition.undoLimit)undoStack.shift();
    }
    state=next;moves=nextMoves;
    status=result.cleared?'CLEARED':result.failed?'FAILED':'PLAYING';
    if(status!=='PLAYING')undoStack=[];
    return snapshot();
  }
  function undo(){
    expect(['PLAYING']);
    if(!undoStack.length)return snapshot();
    state=undoStack.pop();moves--;return snapshot();
  }
  function pause(){expect(['PLAYING']);status='PAUSED';return snapshot();}
  function resume(){expect(['PAUSED']);status='PLAYING';return snapshot();}
  function cancel(){
    expect(['READY','PLAYING','PAUSED']);status='CANCELLED';undoStack=[];return snapshot();
  }
  function restart(){live();status='READY';state=definition.initialState;moves=0;undoStack=[];return snapshot();}
  function destroy(){destroyed=true;undoStack=[];state=null;}
  return Object.freeze({snapshot,start,dispatch,undo,pause,resume,cancel,restart,destroy});
}
