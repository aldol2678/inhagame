import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
test('main mounts region-specific maps instead of hiding Biryong behind the indoor guard',()=>{
  assert.match(main,/createBiryongMapDataSource\(\)/);
  assert.match(main,/setDataSource\(biryongMapDataSource, \{ id: WORLD_REGION_ID.BIRYONG_REALM, indoor: false/);
  assert.doesNotMatch(main,/getRoomState: \(\) => biryongRealm\?\.inBiryong/);
  assert.match(main,/if \(rooms\?\.insideRoom \|\| biryongRealm\?\.inBiryong\) return null/,'Campus objective never appears in Biryong local x/z');
});
test('main routes Biryong through its provider and scopes old Campus quest observers',()=>{
  assert.match(main,/createBiryongNavigation\(\)/);
  assert.match(main,/navigationProviderFor\(navigationSpaceId\(\)\)/);
  assert.match(main,/snapshot\.destination\?\.mapSourceId === CAMPUS_NAV_SPACE/);
  assert.match(main,/onNavigate: poiId =>/);
  assert.match(main,/biryongMapDataSource\?\.poiRegistry\(\)\.get\(poiId\)/);
});
test('regional resume preserves permanent-spawn and automatic-movement limits',()=>{
  const resume=readFileSync(new URL('../src/lobby/world-resume.js',import.meta.url),'utf8');
  const spawn=readFileSync(new URL('../src/lobby/spawn-registry.js',import.meta.url),'utf8');
  assert.match(resume,/getBiryongRealmPlaceZone/);
  assert.match(resume,/BIRYONG_REALM_MOVEMENT_SPACE\.obstacles/);
  assert.match(spawn,/state: SPAWN_STATE.HIDDEN/);
  assert.match(main,/const canUseAutoMove[\s\S]*?biryongRealm\?\.inCampus/,'no automatic region movement activation');
});

test('merged Fishing and Biryong dialogue both suppress the minimap through existing overlay owners',()=>{
  const start=main.indexOf('    getOverlayState: () => ({');
  const end=main.indexOf('\n    getObjectiveMarker:',start);
  assert.ok(start>=0&&end>start);
  const expression=main.slice(start,end).trim().replace(/^getOverlayState: /,'').replace(/,$/,'');
  const names=['hudMenu','keyboardHelp','friendPanel','playerCard','guestbookPanel','shopPanel','inventoryPanel','wardrobePanel',
    'furnitureEditor','dailyQuizPanel','attendancePanel','lifeSkillBookPanel','fishingPanel','questJournal','npcTest',
    'biryongVillageDialogue','mcmEventUi','mcmEventRuntime','fullMap','document','chatPanel','smartphone'];
  const state=Object.fromEntries(names.map(name=>[name,{open:false,openState:false,current:null}]));
  state.npcTest.isConversationOpen=()=>false;state.mcmEventRuntime.isDialogueOpen=()=>false;
  state.document.getElementById=()=>({hidden:true});
  state.smartphone.shell={ownsInput:false};
  const read=new Function(...names,`return (${expression})();`);
  const snapshot=()=>read(...names.map(name=>state[name]));
  assert.equal(snapshot().blocking,false);assert.equal(snapshot().npcConversation,false);
  state.smartphone.shell.ownsInput=true;assert.equal(snapshot().blocking,true);state.smartphone.shell.ownsInput=false;
  state.fishingPanel.open=true;assert.equal(snapshot().blocking,true);state.fishingPanel.open=false;
  state.biryongVillageDialogue.open=true;assert.equal(snapshot().npcConversation,true);
});
