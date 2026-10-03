import test from "node:test";
import assert from "node:assert/strict";
import {
  LIFE_PROGRESSION_RPC, LIFE_TREE_RPC, LIFE_RANK_UP_RPC, LIFE_RESET_RPC,
  LIFE_PROGRESSION_STATE, createLifeProgressionClient,
  parseLifeProgressionSnapshot, parseLifeTreeSnapshot, lifeErrorCode
} from "../src/life-skills/life-progression-client.js";

const A="11111111-1111-4111-8111-111111111111";
const progression=()=>({
  curveId:"life.progression.v1",totalXp:4500,level:10,version:2,currentLevelStartXp:4500,
  nextLevelXp:5500,progressXp:0,progressRequired:1000,maxDefinedLevel:20,isMaxLevel:false,
  skillPointsEarned:8,skillPointsSpent:1,skillPointsBalance:7,
  trees:[
    {treeId:"life_tree.farming",skillId:"life.farming",status:"COMING_SOON",definitionVersion:1,nodeCount:6,spentPoints:0},
    {treeId:"life_tree.fishing",skillId:"life.fishing",status:"ACTIVE",definitionVersion:1,nodeCount:6,spentPoints:1},
    {treeId:"life_tree.sailing",skillId:"life.sailing",status:"COMING_SOON",definitionVersion:1,nodeCount:6,spentPoints:0},
    {treeId:"life_tree.woodcutting",skillId:"life.woodcutting",status:"COMING_SOON",definitionVersion:1,nodeCount:6,spentPoints:0}
  ]
});
const prereq=(nodeId,requiredRank,currentRank)=>({nodeId,requiredRank,currentRank});
const node=(nodeId,extra={})=>({
  nodeId,treeId:"life_tree.fishing",maxRank:3,pointCost:1,requiredLifeLevel:2,
  requiredSkillId:null,requiredSkillLevel:null,effectKey:"fishing.test.v1",status:"ACTIVE",
  definitionVersion:1,rank:0,canRankUp:true,unavailableReason:null,prerequisites:[],...extra
});
const fishing=()=>({
  treeId:"life_tree.fishing",skillId:"life.fishing",status:"ACTIVE",definitionVersion:1,spentPoints:1,nodeCount:2,canReset:true,
  nodes:[
    node("life_node.fishing.steady_hands",{rank:1}),
    node("life_node.fishing.fish_sense",{requiredLifeLevel:3,prerequisites:[prereq("life_node.fishing.steady_hands",1,1)]})
  ]
});
const farming=()=>({
  treeId:"life_tree.farming",skillId:"life.farming",status:"COMING_SOON",definitionVersion:1,spentPoints:0,nodeCount:1,canReset:false,
  nodes:[{
    ...node("life_node.farming.soil_reading",{treeId:"life_tree.farming",status:"COMING_SOON",canRankUp:false,unavailableReason:"INACTIVE"})
  }]
});

function fakeClient(){
  const calls=[]; const queue=new Map();
  return {
    calls,
    respond(fn,value){ if(!queue.has(fn)) queue.set(fn,[]); queue.get(fn).push(value); },
    rpc(fn,args){ calls.push({fn,args}); const value=queue.get(fn)?.shift() ?? {data:null,error:{message:"NO_FIXTURE"}}; return Promise.resolve(value); }
  };
}
const readPair=(client,p=progression(),t=fishing())=>{
  client.respond(LIFE_PROGRESSION_RPC,{data:p,error:null});
  client.respond(LIFE_TREE_RPC,{data:t,error:null});
};

test("parsers accept documented Life progression / tree snapshots and reject malformed data",()=>{
  assert.equal(parseLifeProgressionSnapshot(progression()).level,10);
  assert.equal(parseLifeProgressionSnapshot(progression()).trees.length,4);
  assert.equal(parseLifeTreeSnapshot(fishing()).nodes[1].prerequisites[0].currentRank,1);
  assert.equal(parseLifeProgressionSnapshot({...progression(),skillPointsBalance:-1}),null);
  assert.equal(parseLifeTreeSnapshot({...fishing(),nodeCount:9}),null);
  assert.equal(parseLifeTreeSnapshot({...fishing(),nodes:[node("life_node.other.bad")]}),null);
});

test("account read chooses the first ACTIVE tree and uses only self-only read RPCs",async()=>{
  const client=fakeClient(); readPair(client);
  const life=createLifeProgressionClient({getClient:()=>client,createKey:()=> "life:key"});
  assert.equal(await life.setAccount(A),true);
  assert.equal(life.state,LIFE_PROGRESSION_STATE.READY);
  assert.equal(life.selectedTreeId,"life_tree.fishing");
  assert.equal(life.progression.skillPointsBalance,7);
  assert.deepEqual(client.calls,[
    {fn:LIFE_PROGRESSION_RPC,args:undefined},
    {fn:LIFE_TREE_RPC,args:{p_tree_id:"life_tree.fishing"}}
  ]);
});

test("tree selection re-reads server dashboard then the selected tree",async()=>{
  const client=fakeClient(); readPair(client);
  const life=createLifeProgressionClient({getClient:()=>client,createKey:()=> "life:key"});
  await life.setAccount(A);
  client.respond(LIFE_PROGRESSION_RPC,{data:progression(),error:null});
  client.respond(LIFE_TREE_RPC,{data:farming(),error:null});
  assert.equal(await life.selectTree("life_tree.farming"),true);
  assert.equal(life.tree.status,"COMING_SOON");
  assert.equal(life.selectedTreeId,"life_tree.farming");
});

test("rank-up forwards node + idempotency key, never cost/rank/user, then re-reads authority",async()=>{
  const client=fakeClient(); readPair(client);
  const life=createLifeProgressionClient({getClient:()=>client,createKey:(kind)=> "life:"+kind+":fixed"});
  await life.setAccount(A);
  client.respond(LIFE_RANK_UP_RPC,{data:{status:"SUCCESS",rankAfter:2,balanceAfter:6},error:null});
  readPair(client,{...progression(),skillPointsSpent:2,skillPointsBalance:6},{
    ...fishing(),spentPoints:2,nodes:[
      node("life_node.fishing.steady_hands",{rank:2}),
      node("life_node.fishing.fish_sense",{requiredLifeLevel:3,prerequisites:[prereq("life_node.fishing.steady_hands",1,2)]})
    ]
  });
  const result=await life.rankUp("life_node.fishing.steady_hands");
  assert.equal(result.outcome,"SUCCESS");
  const mutation=client.calls.find((c)=>c.fn===LIFE_RANK_UP_RPC);
  assert.deepEqual(mutation.args,{p_node_id:"life_node.fishing.steady_hands",p_idempotency_key:"life:rank-up:fixed"});
  assert.equal("p_user" in mutation.args,false);
  assert.equal("p_point_cost" in mutation.args,false);
  assert.equal(life.progression.skillPointsBalance,6);
  assert.equal(life.tree.nodes[0].rank,2);
});

test("reset forwards only tree + key and refreshes the exact server refund result",async()=>{
  const client=fakeClient(); readPair(client);
  const life=createLifeProgressionClient({getClient:()=>client,createKey:(kind)=>"life:"+kind+":fixed"});
  await life.setAccount(A);
  client.respond(LIFE_RESET_RPC,{data:{status:"SUCCESS",pointsDelta:1,balanceAfter:8},error:null});
  readPair(client,{...progression(),skillPointsSpent:0,skillPointsBalance:8},{...fishing(),spentPoints:0,canReset:false,nodes:[
    node("life_node.fishing.steady_hands"),node("life_node.fishing.fish_sense",{requiredLifeLevel:3,canRankUp:false,unavailableReason:"PREREQUISITE_REQUIRED",prerequisites:[prereq("life_node.fishing.steady_hands",1,0)]})
  ]});
  const result=await life.resetTree("life_tree.fishing");
  assert.equal(result.outcome,"SUCCESS");
  const mutation=client.calls.find((c)=>c.fn===LIFE_RESET_RPC);
  assert.deepEqual(mutation.args,{p_tree_id:"life_tree.fishing",p_idempotency_key:"life:reset:fixed"});
  assert.equal(life.tree.spentPoints,0);
});

test("known refusal is stable, unknown transport error is FAILED, signed out performs no RPC",async()=>{
  assert.equal(lifeErrorCode({message:"LIFE_LEVEL_REQUIRED"}),"LIFE_LEVEL_REQUIRED");
  assert.equal(lifeErrorCode({message:"private stack"}),"FAILED");
  const client=fakeClient(); readPair(client);
  const life=createLifeProgressionClient({getClient:()=>client,createKey:()=> "life:key"});
  await life.setAccount(A);
  client.respond(LIFE_RANK_UP_RPC,{data:null,error:{message:"INSUFFICIENT_LIFE_SKILL_POINTS"}});
  readPair(client);
  const refused=await life.rankUp("life_node.fishing.steady_hands");
  assert.deepEqual({outcome:refused.outcome,code:refused.code},{outcome:"REFUSED",code:"INSUFFICIENT_LIFE_SKILL_POINTS"});
  await life.setAccount(null);
  const before=client.calls.length;
  assert.equal((await life.resetTree("life_tree.fishing")).outcome,"SIGNED_OUT");
  assert.equal(client.calls.length,before);
});
