import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Only GPU/DOM drawing is stubbed. Scheduling, NPC positions, projection use,
// activity copy, filtering, and layout run through the production runtime.
const pcStub = `export class Vec3 { set(x, y, z) { Object.assign(this, { x, y, z }); return this; } }`;
const avatarStub = `export function createHumanAvatar(root, definition) {
  const avatar = { enabled: true, position: {}, setLocalPosition(x, y, z) { this.position = { x, y, z }; },
    setLocalEulerAngles() {}, getPosition() { return this.position; }, destroy() { this.destroyed = true; } };
  root.avatars.set(definition.id, avatar);
  return { avatar, marker: { enabled: true }, arms: [], legs: [] };
}`;
registerHooks({ resolve(specifier, context, next) {
  const stub = specifier === "playcanvas" ? pcStub : specifier.endsWith("/dev-human-avatar.mjs") ? avatarStub : null;
  return stub ? { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true } : next(specifier, context);
} });
const { createBiryongVillageNpcRuntime } = await import("../src/biryong/biryong-village-npc-runtime.js");

function fixture(t) {
  const labels = [], hud = [];
  const reads = { hud: 0, projection: 0 }, listeners = new Map();
  const oldDocument = globalThis.document, oldWindow = globalThis.window;
  const oldComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = element => ({ display: 'block', visibility: 'visible', opacity: '1', ...element.computed });
  globalThis.window = { innerWidth: 390, innerHeight: 844 };
  globalThis.document = {
    body: { appendChild(element) { labels.push(element); } },
    querySelectorAll: selector => {
      reads.hud++;
      return hud.filter(element => selector.split(',').some(part => part.trim() === `#${element.id}`));
    },
    createElement() {
      const nodes = { strong: { textContent: "" }, small: { textContent: "" } };
      return { hidden: true, style: {}, nodes,
        querySelector(name) { return nodes[name]; },
        getBoundingClientRect() {
          const width = this.hidden ? 0 : Math.min(context.labelWidth ?? 150, parseFloat(this.style.maxWidth) || Infinity);
          const height = this.hidden ? 0 : context.labelHeight ?? 36;
          const x = parseFloat(this.style.left) - width / 2, y = parseFloat(this.style.top) - height;
          return { x, y, left: x, top: y, width, height, right: x + width, bottom: y + height };
        },
        remove() { this.removed = true; }
      };
    }
  };
  const context = { active: true, projection: () => ({ x: 195, y: 200, z: 1 }),
    rect: { left: 0, top: 0, width: 390, height: 844 }, playerPosition: { x: 8, z: 10 } };
  const app = { graphicsDevice: { canvas: { getBoundingClientRect: () => context.rect } },
    on(event, callback) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(callback); },
    off(event, callback) { listeners.get(event)?.delete(callback); } };
  const tick = (dt = 0) => { for (const callback of listeners.get('update') ?? []) callback(dt); };
  const draw = () => { for (const callback of listeners.get('postrender') ?? []) callback(); };
  const root = { avatars: new Map() };
  const runtime = createBiryongVillageNpcRuntime({ app, root,
    player: { getLocalPosition: () => context.playerPosition },
    camera: { camera: { worldToScreen: point => { reads.projection++; return context.projection(point); } } },
    getActive: () => context.active,
    clock: { now: () => NaN, sync: async () => false, refreshIfDue() {}, status: () => ({}), dispose() {} }
  });
  t.after(() => { runtime.destroy(); globalThis.document = oldDocument; globalThis.window = oldWindow;
    globalThis.getComputedStyle = oldComputedStyle; });
  return { labels, context, runtime, root, hud, reads, listeners, tick, draw, update: () => { tick(); draw(); } };
}

test("inactive, out-of-range, and behind-camera NPC frames never query the HUD", t => {
  const f = fixture(t);
  f.context.active = false; f.update();
  assert.equal(f.reads.hud, 0);
  f.context.active = true; f.context.playerPosition = { x: 1000, z: 1000 }; f.update();
  assert.equal(f.reads.hud, 0);
  f.context.playerPosition = { x: 8, z: 10 }; f.context.projection = () => ({ x: 195, y: 200, z: -1 }); f.update();
  assert.equal(f.reads.hud, 0);
  assert.ok(f.labels.every(label => label.hidden));
});

test("postrender uses the current camera and HUD instead of the earlier update frame", t => {
  const f = fixture(t);
  f.tick();
  assert.equal(f.reads.projection, 0, "NPC update does not project stale camera matrices");
  assert.ok(f.labels.every(label => label.hidden));
  const surface = { id: 'quest-hud', hidden: false, computed: {}, getClientRects: () => [1],
    getBoundingClientRect: () => ({ left: 110, top: 150, right: 280, bottom: 220 }) };
  f.hud.push(surface); f.draw();
  assert.ok(f.labels.every(label => label.hidden), "HUD that appeared after NPC update already owns this rendered frame");
  f.tick(); f.context.projection = () => ({ x: 300, y: 350, z: 1 }); f.draw();
  assert.equal(f.labels[1].hidden, false);
  assert.equal(f.labels[1].style.left, '300px');
  assert.equal(f.labels[1].style.top, '350px');
  f.context.active = false; f.tick();
  assert.ok(f.labels.every(label => label.hidden), "leaving Biryong hides labels immediately without needing a render");
});

test("postrender never ticks or reanimates NPCs and destroy removes both event listeners", t => {
  const f = fixture(t);
  f.runtime.setPeriodForTest(1); f.tick(.05);
  const snapshot = f.runtime.status().npcs, positions = [...f.root.avatars.values()].map(avatar => ({ ...avatar.position }));
  assert.equal(f.listeners.get('postrender')?.size, 1);
  f.draw(); f.draw(); f.draw();
  assert.deepEqual(f.runtime.status().npcs, snapshot);
  assert.deepEqual([...f.root.avatars.values()].map(avatar => avatar.position), positions);
  f.runtime.destroy();
  assert.equal(f.listeners.get('update').size, 0);
  assert.equal(f.listeners.get('postrender').size, 0);
  const reads = { ...f.reads }; f.tick(.05); f.draw();
  assert.deepEqual(f.reads, reads);
});

test("runtime excludes visible HUD bounds and restores labels when those surfaces disappear", t => {
  const f = fixture(t);
  const surface = { id: 'quest-hud', hidden: false, computed: {}, getClientRects: () => [1],
    getBoundingClientRect: () => ({ left: 110, top: 150, right: 280, bottom: 220 }) };
  f.hud.push(surface);
  f.update();
  assert.ok(f.labels.every(label => label.hidden));
  assert.equal(f.runtime.nearestNpc().id, "BR_NPC_002");
  for (const invisible of [{ hidden: true }, { hidden: false, computed: { display: 'none' } },
    { hidden: false, computed: { visibility: 'hidden' } }, { hidden: false, computed: { opacity: '0' } }]) {
    Object.assign(surface, invisible); f.update();
    assert.equal(f.labels[1].hidden, false);
  }
  surface.computed = {}; surface.getClientRects = () => []; f.update();
  assert.equal(f.labels[1].hidden, false, "a hidden parent leaves no occupied HUD rectangle");
});

test("landscape first-tour HUD suppresses the intersecting nameplate and restores it when hidden", t => {
  const f = fixture(t);
  f.context.rect = { left: 0, top: 0, width: 844, height: 390 };
  f.context.playerPosition = { x: -8, z: 10 };
  // Actual label projection and dimensions from the 11e79dc hosted regression.
  f.context.projection = () => ({ x: 238.328125, y: 95, z: 13.67633798517799 });
  f.context.labelWidth = 109.90625; f.context.labelHeight = 34.734375;
  const tour = { id: 'tour', hidden: true, computed: {}, getClientRects: () => [1],
    getBoundingClientRect: () => ({ left: 12, top: 52, right: 212, bottom: 94 }) };
  f.hud.push(tour); f.update();
  assert.equal(f.labels[0].hidden, false, 'the nearby NPC has a readable nameplate without the tour card');
  const before = f.runtime.status().npcs;
  tour.hidden = false; f.draw();
  assert.ok(f.labels.every(label => label.hidden), 'the visible first-tour card owns its occupied screen space');
  assert.deepEqual(f.runtime.status().npcs, before, 'only nameplate visibility changes');
  tour.hidden = true; f.draw();
  assert.equal(f.labels[0].hidden, false, 'hiding the tour card restores the label without another NPC update');
});

test("actual runtime gives a crowded nameplate to the nearest NPC and preserves detail", t => {
  const f = fixture(t);
  f.update();
  assert.deepEqual(f.labels.filter(label => !label.hidden).map(label => label.nodes.strong.textContent), ["한여울"]);
  assert.equal(f.labels[1].nodes.small.textContent, "비룡역 정비사 · 이동 중");
  assert.equal(f.runtime.nearestNpc().id, "BR_NPC_002", "label layout does not alter dialogue targeting");
  f.context.playerPosition = { x: -8, z: 10 };
  f.update();
  assert.deepEqual(f.labels.filter(label => !label.hidden).map(label => label.nodes.strong.textContent), ["강소라"]);
});

test("actual runtime measures complete labels before clamping them into a resized canvas", t => {
  const f = fixture(t);
  f.context.projection = () => ({ x: 0, y: 0, z: 1 });
  for (const [width, height, left, top] of [[390, 844, 0, 0], [120, 240, 20, 30]]) {
    f.context.rect = { left, top, width, height };
    f.update();
    const visible = f.labels.filter(label => !label.hidden);
    assert.equal(visible.length, 1);
    const box = visible[0].getBoundingClientRect();
    assert.ok(box.left >= left + 8 && box.top >= top + 8);
    assert.ok(box.right <= left + width - 8 && box.bottom <= top + height - 8);
    assert.equal(visible[0].nodes.strong.textContent, "한여울");
  }
});

test("nameplate filtering never hides actors or changes their snapshot positions", t => {
  const f = fixture(t);
  f.update();
  const before = f.runtime.status().npcs;
  f.context.projection = () => ({ x: 195, y: 200, z: -1 });
  f.update();
  assert.ok(f.labels.every(label => label.hidden));
  assert.deepEqual(f.runtime.status().npcs, before);
  assert.equal(f.root.avatars.get("BR_NPC_001").enabled, true);
  assert.equal(f.root.avatars.get("BR_NPC_002").enabled, true);
  f.context.active = false;
  f.update();
  assert.ok(f.labels.every(label => label.hidden));
  assert.ok([...f.root.avatars.values()].every(avatar => !avatar.enabled));
  f.runtime.destroy();
  assert.ok(f.labels.every(label => label.removed));
});
