import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const source = fileURLToPath(new URL('../', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'arcade-generation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ['scripts', 'data', 'arcade', 'assets/hub', 'index.html', 'game-catalog.js']) {
    if (existsSync(join(source, path))) cpSync(join(source, path), join(root, path), { recursive: true });
  }
  const data = JSON.parse(readFileSync(join(root, 'data/game-catalog.json'), 'utf8'));
  const write = () => writeFileSync(join(root, 'data/game-catalog.json'), JSON.stringify(data));
  const run = (...args) => spawnSync(process.execPath, [join(root, 'scripts/generate-arcade-pages.mjs'), ...args], { encoding: 'utf8' });
  const read = path => readFileSync(join(root, path), 'utf8');
  return { root, data, write, run, read };
}
const generated = r => assert.equal(r.status, 0, r.stderr);

for (const transition of ['removed', 'planned']) test(`${transition} game cannot retain its old playable detail`, t => {
  const f = fixture(t); generated(f.run());
  if (transition === 'removed') f.data.games = f.data.games.filter(g => g.id !== 'classic');
  else Object.assign(f.data.games.find(g => g.id === 'classic'), { status: 'planned', playUrl: null });
  f.write();
  assert.notEqual(f.run('--check').status, 0);
  generated(f.run()); generated(f.run('--check'));
  assert.equal(existsSync(join(f.root, 'arcade/classic/index.html')), false);
  assert.doesNotMatch(f.read('index.html').split('<!-- ARCADE-CARDS:START -->')[1].split('<!-- ARCADE-CARDS:END -->')[0], /href="https:\/\/duck\.inhagame\.app\/" rel=/);
  assert.doesNotMatch(f.read('sitemap.xml'), /\/arcade\/classic\//);
});

test('orphan check detects generated details while cleanup preserves unrelated files', t => {
  const f = fixture(t); generated(f.run());
  mkdirSync(join(f.root, 'arcade/manual'), { recursive: true });
  writeFileSync(join(f.root, 'arcade/manual/index.html'), '<h1>Maintained by a person</h1>');
  writeFileSync(join(f.root, 'arcade/classic/notes.txt'), 'keep');
  f.data.games = f.data.games.filter(g => g.id !== 'classic'); f.write();
  assert.notEqual(f.run('--check').status, 0);
  generated(f.run()); generated(f.run('--check'));
  assert.equal(f.read('arcade/manual/index.html'), '<h1>Maintained by a person</h1>');
  assert.equal(f.read('arcade/classic/notes.txt'), 'keep');
  assert.equal(existsSync(join(f.root, 'arcade/classic/index.html')), false);
});

test('check fails on an orphan even when all expected pages are current', t => {
  const f=fixture(t); generated(f.run());
  const old=f.read('arcade/classic/index.html');
  f.data.games=f.data.games.filter(g=>g.id!=='classic'); f.write(); generated(f.run());
  writeFileSync(join(f.root,'arcade/classic/index.html'),old);
  const r=f.run('--check'); assert.notEqual(r.status,0); assert.match(r.stderr,/Orphan generated file/);
});

test('regeneration only changes the marked home card area', t => {
  const f=fixture(t);
  const unmanaged=s=>s.replace(/<!-- ARCADE-CARDS:START -->[\s\S]*?<!-- ARCADE-CARDS:END -->/,'');
  const before=unmanaged(f.read('index.html'));
  f.data.games[1].title='새 원작 제목'; f.write(); generated(f.run());
  assert.equal(unmanaged(f.read('index.html')),before);
});

for (const mode of ['parent', 'dangling target']) test(`generation rejects a ${mode} symlink without outside writes`, t => {
  const f=fixture(t); const outside=mkdtempSync(join(tmpdir(),'arcade-outside-'));
  t.after(()=>rmSync(outside,{recursive:true,force:true}));
  if(mode==='parent') {
    rmSync(join(f.root,'arcade/classic'),{recursive:true});
    symlinkSync(outside,join(f.root,'arcade/classic'),'dir');
  } else {
    rmSync(join(f.root,'arcade/classic/index.html'));
    symlinkSync(join(outside,'index.html'),join(f.root,'arcade/classic/index.html'));
  }
  const before=f.read('arcade/index.html'); const r=f.run();
  assert.notEqual(r.status,0); assert.match(r.stderr,/Unsafe output/);
  assert.equal(existsSync(join(outside,'index.html')),false);
  assert.equal(f.read('arcade/index.html'),before);
});

test('an unowned page at an expected output path is preserved and reported', t => {
  const f=fixture(t); writeFileSync(join(f.root,'arcade/classic/index.html'),'<h1>Manual page</h1>');
  const r=f.run(); assert.notEqual(r.status,0); assert.match(r.stderr,/Unowned output/);
  assert.equal(f.read('arcade/classic/index.html'),'<h1>Manual page</h1>');
});

for (const svg of ['<svg', '<svg><g></svg>', '<svg></svg bad="x">', '<svg width="10" width="20"/>', '<svg><use href = "https://example.test/x"/></svg>', '<svg><a href="javascript:alert(1)"/></svg>', '<svg onload="alert(1)"/>']) {
  test(`generation rejects malformed or active cover: ${svg.slice(0,35)}`, t => {
    const f=fixture(t); const before=f.read('arcade/index.html');
    writeFileSync(join(f.root,'assets/hub/classic-concept.svg'),svg);
    const r=f.run(); assert.notEqual(r.status,0); assert.match(r.stderr,/Unsafe cover/);
    assert.equal(f.read('arcade/index.html'),before);
  });
}

test('one reviewed host policy and catalog entry generate both home and arcade cards', t => {
  const f = fixture(t);
  const game = { id: 'review-fifth', title: '새 퍼즐', description: '임시 복사본의 다섯 번째 게임입니다.',
    playUrl: 'https://review-fifth.inhagame.app/', status: 'playable', sortOrder: 60,
    platform: { genre: '퍼즐', label: '퍼즐', coverImage: '/assets/hub/review-fifth-concept.svg' } };
  f.data.games.push(game); f.write();
  writeFileSync(join(f.root, 'assets/hub/review-fifth-concept.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const policy = f.read('game-catalog.js').replace('const playUrls = Object.freeze({',
    'const playUrls = Object.freeze({"review-fifth":"https://review-fifth.inhagame.app/",');
  writeFileSync(join(f.root, 'game-catalog.js'), policy);
  generated(f.run()); generated(f.run('--check'));
  const browser = vm.createContext({ URL });
  vm.runInContext(f.read('game-catalog.js'), browser);
  const readGames = browser.InhaGameCatalog.readCatalog(f.data);
  assert.equal(readGames.find(g=>g.id==='review-fifth').playUrl, game.playUrl);
  assert.equal(browser.InhaGameCatalog.gameIdForUrl(game.playUrl), game.id);
  assert.match(f.read('index.html'), /data-game-id="review-fifth"/);
  assert.match(f.read('index.html'), /href="https:\/\/review-fifth\.inhagame\.app\/"/);
  assert.match(f.read('arcade/index.html'), /href="\/arcade\/review-fifth\/"/);
  assert.match(f.read('arcade/review-fifth/index.html'), /href="https:\/\/review-fifth\.inhagame\.app\/"/);
});

for (const [name, mutate] of [
  ['unknown ID with undefined host', d => { const g=d.games[1]; g.id='unknown'; g.playUrl='https://undefined/'; g.platform.coverImage='/assets/hub/unknown-concept.svg'; }],
  ['negative sort order', d => { d.games[1].sortOrder=-1; }],
  ['non-string title', d => { d.games[1].title=42; }],
  ['blank description', d => { d.games[1].description='   '; }],
  ['missing cover', d => { d.games[1].platform.coverImage='/assets/hub/classic-concept.svg'; }],
]) test(`generation rejects ${name} before writing output`, t => {
  const f = fixture(t); const before=f.read('arcade/index.html'); mutate(f.data); f.write();
  if (name==='missing cover') rmSync(join(f.root, 'assets/hub/classic-concept.svg'));
  assert.notEqual(f.run().status, 0);
  assert.equal(f.read('arcade/index.html'), before, 'invalid input must not partially update pages');
});

test('sortOrder changes do not make a valid sitemap fail the SEO contract', t => {
  const f = fixture(t); f.data.games[1].sortOrder=100; f.write(); generated(f.run());
  mkdirSync(join(f.root,'tests'), { recursive:true });
  cpSync(join(source,'tests/seo-metadata.test.mjs'), join(f.root,'tests/seo-metadata.test.mjs'));
  const env={...process.env}; delete env.NODE_TEST_CONTEXT;
  const r=spawnSync(process.execPath,['--test','--test-name-pattern=^sitemap includes',join(f.root,'tests/seo-metadata.test.mjs')],{encoding:'utf8', env});
  assert.match(r.stdout,/tests 1/,r.stdout+r.stderr);
  assert.equal(r.status,0,r.stdout+r.stderr);
});
