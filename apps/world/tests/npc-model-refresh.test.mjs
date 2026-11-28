import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root = new URL('../assets/npcs/refresh-72/',import.meta.url);
const read = f => readFileSync(new URL(f,root));
const rows = JSON.parse(read('manifest.json'));
test('all 72 reviewed generated models match the public bundle and keep their animation names',()=>{
 assert.equal(rows.length,72);
 assert.equal(new Set(rows.map(x=>x.id)).size,72);
 assert.deepEqual(readdirSync(root).filter(f=>f.endsWith('.glb')).sort(),rows.map(r=>r.file).sort());
 const refs=JSON.parse(readFileSync(new URL('../release/cloudflare-live/reference.json',import.meta.url))).files;
 for(const r of rows){
  const b=read(r.file);
  assert.equal(b.toString('ascii',0,4),'glTF',r.id);
  assert.equal(b.readUInt32LE(4),2,r.id);
  assert.equal(b.readUInt32LE(8),b.length,r.id);
  assert.equal(b.length,r.bytes,r.id);
  assert.equal(createHash('sha256').update(b).digest('hex'),r.sha256,r.id);
  assert.equal(refs['assets/npcs/refresh-72/'+r.file],r.sha256,r.id);
  const j=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));
  assert.deepEqual(j.animations.map(x=>x.name),r.animations,r.id);
  assert.ok(j.skins?.length>0,r.id);
 }
});
test('model generation remains explicit and release excludes Blender tools',()=>{
 const source=readFileSync(new URL('../npc-factory/npc-model-refresh.mjs',import.meta.url),'utf8');
 const refs=Object.keys(JSON.parse(readFileSync(new URL('../release/cloudflare-live/reference.json',import.meta.url))).files);
 assert.match(source,/npcModels'\)==='generated'/);
 assert.match(source,/count=5/);
 assert.ok(refs.includes('npc-factory/npc-model-refresh.mjs'));
 assert.equal(refs.some(x=>x.endsWith('.blend')||x.includes('inha-npc-generator')),false);
});
