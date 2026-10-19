import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import policy from '../game-catalog.js';
const data = JSON.parse(readFileSync(new URL('../data/game-catalog.json', import.meta.url)));
const browser = vm.createContext({ URL });
vm.runInContext(readFileSync(new URL('../game-catalog.js', import.meta.url), 'utf8'), browser);

test('browser and generator use the same catalog without changing its data', () => {
  const before = JSON.stringify(data);
  assert.equal(JSON.stringify(browser.InhaGameCatalog.readCatalog(data)), JSON.stringify(policy.readCatalog(data)));
  assert.equal(JSON.stringify(data), before);
});
test('URL approval is tied to an explicit ID and an exact destination', () => {
  for (const g of data.games) assert.equal(policy.checkedPlayUrl(g.playUrl, g.id), g.playUrl);
  for (const url of ['https://undefined/', 'https://duck.inhagame.app.evil.test/', 'https://duck.inhagame.app/?x=1', 'https://user@duck.inhagame.app/', 'javascript:alert(1)']) {
    assert.equal(policy.checkedPlayUrl(url, 'classic'), null);
  }
  assert.equal(policy.checkedPlayUrl('https://duck.inhagame.app/', 'unknown'), null);
  assert.equal(policy.checkedPlayUrl('https://duck.inhagame.app/', 'constructor'), null);
});
test('new planned games need metadata but do not need a host approval until playable', () => {
  const d=structuredClone(data);
  d.games.push({ id:'planned-puzzle', title:'새 퍼즐', description:'준비 중인 게임입니다.', status:'planned', sortOrder:1,
    platform:{genre:'퍼즐',label:'퍼즐',coverImage:'/assets/hub/planned-puzzle-concept.svg'} });
  assert.equal(policy.readCatalog(d)[0].playUrl, null);
  d.games.at(-1).playUrl='https://unknown.inhagame.app/';
  assert.throws(()=>policy.readCatalog(d), /Invalid game link/);
});
test('a policy edit cannot approve insecure, credentialed or non-root play URLs', () => {
  const source=readFileSync(new URL('../game-catalog.js',import.meta.url),'utf8');
  for (const url of ['http://duck.inhagame.app/', 'https://user@duck.inhagame.app/', 'https://duck.inhagame.app/play', 'https://duck.inhagame.app/?x=1']) {
    const ctx=vm.createContext({URL});
    vm.runInContext(source.replace('https://duck.inhagame.app/',url),ctx);
    assert.equal(ctx.InhaGameCatalog.checkedPlayUrl(url,'classic'),null,url);
  }
});
test('duplicate IDs and equal-order entries have one deterministic contract', () => {
  const d=structuredClone(data); d.games[1].sortOrder=d.games[2].sortOrder;
  assert.deepEqual(policy.readCatalog(d).filter(g=>g.sortOrder===30).map(g=>g.id),['classic','induckup']);
  d.games.push(structuredClone(d.games[1]));
  assert.throws(()=>policy.readCatalog(d), /Invalid game catalog/);
});
