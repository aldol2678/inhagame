import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('const interactionAction = () => {');
const end=source.indexOf('\n};',start)+3;
const fn=source.slice(start,end).replace('const interactionAction','globalThis.interactionAction');
test('real host F entry point preserves existing MCM and quest dialogue close priority over ambient',()=>{
 const calls=[];let mcm=true,npc=true;
 const context={playerAutoMove:null,mcmEventRuntime:{isDialogueOpen:()=>mcm,closeDialogue:()=>calls.push('mcm')},npcTest:{isConversationOpen:()=>npc,closeConversation:()=>calls.push('quest')},inkyungDailyNpcs:{isConversationOpen:()=>true,closeConversation:()=>calls.push('daily')},inputFocus:{can:()=>true},contextActions:{trigger:()=>calls.push('slot')}};
 runInNewContext(fn,context);context.interactionAction();assert.deepEqual(calls,['mcm']);mcm=false;context.interactionAction();assert.deepEqual(calls,['mcm','quest']);npc=false;context.interactionAction();assert.deepEqual(calls,['mcm','quest','daily']);
});
