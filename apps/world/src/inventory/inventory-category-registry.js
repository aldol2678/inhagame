// INHA WORLD · Inventory display category registry V1.
// This layer never changes item ownership or the Collection catalog authority. It only maps the
// existing semantic catalog definition into the compact six-tab inventory UI.

export const INVENTORY_CATEGORY = Object.freeze({
  EQUIPMENT: "EQUIPMENT",
  CONSUMABLE: "CONSUMABLE",
  MATERIAL: "MATERIAL",
  LIFE: "LIFE",
  HOUSING: "HOUSING",
  PET_MOUNT: "PET_MOUNT",
  QUEST: "QUEST",
  EVENT: "EVENT",
  MISC: "MISC"
});

export const INVENTORY_TAB = Object.freeze({
  ALL: "ALL",
  EQUIPMENT: "EQUIPMENT",
  CONSUMABLE: "CONSUMABLE",
  MATERIAL: "MATERIAL",
  LIFE: "LIFE",
  OTHER: "OTHER"
});

export const INVENTORY_TABS = Object.freeze([
  Object.freeze({ id: INVENTORY_TAB.ALL, label: "전체", categories: Object.freeze(["*"]) }),
  Object.freeze({ id: INVENTORY_TAB.EQUIPMENT, label: "장비", categories: Object.freeze([INVENTORY_CATEGORY.EQUIPMENT]) }),
  Object.freeze({ id: INVENTORY_TAB.CONSUMABLE, label: "소비", categories: Object.freeze([INVENTORY_CATEGORY.CONSUMABLE]) }),
  Object.freeze({ id: INVENTORY_TAB.MATERIAL, label: "재료", categories: Object.freeze([INVENTORY_CATEGORY.MATERIAL]) }),
  Object.freeze({ id: INVENTORY_TAB.LIFE, label: "생활", categories: Object.freeze([INVENTORY_CATEGORY.LIFE]) }),
  Object.freeze({
    id: INVENTORY_TAB.OTHER,
    label: "기타",
    categories: Object.freeze([
      INVENTORY_CATEGORY.HOUSING,
      INVENTORY_CATEGORY.PET_MOUNT,
      INVENTORY_CATEGORY.QUEST,
      INVENTORY_CATEGORY.EVENT,
      INVENTORY_CATEGORY.MISC
    ])
  })
]);

const INVENTORY_CATEGORY_VALUES = new Set(Object.values(INVENTORY_CATEGORY));

const CATALOG_CATEGORY_TO_INVENTORY = Object.freeze({
  WEARABLE: INVENTORY_CATEGORY.EQUIPMENT,
  MATERIAL: INVENTORY_CATEGORY.MATERIAL,
  FURNITURE: INVENTORY_CATEGORY.HOUSING,
  MOUNT: INVENTORY_CATEGORY.PET_MOUNT,
  MOUNT_COSMETIC: INVENTORY_CATEGORY.PET_MOUNT,
  BADGE: INVENTORY_CATEGORY.MISC,
  EMOTE: INVENTORY_CATEGORY.MISC,
  MEMORABILIA: INVENTORY_CATEGORY.MISC,

  // Forward-compatible semantic categories. They are not part of the current C0 catalog yet.
  CONSUMABLE: INVENTORY_CATEGORY.CONSUMABLE,
  LIFE: INVENTORY_CATEGORY.LIFE,
  QUEST: INVENTORY_CATEGORY.QUEST,
  EVENT: INVENTORY_CATEGORY.EVENT
});

const CATEGORY_TO_TAB = Object.freeze({
  [INVENTORY_CATEGORY.EQUIPMENT]: INVENTORY_TAB.EQUIPMENT,
  [INVENTORY_CATEGORY.CONSUMABLE]: INVENTORY_TAB.CONSUMABLE,
  [INVENTORY_CATEGORY.MATERIAL]: INVENTORY_TAB.MATERIAL,
  [INVENTORY_CATEGORY.LIFE]: INVENTORY_TAB.LIFE,
  [INVENTORY_CATEGORY.HOUSING]: INVENTORY_TAB.OTHER,
  [INVENTORY_CATEGORY.PET_MOUNT]: INVENTORY_TAB.OTHER,
  [INVENTORY_CATEGORY.QUEST]: INVENTORY_TAB.OTHER,
  [INVENTORY_CATEGORY.EVENT]: INVENTORY_TAB.OTHER,
  [INVENTORY_CATEGORY.MISC]: INVENTORY_TAB.OTHER
});

const TAG_FALLBACKS = Object.freeze([
  ["consumable", INVENTORY_CATEGORY.CONSUMABLE],
  ["life_tool", INVENTORY_CATEGORY.LIFE],
  ["bait", INVENTORY_CATEGORY.LIFE],
  ["pet_item", INVENTORY_CATEGORY.PET_MOUNT],
  ["quest_item", INVENTORY_CATEGORY.QUEST],
  ["event_item", INVENTORY_CATEGORY.EVENT]
]);

/**
 * Convert one catalog definition into the inventory's broader purpose category.
 *
 * Priority:
 * 1. explicit future inventoryCategory override;
 * 2. current semantic catalog category;
 * 3. narrow purpose tags for future catalog shapes;
 * 4. MISC.
 *
 * Acquisition source is intentionally ignored. A fish caught by a life activity is MATERIAL, and
 * an event furniture reward is still HOUSING.
 */
export function inventoryCategoryForDefinition(definition) {
  const explicit = definition?.inventoryCategory;
  if (INVENTORY_CATEGORY_VALUES.has(explicit)) return explicit;

  const semantic = CATALOG_CATEGORY_TO_INVENTORY[definition?.category];
  if (semantic) return semantic;

  const tags = new Set(Array.isArray(definition?.tags)
    ? definition.tags.map((tag) => String(tag).toLowerCase())
    : []);
  for (const [tag, category] of TAG_FALLBACKS) {
    if (tags.has(tag)) return category;
  }
  return INVENTORY_CATEGORY.MISC;
}

export function inventoryTabForDefinition(definition) {
  return CATEGORY_TO_TAB[inventoryCategoryForDefinition(definition)] ?? INVENTORY_TAB.OTHER;
}

export function filterItemsForInventoryTab(items, tabId, describe) {
  const source = Array.isArray(items) ? items : [];
  if (tabId === INVENTORY_TAB.ALL) return source;
  if (!Object.values(INVENTORY_TAB).includes(tabId)) return source;
  return source.filter((item) => inventoryTabForDefinition(describe?.(item.itemId) ?? null) === tabId);
}
