import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
test('hosted room QA uses exact PR head, bounded read-only jobs and uploads evidence even on failure', () => {
  const workflow = read('../../../.github/workflows/room-transition-recovery-browser.yml');
  assert.match(workflow, /ref: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /timeout-minutes: 12/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /EXPECTED_ROOM_HEAD: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.doesNotMatch(workflow, /secrets\.|pull_request_target|deploy|supabase db push/);
});
test('offline fixture uses the real transition, fade, adapter, controller, camera, input and room renderers', () => {
  const fixture = read('./browser/room-transition-recovery-fixture.mjs');
  for (const name of ['createRoomTransition','createRoomWorldAdapter','createSpaceFade','PlayerController','OrbitCameraController','bindInputFocusRuntime','createClubRoomScene','createDorm1LobbyScene','createPersonalRoomScene']) assert.match(fixture,new RegExp(name));
  assert.doesNotMatch(fixture,/supabase|\.rpc\(|localStorage|sessionStorage/);
  assert.match(fixture,/if \(!rooms.status\(\).busy\) controller.update/);
  const html = read('./browser/room-transition-recovery-harness.html');
  assert.match(html,/href="\/styles.css"/);
  assert.match(html,/id="space-fade" class="space-fade"/);
  for(const id of ['joystick','joystick-knob','jump','run'])assert.ok(html.includes(`id="${id}"`),`real touch binder needs ${id}`);
});
test('browser receipt includes desktop/mobile failure-retry and fail-closed coverage with hashed screenshots', () => {
  const smoke = read('./browser/room-transition-recovery-smoke.mjs');
  for(const word of ['desktop','portrait360','portrait390','landscape','rollbackFail','fade-before','fade-after','showCampus','resumeCampus','sha256','expectedHead','reducedMotion','expectedRoom','Input.dispatchTouchEvent'])assert.ok(smoke.includes(word),word);
  assert.match(smoke,/startSmoke/);
  assert.match(smoke,/smoke.problems/);
});
test('latest main loading render and offline shared-clock contracts remain intact', () => {
  const main=read('../src/main.js'), harness=read('./browser/harness.mjs');
  assert.match(main,/await waitForWorldRender\(\{/);
  assert.match(main,/isSceneReady: \(\) => streaming.pending.length === 0/);
  assert.match(main,/worldLoading\?\.setRenderReady\(true\)/);
  assert.match(harness,/url.pathname === "\/api\/world-time"/);
});
