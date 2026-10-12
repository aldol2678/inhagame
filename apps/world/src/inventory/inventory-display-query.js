// Read-only presentation: never mutate, merge or infer ownership from the catalog.
import { getItemDefinition } from "../collection/item-catalog.js";
import { filterItemsForInventoryTab, INVENTORY_TAB } from "./inventory-category-registry.js";

export const INVENTORY_SORTS = Object.freeze([
  Object.freeze({ id: "server", label: "기본 순서" }),
  Object.freeze({ id: "recent", label: "최근 획득순" }),
  Object.freeze({ id: "name", label: "이름순" })
]);
const normalize = (value) => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ko");
const nameOrder = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
const acquiredTime = (value) => {
  const time = typeof value === "string" && value.trim() ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : -Infinity;
};

export function queryInventoryItems(items, {
  tab = INVENTORY_TAB.ALL, query = "", sort = "server", describe = getItemDefinition
} = {}) {
  const needle = normalize(query);
  const rows = filterItemsForInventoryTab(items, tab, describe).map((item, index) => ({
    item, index, name: describe(item.itemId)?.displayName ?? item.itemId
  })).filter(({ item, name }) => !needle || normalize(name).includes(needle) || normalize(item.itemId).includes(needle));
  if (sort === "name") rows.sort((a, b) => nameOrder.compare(a.name, b.name) || a.index - b.index);
  if (sort === "recent") rows.sort((a, b) => {
    const at = acquiredTime(a.item.acquiredAt);
    const bt = acquiredTime(b.item.acquiredAt);
    return at === bt ? a.index - b.index : at > bt ? -1 : 1;
  });
  return rows.map(({ item }) => item);
}
