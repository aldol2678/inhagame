import test from "node:test";
import assert from "node:assert/strict";
import { createInventoryClient } from "../src/inventory/inventory-client.js";
import { createInventoryPanel } from "../src/inventory/inventory-panel.js";
import {
  INVENTORY_CATEGORY,
  INVENTORY_TAB,
  INVENTORY_TABS,
  inventoryCategoryForDefinition,
  inventoryTabForDefinition
} from "../src/inventory/inventory-category-registry.js";
import { getItemDefinition } from "../src/collection/item-catalog.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const CAP = "head.induck_cap";
const FISH = "material.fish_carp";
const FURNITURE = "furniture.induck_cushion";
const UNKNOWN = "head.future_hat";

const row = (itemId, extra = {}) => ({
  itemId,
  quantity: 1,
  acquiredAt: "2026-10-05T00:00:00+00:00",
  updatedAt: "2026-10-05T00:00:00+00:00",
  sourceType: "SYSTEM",
  sourceRef: "system:inventory-tabs-test",
  eventId: null,
  catalogStatus: "ACTIVE",
  ...extra
});

function walk(node, out = []) {
  out.push(node);
  for (const child of node.children ?? []) walk(child, out);
  return out;
}
const byClass = (root, name) => walk(root).filter((node) => (node.className ?? "").split(/\s+/).includes(name));
const text = (node) => walk(node).map((child) => child.textContent).join(" ");
const cards = (root) => byClass(root, "inventory-item");
const tabs = (root) => byClass(root, "inventory-tab");
const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };

function fakeClient() {
  const queue = [];
  return {
    respond(value) { queue.push(value); },
    rpc() { return Promise.resolve(queue.shift() ?? { data: { items: [] }, error: null }); }
  };
}

test("registry: existing catalog categories map by purpose, not acquisition source", () => {
  assert.equal(inventoryCategoryForDefinition(getItemDefinition(CAP)), INVENTORY_CATEGORY.EQUIPMENT);
  assert.equal(inventoryTabForDefinition(getItemDefinition(CAP)), INVENTORY_TAB.EQUIPMENT);

  const fish = getItemDefinition(FISH);
  assert.ok(fish.tags.includes("life"), "fish is earned by a life activity");
  assert.equal(inventoryCategoryForDefinition(fish), INVENTORY_CATEGORY.MATERIAL, "fish remains a material");
  assert.equal(inventoryTabForDefinition(fish), INVENTORY_TAB.MATERIAL);

  assert.equal(inventoryCategoryForDefinition(getItemDefinition(FURNITURE)), INVENTORY_CATEGORY.HOUSING);
  assert.equal(inventoryTabForDefinition(getItemDefinition(FURNITURE)), INVENTORY_TAB.OTHER);

  const eventFurniture = getItemDefinition("furniture.mcm_2026_poster");
  assert.ok(eventFurniture.tags.includes("event"));
  assert.equal(inventoryCategoryForDefinition(eventFurniture), INVENTORY_CATEGORY.HOUSING,
    "event acquisition does not turn furniture into an EVENT-purpose item");

  assert.equal(inventoryCategoryForDefinition(null), INVENTORY_CATEGORY.MISC);
  assert.equal(inventoryTabForDefinition(null), INVENTORY_TAB.OTHER);
  assert.equal(inventoryCategoryForDefinition({ inventoryCategory: "LIFE", category: "UNKNOWN" }), INVENTORY_CATEGORY.LIFE);
});

test("registry: V1 exposes exactly the compact six-tab surface", () => {
  assert.deepEqual(INVENTORY_TABS.map(({ id, label }) => [id, label]), [
    ["ALL", "전체"],
    ["EQUIPMENT", "장비"],
    ["CONSUMABLE", "소비"],
    ["MATERIAL", "재료"],
    ["LIFE", "생활"],
    ["OTHER", "기타"]
  ]);
});

test("panel: tabs filter locally while preserving server ownership order and unknown items", async () => {
  const doc = createFakeDocument();
  const panel = doc.createElement("section");
  panel.hidden = true;
  const client = fakeClient();
  const inventory = createInventoryClient({ getClient: () => client });
  const ui = createInventoryPanel({ panel, inventory, doc });
  const snapshot = { items: [row(CAP), row(FISH), row(FURNITURE), row(UNKNOWN)] };

  client.respond({ data: snapshot, error: null });
  client.respond({ data: snapshot, error: null });
  void inventory.setAccount(A);
  ui.setOpen(true);
  await flush();

  assert.equal(tabs(panel).length, 6);
  assert.deepEqual(tabs(panel).map((button) => button.textContent), ["전체", "장비", "소비", "재료", "생활", "기타"]);
  assert.deepEqual(cards(panel).map((card) => card.dataset.itemId), [CAP, FISH, FURNITURE, UNKNOWN]);
  assert.equal(panel.dataset.inventoryTab, "ALL");

  tabs(panel).find((button) => button.dataset.inventoryTab === "EQUIPMENT").click();
  assert.deepEqual(cards(panel).map((card) => card.dataset.itemId), [CAP]);
  assert.equal(panel.dataset.inventoryTab, "EQUIPMENT");

  tabs(panel).find((button) => button.dataset.inventoryTab === "MATERIAL").click();
  assert.deepEqual(cards(panel).map((card) => card.dataset.itemId), [FISH]);

  tabs(panel).find((button) => button.dataset.inventoryTab === "LIFE").click();
  assert.equal(cards(panel).length, 0);
  assert.match(text(panel), /이 분류에 보유한 아이템이 없어요/);

  tabs(panel).find((button) => button.dataset.inventoryTab === "OTHER").click();
  assert.deepEqual(cards(panel).map((card) => card.dataset.itemId), [FURNITURE, UNKNOWN],
    "unknown owned items remain visible under 기타");
});
