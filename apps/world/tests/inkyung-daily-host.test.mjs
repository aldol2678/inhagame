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

function mountDailyFrame() {
 const start = source.indexOf('const dailyCampusVisible =');
 const globalsEnd = source.indexOf('const biryongCloudSync =', start);
 const frameStart = source.indexOf('function updateInkyungDailyNpcs(');
 const mainStart = source.indexOf('app.on("update", (dt) => {');
 assert.ok(frameStart > globalsEnd && frameStart < mainStart,
   'daily updater is separately attached before the unchanged campus frame');
 const frames = new Set();
 const lifecycle = new Map();
 const calls = [];
 const state = { busy: false, inside: false, roomOpening: false, regionBusy: false,
   inBiryong: false, lobby: false, lobbyTransition: false, cinematic: false, mounted: false,
   worldAction: true, topOwners: [] };
 runInNewContext(`let inkyungDailyNpcs;\n${source.slice(start, globalsEnd)}\n${source.slice(frameStart, mainStart)}`, {
  app: {
   on: (event, handler) => { assert.equal(event, 'update'); frames.add(handler); },
   off: (event, handler) => { assert.equal(event, 'update'); frames.delete(handler); }
  }, window: { addEventListener: (event, handler) => lifecycle.set(event, handler) },
  rooms: { get insideRoom() { return state.inside; }, status: () => ({ busy: state.busy }) },
  personalRoomInteraction: { get opening() { return state.roomOpening; } },
  biryongRealm: { get inBiryong() { return state.inBiryong; }, get busy() { return state.regionBusy; } },
  lobbyWorld: { get active() { return state.lobby; } },
  lobbyTransition: { get active() { return state.lobbyTransition; } },
  cinematic: { get active() { return state.cinematic; } },
  controller: { get mounted() { return state.mounted; } }, seats: { isSeated: false },
  combatRuntime: { active: false }, inputFocus: { can: () => state.worldAction, snapshot: () => ({ topOwners: state.topOwners }) },
  campusRoot: {}, player: {}, createInkyungDailyNpcs: () => ({
   update: (dt, { visible, blocked }) => calls.push([dt, visible, blocked]),
   closeConversation: () => calls.push('close'), destroy: () => calls.push('destroy')
  })
 });
 return { state, calls, frame: () => frames.forEach(handler => handler(.016)),
  pagehide: persisted => lifecycle.get('pagehide')({ persisted }) };
}

test('separately registered daily frame keeps delivering suppressed updates during host early-return transitions', () => {
 const { state, calls, frame } = mountDailyFrame();
 frame();
 for (const gate of ['busy', 'inside', 'roomOpening', 'regionBusy', 'inBiryong', 'lobby', 'lobbyTransition', 'cinematic']) {
  state[gate] = true; frame();
  assert.deepEqual(calls.at(-1), [.016, false, false], gate);
  state[gate] = false;
 }
 state.worldAction = false; state.topOwners = ['inkyung-daily-dialogue']; frame();
 assert.deepEqual(calls.at(-1), [.016, true, false], 'own dialogue lock can advance');
 state.topOwners = ['full-map']; frame();
 assert.deepEqual(calls.at(-1), [.016, true, true], 'another modal can cancel the dialogue');
 assert.deepEqual(calls[0], [.016, true, false]);
 assert.equal(calls.length, 11, 'one daily update per frame');
});

test('daily frame survives a BFCache pagehide and detaches when the page actually unloads', () => {
 const { calls, frame, pagehide } = mountDailyFrame();
 frame(); pagehide(true); frame(); pagehide(false); frame();
 assert.deepEqual(calls, [[.016, true, false], 'close', [.016, true, false], 'close', 'destroy']);
});
