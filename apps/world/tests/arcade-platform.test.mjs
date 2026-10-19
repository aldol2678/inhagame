import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const load=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll(String.fromCharCode(34),'&quot;').replaceAll(String.fromCharCode(39),'&#39;');
const games=JSON.parse(load('data/game-catalog.json')).games.filter(g=>g.id!=='campus'&&g.status==='playable');
test('published games have crawlable static detail pages and original play destinations',()=>{
 const index=load('arcade/index.html');
 for(const g of games){
  const path='arcade/'+g.id+'/index.html';
  assert.ok(index.includes('href="/arcade/'+g.id+'/"'));
  const html=load(path);
  assert.ok(html.includes('href="https://inhagame.app/arcade/'+g.id+'/"'),path);
  assert.ok(html.includes('href="'+g.playUrl+'"'),path);
  assert.ok(html.includes('alt="'+esc(g.title)+' 콘셉트 일러스트"'),path);
 }
});
test('catalog-generated pages and sitemap are current',()=>{
 const r=spawnSync(process.execPath,[new URL('../scripts/generate-arcade-pages.mjs',import.meta.url).pathname,'--check'],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
});
