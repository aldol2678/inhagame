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
  const labels = [];
  const oldDocument = globalThis.document, oldWindow = globalThis.window;
  globalThis.window = { innerWidth: 390, innerHeight: 844 };
  globalThis.document = {
    body: { appendChild(element) { labels.push(element); } },
    createElement() {
      const nodes = { strong: { textContent: "" }, small: { textContent: "" } };
      return { hidden: true, style: {}, nodes,
        querySelector(name) { return nodes[name]; },
        getBoundingClientRect() {
          const width = this.hidden ? 0 : Math.min(150, parseFloat(this.style.maxWidth) || Infinity);
          const height = this.hidden ? 0 : 36;
          const x = parseFloat(this.style.left) - width / 2, y = parseFloat(this.style.top) - height;
          return { x, y, left: x, top: y, width, height, right: x + width, bottom: y + height };
        },
        remove() { this.removed = true; }
      };
    }
  };
  let update;
  const context = { active: true, projection: () => ({ x: 195, y: 200, z: 1 }),
    rect: { left: 0, top: 0, width: 390, height: 844 }, playerPosition: { x: 8, z: 10 } };
  const app = { graphicsDevice: { canvas: { getBoundingClientRect: () => context.rect } },
    on(event, callback) { update = callback; }, off() { update = null; } };
  const root = { avatars: new Map() };
  const runtime = createBiryongVillageNpcRuntime({ app, root,
    player: { getLocalPosition: () => context.playerPosition },
    camera: { camera: { worldToScreen: point => context.projection(point) } },
    getActive: () => context.active,
    clock: { now: () => NaN, sync: async () => false, refreshIfDue() {}, status: () => ({}), dispose() {} }
  });
  t.after(() => { runtime.destroy(); globalThis.document = oldDocument; globalThis.window = oldWindow; });
  return { labels, context, runtime, root, update: () => update(0) };
}

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
