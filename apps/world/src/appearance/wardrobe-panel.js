// INHA WORLD · Wardrobe panel P0 (presentation; no RPC).
// Three sources, three jobs:
//   - loadout snapshot (get_my_world_appearance_loadout_v1) = what is worn, per slot (the only source
//     of "장착 중"; an empty slot is never inferred to hold a starter item)
//   - inventory snapshot (get_my_world_inventory_v1) = what the account owns (the only source of
//     "보유"; the local catalog never adds or removes an owned item)
//   - local item catalog = names, descriptions, rarity and the equip slot of an owned WEARABLE
// Equip / unequip are forwarded to the loadout client; the server decides. This panel only disables
// buttons as a hint (DISABLED / HIDDEN / UNKNOWN_ITEM) and never guesses a slot the catalog does not give.
// Wearing something here does not change the 3D avatar: projection is a later step.

import { getItemDefinition } from "../collection/item-catalog.js";
import { INVENTORY_STATE } from "../inventory/inventory-client.js";
import { APPEARANCE_SLOTS, LOADOUT_STATE } from "./loadout-client.js";

export const SLOT_TEXT = Object.freeze({
  BODY: "몸", FACE: "얼굴", HAIR: "헤어", HEAD: "머리", TOP: "상의", BOTTOM: "하의", SHOES: "신발", BACK: "등",
  ACCESSORY: "액세서리"
});
const RARITY_TEXT = Object.freeze({ COMMON: "일반", UNCOMMON: "고급", RARE: "희귀", SPECIAL: "특별" });
const STATUS_TEXT = Object.freeze({
  LOCKED: "잠김", COMING_SOON: "준비 중", DISABLED: "사용 중지", HIDDEN: "숨김", UNKNOWN_ITEM: "정보 없음"
});
// UX hint only: the equip RPC refuses these anyway. Taking an item off is always offered.
const EQUIP_BLOCKED = new Set(["DISABLED", "HIDDEN", "UNKNOWN_ITEM"]);
export const EMPTY_SLOT_TEXT = "장착 없음";

const statusText = (status) => (status === "ACTIVE" ? null : STATUS_TEXT[status] ?? "상태 확인 필요");
const slotLabel = (slot) => `${SLOT_TEXT[slot] ?? slot} · ${slot}`;

/** Stable server code → short text. Unknown codes never leak internal messages. */
export function wardrobeMessage(code) {
  if (code === "ITEM_NOT_OWNED") return "보유한 아이템만 장착할 수 있어요";
  if (code === "ITEM_NOT_EQUIPPABLE") return "착용할 수 없는 아이템이에요";
  if (code === "SLOT_MISMATCH") return "이 슬롯에는 장착할 수 없어요";
  if (code === "ITEM_UNAVAILABLE") return "현재 장착할 수 없는 아이템이에요";
  if (code === "UNKNOWN_ITEM") return "아이템 정보를 확인할 수 없어요";
  if (code === "PERMANENT_ACCOUNT_REQUIRED" || code === "SIGNED_OUT") return "로그인한 계정만 옷장을 이용할 수 있어요";
  if (code === "ACCOUNT_UNAVAILABLE") return "현재 이 계정으로는 옷장을 이용할 수 없어요";
  if (code === "IDEMPOTENCY_CONFLICT") return "요청이 겹쳤어요. 잠시 후 다시 시도해 주세요.";
  return "변경하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

/** Current slot view: the server loadout entry, named from the catalog, itemId as the fallback. */
export function slotView(slot, entry, { describe = getItemDefinition } = {}) {
  if (!entry) return Object.freeze({ slot, label: slotLabel(slot), empty: true, name: EMPTY_SLOT_TEXT, statusText: null, itemId: null });
  const definition = describe(entry.itemId);
  return Object.freeze({
    slot, label: slotLabel(slot), empty: false, itemId: entry.itemId,
    name: definition?.displayName ?? entry.itemId,
    statusText: definition ? statusText(entry.catalogStatus) : STATUS_TEXT.UNKNOWN_ITEM
  });
}

/**
 * Owned items → { wearables, unknown }. Only rows the server says are owned are considered. A row the
 * local catalog knows as WEARABLE (with its equipSlot) becomes a candidate; a row the catalog does not
 * know is kept in `unknown` (owned, but its slot cannot be known); other categories are not wardrobe items.
 */
export function wardrobeCandidates(items = [], slots = {}, { describe = getItemDefinition } = {}) {
  const wearables = [];
  const unknown = [];
  for (const item of items) {
    const definition = describe(item.itemId);
    if (!definition) { unknown.push(Object.freeze({ itemId: item.itemId, name: item.itemId })); continue; }
    if (definition.category !== "WEARABLE" || !APPEARANCE_SLOTS.includes(definition.equipSlot)) continue;
    const slot = definition.equipSlot;
    const equipped = slots[slot]?.itemId === item.itemId;
    wearables.push(Object.freeze({
      itemId: item.itemId,
      slot,
      name: definition.displayName,
      description: definition.description,
      metaText: `${SLOT_TEXT[slot] ?? slot} · ${RARITY_TEXT[definition.rarity] ?? definition.rarity}`,
      catalogStatus: item.catalogStatus,
      statusText: statusText(item.catalogStatus),
      equipped,
      canEquip: !equipped && !EQUIP_BLOCKED.has(item.catalogStatus)
    }));
  }
  return Object.freeze({ wearables: Object.freeze(wearables), unknown: Object.freeze(unknown) });
}

export function createWardrobePanel({
  panel,
  loadout,
  inventory,
  describe = getItemDefinition,
  onStatus = () => false,
  onChange = () => {},
  onOpenChange = () => {},
  doc = globalThis.document
} = {}) {
  if (!panel || !loadout || !inventory) throw new Error("Wardrobe panel requires its panel, loadout and inventory clients");

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  let open = false;
  let hint = "";
  let closeButton = null;

  function button(text, { disabled = false, onClick, label }) {
    const node = el("button", "wardrobe-action", text);
    node.type = "button";
    node.disabled = disabled;
    if (label) node.setAttribute("aria-label", label);
    node.addEventListener("click", () => { if (!node.disabled) void onClick(); });
    return node;
  }

  async function change(action, slot, itemId, name) {
    hint = "";
    render();
    const result = action === "EQUIP" ? await loadout.equip(slot, itemId) : await loadout.unequip(slot);
    if (result.outcome === "STALE" || result.code === "BUSY") return result;
    if (result.outcome === "SUCCESS") {
      hint = `${action === "EQUIP" ? "장착 완료" : "해제 완료"} · ${name}`;
      onStatus(hint);
    } else {
      hint = wardrobeMessage(result.code);
    }
    // Ownership may have moved under the shown list (e.g. ITEM_NOT_OWNED): let the owner re-read it.
    try { onChange(result); } catch (error) { console.warn("Wardrobe change listener failed:", error); }
    render();
    return result;
  }

  function renderSlots(slots) {
    const list = el("ul", "wardrobe-slots");
    for (const slot of APPEARANCE_SLOTS) {
      const view = slotView(slot, slots[slot], { describe });
      const row = el("li", `wardrobe-slot${view.empty ? " wardrobe-slot-empty" : ""}`);
      row.dataset.slot = slot;
      row.dataset.itemId = view.itemId ?? "";
      const text = el("div", "wardrobe-slot-text");
      text.append(el("span", "wardrobe-slot-label", view.label), el("strong", "wardrobe-slot-item", view.name));
      if (view.statusText) text.append(el("span", "inventory-item-status", view.statusText));
      row.append(text);
      if (!view.empty) {
        const pending = loadout.isPending(slot);
        row.append(button(pending ? "처리 중…" : "해제", {
          disabled: pending, label: `${view.name} 해제`,
          onClick: () => change("UNEQUIP", slot, null, view.name)
        }));
      }
      list.append(row);
    }
    return list;
  }

  function renderOwned(slots) {
    const section = el("div", "wardrobe-owned");
    section.append(el("h3", "wardrobe-section-title", "보유 착용 아이템"));
    if (inventory.state === INVENTORY_STATE.LOADING) {
      section.append(el("p", "shop-empty", "보유 아이템을 불러오는 중…"));
      return section;
    }
    if (inventory.state !== INVENTORY_STATE.READY) {
      section.append(el("p", "shop-empty", "보유 아이템을 불러오지 못했어요."));
      return section;
    }
    const { wearables, unknown } = wardrobeCandidates(inventory.snapshot.items, slots, { describe });
    if (!wearables.length) section.append(el("p", "shop-empty", "보유한 착용 아이템이 없어요."));
    else {
      const list = el("ul", "inventory-items wardrobe-items");
      for (const item of wearables) {
        const card = el("li", `inventory-item wardrobe-item${item.equipped ? " wardrobe-item-equipped" : ""}`);
        card.dataset.itemId = item.itemId;
        card.dataset.slot = item.slot;
        card.dataset.status = item.catalogStatus;
        card.dataset.equipped = String(item.equipped);
        const head = el("div", "inventory-item-head");
        head.append(el("strong", "inventory-item-name", item.name));
        if (item.equipped) head.append(el("span", "wardrobe-equipped-chip", "장착 중"));
        card.append(head, el("p", "inventory-item-description", item.description));
        const foot = el("div", "wardrobe-item-foot");
        const meta = el("div", "inventory-item-meta");
        meta.append(el("span", "inventory-item-kind", item.metaText));
        if (item.statusText) meta.append(el("span", "inventory-item-status", item.statusText));
        const pending = loadout.isPending(item.slot);
        const action = item.equipped
          ? button(pending ? "처리 중…" : "해제", { disabled: pending, label: `${item.name} 해제`,
            onClick: () => change("UNEQUIP", item.slot, null, item.name) })
          : button(pending ? "처리 중…" : "장착", { disabled: pending || !item.canEquip,
            label: item.canEquip ? `${item.name} 장착` : `${item.name} 장착 불가`,
            onClick: () => change("EQUIP", item.slot, item.itemId, item.name) });
        foot.append(meta, action);
        card.append(foot);
        list.append(card);
      }
      section.append(list);
    }
    if (unknown.length) {
      const box = el("div", "wardrobe-unknown");
      box.append(el("p", "wardrobe-unknown-title", "장착 정보 확인 불가"));
      const list = el("ul", "wardrobe-unknown-list");
      for (const item of unknown) {
        const row = el("li", "wardrobe-unknown-item", item.name);
        row.dataset.itemId = item.itemId;
        list.append(row);
      }
      box.append(list);
      section.append(box);
    }
    return section;
  }

  function render() {
    if (!open) return;
    const previousScroll = panel.querySelector?.(".shop-panel-body")?.scrollTop ?? 0;
    const head = el("div", "shop-panel-head");
    const titles = el("div", "shop-panel-titles");
    const title = el("h2", "", "👕 옷장");
    title.id = "wardrobe-panel-title";
    titles.append(title, el("p", "wardrobe-subtitle", "보유한 착용 아이템을 슬롯별로 관리해요"));
    closeButton = el("button", "profile-close", "×");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "옷장 닫기");
    closeButton.addEventListener("click", () => setOpen(false));
    head.append(titles, closeButton);

    const status = el("p", "shop-hint", hint);
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.hidden = !hint;

    const body = el("div", "shop-panel-body");
    if (loadout.state === LOADOUT_STATE.SIGNED_OUT) {
      body.append(el("p", "shop-empty", "로그인한 INHAGAME 계정만 옷장을 이용할 수 있어요."));
    } else if (loadout.state === LOADOUT_STATE.LOADING) {
      body.append(el("p", "shop-empty", "옷장을 불러오는 중…"));
    } else if (loadout.state === LOADOUT_STATE.UNAVAILABLE) {
      body.append(el("p", "shop-empty", "옷장을 불러오지 못했어요."));
      const retry = el("button", "shop-retry", "다시 시도");
      retry.type = "button";
      retry.addEventListener("click", () => void loadout.refresh("retry"));
      body.append(retry);
    } else {
      const slots = loadout.snapshot.slots;
      body.append(el("h3", "wardrobe-section-title", "현재 장착"), renderSlots(slots), renderOwned(slots),
        el("p", "wardrobe-note", "3D 모델이 지원되는 장비는 캐릭터에 바로 반영돼요."));
    }
    panel.dataset.state = loadout.state;
    panel.replaceChildren(head, status, body);
    if (previousScroll) body.scrollTop = previousScroll;
  }

  function setOpen(next) {
    const value = Boolean(next);
    if (value === open) return open;
    open = value;
    panel.hidden = !open;
    hint = "";
    if (!open) {
      panel.replaceChildren();
      onOpenChange(false);
      return false;
    }
    render();
    onOpenChange(true);
    closeButton?.focus?.();
    if (loadout.accountId) void loadout.refresh("open");
    if (inventory.accountId) void inventory.refresh("open");
    return true;
  }

  loadout.onChange((change) => {
    if (change.reason === "account") hint = "";
    render();
  });
  inventory.onChange(() => render());
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  doc.addEventListener("keydown", (event) => {
    if (open && event.code === "Escape") setOpen(false);
  });

  return {
    get open() { return open; },
    setOpen,
    render,
    status: () => ({ open, hint })
  };
}
