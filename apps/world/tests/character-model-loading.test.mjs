import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEquipmentAnchors } from '../src/appearance/equipment-anchors.js';
import { composeEmotePose, emoteOffsets, REST_OFFSETS } from '../src/online/emotes.js';
import { SIT_OFFSETS } from '../src/seat-anchors.js';
import { HUMAN_HEIGHT, PLAYER_ORIGIN_Y } from '../src/player-dimensions.js';
import { createAssetAuthorityCanary } from '../src/asset-authority-canary.js';
import { ASSET_OPTIMIZATION_SHADOW_STATUS } from '../src/asset-optimization-shadow.js';

const URLS = { duck: '/assets/induck-v3.glb', dragon: '/assets/annyongi-flight-v1.glb' };
const PIVOTS = { duck: ['DuckWing_L', 'DuckWing_R', 'DuckLeg_L', 'DuckLeg_R'], dragon: ['DragonWing_L', 'DragonWing_R'] };
class Entity {
  constructor(name) {
    this.name = name; this.children = []; this.parent = null; this.enabled = true;
    this.position = [0, 0, 0]; this.euler = [0, 0, 0]; this.scale = [1, 1, 1];
    this.destroyCount = 0; this.events = new Map();
  }
  once(name, callback) { const handlers = this.events.get(name) ?? []; handlers.push(callback); this.events.set(name, handlers); }
  addChild(child) { child.parent?.removeChild(child); child.parent = this; this.children.push(child); }
  removeChild(child) { this.children = this.children.filter(c => c !== child); child.parent = null; }
  addComponent() { this.render = {}; }
  setLocalPosition(...value) { this.position = value; }
  setLocalScale(...value) { this.scale = value; }
  setLocalEulerAngles(...value) { this.euler = value; }
  getLocalEulerAngles() { const [x, y, z] = this.euler; return { x, y, z }; }
  findByName(name) { return this.name === name ? this : this.children.map(c => c.findByName(name)).find(Boolean); }
  destroy() {
    this.destroyCount += 1; this.parent?.removeChild(this);
    for (const child of [...this.children]) child.destroy();
    for (const callback of this.events.get('destroy') ?? []) callback();
    this.events.clear();
  }
}
const makeChild = (player, name) => { const root = new Entity(name); player.addChild(root); return root; };
const prototypes = Object.fromEntries([
  ['CAMPUS_KICKBOARD_ID', 'createCampusKickboard'], ['CAMPUS_KART_ID', 'createCampusKart'],
  ['DUCK_BOAT_ID', 'createDuckBoat'], ['CAMPUS_SHUTTLE_ID', 'createCampusShuttle'], ['CAMPUS_BALLOON_ID', 'createCampusBalloon']
].flatMap(([id, factory]) => [[id, id], [factory, player => makeChild(player, id)]]));
// Exercise the shipping character code. Only the renderer/geometry factories and asset I/O are
// replaced; animation, dimensions, equipment anchors and the canary owner are real modules.
const source = readFileSync(new URL('../src/character-model.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace('export function createCharacter', 'function createCharacter');
const createCharacter = new Function('deps', `const {${[
  'pc', 'composeEmotePose', 'emoteOffsets', 'REST_OFFSETS', 'SIT_OFFSETS', 'HUMAN_HEIGHT', 'PLAYER_ORIGIN_Y',
  'CAMPUS_BIKE_ID', 'attachRiderBike', 'CAMPUS_HELICOPTER_ID', 'attachRiderHelicopter', 'createEquipmentAnchors', ...Object.keys(prototypes)
].join(',')}} = deps; ${source}; return createCharacter;`)({
  pc: { Entity, StandardMaterial: class { update() {} }, Color: class {} },
  composeEmotePose, emoteOffsets, REST_OFFSETS, SIT_OFFSETS, HUMAN_HEIGHT, PLAYER_ORIGIN_Y, createEquipmentAnchors,
  CAMPUS_BIKE_ID: 'bike', CAMPUS_HELICOPTER_ID: 'helicopter',
  attachRiderBike: player => makeChild(player, 'bike'),
  attachRiderHelicopter: player => ({ root: makeChild(player, 'helicopter'), update() {} }), ...prototypes
});
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({ canary = false, waitOptimized = null, preflightThrows = false } = {}) {
  const pending = new Map(), instances = [], assets = [];
  const app = { assets: { loadFromUrl(url, _kind, callback) { pending.set(url, callback); }, remove() {} } };
  function asset(kind, { badPivot = false, throws = false } = {}) {
    const result = { resource: { instantiateRenderEntity() {
      if (throws) throw new Error('injected instantiate failure');
      const entity = new Entity(kind);
      for (const pivot of PIVOTS[kind].slice(badPivot ? 1 : 0)) entity.addChild(new Entity(pivot));
      instances.push(entity); return entity;
    } }, unload() {} };
    assets.push(result); return result;
  }
  const player = new Entity('Player');
  const owner = canary ? createAssetAuthorityCanary({ app, enabled: true, percentage: 100,
    shadow: { optimizedUrlFor: () => '/optimized/duck.glb', observeResource: async () => { if (preflightThrows) throw new Error('injected preflight failure'); return { status: ASSET_OPTIMIZATION_SHADOW_STATUS.MATCH }; } },
    optimizedLoader: async () => { if (waitOptimized) await waitOptimized; return asset('duck'); }
  }) : null;
  const character = createCharacter(app, player, { assetCanary: owner, assetCanarySubjectKey: 'test-subject' });
  return { app, player, character, instances, assets,
    success(kind, options) { pending.get(URLS[kind])(null, asset(kind, options)); },
    fail(kind, missing = false) { pending.get(URLS[kind])(missing ? null : new Error(`injected ${kind} failure`), missing ? {} : null); }
  };
}
const visual = (f, kind) => f.player.findByName(kind === 'duck' ? 'Induck_GLB_Visual' : 'Annyongi_GLB_Visual');
const fallback = (f, kind) => f.player.findByName(kind === 'duck' ? 'Public_QA_Avatar' : 'Public_QA_Carrier');
function assertOwned(f) {
  for (const entity of f.instances) {
    assert.ok(entity.parent === f.player || entity.destroyCount === 1, `${entity.name}: no orphan instance`);
    assert.ok(entity.destroyCount <= 1, `${entity.name}: at most one destroy`);
  }
}

for (const failed of ['duck', 'dragon']) {
  const good = failed === 'duck' ? 'dragon' : 'duck';
  for (const order of ['failure-first', 'success-first']) {
    test(`${failed} load failure, ${order}: independently adopt ${good} and retain only the failed fallback`, async () => {
      const f = fixture(); f.character.setMounted(true);
      if (order === 'failure-first') f.fail(failed); else f.success(good);
      await flush();
      if (order === 'failure-first') f.success(good); else f.fail(failed);
      await f.character.ready;
      assert.ok(visual(f, good), 'successful model is retained');
      assert.equal(visual(f, failed), undefined);
      assert.equal(fallback(f, good).enabled, false);
      assert.equal(fallback(f, failed).enabled, true);
      assertOwned(f);
    });
  }
  for (const failure of ['missing-resource', 'instantiate', 'bad-pivot']) {
    test(`${failed} ${failure}: does not discard the other model and destroys invalid instances`, async () => {
      const f = fixture(); f.success(good);
      if (failure === 'missing-resource') f.fail(failed, true);
      else f.success(failed, { throws: failure === 'instantiate', badPivot: failure === 'bad-pivot' });
      await f.character.ready;
      assert.ok(visual(f, good)); assert.equal(visual(f, failed), undefined); assertOwned(f);
    });
  }
}

test('a completed model becomes usable before the unrelated pending model settles', async () => {
  const f = fixture(); let ready = false; f.character.ready.then(() => { ready = true; });
  f.success('duck'); await flush();
  assert.ok(visual(f, 'duck')); assert.equal(ready, false);
  f.fail('dragon'); assert.equal(await f.character.ready, 'glb');
  assert.equal(f.character.modelState, 'glb'); assert.equal(f.character.dragonModelState, 'fallback');
});

test('carrier completion is usable while the duck remains pending, including camera visibility changes', async () => {
  const f = fixture(); let ready = false; f.character.ready.then(() => { ready = true; });
  f.character.setMounted(true); f.character.setCameraOccluded(true);
  f.success('dragon'); await flush();
  assert.ok(visual(f, 'dragon')); assert.equal(visual(f, 'dragon').enabled, false);
  assert.equal(fallback(f, 'dragon').enabled, false); assert.equal(ready, false);
  f.character.setCameraOccluded(false); assert.equal(visual(f, 'dragon').enabled, true);
  f.fail('duck'); await f.character.ready;
  assert.equal(f.character.modelState, 'fallback'); assert.equal(f.character.dragonModelState, 'glb');
  assertOwned(f);
});

test('both unavailable models settle ready with the existing fallback contract', async () => {
  const f = fixture(); f.fail('duck'); f.fail('dragon');
  assert.equal(await f.character.ready, 'fallback');
  assert.equal(f.character.modelState, 'fallback'); assert.equal(f.character.dragonModelState, 'fallback');
  assert.equal(f.instances.length, 0);
});

test('independent states preserve duck dimensions and carrier flight animation', async () => {
  for (const failed of ['duck', 'dragon', null]) {
    const f = fixture();
    for (const kind of ['duck', 'dragon']) failed === kind ? f.fail(kind) : f.success(kind);
    await f.character.ready; f.character.setMounted(true);
    f.character.update(0, { mounted: true, moving: true, grounded: false });
    const carrier = visual(f, 'dragon') ?? fallback(f, 'dragon');
    const relativeY = (visual(f, 'duck') ?? fallback(f, 'duck')).position[1] - carrier.position[1];
    f.character.update(.1, { mounted: true, moving: true, grounded: false });
    const duck = visual(f, 'duck') ?? fallback(f, 'duck');
    assert.ok(Math.abs(duck.scale[0] - HUMAN_HEIGHT / (failed === 'duck' ? 2.3475 : 2.865)) < 1e-9);
    assert.ok(Math.abs(duck.position[1] - carrier.position[1] - relativeY) < 1e-9, 'rider stays aligned with carrier bob in mixed states');
    if (failed !== 'dragon') assert.notEqual(visual(f, 'dragon').position[1], 0, 'loaded carrier still bobs when duck fails');
    f.character.setFirstPerson(true);
    assert.equal(duck.enabled, false);
    assert.equal((visual(f, 'dragon') ?? fallback(f, 'dragon')).enabled, false);
    f.character.setFirstPerson(false); f.character.setCameraOccluded(true);
    assert.equal(duck.enabled, false);
    f.character.setMounted(false); f.character.setCameraOccluded(false);
    assert.equal(duck.enabled, true);
    assert.equal((visual(f, 'dragon') ?? fallback(f, 'dragon')).enabled, false);
    assertOwned(f);
  }
});

test('player disposal before callbacks prevents new entities and late attachment', async () => {
  const f = fixture(); f.player.destroy(); f.success('duck'); f.success('dragon');
  await f.character.ready;
  assert.equal(f.player.children.length, 0); assert.equal(f.instances.length, 0);
});

test('player disposal after one success destroys it once and blocks the remaining callback', async () => {
  const f = fixture(); f.success('duck'); await flush();
  f.player.destroy(); f.success('dragon'); await f.character.ready;
  assert.equal(f.player.children.length, 0); assert.equal(f.instances.length, 1); assertOwned(f);
});

test('player disposal between successful callbacks and adoption releases both unattached instances once', async () => {
  const f = fixture(); f.success('duck'); f.success('dragon');
  assert.equal(f.instances.length, 2); assert.ok(f.instances.every(entity => entity.parent === null));
  f.player.destroy(); await f.character.ready;
  assert.equal(f.player.children.length, 0); assertOwned(f);
});

test('selected canary survives carrier failure and manual rollback attaches canonical exactly once', async () => {
  const f = fixture({ canary: true }); f.success('duck'); f.fail('dragon');
  await f.character.ready;
  assert.equal(f.character.assetCanary.authority, 'OPTIMIZED_CANARY');
  assert.ok(visual(f, 'duck'));
  const before = visual(f, 'duck');
  const receipt = f.character.rollbackAssetCanary('TEST_ROLLBACK');
  assert.equal(receipt.authority, 'CANONICAL'); assert.equal(receipt.reason, 'TEST_ROLLBACK');
  assert.notEqual(visual(f, 'duck'), before); assert.equal(before.destroyCount, 1);
  f.character.rollbackAssetCanary('AGAIN');
  assert.equal(f.player.children.filter(e => e.name === 'Induck_GLB_Visual').length, 1);
  assertOwned(f); f.player.destroy(); assertOwned(f);
});

test('player disposal destroys retained canary canonical and active clones exactly once', async () => {
  const f = fixture({ canary: true }); f.success('duck'); f.success('dragon');
  await f.character.ready; f.player.destroy();
  assert.equal(f.instances.length, 3); assertOwned(f);
  f.character.rollbackAssetCanary('AFTER_DESTROY');
  assert.equal(f.player.children.length, 0); assertOwned(f);
});

test('canary preparation completing after player disposal releases both unattached clones', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; });
  const f = fixture({ canary: true, waitOptimized: waiting });
  f.success('duck'); f.fail('dragon'); await flush();
  f.player.destroy();
  assert.equal(f.instances[0].destroyCount, 1, 'retained canonical released immediately while prepare remains pending');
  release(); await f.character.ready;
  assert.equal(f.player.children.length, 0); assert.equal(f.instances.length, 2); assertOwned(f);
});

test('canary preflight rejection releases its already-created canonical and preserves carrier', async () => {
  const f = fixture({ canary: true, preflightThrows: true });
  f.success('duck'); f.success('dragon'); await f.character.ready;
  assert.equal(f.character.modelState, 'fallback'); assert.ok(visual(f, 'dragon')); assertOwned(f);
});
