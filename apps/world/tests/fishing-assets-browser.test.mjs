import test from 'node:test';
import assert from 'node:assert/strict';
import { createFishingPresentation } from '../src/activity/fishing-visuals.js';
import { FISHING_SPOTS } from '../src/activity/fishing-spots.js';
const fixture = await import('./browser/fishing-assets-fixture.mjs').catch(() => null);
test('hosted fishing fixture provides deterministic client and framebuffer evidence helpers', () => {
  assert.ok(fixture, 'missing fishing-assets-fixture.mjs');
});
if (fixture) {
  test('real fishing client waits for synthetic server success and settlement before showing a catch', async () => {
    const f = fixture.createFishingFixture();
    const frames = [];
    const p = createFishingPresentation({ fishing: f.client, createView: () => ({ render: frame => frames.push(frame), destroy() {} }) });
    await f.reset(FISHING_SPOTS[0].sourceRef); p.setOpen(true);
    assert.equal((await f.start()).outcome, 'STARTED');
    assert.equal(frames.at(-1).castProgress, 0);
    f.advance(1400); p.update(); assert.equal(frames.at(-1).phase, 'WAITING');
    f.advance(3000); p.update(); assert.equal(frames.at(-1).phase, 'BITE');
    const pending = f.hook();
    await f.waitForPendingHook();
    assert.equal(f.client.busy, 'hook'); assert.equal(frames.at(-1).showFish, false);
    f.respondHook(); await pending;
    assert.equal(f.client.attempt.status, 'SUCCEEDED'); assert.equal(frames.at(-1).showFish, true);
    f.advance(3700); p.update(); assert.equal(frames.at(-1).reelProgress, 1);
    const before = frames.length;
    p.setOpen(false); p.setOpen(true); await f.client.refresh(); p.update();
    assert.equal(frames.length, before, 'closed/replayed result cannot recreate catch');
    assert.deepEqual(f.requests.map(r => r.op), ['read', 'start', 'input', 'settle', 'read', 'read']);
    assert.ok(f.requests.every(r => r.transport === 'in-memory synthetic server'));
    p.destroy();
  });
  test('suppression and active replay preserve server time without replaying splash or cast at either shore', async () => {
    for (const spot of FISHING_SPOTS) {
      const f = fixture.createFishingFixture(), frames = [];
      const p = createFishingPresentation({ fishing: f.client, createView: () => ({ render: x => frames.push(x), destroy() {} }) });
      await f.reset(spot.sourceRef); p.setOpen(true); await f.start(); f.advance(1400); p.update();
      p.setOpen(false); p.setOpen(true); assert.equal(frames.at(-1).castProgress, 1);
      assert.equal(frames.at(-1).splashFrame, null);
      p.setSuppressed(true); f.advance(3125); p.setSuppressed(false);
      assert.equal(frames.at(-1).phase, 'BITE'); assert.equal(frames.at(-1).splashFrame, null);
      assert.equal(frames.at(-1).spot.sourceRef, spot.sourceRef); p.destroy();
    }
  });
  test('pixel delta counts RGB changes inside top-left ROI and rejects an unchanged framebuffer', () => {
    const before = new Uint8Array(4 * 4 * 4), after = before.slice();
    // readPixels is bottom-up: buffer pixel (1,2) belongs to top-left ROI (1,1).
    after[(2 * 4 + 1) * 4] = 200;
    const roi = { minX: 1, maxX: 1, minY: 1, maxY: 1 };
    assert.equal(fixture.pixelEvidence(after, 4, 4, before, roi).changedInRoi, 1);
    assert.equal(fixture.pixelEvidence(before, 4, 4, before, roi).changed, 0);
    assert.throws(() => fixture.requirePixelContribution({ changed: 0, changedInRoi: 0 }, 1), /visible pixel contribution/);
    assert.doesNotThrow(() => fixture.requirePixelContribution({ changed: 1, changedInRoi: 1 }, 1));
  });
  test('pixel evidence rejects mismatched buffers, and synthetic time cannot move backwards', () => {
    assert.throws(() => fixture.pixelEvidence(new Uint8Array(3), 1, 1), /framebuffer/);
    const f = fixture.createFishingFixture(); f.advance(1000);
    assert.throws(() => f.advance(999), /monotonic/);
  });
}

// These protect the diagnostic gate itself; they make no browser/GPU acceptance claim.
test('diagnostic captions reserve layout space instead of changing canvas height between frames', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('./browser/fishing-assets-harness.html', import.meta.url), 'utf8');
  assert.match(html, /grid-template-rows:164px minmax\(0,1fr\)/);
  assert.match(html, /production avatar/);
  assert.match(html, /Not full-campus acceptance/);
});
test('orthographic contribution bounds use view-space depth rather than clip-space screen z', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./browser/fishing-assets-harness.mjs', import.meta.url), 'utf8');
  assert.match(source, /camera\.getWorldTransform\(\)\.clone\(\)\.invert\(\)/);
  assert.match(source, /-view\.transformPoint\(p, new pc\.Vec3\(\)\)\.z/);
  assert.doesNotMatch(source, /minDepth: Math\.min\(\.\.\.screen\.map\(p => p\.z\)\)/);
});
