import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('both turns and the short conversation have a speech tail',()=>{
 const css=read('npc-factory/campus-dialogue.css');
 for(const id of ['npc-test-player-line:not([hidden])','npc-test-line','inkyung-daily-bubble']) assert.ok(css.includes('#'+id+'::after'),id);
});
test('original SVG icon and text are separate for each choice',()=>{
 assert.match(read('npc-factory/dev-runtime.mjs'),/button\.append\(createDialogueIcon/);
 assert.match(read('src/inkyung-daily-npcs.mjs'),/close\.append\(createDialogueIcon/);
 const p=read('npc-factory/campus-dialogue-icons.mjs');
 assert.match(p,/aria-hidden/);
 assert.match(p,/createElementNS/);
});
test('menu and contextual choices map to distinct familiar symbols',async()=>{
 const {dialogueIconFor}=await import('../npc-factory/campus-dialogue-icons.mjs');
 assert.deepEqual([
  ['근황 묻기'],['관심사 이야기'],['지난번 이야기'],
  ['부탁 확인','npc-quest-choice'],['조금 더 물어보기','npc-ai-follow-up'],
  ['함께 할 거리 물어보기'],['← 처음으로'],['대화 끝내기']
 ].map(x=>dialogueIconFor(...x)),['status','topic','memory','quest','follow','meet','back','exit']);
});
