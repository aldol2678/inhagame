import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('campus dialogue loads its shared, narrowly scoped theme',()=>{
 assert.match(read('campus/index.html'),/href="\/npc-factory\/campus-dialogue\.css/);
 const css=read('npc-factory/campus-dialogue.css');
 assert.match(css,/npc-conversation-open/);
 assert.match(css,/inkyung-daily-overlay/);
 assert.match(css,/safe-area-inset-bottom/);
 assert.match(css,/min-height:\s*44px/);
});
test('both speakers name their dialogue; normal choices have their own labeled group',()=>{
 const roster=read('npc-factory/dev-runtime.mjs'),daily=read('src/inkyung-daily-npcs.mjs');
 assert.match(roster,/role="dialog" aria-labelledby="npc-test-speaker"/);
 assert.match(roster,/aria-labelledby="npc-test-choice-title"/);
 assert.match(daily,/aria-labelledby', 'inkyung-daily-speaker'/);
 assert.match(daily,/campus-dialogue-kicker/);
});
