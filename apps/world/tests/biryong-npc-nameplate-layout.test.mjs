import test from "node:test";
import assert from "node:assert/strict";
import { layoutBiryongNpcNameplates } from "../src/biryong/biryong-npc-nameplate-layout.js";

const viewport = Object.freeze({ left: 0, top: 0, width: 390, height: 844 });
const plate = (id, overrides = {}) => Object.freeze({
  id, x: 195, y: 200, depth: 1, distance: 6, width: 130, height: 36, ...overrides
});

test("hosted landscape label rectangles yield to navigation and minimap HUD surfaces", () => {
  // Exact label DOM rectangles from PR210 head 56cb099, landscape NPC003 after
  // guidance receipt. HUD bounds were observed in its 844x390 screenshot; that
  // older receipt did not record them. The next hosted gate records exact HUD DOM.
  const nearest = plate("BR_NPC_003", { x: 410.46875, y: 186.015625, width: 121.3125, height: 34.734375, distance: .4144 });
  const blocked = plate("BR_NPC_002", { x: 710.671875, y: 111.859375, width: 106.484375, height: 34.734375, distance: 10.0915 });
  const exclusions = [{ left: 561, top: 52, right: 728, bottom: 94 }, { left: 736, top: 52, right: 832, bottom: 148 }];
  const placed = layoutBiryongNpcNameplates([blocked, nearest], { width: 844, height: 390 }, exclusions);
  assert.deepEqual(placed.map(item => item.id), [nearest.id]);
  assert.equal(placed[0].x, nearest.x);
  assert.equal(placed[0].y, nearest.y, "an unobstructed label stays attached to its head");
});

test("HUD-blocked nearby labels are suppressed without relocating them away from actors", () => {
  const hud = { left: 120, top: 145, right: 275, bottom: 210 };
  assert.deepEqual(layoutBiryongNpcNameplates([plate("near", { distance: 1 })], viewport, [hud]), []);
  assert.deepEqual(layoutBiryongNpcNameplates([plate("near", { distance: 1 }), plate("far", { y: 350, distance: 15 })], viewport, [hud])
    .map(item => item.id), ["far"], "only labels in available space compete by distance");
  assert.equal(layoutBiryongNpcNameplates([plate("clear")], viewport,
    [{ left: NaN, top: 0, right: 390, bottom: 844 }, { left: 0, top: 0, right: 0, bottom: 0 }]).length, 1);
});

test("overlapping Biryong nameplates keep the closest NPC regardless of roster order", () => {
  const far = plate("BR_NPC_001", { distance: 18 });
  const near = plate("BR_NPC_008", { distance: 1.5 });
  assert.deepEqual(layoutBiryongNpcNameplates([far, near], viewport).map(item => item.id), [near.id]);
  assert.deepEqual(layoutBiryongNpcNameplates([near, far], viewport).map(item => item.id), [near.id]);
});

test("equal-distance overlaps use stable NPC IDs instead of input order", () => {
  const a = plate("BR_NPC_001"), b = plate("BR_NPC_002");
  assert.deepEqual(layoutBiryongNpcNameplates([b, a], viewport), layoutBiryongNpcNameplates([a, b], viewport));
  assert.deepEqual(layoutBiryongNpcNameplates([b, a], viewport).map(item => item.id), [a.id]);
});

test("separated nameplates remain visible without mutating input projections", () => {
  const candidates = Object.freeze([plate("far", { distance: 20, y: 400 }), plate("near", { distance: 2 })]);
  const result = layoutBiryongNpcNameplates(candidates, viewport);
  assert.deepEqual(result.map(item => item.id), ["near", "far"]);
  assert.deepEqual(result.map(({ x, y }) => ({ x, y })), [{ x: 195, y: 200 }, { x: 195, y: 400 }]);
  assert.equal(candidates[0].y, 400);
});

test("full nameplate rectangles fit inside every edge of an offset canvas", () => {
  const offset = { left: 27, top: 43, width: 390, height: 250 };
  for (const [x, y] of [[27, 43], [417, 43], [27, 293], [417, 293]]) {
    const [result] = layoutBiryongNpcNameplates([plate("edge", { x, y })], offset);
    assert.ok(result, "an on-screen anchor at an edge remains readable");
    assert.ok(result.x - result.width / 2 >= offset.left + 8);
    assert.ok(result.x + result.width / 2 <= offset.left + offset.width - 8);
    assert.ok(result.y - result.height >= offset.top + 8);
    assert.ok(result.y <= offset.top + offset.height - 8);
  }
});

test("collision checks use clamped bounds and keep a readable gap", () => {
  const near = plate("near", { x: 0, distance: 1 });
  const far = plate("far", { x: 195, distance: 10 });
  assert.deepEqual(layoutBiryongNpcNameplates([far, near], viewport).map(item => item.id), ["near"]);
  const separated = plate("separated", { x: 208, distance: 10 });
  assert.deepEqual(layoutBiryongNpcNameplates([near, separated], viewport).map(item => item.id), ["near", "separated"]);
});

test("off-screen, behind-camera, distant, invalid, and oversized nameplates are hidden", () => {
  const candidates = [
    plate("behind", { depth: 0 }), plate("negative-depth", { depth: -1 }),
    plate("left", { x: -1 }), plate("right", { x: 391 }),
    plate("above", { y: -1 }), plate("below", { y: 845 }),
    plate("distant", { distance: 22.01 }), plate("negative-distance", { distance: -1 }),
    plate("nan", { x: NaN }), plate("infinite", { depth: Infinity }),
    plate("unmeasured", { width: 0 }), plate("too-wide", { width: 375 }),
    plate("too-tall", { height: 829 }), plate("boundary", { distance: 22 })
  ];
  assert.deepEqual(layoutBiryongNpcNameplates(candidates, viewport).map(item => item.id), ["boundary"]);
});

test("a zero-size, too-small, or non-finite viewport never places nameplates", () => {
  for (const dimensions of [{ width: 0, height: 800 }, { width: 12, height: 800 }, { width: 390, height: NaN }]) {
    assert.deepEqual(layoutBiryongNpcNameplates([plate("npc")], dimensions), []);
  }
});

test("crowded desktop, portrait, and landscape layouts have no overlaps or clipping", () => {
  for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
    const candidates = Array.from({ length: 8 }, (_, index) => plate(`BR_NPC_${index}`, {
      x: (index % 4) * width / 3, y: index < 4 ? 0 : height,
      distance: index + 1, width: 130 + index * 4
    }));
    const result = layoutBiryongNpcNameplates(candidates, { width, height });
    assert.ok(result.length > 0);
    for (const [index, a] of result.entries()) {
      assert.ok(a.x - a.width / 2 >= 8 && a.x + a.width / 2 <= width - 8);
      assert.ok(a.y - a.height >= 8 && a.y <= height - 8);
      for (const b of result.slice(index + 1)) {
        assert.ok(a.x + a.width / 2 + 4 <= b.x - b.width / 2 ||
          b.x + b.width / 2 + 4 <= a.x - a.width / 2 ||
          a.y + 4 <= b.y - b.height || b.y + 4 <= a.y - a.height);
      }
    }
  }
});
