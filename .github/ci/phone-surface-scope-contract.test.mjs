import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scoped = [
  'graphics-integration-browser.yml',
  'biryong-cloud-sync-browser.yml',
  'world-main2-recovery.yml',
  'npc-shop-routing-browser.yml',
  'cooking-candidate-browser.yml',
  'room-transition-recovery-browser.yml',
  'quest-journal-controls-browser.yml',
  'asset-runtime-browser.yml',
  'player-activity-audio-browser.yml',
  'student-center-campus-browser.yml',
  'biryong-map-guidance-browser.yml'
];
const requiredUnmodified = [
  'public-ci.yml', 'phone-browser.yml', 'photo-mode-browser.yml',
  'housing-browser.yml', 'life-housing-browser.yml', 'mounted-photo-maps-browser.yml',
  'private-character-acceptance.yml', 'world-asset-optimizer.yml',
  'world-stability-browser.yml'
];

test('all 11 unrelated suites preserve jobs and check names, guard EVERY costly step', () => {
  for (const file of scoped) {
    const text = readFileSync(new URL('../workflows/'+file,import.meta.url),'utf8');
    assert.match(text,/pull_request:/,file);
    assert.match(text,/\.github\/ci\/phone-surface-scope\*\.mjs/,file);
    assert.match(text,/fetch-depth: 128/,file);
    assert.match(text,/persist-credentials: false/,file);
    assert.match(text,/id: phone_scope/,file);
    assert.match(text,/CI_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/,file);
    assert.match(text,/CI_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/,file);
    assert.match(text,/CI_PR_TITLE: \$\{\{ github\.event\.pull_request\.title \}\}/,file);
    assert.match(text,/node \.github\/ci\/phone-surface-scope\.mjs >> "\$GITHUB_OUTPUT"/,file);
    const steps = [...text.matchAll(/^      - (?:uses|name|run):.*$/gm)];
    assert.ok(steps.length>=5,file+' must keep original job');
    const bodies=steps.map((m,i)=>text.slice(m.index,steps[i+1]?.index??text.length));
    const checkout=bodies.filter(b=>b.startsWith('      - uses: actions/checkout@v4'));
    assert.equal(checkout.length,1,file);
    const gate=bodies.filter(b=>b.includes('id: phone_scope'));
    assert.equal(gate.length,1,file);
    for (const block of bodies) {
      if(block===checkout[0]||block===gate[0])continue;
      assert.match(block,/^        if: .*steps\.phone_scope\.outputs\.skip != 'true'/m,file+': unguarded costly step '+block.split('\n')[0]);
    }
    assert.match(text,/if: always\(\) && steps\.phone_scope\.outputs\.skip != 'true'/,file+' must preserve failure evidence');
  }
});
test('core release, security and gameplay integration gates remain unconditionally triggered',()=>{
  for(const file of requiredUnmodified){
    const text=readFileSync(new URL('../workflows/'+file,import.meta.url),'utf8');
    assert.doesNotMatch(text,/id: phone_scope/,file+' must not be scoped');
  }
});
