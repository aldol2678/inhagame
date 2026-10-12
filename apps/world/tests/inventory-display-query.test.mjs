import test from "node:test";
import assert from "node:assert/strict";
import { queryInventoryItems } from "../src/inventory/inventory-display-query.js";
const definitions = {
  "head.a": { displayName: "인덕 모자", category: "WEARABLE" },
  "head.b": { displayName: "가방 10", category: "WEARABLE" },
  "head.c": { displayName: "가방 2", category: "WEARABLE" },
  "material.a": { displayName: "인덕 재료", category: "MATERIAL" }
};
const describe = (id) => definitions[id];
const row = (itemId, acquiredAt) => Object.freeze({ itemId, acquiredAt, quantity: 7, catalogStatus: "DISABLED" });
const items = Object.freeze([row("head.a", null), row("head.b", "2026-10-01"), row("head.c", "2026-10-02"), row("material.a", "2026-10-02"), row("unknown.future", "bad")]);
const ids = (options) => queryInventoryItems(items, { describe, ...options }).map((item) => item.itemId);
test("default order and ownership references are preserved without mutating frozen server rows", () => {
  assert.deepEqual(ids(), items.map((i) => i.itemId));
  assert.notEqual(queryInventoryItems(items), items);
  assert.equal(queryInventoryItems(items)[0], items[0]);
  assert.equal(queryInventoryItems(items)[0].quantity, 7);
  assert.equal(queryInventoryItems(items)[0].catalogStatus, "DISABLED");
});
test("Korean normalized name and case-insensitive item ID search compose with category", () => {
  assert.deepEqual(ids({ query: "  인덕  ", tab: "EQUIPMENT" }), ["head.a"]);
  assert.deepEqual(ids({ query: "인덕" }), ["head.a", "material.a"]);
  assert.deepEqual(ids({ query: "UNKNOWN.FUTURE" }), ["unknown.future"]);
  assert.deepEqual(ids({ query: "<script>" }), []);
});
test("recent order keeps ties stable and null/invalid times last; updatedAt does not change acquisition order", () => {
  assert.deepEqual(ids({ sort: "recent" }), ["head.c", "material.a", "head.b", "head.a", "unknown.future"]);
});
test("name order is Korean-aware, numeric and stable; unknown items remain searchable", () => {
  assert.deepEqual(ids({ sort: "name", tab: "EQUIPMENT" }), ["head.c", "head.b", "head.a"]);
  const same = [row("head.z"), row("head.x")];
  assert.deepEqual(queryInventoryItems(same, { sort: "name", describe: () => ({ displayName: "같음" }) }), same);
  assert.deepEqual(ids({ sort: "unsupported" }), ids());
});
