import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLegacyPort } from '../src/bootstrap.mjs';
import { parseWorld, serializeWorld } from '../../../apps/world/src/editor/world-serialization.js';

// Real editor classes only. No writes to the committed world or any external store.
export async function runtimeFixture() {
  const port = await createLegacyPort(new URL('../../../apps/world/src/editor', import.meta.url).pathname);
  let sequence = 0;
  async function command(operation, payload, targetId) {
    const result = await port.dispatch({ commandId: `runtime.${++sequence}`, expectedRevision: port.read().revisionToken,
      operation, payload, ...(targetId ? { targetId } : {}) });
    assert.equal(result.status, 'applied', JSON.stringify(result));
  }
  const transform = { position: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [4, 2, 4] };
  const structure = { 'world.structure': { shape: 'box', sizeMeters: [1, 1, 1], color: '#ffaa22' } };
  await command('node.create', { id: 'visible', name: 'P12 visible', kind: 'prop', transform, components: structure });
  await command('node.create', { id: 'z-parent', name: 'P12 parent', kind: 'prop',
    transform: { position: [4, 2, 6], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], scale: [2, 3, 4] },
    components: { 'user.keep': { nested: [42, { text: 'preserve' }] } }, metadata: { provenance: 'test-only' } });
  // Serializes before its parent: loading must not depend on entity order.
  await command('node.create', { id: 'a-child', name: 'P12 child', kind: 'prop', parentId: 'z-parent',
    transform: { ...transform, position: [1, 2, 3], scale: [.5, .75, 1.25] }, components: structure });
  await command('node.create', { id: 'disabled', name: 'P12 disabled', kind: 'prop', enabled: false, transform, components: structure });
  await command('node.create', { id: 'disabled-child', name: 'P12 disabled child', kind: 'prop', parentId: 'disabled', transform, components: structure });
  const original = port.exportWorld();
  await command('node.transform', { transform: { ...transform, position: [2, 3, 4] } }, 'visible');
  const changed = port.exportWorld();
  assert.equal((await port.undo(port.read().revisionToken)).status, 'applied');
  assert.equal(port.exportWorld(), original);
  assert.equal((await port.redo(port.read().revisionToken)).status, 'applied');
  assert.equal(port.exportWorld(), changed);
  await port.undo(port.read().revisionToken);
  assert.equal(serializeWorld(parseWorld(original)), original);
  assert.deepEqual(parseWorld(original).entities.find(e => e.id === 'z-parent').components['user.keep'],
    { nested: [42, { text: 'preserve' }] });

  const committedPath = new URL('../../../apps/world/data/editor/main-gate.world.json', import.meta.url);
  const committed = await readFile(committedPath, 'utf8');
  const existing = await createLegacyPort(new URL('../../../apps/world/src/editor', import.meta.url).pathname, committedPath.pathname);
  const before = existing.exportWorld();
  const entity = existing.read().nodes[0];
  assert.equal((await existing.dispatch({ commandId: 'existing.rename', operation: 'node.rename', targetId: entity.id,
    expectedRevision: existing.read().revisionToken, payload: { name: 'temporary QA name' } })).status, 'applied');
  await existing.undo(existing.read().revisionToken);
  assert.equal(existing.exportWorld(), before);
  assert.equal(await readFile(committedPath, 'utf8'), committed);
  return { text: original, world: parseWorld(original) };
}
