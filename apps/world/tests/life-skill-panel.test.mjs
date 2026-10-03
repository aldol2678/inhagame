import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFakeDocument } from "./support/fake-dom.mjs";
import { createLifeSkillPanel, lifeNodeView, lifeProgressText, lifeTreeName } from "../src/life-skills/life-skill-panel.js";
import { LIFE_PROGRESSION_STATE } from "../src/life-skills/life-progression-client.js";

function walk(node,out=[]){ out.push(node); for(const child of node.children ?? []) walk(child,out); return out; }
const byClass=(root,name)=>walk(root).filter((n)=>(n.className ?? "").split(/\s+/).includes(name));
const text=(root)=>walk(root).map((n)=>n.textContent).join(" ");
const source=(path)=>readFileSync(new URL(path,import.meta.url),"utf8");

function lifeStub(){
  const listeners=new Set();
  const progression={
    totalXp:4500,level:10,nextLevelXp:5500,isMaxLevel:false,skillPointsBalance:7,skillPointsSpent:1,
    trees:[
      {treeId:"life_tree.farming",status:"COMING_SOON"},
      {treeId:"life_tree.fishing",status:"ACTIVE"},
      {treeId:"life_tree.sailing",status:"COMING_SOON"},
      {treeId:"life_tree.woodcutting",status:"COMING_SOON"}
    ]
  };
  const tree={
    treeId:"life_tree.fishing",status:"ACTIVE",spentPoints:1,canReset:true,
    nodes:[
      {nodeId:"life_node.fishing.steady_hands",rank:1,maxRank:3,pointCost:1,requiredLifeLevel:2,canRankUp:true,unavailableReason:null,prerequisites:[]},
      {nodeId:"life_node.fishing.rare_fish_sense",rank:0,maxRank:2,pointCost:2,requiredLifeLevel:8,canRankUp:false,unavailableReason:"PREREQUISITE_REQUIRED",
       prerequisites:[{nodeId:"life_node.fishing.fish_sense",requiredRank:2,currentRank:0}]}
    ]
  };
  const stub={
    state:LIFE_PROGRESSION_STATE.READY,progression,tree,selectedTreeId:"life_tree.fishing",accountId:"A",
    calls:[],onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    refresh(reason){stub.calls.push(["refresh",reason]);return Promise.resolve(true);},
    selectTree(id){stub.calls.push(["select",id]);stub.selectedTreeId=id;return Promise.resolve(true);},
    rankUp(id){stub.calls.push(["rank",id]);return Promise.resolve({outcome:"SUCCESS"});},
    resetTree(id){stub.calls.push(["reset",id]);return Promise.resolve({outcome:"SUCCESS"});},
    isPending(){return false;}
  };
  return stub;
}

test("presentation helpers show Life Level, tree names and server-derived node state",()=>{
  assert.equal(lifeProgressText({level:10,totalXp:4500,nextLevelXp:5500,isMaxLevel:false}),"생활 Lv.10 · 4,500 / 5,500 EXP");
  assert.equal(lifeProgressText({level:20,totalXp:19000,nextLevelXp:null,isMaxLevel:true}),"생활 Lv.20 · 19,000 EXP");
  assert.equal(lifeTreeName("life_tree.fishing"),"낚시");
  const view=lifeNodeView({
    nodeId:"life_node.fishing.rare_fish_sense",rank:0,maxRank:2,pointCost:2,requiredLifeLevel:8,
    canRankUp:false,unavailableReason:"PREREQUISITE_REQUIRED",
    prerequisites:[{nodeId:"life_node.fishing.fish_sense",requiredRank:2,currentRank:1}]
  });
  assert.equal(view.name,"희귀어 탐지");
  assert.equal(view.reasonText,"선행 스킬 필요");
  assert.deepEqual(view.prerequisites,["어군 감지 1/2"]);
});

test("panel renders Life summary, four tabs, active Fishing nodes and server lock reasons",()=>{
  const doc=createFakeDocument(); const panel=doc.createElement("section"); panel.hidden=true;
  const life=lifeStub(); const ui=createLifeSkillPanel({panel,life,doc});
  ui.setOpen(true);
  assert.match(text(panel),/생활 Lv\.10/);
  assert.match(text(panel),/스킬포인트 7 SP/);
  assert.equal(byClass(panel,"life-tree-tab").length,4);
  assert.equal(byClass(panel,"life-skill-node").length,2);
  assert.match(text(panel),/희귀어 탐지/);
  assert.match(text(panel),/선행 스킬 필요/);
  assert.equal(byClass(panel,"life-skill-rank-button")[0].disabled,false);
  assert.equal(byClass(panel,"life-skill-rank-button")[1].disabled,true);
});

test("tab, rank-up and reset buttons forward intent only through the client",async()=>{
  const doc=createFakeDocument(); const panel=doc.createElement("section");
  const life=lifeStub(); const statuses=[];
  const ui=createLifeSkillPanel({panel,life,doc,onStatus:(m)=>statuses.push(m)});
  ui.setOpen(true);
  byClass(panel,"life-tree-tab").find((b)=>b.dataset.treeId==="life_tree.farming").click();
  byClass(panel,"life-skill-rank-button")[0].click();
  byClass(panel,"life-tree-reset")[0].click();
  await new Promise((r)=>setTimeout(r,0));
  assert.ok(life.calls.some((c)=>c[0]==="select"&&c[1]==="life_tree.farming"));
  assert.ok(life.calls.some((c)=>c[0]==="rank"&&c[1]==="life_node.fishing.steady_hands"));
  assert.ok(life.calls.some((c)=>c[0]==="reset"&&c[1]==="life_tree.fishing"));
  assert.ok(statuses.every((m)=>/갱신/.test(m)));
});

test("signed-out and unavailable states never expose raw server details",()=>{
  const doc=createFakeDocument(); const panel=doc.createElement("section");
  const life=lifeStub(); life.state=LIFE_PROGRESSION_STATE.SIGNED_OUT; life.progression=null; life.tree=null; life.accountId=null;
  const ui=createLifeSkillPanel({panel,life,doc}); ui.setOpen(true);
  assert.match(text(panel),/로그인한 INHAGAME 계정만/);
  ui.setOpen(false);
  life.state=LIFE_PROGRESSION_STATE.UNAVAILABLE; life.accountId="A"; ui.setOpen(true);
  assert.match(text(panel),/불러오지 못했어요/);
  assert.doesNotMatch(text(panel),/private|stack|rpc/i);
});

test("main wiring keeps Life UI on the member client and InputFocus boundary",()=>{
  const main=source("../src/main.js");
  assert.match(main,/createLifeProgressionClient\(\{ getClient: \(\) => online\?\.supabase \?\? null \}\)/);
  assert.match(main,/void lifeProgression\.setAccount\(identity \? online\?\.userId \?\? null : null\)/);
  assert.match(main,/ownerId: "life-skill".*policy: INPUT_FOCUS_POLICY\.BLOCKING_UI/s);
  assert.match(main,/document\.getElementById\("open-life-skills"\)/);
  assert.match(main,/void lifeProgression\.refresh\("resume"\)/);
});
