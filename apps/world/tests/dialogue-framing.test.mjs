import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const subject={x:0,y:1,z:0},player={x:1.1,y:1,z:0};
test('camera finds a side angle and falls back safely when all sightlines are obstructed',async()=>{
 const {chooseDialogueShot}=await import('../npc-factory/dialogue-shot.mjs');
 const shot=chooseDialogueShot({player,subject,aspect:390/844,visible:()=>true});
 assert.ok(Math.abs(shot.eye[2])>=1.5);
 assert.ok(shot.target[1]<subject.y);
 const other=chooseDialogueShot({player,subject,aspect:1.7,visible:(_from,to)=>Math.abs(to[2])<.01||to[2]<0});
 assert.ok(other.eye[2]<0);
 assert.equal(chooseDialogueShot({player,subject,aspect:1,visible:()=>false}),null);
});
test('navigation-only actions suppress the topic prompt and landscape keeps its own compact layout',()=>{
 const css=read('npc-factory/campus-dialogue.css');
 assert.match(css,/\.campus-dialogue-options:not\(:has\(/);
 assert.match(css,/\.campus-dialogue-turns\s*\{[^}]*overflow-y:auto/);
 assert.match(css,/max-height:57dvh/);
});
