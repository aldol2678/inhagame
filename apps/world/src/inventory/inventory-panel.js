// INHA WORLD · Inventory panel P0 (read-only presentation).
// Shows exactly the items the server says the player owns, in the server's order. Names,
// descriptions, category and rarity come from the code catalog (presentation only). The catalog never
// decides ownership: an owned item the catalog cannot describe is still shown, with its itemId. The
// server's catalogStatus is shown as served; a non-ACTIVE item stays in the list. No RPC here.

import { getItemDefinition } from "../collection/item-catalog.js";
import { INVENTORY_STATE } from "./inventory-client.js";

const CATEGORY_TEXT = Object.freeze({
  WEARABLE: "착용 아이템", BADGE: "배지", EMOTE: "이모트", FURNITURE: "가구", MOUNT: "탈것",
  MOUNT_COSMETIC: "탈것 꾸미기", MEMORABILIA: "기념품"
});
const RARITY_TEXT = Object.freeze({ COMMON: "일반", UNCOMMON: "고급", RARE: "희귀", SPECIAL: "특별" });
const SOURCE_TEXT = Object.freeze({
  SHOP: "상점", EVENT: "이벤트", QUEST: "퀘스트", EXPLORATION: "탐험", ACHIEVEMENT: "업적",
  MINIGAME: "미니게임", DEFAULT: "기본 지급", INHAGAME_REWARD: "INHAGAME 보상", SYSTEM: "지급", ADMIN: "지급"
});
const STATUS_TEXT = Object.freeze({
  LOCKED: "잠김", COMING_SOON: "준비 중", DISABLED: "사용 중지", HIDDEN: "숨김", UNKNOWN_ITEM: "정보 없음"
});
export const UNKNOWN_ITEM_DESCRIPTION = "아이템 정보를 불러올 수 없어요";

const formatCount = (value) => Number(value).toLocaleString("en-US");

/** Display model for one owned server row. Ownership fields are the server's; text is presentation. */
export function itemView(item, { describe = getItemDefinition } = {}) {
  const definition = describe(item.itemId);
  const known = Boolean(definition);
  // A local catalog miss is shown as UNKNOWN_ITEM even when the server still has a status for it.
  const status = known ? item.catalogStatus : "UNKNOWN_ITEM";
  const category = known ? CATEGORY_TEXT[definition.category] ?? definition.category : null;
  const rarity = known ? RARITY_TEXT[definition.rarity] ?? definition.rarity : null;
  return Object.freeze({
    itemId: item.itemId,
    known,
    name: definition?.displayName ?? item.itemId,
    description: definition?.description ?? UNKNOWN_ITEM_DESCRIPTION,
    metaText: [category, rarity].filter(Boolean).join(" · ") || null,
    quantityText: `보유 ${formatCount(item.quantity)}`,
    sourceText: `획득 · ${SOURCE_TEXT[item.sourceType] ?? "기타"}`,
    status,
    statusText: status === "ACTIVE" ? null : STATUS_TEXT[status] ?? "상태 확인 필요",
    muted: status !== "ACTIVE"
  });
}

/** "보유 아이템 N종": the number of distinct owned items, never the quantity sum. */
export function summaryText(snapshot) {
  return `보유 아이템 ${formatCount(snapshot?.items.length ?? 0)}종`;
}

export function createInventoryPanel({
  panel,
  inventory,
  describe = getItemDefinition,
  onOpenChange = () => {},
  doc = globalThis.document
} = {}) {
  if (!panel || !inventory) throw new Error("Inventory panel requires its panel and inventory client");

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  let open = false;
  let closeButton = null;

  function renderItem(item) {
    const view = itemView(item, { describe });
    const card = el("li", `inventory-item${view.muted ? " inventory-item-muted" : ""}`);
    card.dataset.itemId = view.itemId;
    card.dataset.status = view.status;
    const head = el("div", "inventory-item-head");
    head.append(el("strong", "inventory-item-name", view.name), el("span", "inventory-item-quantity", view.quantityText));
    card.append(head);
    card.append(el("p", "inventory-item-description", view.description));
    const meta = el("div", "inventory-item-meta");
    if (view.metaText) meta.append(el("span", "inventory-item-kind", view.metaText));
    meta.append(el("span", "inventory-item-source", view.sourceText));
    if (view.statusText) meta.append(el("span", "inventory-item-status", view.statusText));
    card.append(meta);
    return card;
  }

  function render() {
    if (!open) return;
    const snapshot = inventory.state === INVENTORY_STATE.READY ? inventory.snapshot : null;
    const head = el("div", "shop-panel-head");
    const titles = el("div", "shop-panel-titles");
    const title = el("h2", "", "🎒 인벤토리");
    title.id = "inventory-panel-title";
    titles.append(title);
    if (snapshot) titles.append(el("p", "inventory-summary", summaryText(snapshot)));
    closeButton = el("button", "profile-close", "×");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "인벤토리 닫기");
    closeButton.addEventListener("click", () => setOpen(false));
    head.append(titles, closeButton);

    const body = el("div", "shop-panel-body");
    if (inventory.state === INVENTORY_STATE.SIGNED_OUT) {
      body.append(el("p", "shop-empty", "로그인한 INHAGAME 계정만 인벤토리를 볼 수 있어요."));
    } else if (inventory.state === INVENTORY_STATE.LOADING) {
      body.append(el("p", "shop-empty", "인벤토리를 불러오는 중…"));
    } else if (inventory.state === INVENTORY_STATE.UNAVAILABLE) {
      body.append(el("p", "shop-empty", "인벤토리를 불러오지 못했어요."));
      const retry = el("button", "shop-retry", "다시 시도");
      retry.type = "button";
      retry.addEventListener("click", () => void inventory.refresh("retry"));
      body.append(retry);
    } else if (!snapshot.items.length) {
      body.append(el("p", "shop-empty", "아직 보유한 아이템이 없어요."));
    } else {
      const list = el("ul", "inventory-items");
      list.append(...snapshot.items.map(renderItem));
      body.append(list);
    }
    panel.dataset.state = inventory.state;
    panel.replaceChildren(head, body);
  }

  function setOpen(next) {
    const value = Boolean(next);
    if (value === open) return open;
    open = value;
    panel.hidden = !open;
    if (!open) {
      panel.replaceChildren();
      onOpenChange(false);
      return false;
    }
    render();
    onOpenChange(true);
    closeButton?.focus?.();
    if (inventory.accountId) void inventory.refresh("open");
    return true;
  }

  // Any state change re-renders; an account change shows LOADING / SIGNED_OUT at once, so the
  // previous account's items never stay on screen.
  inventory.onChange(() => render());
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  doc.addEventListener("keydown", (event) => {
    if (open && event.code === "Escape") setOpen(false);
  });

  return {
    get open() { return open; },
    setOpen,
    render,
    status: () => ({ open })
  };
}
