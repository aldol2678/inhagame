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
const stage=stages[6];

assert.equal(stage.implemented,true,'Stage 6 must be implemented');
assert.equal(stage.name,'후문');
assert.equal(stage.clear.kind,'gateFinal');
assert.equal(stage.clear.seconds,120);
assert.equal(stage.clear.deadline,270);
assert.equal(stage.map.kind,'gate');
assert.equal(stage.map.requirements.length,3);
assert.deepEqual(JSON.parse(JSON.stringify(stage.map.start||stage.start)),{x:0,z:-15});
assert.equal(stage.map.professorSpawn.x,0);
assert.equal(stage.map.professorSpawn.z,9);
assert.equal(stage.map.crosswalk.minZ,7);
assert.equal(stage.map.crosswalk.maxZ,19);

const required=[
  "function updateFinalStage(dt)",
  "function stage6Result()",
  "function spawnFinalProfessor()",
  "e.hp=2400",
  "oralFan",
  "followup",
  "assignment",
  "revision",
  "laneControl",
  "e.patternCd=final&&stage.id===6?(e.hp/e.maxHp<=.35?2.1:5.2)",
  "FINAL EXAM",
  "finalRequirementCount>=3&&elapsed>=90",
  "stage.id===6?finalBossSpawned",
  "stage.id===6?(level>=6||elapsed>=100)",
  "function damageEnemy(e,amount,source='')",
  "Math.round(amount*.60)",
  "showFinalBossIntro('FINAL EXAM'",
  "심사 방어막 40%",
  "finalBossIntro.classList.add('show')",
  "new THREE.RingGeometry(1.38,1.92,48)",
  "e.phaseInvuln=2.8",
  "elapsed<120",
  "finalBossDefeated&&duck.position.x>=-10",
  "CAMPUS SURVIVED",
  "[2,3,4,5,6].includes(stage)",
  "function gateTarget(e,tx,tz)",
  "campaignClear"
];
for(const needle of required)assert.ok(html.includes(needle)||fs.readFileSync('stage-progress.js','utf8').includes(needle),`missing Stage 6 contract: ${needle}`);

const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1].trim()).filter(Boolean);
for(let i=0;i<inline.length;i++)new vm.Script(inline[i],{filename:`index-inline-${i}.js`});

console.log('Stage 6 rear-gate finale contracts PASS');
