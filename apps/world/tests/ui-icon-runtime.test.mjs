import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { UI_ICON_NAMES, UI_ICON_TARGETS, uiIconSource } from '../src/ui/ui-icon-runtime.js';
const root=new URL('../assets/ui-icons/p0-v1/',import.meta.url);
test('all 19 approved SVG files are mapped to existing presentation',async()=>{
 const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
 assert.equal(manifest.count,19);
 assert.equal(UI_ICON_NAMES.length,19);
 assert.equal(new Set(UI_ICON_NAMES).size,19);
 assert.deepEqual([...UI_ICON_NAMES].sort(),manifest.assetIds.map(a=>a.file.split('/').at(-1).replace('.svg','')).sort());
 for(const name of UI_ICON_NAMES){
   assert.ok(uiIconSource(name).endsWith('/assets/ui-icons/p0-v1/svg/'+name+'.svg'));
   assert.match(await readFile(new URL('svg/'+name+'.svg',root),'utf8'),/<svg\b/);
   assert.ok(UI_ICON_TARGETS.some(([,icon])=>icon===name),'unbound approved icon '+name);
 }
 assert.equal(uiIconSource('../inventory'),null);
});
test('notification binds status, collection maps inventory, future member messages reuse chat',()=>{
 assert.ok(UI_ICON_TARGETS.some(([selector,name])=>selector.includes('smartphone-message')&&name==='notification'));
 assert.ok(UI_ICON_TARGETS.some(([selector,name])=>selector.includes('messages')&&name==='chat'));
 assert.ok(UI_ICON_TARGETS.some(([selector,name])=>selector.includes('inventory-panel h2')&&name==='collection'));
 for(const [selector,name,mode] of UI_ICON_TARGETS){
   assert.ok(selector && UI_ICON_NAMES.includes(name));
   assert.ok(['glyph','label'].includes(mode));
 }
});
