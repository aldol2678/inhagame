// Pure Node acceptance contracts. Importing this file never loads browser tooling.
import assert from 'node:assert/strict';

export function assertHostedBrowserExecution(env) {
  assert.ok(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted',
    'Biryong browser QA is restricted to GitHub-hosted runners; local browser execution is not authorized');
  assert.equal(env.GITHUB_EVENT_NAME, 'pull_request', 'Biryong QA requires a pull_request event');
  assert.match(env.EXPECTED_BIRYONG_HEAD || '', /^[0-9a-f]{40}$/, 'Biryong QA requires the exact PR head SHA');
  assert.equal(env.WORLD_SMOKE_DISABLE_WEBGPU, '1', 'Biryong QA requires the pinned offline WebGL2 path');
  assert.equal(env.WORLD_SMOKE_BROWSER, 'chrome', 'Biryong QA requires hosted Chrome');
}

export const BIRYONG_QA_VIEWPORTS = Object.freeze([
  { name: 'desktop', viewport: { width: 1280, height: 720 }, mobile: false },
  { name: 'portrait', viewport: { width: 390, height: 844 }, mobile: true },
  { name: 'landscape', viewport: { width: 844, height: 390 }, mobile: true }
].map(item => Object.freeze({ ...item, viewport: Object.freeze(item.viewport) })));

export const BIRYONG_QA_NPCS = Object.freeze([
  { id: 'BR_NPC_001', name: '강소라', topicId: 'work', target: 'poi.biryong-realm.station' },
  { id: 'BR_NPC_003', name: '남이솔', topicId: 'map', target: 'poi.biryong-realm.council' },
  { id: 'BR_NPC_006', name: '한세온', topicId: 'craft', target: 'poi.biryong-realm.workshop' }
].map(Object.freeze));

// Serialized directly by Playwright; inspect the existing public actor without
// changing its schedule, position, pause state, clock or animation frame rate.
export function readNpcConversationReadiness(npcId) {
  const npc = window.__INHAGAME_P0__.biryongVillageNpcs.actorSnapshot(npcId);
  return npc?.visible === true && ['MOVING', 'ACTING'].includes(npc.phase);
}

const overlaps = (a, b) => a.x < b.right - 1 && a.right > b.x + 1 && a.y < b.bottom - 1 && a.bottom > b.y + 1;
export function assertNpcNameplateLayout(layout, name) {
  const { canvas, viewport, labels } = layout;
  if (layout.camera) assertBiryongCameraReadability(layout.camera, name);
  const finiteRect = rect => ['x', 'y', 'right', 'bottom', 'width', 'height'].every(key => Number.isFinite(rect[key])) &&
    rect.width > 0 && rect.height > 0;
  assert.ok(finiteRect(canvas) && Number.isFinite(viewport.width) && Number.isFinite(viewport.height) &&
    viewport.width > 0 && viewport.height > 0, `${name}: valid canvas/viewport nameplate bounds`);
  for (const label of labels) {
    assert.ok(finiteRect(label), `${name}: finite visible nameplate rectangle`);
    assert.ok(label.name?.trim() && label.detail?.trim() && parseFloat(label.font) >= 12,
      `${name}: readable nameplate name and public role/activity`);
    assert.ok(label.x >= Math.max(0, canvas.x) - 1 && label.right <= Math.min(viewport.width, canvas.right) + 1 &&
      label.y >= Math.max(0, canvas.y) - 1 && label.bottom <= Math.min(viewport.height, canvas.bottom) + 1,
      `${name}: ${label.name} whole nameplate fits canvas and viewport`);
    for (const surface of layout.exclusions ?? []) {
      assert.ok(!overlaps(label, surface), `${name}: ${label.name} does not overlap HUD ${surface.id}`);
    }
  }
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    assert.ok(!overlaps(labels[i], labels[j]), `${name}: nameplates ${labels[i].name}/${labels[j].name} do not overlap`);
  }
}

export function assertNpcNameplateCoverage(layouts, name) {
  layouts.forEach(layout => assertNpcNameplateLayout(layout, name));
  // Head projection can differ slightly from the preceding label update while
  // actors/camera move. Require aggregate coverage only for clearly interior
  // heads, never a specific target that may currently be outside the camera.
  const eligibleProbeCount = layouts.filter(({ candidates, canvas, viewport, exclusions = [] }) => candidates.some(candidate =>
    candidate.visible && Number.isFinite(candidate.distance) && candidate.distance >= 0 && candidate.distance <= 22 &&
    Number.isFinite(candidate.depth) && candidate.depth > 0 &&
    candidate.x >= Math.max(0, canvas.x) + 32 && candidate.x <= Math.min(viewport.width, canvas.right) - 32 &&
    candidate.y >= Math.max(0, canvas.y) + 32 && candidate.y <= Math.min(viewport.height, canvas.bottom) - 32 &&
    // A hidden/cull-suppressed DOM label has no measurable box. Use generous
    // clear space around its head to avoid requiring a HUD-blocked label.
    !exclusions.some(surface => overlaps({ x: candidate.x - 96, right: candidate.x + 96,
      y: candidate.y - 48, bottom: candidate.y + 8 }, surface)))).length;
  const readableLabelCount = layouts.reduce((sum, layout) => sum + layout.labels.length, 0);
  if (eligibleProbeCount) assert.ok(readableLabelCount > 0, `${name}: readable nameplate coverage required for on-screen nearby heads`);
  return { result: readableLabelCount ? 'COVERED' : 'NO_CLEAR_ONSCREEN_HEADS', eligibleProbeCount, readableLabelCount };
}

export function assertBiryongCameraReadability(camera, name) {
  assert.ok(Number.isFinite(camera.eyeDistance) && camera.eyeDistance >= 0, `${name}: finite camera-eye distance`);
  if (camera.regionId === 'BIRYONG_REALM' && !camera.indoor && !camera.mounted && !camera.firstPerson && camera.eyeDistance < .6) {
    assert.equal(camera.localVisualOccluded, true, `${name}: compressed outdoor camera activates local visual occlusion`);
    assert.equal(camera.equipmentVisible, false, `${name}: compressed outdoor camera hides local equipment`);
  }
}

export function assertBiryongReturnLabelVisible(layout, name) {
  const label = layout.labels.find(item => item.id === 'poi.biryong-realm.return');
  assert.ok(label, `${name}: overview return label must be visible`);
  assert.match(label.text, /귀환.*F1.*인하대후문행/, `${name}: complete return destination copy`);
  assert.ok(label.clientWidth > 0 && label.clientHeight > 0 && label.scrollWidth <= label.clientWidth + 1 &&
    label.scrollHeight <= label.clientHeight + 1, `${name}: complete return label has no text overflow`);
}

export function assertInteractionHintLayout({ context, hint }, name) {
  if (context && hint) assert.ok(!overlaps(context, hint), `${name}: interaction and pointer hint must not overlap`);
}
export function assertInteractionHintCoverage(layouts, mobile) {
  if (!mobile) assert.ok(layouts.some(layout => layout?.context && layout?.hint), 'visible desktop interaction and pointer hint coverage required');
}

export function assertMapPointProjection(node, position, bounds) {
  // CSSOM serializes percentage styles to about six significant digits. A
  // 0.0001 percentage-point tolerance is at most 0.001 CSS px on a 1000px map.
  // Exact canonical world coordinates are checked separately in route receipts.
  const tolerance = 1e-4;
  const left = 3.6 + (position.x - bounds.minX) / (bounds.maxX - bounds.minX) * 92.8;
  const top = 3.6 + (1 - (position.z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * 92.8;
  assert.ok(Math.abs(node.mapPositionPercent.left - left) < tolerance, `${node.id}: local X source`);
  assert.ok(Math.abs(node.mapPositionPercent.top - top) < tolerance, `${node.id}: local Z source`);
}

export function assertMapLayout(layout, name) {
  assert.ok(layout.labels.length >= 2, `${name}: useful Korean labels must be visible`);
  for (const [part, rect] of [['surface', layout.surface], ['controls', layout.controls]]) {
    assert.ok(rect.width > 0 && rect.height > 0, `${name}: ${part} is visible`);
    assert.ok(rect.x >= Math.max(0, layout.card.x) - 1 && rect.right <= Math.min(layout.viewport.width, layout.card.right) + 1,
      `${name}: ${part} fits horizontally`);
    assert.ok(rect.y >= Math.max(0, layout.card.y) - 1 && rect.bottom <= Math.min(layout.viewport.height, layout.card.bottom) + 1,
      `${name}: ${part} fits vertically`);
  }
  for (const label of layout.labels) {
    assert.ok(parseFloat(label.font) >= 11, `${name}: ${label.id} label is readable`);
    assert.ok(label.x >= layout.surface.x - 1 && label.right <= layout.surface.right + 1 &&
      label.y >= layout.surface.y - 1 && label.bottom <= layout.surface.bottom + 1, `${name}: ${label.id} label fits`);
    assert.equal(label.hitId, label.id, `${name}: ${label.id} label receives its own input`);
    assert.ok(!overlaps(label, layout.controls), `${name}: ${label.id} does not collide with controls`);
  }
  for (let i = 0; i < layout.labels.length; i++) for (let j = i + 1; j < layout.labels.length; j++) {
    assert.ok(!overlaps(layout.labels[i], layout.labels[j]), `${name}: labels ${layout.labels[i].id}/${layout.labels[j].id} do not overlap`);
  }
  assert.ok(layout.pois.every(poi => poi.icon && poi.width >= 43.9 && poi.height >= 43.9), `${name}: visible 44px POI targets`);
  for (const button of layout.controlButtons) {
    assert.ok(button.x >= layout.controls.x - 1 && button.right <= layout.controls.right + 1, `${name}: ${button.text} fits`);
    assert.equal(button.lines, 1, `${name}: ${button.text} stays on one line`);
  }
}
