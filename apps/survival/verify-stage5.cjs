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
const stage=stages[5];

assert.equal(stage.implemented,true,'Stage 5 must be implemented');
assert.equal(stage.name,'60주년기념관');
assert.equal(stage.clear.kind,'reviewExit');
assert.equal(stage.clear.seconds,200);
assert.equal(stage.clear.deadline,250);
assert.equal(stage.map.kind,'hall');
assert.equal(stage.map.stamps.length,2);
assert(stage.map.stamps.every(s=>s.hold===1.5));
assert(stage.encounters.events.some(e=>e.kind==='reviewBoss'&&e.at===125));
assert(stage.encounters.events.some(e=>e.id==='exit'&&e.at===200));

const required=[
  "bossKind='review'",
  "e.hp=520",
  "reviewFan",
  "reviewZones",
  "function updateReview(dt)",
  "function stage5Result()",
  "stage.id===5?125",
  "stage.id===5?'04:10'",
  "[2,3,4,5,6].includes(stage)",
  "reviewMarkCount===stamps.length&&reviewBossDefeated",
  "spawnDangerZone(baseX,baseZ,1.45,1.5,16,1.0)"
];
for(const needle of required)assert.ok(html.includes(needle),`missing Stage 5 contract: ${needle}`);

const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1].trim()).filter(Boolean);
for(let i=0;i<inline.length;i++)new vm.Script(inline[i],{filename:`index-inline-${i}.js`});

console.log('Stage 5 60th anniversary hall contracts PASS');
