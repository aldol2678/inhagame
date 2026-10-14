import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAMPUS_SHORTCUT_APPS,resolveCampusShortcut,createCampusShortcutDispatcher } from '../src/lobby/pwa-shortcuts.js';

const manifest=JSON.parse(readFileSync(new URL('../campus/manifest.webmanifest',import.meta.url),'utf8'));
test('PWA shortcut manifest is scoped, unique and keeps existing install identity',()=>{
  assert.equal(manifest.id,'/campus/');assert.equal(manifest.scope,'/');
  assert.equal(manifest.start_url,'/campus/?lobby=1');
  assert.equal(manifest.shortcuts.length,4);
  assert.deepEqual(manifest.shortcuts.map(x=>x.short_name),['캠퍼스','알림','퀴즈','앨범']);
  for(const row of manifest.shortcuts) {
    const url=new URL(row.url,'https://inhagame.app');
    assert.equal(url.origin,'https://inhagame.app');
    assert.equal(url.pathname,'/campus/');
    assert.equal(url.searchParams.get('lobby'),'1');
    assert.equal(url.searchParams.getAll('shortcut').length,1);
  }
  assert.equal(new Set(manifest.shortcuts.map(x=>x.url)).size,4);
  assert.deepEqual(Object.keys(CAMPUS_SHORTCUT_APPS),['notifications','daily-quiz','album']);
});
test('unknown, duplicated or non-lobby shortcut requests never auto-open',()=>{
  for(const query of ['', '?lobby=1', '?lobby=0&shortcut=album',
    '?lobby=1&shortcut=campus', '?lobby=1&shortcut=settings',
    '?lobby=1&shortcut=album&shortcut=notifications',
    '?shortcut=notifications'])assert.equal(resolveCampusShortcut(query),null,query);
  assert.equal(resolveCampusShortcut('?lobby=1&shortcut=notifications'),'notifications');
  assert.equal(resolveCampusShortcut('?shortcut=daily-quiz&lobby=1'),'daily-quiz');
  assert.equal(resolveCampusShortcut('?lobby=1&shortcut=album'),'album');
});
test('dispatch waits through lobby, loading, transition and input lock; launches once',()=>{
  let ready=false,attempts=0,consumed=0;
  const shortcut=createCampusShortcutDispatcher({search:'?lobby=1&shortcut=notifications',
    isReady:()=>ready,openApp:id=>{assert.equal(id,'notifications');attempts++;return true;},
    onConsumed:()=>{consumed++;}});
  assert.equal(shortcut.tryOpen(),false);assert.equal(attempts,0);
  ready=true;assert.equal(shortcut.tryOpen(),true);
  assert.equal(shortcut.tryOpen(),false);assert.equal(attempts,1);assert.equal(consumed,1);
  assert.equal(shortcut.pending,null);
});
test('failed launch keeps intent and does not bypass Phone admission',()=>{
  let open=false,attempts=0,consumed=0;
  const s=createCampusShortcutDispatcher({search:'?lobby=1&shortcut=album',
    isReady:()=>true,openApp:()=>{attempts++;return open;},onConsumed:()=>consumed++});
  assert.equal(s.tryOpen(),false);assert.equal(s.pending,'album');
  open=true;assert.equal(s.tryOpen(),true);assert.equal(attempts,2);assert.equal(consumed,1);
});
test('expiration drops stale intent without surprising later app opens',()=>{
  let clock=0,count=0;
  const s=createCampusShortcutDispatcher({search:'?lobby=1&shortcut=daily-quiz',
    isReady:()=>true,now:()=>clock,expiresAfterMs:100,
    openApp:()=>{count++;return true;}});
  clock=101;assert.equal(s.tryOpen(),false);
  assert.equal(s.pending,null);assert.equal(count,0);
});
test('the world integration uses existing InputFocus and Phone Shell without auto-enter',()=>{
  const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(source,/createCampusShortcutDispatcher\(/);
  assert.match(source,/!lobbyWorld\.active && !lobbyTransition\.active && !cinematic\.active/);
  assert.match(source,/inputFocus\.can\("WORLD_ACTION"\)/);
  assert.match(source,/smartphone\.launch\(appId\)/);
  assert.match(source,/app\.on\("update",openPwaShortcut\)/);
  assert.doesNotMatch(readFileSync(new URL('../src/lobby/pwa-shortcuts.js',import.meta.url),'utf8'),
    /location\.assign|location\.replace|\.rpc\(|serviceWorker|supabase/i);
});
