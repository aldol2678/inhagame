import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
const w=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,w),'utf8');
test('nine retired event assets and roster records are absent, but the archived room and minigame remain',()=>{
 const files=readdirSync(new URL('assets/npcs/refresh-72/',w));
 assert.equal(files.filter(x=>/^ZUE.*[.]glb$/.test(x)).length,0);
 const rows=JSON.parse(read('assets/npcs/refresh-72/manifest.json'));
 assert.equal(rows.length,63);
 assert.ok(rows.every(r=>r.kind!=='event'));
 assert.doesNotMatch(read('src/main.js'),/createMcm2026(?:Event|Minigame)Runtime\(/);
 assert.match(read('src/events/zombie-university-2026/minigame-room-runtime.js'),/export function createMcm2026MinigameRuntime/);
});
test('new Jeongseok guide mounts at the original logical anchor, not a second static body',()=>{
 const renderer=read('src/jeongseok/interior-renderer.js');
 assert.doesNotMatch(renderer,/\n\s+guide_npc\(b/);
 assert.match(renderer,/createJeongseokGuideVisual\(app, root\)/);
 assert.match(renderer,/JEONGSEOK_GUIDE\.position/);
 assert.match(renderer,/JEONGSEOK_LOBBY_GUIDE_01\.glb/);
 const ref=JSON.parse(read('release/cloudflare-live/reference.json')).files;
 assert.equal(Object.keys(ref).filter(p=>p.includes('/refresh-72/ZUE')).length,0);
 assert.ok(ref['assets/npcs/refresh-72/JEONGSEOK_LOBBY_GUIDE_01.glb']);
});
