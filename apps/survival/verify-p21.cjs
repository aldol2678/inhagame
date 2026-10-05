'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');

const configSrc=fs.readFileSync('stage-config.js','utf8');
const html=fs.readFileSync('index.html','utf8');

const sandbox={window:{}};
vm.createContext(sandbox);
new vm.Script(configSrc,{filename:'stage-config.js'}).runInContext(sandbox);
const stages=sandbox.window.InduckSurvivalStages.catalog;

for(const id of [1,2,3,4]) assert.equal(stages[id].implemented,true,`Stage ${id} must stay implemented`);

assert.deepEqual(
  JSON.parse(JSON.stringify(stages[3].encounters.randomTypes)),
  [
    {from:100,below:.12,type:'tank'},
    {from:45,below:.44,type:'ranged'},
    {from:25,below:.62,type:'fast'}
  ],
  'Stage 3 late composition must match P2.1'
);
assert.ok(stages[4].encounters.events.some(e=>e.id==='defense'&&e.kind==='defenseCombo'&&e.at===175));
assert.ok(stages[4].encounters.events.some(e=>e.id==='defenseReinforce'&&e.kind==='defenseCombo2'&&e.at===181));

const required=[
  "return stage.id!==1||elapsed>=30",
  "return stage.id!==1||elapsed>=70",
  "remaining:.55",
  "Math.round(20 + level*1.5 + evolutionStage*4)",
  "Math.max(3.5,quackMaxCd-(evolutionStage-1)*.15)",
  "if(stage.id===1)return 3;",
  "stage.id===6?(level>=6||elapsed>=100):(level>=7||elapsed>=(stage.id===5?125:stage.id===4?145:130))",
  "Math.round(p.damage*1.35)",
  "spawnDefensePack(['fast','fast','ranged','ranged','tank'])",
  "priorDone=docIndex===0||libraryDocs[docIndex-1].claimed",
  "waterPursuitScale",
  "Math.round(e.damage*.75)",
  "window.__INDUCK_SURVIVAL_P21__=p21Metrics"
];
for(const needle of required) assert.ok(html.includes(needle),`missing P2.1 contract: ${needle}`);
assert.ok(!html.includes('const power=30 + level*2 + evolutionStage*6'),'old Q damage formula must be removed');
assert.ok(!html.includes('Math.max(2.9,quackMaxCd-(evolutionStage-1)*.35)'),'old Q cooldown formula must be removed');

const inlineScripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(m=>m[1].trim()).filter(Boolean);
assert.ok(inlineScripts.length>0,'index.html must contain inline JS');
for(let i=0;i<inlineScripts.length;i++) new vm.Script(inlineScripts[i],{filename:`index-inline-${i}.js`});

console.log('P2.1 contracts PASS · Stage 1-4 progression, skills, water, stairs, Stage 4 defense');
