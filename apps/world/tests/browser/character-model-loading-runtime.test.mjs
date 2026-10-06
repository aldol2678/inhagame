// Pinned PlayCanvas with real local GLBs and real entities/components. Null device only:
// this verifies parsing, ownership and pose behavior, not pixels or WebGL/WebGPU rendering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as pc from './node_modules/playcanvas/build/playcanvas.mjs';
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'playcanvas'
    ? { url: pathToFileURL(realpathSync(new URL('./node_modules/playcanvas/build/playcanvas.mjs', import.meta.url))).href, shortCircuit: true }
    : nextResolve(specifier, context);
} });
const { createCharacter } = await import('../../src/character-model.js');
hook.deregister();
const { createAssetAuthorityCanary } = await import('../../src/asset-authority-canary.js');
const { ASSET_OPTIMIZATION_SHADOW_STATUS } = await import('../../src/asset-optimization-shadow.js');
const URLS = { duck: '/assets/induck-v3.glb', dragon: '/assets/annyongi-flight-v1.glb' };
const flush = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t, { canary = false, optimizedWait = null } = {}) {
  assert.equal(pc.version, '2.22.4');
  const canvas = { id: t.name, width: 16, height: 16, style: {}, addEventListener() {}, removeEventListener() {} };
  const app = new pc.AppBase(canvas), options = new pc.AppOptions();
  options.graphicsDevice = new pc.NullGraphicsDevice(canvas);
  options.componentSystems = [pc.RenderComponentSystem];
  options.resourceHandlers = [pc.ContainerHandler, pc.TextureHandler];
  app.init(options);
  t.after(() => app.destroy());
  const assets = {}, instances = [], pending = new Map();
  for (const kind of ['duck', 'dragon', ...(canary ? ['optimized'] : [])]) {
    const url = kind === 'optimized' ? '/test-only/optimized-duck.glb' : URLS[kind];
    // A separate canonical-byte clone is sufficient to exercise canary ownership, not
    // optimization equivalence. No production asset endpoint or online API is contacted.
    const bytes = readFileSync(new URL(`../../assets/${kind === 'dragon' ? 'annyongi-flight-v1' : 'induck-v3'}.glb`, import.meta.url));
    const asset = new pc.Asset(kind, 'container', { url, filename: url.split('/').at(-1),
      contents: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    app.assets.add(asset);
    assets[kind] = await new Promise((resolve, reject) => app.assets.loadFromUrl(url, 'container', (error, result) => error ? reject(error) : resolve(result)));
    const instantiate = asset.resource.instantiateRenderEntity.bind(asset.resource);
    asset.resource.instantiateRenderEntity = opts => {
      const entity = instantiate(opts), record = { entity, destroys: 0, kind };
      const destroy = entity.destroy.bind(entity);
      entity.destroy = () => { record.destroys += 1; destroy(); };
      instances.push(record); return entity;
    };
  }
  app.assets.loadFromUrl = (url, _kind, callback) => pending.set(url, callback);
  const player = new pc.Entity('RuntimePlayer'); app.root.addChild(player);
  const owner = canary ? createAssetAuthorityCanary({ app, enabled: true, percentage: 100,
    shadow: { optimizedUrlFor: () => '/test-only/optimized-duck.glb', observeResource: async () => ({ status: ASSET_OPTIMIZATION_SHADOW_STATUS.MATCH }) },
    optimizedLoader: async () => { if (optimizedWait) await optimizedWait; return assets.optimized; }
  }) : null;
  const character = createCharacter(app, player, { assetCanary: owner, assetCanarySubjectKey: 'null-runtime-test' });
  return { app, player, character, instances, assets,
    success(kind) { pending.get(URLS[kind])(null, assets[kind]); },
    fail(kind) { pending.get(URLS[kind])(new Error(`injected ${kind} failure`)); }
  };
}
function checkReleased(f) {
  assert.equal(f.player.children.length, 0);
  for (const record of f.instances) {
    assert.equal(record.destroys, 1, `${record.kind} destroyed exactly once`);
    assert.equal(record.entity.parent, null); assert.equal(record.entity.findComponents('render').length, 0);
  }
}
for (const failed of ['duck', 'dragon']) {
  test(`real GLBs: ${failed} failure preserves its sibling and releases every instance on player destruction`, async t => {
    const f = await fixture(t), good = failed === 'duck' ? 'dragon' : 'duck';
    f.fail(failed); await flush(); f.success(good); await f.character.ready;
    const loaded = f.player.findByName(good === 'duck' ? 'Induck_GLB_Visual' : 'Annyongi_GLB_Visual');
    assert.ok(loaded); assert.ok(loaded.findComponents('render').length > 0);
    f.character.setMounted(true); f.character.update(.1, { mounted: true, moving: true, grounded: false });
    assert.equal(loaded.enabled, true);
    if (good === 'dragon') assert.notEqual(loaded.getLocalPosition().y, 0);
    f.character.setCameraOccluded(true); assert.equal(loaded.enabled, false);
    f.character.setCameraOccluded(false); assert.equal(loaded.enabled, true);
    f.player.destroy(); checkReleased(f);
    assert.ok(f.assets[good].resource, 'shared container stays loaded');
  });
}
test('real GLB bad pivot is released without taking down the other model', async t => {
  const f = await fixture(t);
  const instantiate = f.assets.duck.resource.instantiateRenderEntity;
  f.assets.duck.resource.instantiateRenderEntity = options => {
    const entity = instantiate(options); entity.findByName('DuckLeg_L').name = 'invalid-test-pivot'; return entity;
  };
  f.success('dragon'); f.success('duck'); await f.character.ready;
  assert.equal(f.character.modelState, 'fallback'); assert.equal(f.character.dragonModelState, 'glb');
  assert.equal(f.instances.find(x => x.kind === 'duck').destroys, 1);
  f.player.destroy(); checkReleased(f);
});
test('real player disposal blocks pending load instances and attachment', async t => {
  const f = await fixture(t); f.player.destroy(); f.success('duck'); f.success('dragon');
  await f.character.ready; assert.equal(f.instances.length, 0); checkReleased(f);
});

test('real shared container instances survive another player being destroyed', async t => {
  const f = await fixture(t);
  f.success('duck'); f.success('dragon'); await f.character.ready;
  const other = new pc.Entity('OtherPlayer'); f.app.root.addChild(other);
  const character = createCharacter(f.app, other);
  f.success('duck'); f.success('dragon'); await character.ready;
  f.player.destroy();
  assert.equal(f.instances.length, 4);
  assert.ok(f.instances.slice(0, 2).every(record => record.destroys === 1));
  assert.ok(f.instances.slice(2).every(record => record.destroys === 0 && record.entity.parent === other));
  assert.ok(f.assets.duck.resource && f.assets.dragon.resource);
  character.setMounted(true); character.update(.1, { mounted: true, moving: true, grounded: false });
  assert.ok(other.findByName('Induck_GLB_Visual').findComponents('render').length > 0);
  assert.ok(other.findByName('Annyongi_GLB_Visual').findComponents('render').length > 0);
  other.destroy(); checkReleased(f);
});
test('real canary rollback after carrier failure keeps one canonical visual and no orphan clone', async t => {
  const f = await fixture(t, { canary: true }); f.fail('dragon'); f.success('duck'); await f.character.ready;
  assert.equal(f.character.assetCanary.authority, 'OPTIMIZED_CANARY');
  assert.equal(f.character.rollbackAssetCanary('NULL_RUNTIME').authority, 'CANONICAL');
  f.character.rollbackAssetCanary('REPEAT');
  assert.equal(f.player.children.filter(e => e.name === 'Induck_GLB_Visual').length, 1);
  f.character.update(.1, { mounted: false, moving: true, grounded: true });
  f.player.destroy(); checkReleased(f);
});
test('real canary disposal during asynchronous preparation releases both resulting clones', async t => {
  let release; const optimizedWait = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { canary: true, optimizedWait });
  f.success('duck'); f.fail('dragon'); await flush(); f.player.destroy();
  assert.equal(f.instances[0].destroys, 1, 'pending canonical released before preparation resumes'); release();
  await f.character.ready; assert.equal(f.instances.length, 2); checkReleased(f);
  f.character.rollbackAssetCanary('AFTER_DESTROY'); checkReleased(f);
});
