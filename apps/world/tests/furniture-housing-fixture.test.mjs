import test from "node:test";
import assert from "node:assert/strict";
import { ROOM_FURNITURE, firstFurniturePosition, validateFurniture } from "../src/rooms/furniture-layout.js";
import { housingFurnitureOrder } from "./browser/housing-fixture.mjs";

test("housing smoke native-add order fits all seventeen candidate items without changing the catalog or inventory", () => {
  const originalIds = ROOM_FURNITURE.map(item => item.itemId);
  const ordered = housingFurnitureOrder(ROOM_FURNITURE);
  assert.deepEqual(ordered.slice(0, 2).map(item => item.itemId), ["furniture.dorm_monitor", "furniture.study_books_set"]);
  assert.deepEqual(ordered.map(item => item.itemId).sort(), [...originalIds].sort());
  const owned = ROOM_FURNITURE.map(item => ({ itemId: item.itemId, quantity: 1 }));
  const inventoryBefore = structuredClone(owned), objects = [];
  for (const [index, item] of ordered.entries()) {
    // Match createFurnitureEditor's first-valid-surface search and unique instance identity.
    let position = null;
    for (const surface of item.surfaces) {
      position = firstFurniturePosition(item.itemId, surface, objects, owned);
      if (position) break;
    }
    assert.ok(position, `native add must find space for ${item.itemId}`);
    objects.push({ ...position, id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}` });
    assert.equal(validateFurniture(objects, owned), null, item.itemId);
  }
  assert.equal(objects.length, ROOM_FURNITURE.length);
  assert.deepEqual(new Set(objects.map(item => item.itemId)), new Set(originalIds));
  assert.deepEqual(ROOM_FURNITURE.map(item => item.itemId), originalIds);
  assert.deepEqual(owned, inventoryBefore);
});
