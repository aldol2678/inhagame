import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopedPhoneMessagesOnly, inspect } from './phone-surface-scope.mjs';

const main = 'apps/world/src/main.js';
const files = [
  'apps/world/src/phone/phone-messages.js',
  'apps/world/src/phone/smartphone.js',
  'apps/world/src/phone/phone-preferences.js',
  'apps/world/phone.css',
  'apps/world/tests/browser/phone-messages-harness.html',
  'apps/world/tests/browser/phone-messages-smoke.mjs',
  'apps/world/tests/browser/phone-campus-smoke.mjs',
  'apps/world/tests/phone-preferences.test.mjs',
  main
];
const patch = [
  'diff --git a/apps/world/src/main.js b/apps/world/src/main.js',
  'index aaaa..bbbb 100644',
  '--- a/apps/world/src/main.js',
  '+++ b/apps/world/src/main.js',
  '@@ -1060,0 +1061,2 @@',
  '+    playerCard.close();',
  '+    if (smartphone?.openMessages?.(userId)) return true;',
  ''
].join('\n');
test('Phone Messages UI and reviewed player-card additions may skip unrelated heavy suites', () => {
  const minimal=['apps/world/src/phone/phone-messages.js',main];
  assert.equal(scopedPhoneMessagesOnly(minimal,patch),true);
  assert.equal(scopedPhoneMessagesOnly(minimal.filter(p=>p!==main)),true);
  assert.equal(scopedPhoneMessagesOnly(files,patch),false,'name-only trust of shared Phone UI files is forbidden');
});
test('fail closed for missing main diff, unknown paths, other functionality, or unknown changes', () => {
  assert.equal(scopedPhoneMessagesOnly(files,''),false);
  for(const path of [
    '.github/workflows/phone-browser.yml',
    '.github/workflows/graphics-integration-browser.yml',
    '.github/ci/phone-surface-scope.mjs',
    'apps/world/src/rooms/room-session.js',
    'apps/world/src/phone/phone-shell.js',
    'apps/world/src/photo/photo-mode.js',
    'supabase/migrations/20261012.sql'
  ]) assert.equal(scopedPhoneMessagesOnly([...files,path],patch),false,path);
  assert.equal(scopedPhoneMessagesOnly([],patch),false);
  assert.equal(scopedPhoneMessagesOnly(null,patch),false);
  assert.equal(scopedPhoneMessagesOnly(files,patch+'+other functionality\n'),false);
  assert.equal(scopedPhoneMessagesOnly(files,patch.replace('+    playerCard.close();','-    playerCard.close();')),false);
  assert.equal(scopedPhoneMessagesOnly(files,patch.replace('openMessages','openAlbum')),false);
  assert.equal(scopedPhoneMessagesOnly(files,[...patch.split('\n')].reverse().join('\n')),false);
});
test('release, hotfix and explicit full-ci never opt out', () => {
  for (const title of ['release(world): menu update', 'hotfix: save regression',
    '[full-ci] feat(phone): messages', '릴리스 통합', '출시 준비']) {
    const decision=inspect({CI_PR_TITLE:title,
      CI_BASE_SHA:'a'.repeat(40),CI_HEAD_SHA:'b'.repeat(40)});
    assert.deepEqual({skip:decision.skip,reason:decision.reason},{skip:false,reason:'release-or-unknown-pr'});
  }
});

test('shared Phone code and styling must match reviewed change lines', () => {
  const smartphone='apps/world/src/phone/smartphone.js';
  const prefs='apps/world/src/phone/phone-preferences.js';
  const css='apps/world/phone.css';
  for(const path of [smartphone,prefs,css])
    assert.equal(scopedPhoneMessagesOnly(['apps/world/src/phone/phone-messages.js',path]),false,path);
  const cssPatch='diff --git a/'+css+' b/'+css+'\n'+'+.phone-messages { display:grid; }\n';
  assert.equal(scopedPhoneMessagesOnly(['apps/world/src/phone/phone-messages.js',css],'',{[css]:cssPatch}),false,'partial or unreviewed CSS cannot suppress browser QA');
  assert.equal(scopedPhoneMessagesOnly(['apps/world/src/phone/phone-messages.js',css],'',{
    [css]:cssPatch.replace('.phone-messages','body')}),false);
  assert.equal(scopedPhoneMessagesOnly(['apps/world/src/phone/phone-messages.js',smartphone],'',{
    [smartphone]:'diff --git a/'+smartphone+' b/'+smartphone+'\n+  shell.close();\n'}),false);
});

test('missing CI refs cannot opt out of tests', () => {
  assert.equal(inspect({}).skip,false);
  assert.equal(inspect({CI_BASE_SHA:'x',CI_HEAD_SHA:'y'}).skip,false);
});
