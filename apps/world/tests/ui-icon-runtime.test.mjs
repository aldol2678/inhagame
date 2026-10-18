import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { UI_ICON_NAMES, UI_ICON_TARGETS, uiIconSource, refreshUiIcons } from '../src/ui/ui-icon-runtime.js';
import { PHONE_SYSTEM_APPS } from '../src/phone/phone-app-catalog.js';
const root=new URL('../assets/ui-icons/p0-v1/',import.meta.url);
test('every actual native Phone app has exactly its approved glyph mapping',()=>{
 const expected={
   'student-id':'student-id',maps:'map',camera:'camera',album:'album',settings:'settings',
   'daily-quiz':'quiz',attendance:'attendance',messages:'chat',notifications:'notification','induck-store':'shop',learning:'profile'
 };
 assert.deepEqual(Object.keys(expected).sort(),PHONE_SYSTEM_APPS.map(app=>app.id).sort());
 for(const app of PHONE_SYSTEM_APPS){
   const selector=`.smartphone-app[data-app-id="${app.id}"] .smartphone-app-icon`;
   assert.deepEqual(UI_ICON_TARGETS.filter(([target])=>target===selector),[[selector,expected[app.id],'glyph']],app.id);
 }
});
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

test('decorative images cannot initiate native dragging and retain error fallback',async()=>{
 const doc={createElement(tag){return {tag,dataset:{},children:[],listeners:{},setAttribute(name,value){this[name]=value;},addEventListener(type,fn){this.listeners[type]=fn;},append(...nodes){this.children.push(...nodes);}};}};
 const host={nodeType:1,ownerDocument:doc,textContent:'🖼️',matches:selector=>selector===UI_ICON_TARGETS[3][0],querySelector:()=>null,querySelectorAll:()=>[],replaceChildren(node){this.visual=node;}};
 refreshUiIcons(host);
 const [emoji,img]=host.visual.children;
 assert.equal(img.draggable,false);assert.equal(img.alt,'');assert.equal(host.visual['aria-hidden'],'true');
 img.listeners.load();assert.equal(img.hidden,false);assert.equal(emoji.hidden,true);
 img.listeners.error();assert.equal(img.hidden,true);assert.equal(emoji.hidden,false);assert.equal(emoji.textContent,'🖼️');
 const css=await readFile(new URL('../ui-icon-runtime.css',import.meta.url),'utf8');
 assert.match(css,/\.world-ui-icon, \.world-ui-icon \*\s*\{\s*pointer-events:none;/);
});

test('social HUD icon wrappers are not hidden and Phone retains camera',async()=>{
 const css=await readFile(new URL('../styles.css',import.meta.url),'utf8');
 assert.match(css,/\.social-cluster > button > span:not\(\.world-ui-icon\) \{\s*display: none;\s*\}/);
 assert.doesNotMatch(css,/\.social-cluster #nearby-toggle span\s*\{/);
 assert.ok(UI_ICON_TARGETS.some(([selector,name])=>selector.includes('smartphone-app[data-app-id="camera"]')&&name==='camera'));
 assert.ok(!UI_ICON_TARGETS.some(([selector])=>selector==='#photo-mode-toggle'));
});
