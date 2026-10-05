// Node-only contracts: this test must never import Playwright or start a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const helperUrl = new URL('./browser/biryong-map-guidance-qa.mjs', import.meta.url);
const smokeUrl = new URL('./browser/biryong-map-guidance-smoke.mjs', import.meta.url);
const workflowUrl = new URL('../../../.github/workflows/biryong-map-guidance-browser.yml', import.meta.url);

const nameplateReceipt = () => ({
  canvas: { x: 20, y: 30, right: 370, bottom: 810, width: 350, height: 780 },
  viewport: { width: 390, height: 844 }, nearest: { id: 'BR_NPC_001' },
  candidates: [{ id: 'BR_NPC_001', x: 195, y: 240, depth: 4, distance: 1.2, visible: true }],
  labels: [{ name: '강소라', detail: '운송·화물 담당 · 이동 중', font: '12px',
    x: 130, y: 204, right: 260, bottom: 240, width: 130, height: 36 }]
});

test('hosted nameplate assertions reject real rectangle clipping, overlaps, and unreadable labels', async () => {
  const { assertNpcNameplateLayout } = await import(helperUrl);
  assert.equal(typeof assertNpcNameplateLayout, 'function');
  const receipt = nameplateReceipt();
  assert.doesNotThrow(() => assertNpcNameplateLayout(receipt, 'portrait'));
  for (const changes of [{ x: 10 }, { y: 20 }, { right: 391 }, { bottom: 845 },
    { x: NaN }, { width: 0 }, { name: '' }, { font: '8px' }]) {
    assert.throws(() => assertNpcNameplateLayout({ ...receipt, labels: [{ ...receipt.labels[0], ...changes }] }, 'portrait'));
  }
  assert.throws(() => assertNpcNameplateLayout({ ...receipt, labels: [...receipt.labels,
    { ...receipt.labels[0], name: '한여울', x: 145, right: 275 }] }, 'portrait'), /overlap/);
  assert.doesNotThrow(() => assertNpcNameplateLayout({ ...receipt, labels: [] }, 'offscreen target'));
});

test('hosted nameplate coverage requires labels only when nearby heads are clearly on-screen', async () => {
  const { assertNpcNameplateCoverage } = await import(helperUrl);
  assert.equal(typeof assertNpcNameplateCoverage, 'function');
  const visible = nameplateReceipt(), empty = { ...visible, labels: [] };
  assert.throws(() => assertNpcNameplateCoverage([empty, empty, empty], 'portrait'), /readable nameplate coverage/);
  const covered = assertNpcNameplateCoverage([empty, visible, empty], 'portrait');
  assert.equal(covered.result, 'COVERED');
  assert.equal(covered.readableLabelCount, 1);
  for (const changes of [{ x: -100 }, { y: 900 }, { depth: -1 }, { distance: 23 }, { visible: false }, { x: 20 }]) {
    const outside = { ...empty, candidates: [{ ...empty.candidates[0], ...changes }] };
    const result = assertNpcNameplateCoverage([outside, outside, outside], 'portrait');
    assert.equal(result.result, 'NO_CLEAR_ONSCREEN_HEADS', 'offscreen/edge targets are documented, never forced visible');
  }
  const targetOutside = { ...visible, nearest: { id: 'BR_NPC_008' } };
  assert.doesNotThrow(() => assertNpcNameplateCoverage([targetOutside], 'offscreen nearest'),
    'a particular nearest dialogue target need not have an on-screen nameplate');
});

test('Biryong overview must expose the complete return label without text overflow', async () => {
  const { assertBiryongReturnLabelVisible } = await import(helperUrl);
  assert.equal(typeof assertBiryongReturnLabelVisible, 'function');
  const label = { id: 'poi.biryong-realm.return', text: '귀환 · F1 인하대후문행',
    clientWidth: 96, scrollWidth: 96, clientHeight: 36, scrollHeight: 36 };
  assert.doesNotThrow(() => assertBiryongReturnLabelVisible({ labels: [label] }, 'portrait'));
  assert.throws(() => assertBiryongReturnLabelVisible({ labels: [] }, 'portrait'), /return label/);
  assert.throws(() => assertBiryongReturnLabelVisible({ labels: [{ ...label, text: '귀환' }] }, 'portrait'), /complete return/);
  assert.throws(() => assertBiryongReturnLabelVisible({ labels: [{ ...label, scrollWidth: 180 }] }, 'portrait'), /overflow/);
  assert.throws(() => assertBiryongReturnLabelVisible({ labels: [{ ...label, scrollHeight: 72 }] }, 'portrait'), /overflow/);
});

test('hosted captures record nameplate DOM geometry and public head projections without changing the scene', async () => {
  const source = await readFile(smokeUrl, 'utf8');
  assert.match(source, /async function readNpcNameplates\(page\)/);
  assert.match(source, /querySelectorAll\('\.biryong-npc-nameplate'\)/);
  assert.match(source, /npcNameplateOffset\(definition\.appearance\.height\)/);
  assert.match(source, /worldToScreen\(point\)/);
  assert.match(source, /npcReceipt\.nameplatesBeforeDialogue = await readNpcNameplates\(page\)/);
  assert.match(source, /npcReceipt\.nameplatesAfterGuidance = await readNpcNameplates\(page\)/);
  assert.match(source, /assertNpcNameplateCoverage\(/);
  assert.match(source, /assertBiryongReturnLabelVisible\(entry\.overview/);
  const start = source.indexOf('async function readNpcNameplates(page)');
  const end = source.indexOf('\nasync function inspectRoute(page)', start);
  assert.doesNotMatch(source.slice(start, end), /setLocalPosition|\.pauseNpc\(|setPeriodForTest|\.app\.fire\(/);
});

test('Biryong desktop interaction and pointer help have separate visible rows', async () => {
  const { assertInteractionHintLayout, assertInteractionHintCoverage } = await import(helperUrl);
  assert.equal(typeof assertInteractionHintLayout, 'function');
  const context = { x: 575, y: 662, right: 706, bottom: 702, width: 131, height: 40 };
  const overlappingHint = { x: 519, y: 670, right: 761, bottom: 703, width: 242, height: 33 };
  assert.throws(() => assertInteractionHintLayout({ context, hint: overlappingHint }, 'desktop'), /overlap/);
  assert.doesNotThrow(() => assertInteractionHintLayout({ context,
    hint: { ...overlappingHint, y: 615, bottom: 648 } }, 'desktop'));
  assert.doesNotThrow(() => assertInteractionHintLayout({ context, hint: null }, 'touch'));
  assert.equal(typeof assertInteractionHintCoverage, 'function');
  assert.throws(() => assertInteractionHintCoverage([{ context, hint: null }], false), /visible desktop/);
  assert.doesNotThrow(() => assertInteractionHintCoverage([{ context, hint: overlappingHint }], false));
  assert.doesNotThrow(() => assertInteractionHintCoverage([{ context, hint: null }], true));
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(pointer: fine\) and \(min-width: 700px\) \{\s*body\[data-world-region="BIRYONG_REALM"\]:has\(> #context-action:not\(\[hidden\]\)\) > \.pointer-lock-hint \{\s*bottom: max\(72px, calc\(env\(safe-area-inset-bottom\) \+ 64px\)\);/);
  const source = await readFile(smokeUrl, 'utf8');
  assert.match(source, /assertInteractionHintLayout\(interactionLayout/);
  assert.match(source, /npcReceipt\.interactionLayout = interactionLayout/);
  assert.match(source, /await page\.evaluate\(waitForRenderedFrames\);\s*const interactionLayout/);
  assert.match(source, /assertInteractionHintCoverage\(entry\.npcs\.map\(npc => npc\.interactionLayout\), mobile\)/);
});

test('hosted acceptance guard rejects local and self-hosted environments without browser imports', async () => {
  const { assertHostedBrowserExecution } = await import(helperUrl);
  assert.throws(() => assertHostedBrowserExecution({}), /GitHub-hosted/);
  assert.throws(() => assertHostedBrowserExecution({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted' }), /GitHub-hosted/);
  assert.throws(() => assertHostedBrowserExecution({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_EVENT_NAME: 'push' }), /pull_request/);
  // Pure validation only; no accepted environment is applied to process.env or a subprocess.
  assert.throws(() => assertHostedBrowserExecution({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_EVENT_NAME: 'pull_request' }), /exact PR head/);
});

test('required viewport and public NPC cases are explicit and complete', async () => {
  const { BIRYONG_QA_VIEWPORTS, BIRYONG_QA_NPCS } = await import(helperUrl);
  assert.deepEqual(BIRYONG_QA_VIEWPORTS.map(v => [v.name, v.viewport.width, v.viewport.height, v.mobile]), [
    ['desktop', 1280, 720, false], ['portrait', 390, 844, true], ['landscape', 844, 390, true]
  ]);
  assert.deepEqual(BIRYONG_QA_NPCS.map(n => [n.id, n.name, n.topicId]), [
    ['BR_NPC_001', '강소라', 'work'], ['BR_NPC_003', '남이솔', 'map'], ['BR_NPC_006', '한세온', 'craft']
  ]);
  const { biryongDialogueDestinations } = await import('../src/biryong/biryong-dialogue-guidance.js');
  for (const npc of BIRYONG_QA_NPCS) assert.ok(biryongDialogueDestinations(npc.id, npc.topicId).includes(npc.target));
});

test('hosted NPC readiness accepts real moving scheduled actors without waiting for arrival', async () => {
  const { readNpcConversationReadiness, BIRYONG_QA_NPCS } = await import(helperUrl);
  assert.equal(typeof readNpcConversationReadiness, 'function');
  const { createPurposefulStudent } = await import('../npc-factory/purposeful-student-state.mjs');
  const { createBiryongVillageNpcNavigator } = await import('../src/biryong/biryong-village-npc-navigation.js');
  const { BIRYONG_VILLAGE_NPC_ROSTER, BIRYONG_VILLAGE_NPC_DESTINATIONS: destinations } = await import('../src/biryong/biryong-village-npc-contract.js');
  for (const spec of BIRYONG_QA_NPCS) {
    const index = BIRYONG_VILLAGE_NPC_ROSTER.findIndex(npc => npc.id === spec.id), npc = BIRYONG_VILLAGE_NPC_ROSTER[index];
    const controller = createPurposefulStudent({ id: npc.id, spawn: destinations[npc.schedule[0].destination].position,
      destinations, schedule: npc.schedule, navigator: createBiryongVillageNpcNavigator(),
      speed: 1.05 + index % 3 * .08, holdAtActivity: true, startHidden: npc.schedule[0].sink === true });
    controller.setScheduleIndex(1);
    // 90 slow real frames advance only 4.5 simulation seconds, not 90 seconds.
    // This replay is Node-only evidence; the hosted test never time-warps actors.
    for (let frame = 0; frame < 90; frame++) controller.tick(.05);
    const moving = controller.status(false);
    assert.equal(moving.phase, 'MOVING', npc.id); assert.equal(moving.visible, true); assert.equal(moving.failures, 0);
    let snapshot = moving;
    const readiness = vm.runInNewContext(`(${readNpcConversationReadiness.toString()})`, {
      window: { __INHAGAME_P0__: { biryongVillageNpcs: { actorSnapshot: id => id === npc.id ? snapshot : null } } }
    });
    assert.equal(readiness(npc.id), true, `${npc.name} is already publicly interactable while walking`);
    snapshot = { ...moving, visible: false }; assert.equal(readiness(npc.id), false);
    snapshot = { ...moving, phase: 'FAILED' }; assert.equal(readiness(npc.id), false);
    snapshot = { ...moving, phase: 'ACTING' }; assert.equal(readiness(npc.id), true);
  }
  const source = await readFile(smokeUrl, 'utf8');
  assert.match(source, /await wait\(readNpcConversationReadiness, npc\.id/);
  assert.doesNotMatch(source, /\.pauseNpc\s*\(|setPeriodForTest|\.app\.fire\('update',\s*(?!0\b)[\d.]+/);
  assert.match(source, /npcs: d\.biryongVillageNpcs\.status\(\)/);
  assert.match(source, /actorWhileOpen/);
});

test('moving visibility cannot bypass a currently unsafe live NPC approach', async () => {
  const { findBiryongNpcApproach } = await import('./browser/biryong-map-guidance-proximity.mjs');
  const { createPurposefulStudent } = await import('../npc-factory/purposeful-student-state.mjs');
  const { createBiryongVillageNpcNavigator } = await import('../src/biryong/biryong-village-npc-navigation.js');
  const { createBiryongNavigation } = await import('../src/biryong/biryong-navigation.js');
  const { BIRYONG_VILLAGE_NPC_ROSTER: roster, BIRYONG_VILLAGE_NPC_DESTINATIONS: destinations } = await import('../src/biryong/biryong-village-npc-contract.js');
  const { BIRYONG_MAP_DESTINATIONS } = await import('../src/biryong/biryong-map-data.js');
  const { BIRYONG_QA_NPCS } = await import(helperUrl);
  for (const [npcId, ticks] of [['BR_NPC_003', 121], ['BR_NPC_001', 211]]) {
    const controllers = roster.map((npc, index) => {
      const controller = createPurposefulStudent({ id: npc.id, spawn: destinations[npc.schedule[0].destination].position,
        destinations, schedule: npc.schedule, navigator: createBiryongVillageNpcNavigator(),
        speed: 1.05 + index % 3 * .08, holdAtActivity: true, startHidden: npc.schedule[0].sink === true });
      controller.setScheduleIndex(1); return controller;
    });
    for (let frame = 0; frame < ticks; frame++) for (const controller of controllers) controller.tick(.05);
    const actors = controllers.map(controller => controller.status(false));
    const actor = actors.find(actor => actor.id === npcId), serialized = JSON.stringify(actors);
    assert.equal(actor.phase, 'MOVING'); assert.equal(actor.visible, true);
    const spec = BIRYONG_QA_NPCS.find(npc => npc.id === npcId), provider = createBiryongNavigation();
    const input = { npcId, actors, target: BIRYONG_MAP_DESTINATIONS.find(poi => poi.poiId === spec.target).position,
      walkable: provider.walkable, segmentSafe: provider.segmentSafe };
    assert.equal(findBiryongNpcApproach(input), null, `${npcId}: visible actor crossing the station cannot be approached safely yet`);
    assert.equal(JSON.stringify(actors), serialized, 'candidate inspection never moves, pauses or modifies an actor');
    // Let the unchanged state machines complete their real routes in this Node
    // replay only; browser QA must await live progress without advancing time.
    for (let frame = ticks; frame < 1200; frame++) for (const controller of controllers) controller.tick(.05);
    const settled = controllers.map(controller => controller.status(false));
    const candidate = findBiryongNpcApproach({ ...input, actors: settled });
    assert.equal(candidate?.nearest.id, npcId);
    assert.ok(provider.walkable(candidate.player)); assert.ok(provider.segmentSafe(candidate.player, candidate.actor.position));
  }
  const source = await readFile(smokeUrl, 'utf8');
  assert.match(source, /findBiryongNpcApproach/);
  assert.match(source, /performance\.now\(\) - started < timeoutMs/);
  assert.match(source, /NPC_APPROACH_UNAVAILABLE/);
});

test('Escape repeat is verified before guidance lets a real moving actor depart', async () => {
  const { findBiryongNpcApproach } = await import('./browser/biryong-map-guidance-proximity.mjs');
  const { createBiryongNavigation } = await import('../src/biryong/biryong-navigation.js');
  const { BIRYONG_MAP_DESTINATIONS } = await import('../src/biryong/biryong-map-data.js');
  // Exact desktop actor positions from hosted-2290df0/report.json: initial normal
  // dialogue succeeded; only the late repeat setup failed after guidance capture.
  const receipt = { id: 'BR_NPC_003', initial: { x: -1.9748979334806642, z: 29.581581716188005 },
    lateRepeat: { x: -2.870414634573923, z: 26.671152437634905 } };
  const provider = createBiryongNavigation();
  const input = { npcId: receipt.id, target: BIRYONG_MAP_DESTINATIONS.find(poi => poi.poiId === 'poi.biryong-realm.council').position,
    walkable: provider.walkable, segmentSafe: provider.segmentSafe };
  const actor = position => ({ id: receipt.id, visible: true, phase: 'MOVING', position });
  assert.ok(findBiryongNpcApproach({ ...input, actors: [actor(receipt.initial)] }));
  assert.equal(findBiryongNpcApproach({ ...input, actors: [actor(receipt.lateRepeat)] }), null,
    'the existing station exclusion remains strict; sequencing must not loosen it');
  const source = await readFile(smokeUrl, 'utf8');
  const start = source.indexOf('for (const npc of BIRYONG_QA_NPCS) {');
  const escape = source.indexOf("await page.keyboard.press('Escape')", start);
  const topic = source.indexOf('await action(panel.getByRole', start);
  const guidance = source.indexOf('await capture(`npc-${npc.id}-guidance`)', start);
  assert.ok(start >= 0 && escape > start && escape < topic && topic < guidance,
    'close/reopen must be tested before the final public-topic guidance resumes NPC walking');
  const end = source.indexOf('// Retain a realm route', guidance);
  assert.doesNotMatch(source.slice(guidance, end), /approachNpc\(/, 'no unrelated late NPC journey after successful guidance');
  assert.match(source, /route\.player, finalApproachProof\.player/, 'a genuine reacquisition owns the final no-teleport comparison');
  assert.match(source, /actorWalkable: provider\.walkable\(actor\.position\)/, 'live actor geometry remains visible in the receipt');
  assert.match(source, /reuseProximity \? reopenContext : await approachNpc\(\)/, 'lost proximity is reacquired through the unchanged safe selector');
});

test('actual map receipt keeps CSS percentages separate from DOMRect viewport pixels', async () => {
  const source = await readFile(smokeUrl, 'utf8');
  // Execute only the pure DOM serializer in a tiny Node fixture. Never import the
  // guarded browser entrypoint or fabricate a hosted environment.
  const start = source.indexOf('async function readMap(page) {');
  const end = source.indexOf('\nasync function readNpcNameplates(page) {', start);
  assert.ok(start >= 0 && end > start);
  const rect = { x: 618, y: 558.4375, left: 618, top: 558.4375, right: 662, bottom: 602.4375, width: 44, height: 44 };
  const element = { hidden: true, children: [], getBoundingClientRect: () => ({ toJSON: () => ({ ...rect }) }) };
  const poi = { ...element, dataset: { poiId: 'poi.biryong-realm.station', presentation: 'NORMAL' },
    style: { left: '50%', top: '78.9318%' }, querySelector: () => ({ getAttribute: () => 'M0 0L1 1' }) };
  const root = { ...element, querySelector: () => element,
    querySelectorAll: selector => selector === '.full-map-poi' ? [poi] : [] };
  const document = { getElementById: id => id === 'full-map-panel' ? root : element, querySelectorAll: () => [] };
  const readMap = vm.runInNewContext(`(${source.slice(start, end).trim()})`, { document, innerWidth: 1280, innerHeight: 720 });
  const receipt = await readMap({ evaluate: callback => callback() });
  const node = receipt.pois[0];
  assert.equal(node.mapPositionPercent?.left, 50, 'CSS percentage must survive a DOMRect left property');
  assert.equal(node.mapPositionPercent?.top, 78.9318, 'serialized CSS percentage must survive a DOMRect top property');
  assert.equal(node.left, rect.left, 'screen geometry remains available in its original pixel units');
  assert.equal(node.top, rect.top);
  assert.match(source, /assertMapPointProjection\(node, poi\.position, b\)/);
  const { assertMapPointProjection } = await import(helperUrl);
  const { createBiryongMapDataSource, BIRYONG_MAP_DESTINATIONS } = await import('../src/biryong/biryong-map-data.js');
  const station = BIRYONG_MAP_DESTINATIONS.find(poi => poi.poiId === node.id), bounds = createBiryongMapDataSource().bounds;
  assert.doesNotThrow(() => assertMapPointProjection(node, station.position, bounds), 'normal CSSOM rounding is subpixel');
  assert.throws(() => assertMapPointProjection({ ...node, mapPositionPercent: { left: rect.left, top: rect.top } }, station.position, bounds), /local X source/);
  assert.throws(() => assertMapPointProjection({ ...node, mapPositionPercent: { left: 50, top: 78.94 } }, station.position, bounds), /local Z source/);
});

test('normal captures wait for hidden transition overlays and subsequent real frames', async () => {
  const source = await readFile(smokeUrl, 'utf8');
  const start = source.indexOf('function readTransitionVisualState(');
  const end = source.indexOf('\nasync function state(page) {', start);
  assert.ok(start >= 0 && end > start, 'a read-only transition diagnostic is required');
  const overlay = { hidden: false, className: 'space-fade on' };
  const diagnostics = vm.runInNewContext(`(${source.slice(start, end).trim()})`, {
    document: { getElementById: () => overlay },
    getComputedStyle: el => ({ display: el.hidden ? 'none' : 'block', opacity: el.hidden ? '0' : '1', visibility: 'visible' })
  });
  assert.equal(diagnostics(true), false, 'nonblank framebuffer cannot bypass a visible black DOM overlay');
  assert.equal(diagnostics()[0].hidden, false);
  assert.equal(diagnostics()[0].opacity, '1');
  overlay.hidden = true; overlay.className = 'space-fade';
  assert.equal(diagnostics(true), true);
  assert.match(source, /waitForFunction\(readTransitionVisualState, true, \{ timeout: 15000 \}\)/);
  assert.match(source, /await page\.evaluate\(waitForRenderedFrames\)/);
  assert.match(source, /capture\('failure', \{ settled: false \}\)/, 'failure screenshots retain the actual obstructed state');
  assert.doesNotMatch(source, /reducedMotion:|spaceFade\.hidden\s*=|spaceFade\.classList\.(?:add|remove)/);
});

test('browser import is guarded and actual production owners are retained', async () => {
  const source = await readFile(smokeUrl, 'utf8');
  const guard = source.indexOf('assertHostedBrowserExecution(process.env)');
  const browserImport = source.indexOf("await import('./harness.mjs')");
  assert.ok(guard >= 0 && browserImport > guard, 'hosted guard must run before importing the existing browser harness');
  assert.doesNotMatch(source, /import\s*\{[^}]*startSmoke[^}]*\}\s*from/);
  assert.doesNotMatch(source, /process\.env\.[A-Z_]+\s*=/, 'never spoof the hosted environment');
  assert.doesNotMatch(source, /\.setDataSource\s*\(|\.app\.off\s*\(|new\s+PlayerController|NullGraphicsDevice/);
  assert.match(source, /actorSnapshot/);
  assert.match(source, /nearestNpc/);
  assert.match(source, /biryongRealm\.enter\(\)/);
  assert.match(source, /biryong-station-transit/);
  assert.match(source, /SHA256SUMS/);
  assert.match(source, /PENDING_INDEPENDENT_PIXEL_REVIEW/);
});

test('workflow uses a read-only token, exact PR head and failure artifacts', async () => {
  const source = await readFile(workflowUrl, 'utf8');
  assert.match(source, /contents: read/);
  assert.doesNotMatch(source, /(?:pull_request_target|contents: write|id-token: write|secrets\.)/);
  assert.match(source, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /EXPECTED_BIRYONG_HEAD: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(source, /timeout --signal=TERM --kill-after=10s/);
  assert.match(source, /fonts-noto-cjk/);
  assert.match(source, /if: always\(\)/);
  assert.match(source, /if-no-files-found: error/);
});
