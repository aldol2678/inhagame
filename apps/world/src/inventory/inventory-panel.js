// INHA WORLD · Inventory panel P0 (read-only presentation).
// Shows exactly the items the server says the player owns, in the server's order. Names,
// descriptions, category and rarity come from the code catalog (presentation only). The catalog never
// decides ownership: an owned item the catalog cannot describe is still shown, with its itemId. The
// server's catalogStatus is shown as served; a non-ACTIVE item stays in the list. No RPC here.

import { renderCollectionBook } from "../collection/collection-book-view.js";
import { getItemDefinition } from "../collection/item-catalog.js";
import { filterItemsForInventoryTab, INVENTORY_TAB, INVENTORY_TABS } from "./inventory-category-registry.js";
import { INVENTORY_STATE } from "./inventory-client.js";

const CATEGORY_TEXT = Object.freeze({
  WEARABLE: "착용 아이템", BADGE: "배지", EMOTE: "이모트", FURNITURE: "가구", MOUNT: "탈것",
  MOUNT_COSMETIC: "탈것 꾸미기", MEMORABILIA: "기념품", MATERIAL: "재료"
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
  collectionBook = null,
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
  let bodyElement = null;
  let opener = null;
  let renderedAccount = inventory.accountId;
  let activeTab = INVENTORY_TAB.ALL;
  let activeView = "inventory";
  let renderedBookState = null;
  let viewButtons = new Map();
  let tabButtons = new Map();

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

  function renderTabs(items) {
    const tabs = el("div", "inventory-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "인벤토리 분류");
    tabButtons = new Map();
    for (const tab of INVENTORY_TABS) {
      const count = filterItemsForInventoryTab(items, tab.id, describe).length;
      const button = el("button", "inventory-tab", tab.label);
      button.type = "button";
      button.dataset.inventoryTab = tab.id;
      button.dataset.focusKey = `tab:${tab.id}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(activeTab === tab.id));
      button.setAttribute("aria-label", `${tab.label} ${count}종`);
      button.addEventListener("click", () => {
        if (activeTab === tab.id) return;
        activeTab = tab.id;
        if (bodyElement) {
          bodyElement.scrollTop = 0;
          bodyElement.scrollLeft = 0;
        }
        render();
        tabButtons.get(tab.id)?.focus?.({ preventScroll: true });
      });
      tabButtons.set(tab.id, button);
      tabs.append(button);
    }
    return tabs;
  }

  function render() {
    if (!open) return;
    const hadFocus = panel.contains(doc.activeElement);
    const accountChanged = renderedAccount !== inventory.accountId;
    const focusKey = !accountChanged && hadFocus ? doc.activeElement?.dataset?.focusKey : null;
    const bookState = activeView === "book" ? collectionBook?.state ?? null : null;
    const bookStateChanged = bookState !== renderedBookState;
    renderedBookState = bookState;
    // Book requests replace a tall history with a short status. An old offset would hide the
    // loading/error feedback above the viewport and clip the recovered navigation.
    const scrollTop = accountChanged || bookStateChanged ? 0 : bodyElement?.scrollTop ?? 0;
    const scrollLeft = accountChanged ? 0 : bodyElement?.scrollLeft ?? 0;
    renderedAccount = inventory.accountId;
    if (accountChanged) { activeTab = INVENTORY_TAB.ALL; activeView = "inventory"; }
    let retryButton = null;
    let bookRetryButton = null;
    const snapshot = inventory.state === INVENTORY_STATE.READY ? inventory.snapshot : null;
    const head = el("div", "shop-panel-head");
    const titles = el("div", "shop-panel-titles");
    const title = el("h2", "", activeView === "book" ? "📖 수집도감" : "🎒 인벤토리");
    title.id = "inventory-panel-title";
    titles.append(title);
    if (snapshot && activeView === "inventory") titles.append(el("p", "inventory-summary", summaryText(snapshot)));
    closeButton = el("button", "profile-close", "×");
    closeButton.type = "button";
    closeButton.dataset.focusKey = "close";
    closeButton.setAttribute("aria-label", activeView === "book" ? "수집도감 닫기" : "인벤토리 닫기");
    closeButton.addEventListener("click", () => setOpen(false));
    head.append(titles, closeButton);

    const body = el("div", "shop-panel-body");
    viewButtons = new Map();
    if (collectionBook) {
      const navigation = el("div", "inventory-tabs collection-book-navigation");
      navigation.setAttribute("aria-label", "인벤토리와 수집 기록");
      for (const [view, label] of [["inventory", "인벤토리"], ["book", "수집도감"]]) {
        const button = el("button", "inventory-tab", label);
        button.type = "button";
        button.dataset.focusKey = `view:${view}`;
        button.setAttribute("aria-pressed", String(activeView === view));
        button.addEventListener("click", () => {
          if (activeView === view) return;
          activeView = view;
          if (bodyElement) bodyElement.scrollTop = 0;
          // Lazy read: opening inventory does not fetch discovery history.
          if (view === "book") void collectionBook.refresh();
          render();
          viewButtons.get(view)?.focus?.({ preventScroll: true });
        });
        viewButtons.set(view, button);
        navigation.append(button);
      }
      body.append(navigation);
    }
    // Drop references to tab buttons from the previous DOM before rebuilding state-specific content.
    tabButtons = new Map();
    if (activeView === "book" && collectionBook) {
      const bookView = renderCollectionBook({ doc, book: collectionBook, inventory,
        retry: () => void collectionBook.refresh() });
      body.append(bookView.element);
      bookRetryButton = bookView.retryButton;
    } else if (inventory.state === INVENTORY_STATE.SIGNED_OUT) {
      body.append(el("p", "shop-empty", "로그인한 INHAGAME 계정만 인벤토리를 볼 수 있어요."));
    } else if (inventory.state === INVENTORY_STATE.LOADING) {
      body.append(el("p", "shop-empty", "인벤토리를 불러오는 중…"));
    } else if (inventory.state === INVENTORY_STATE.UNAVAILABLE) {
      body.append(el("p", "shop-empty", "인벤토리를 불러오지 못했어요."));
      const retry = el("button", "shop-retry", "다시 시도");
      retry.type = "button";
      retry.dataset.focusKey = "retry";
      retryButton = retry;
      retry.addEventListener("click", () => void inventory.refresh("retry"));
      body.append(retry);
    } else {
      const visibleItems = filterItemsForInventoryTab(snapshot.items, activeTab, describe);
      body.append(renderTabs(snapshot.items));
      if (!snapshot.items.length) {
        body.append(el("p", "shop-empty", "아직 보유한 아이템이 없어요."));
      } else if (!visibleItems.length) {
        body.append(el("p", "shop-empty", "이 분류에 보유한 아이템이 없어요."));
      } else {
        const list = el("ul", "inventory-items");
        list.id = "inventory-item-list";
        list.append(...visibleItems.map(renderItem));
        body.append(list);
      }
    }
    panel.dataset.state = inventory.state;
    panel.dataset.inventoryTab = activeTab;
    panel.dataset.inventoryView = activeView;
    panel.replaceChildren(head, body);
    bodyElement = body;
    if (hadFocus) {
      let nextFocus = closeButton;
      if (focusKey === "book-retry") nextFocus = bookRetryButton?.disabled ? closeButton : bookRetryButton ?? closeButton;
      else if (focusKey?.startsWith("view:")) nextFocus = viewButtons.get(focusKey.slice(5)) ?? closeButton;
      else if (focusKey === "retry") nextFocus = retryButton ?? closeButton;
      else if (focusKey?.startsWith("tab:")) nextFocus = tabButtons.get(focusKey.slice(4)) ?? closeButton;
      nextFocus?.focus?.({ preventScroll: true });
    }
    body.scrollTop = scrollTop;
    body.scrollLeft = scrollLeft;
  }

  function setOpen(next) {
    const value = Boolean(next);
    if (value === open) return open;
    const focused = doc.activeElement;
    const restoreOpener = !value && panel.contains(focused);
    if (value) opener = focused;
    open = value;
    panel.hidden = !open;
    if (!open) {
      panel.replaceChildren();
      bodyElement = null;
      onOpenChange(false);
      // A close callback may already have focused a different panel. Never override that handoff.
      if (restoreOpener && (!doc.activeElement || doc.activeElement === doc.body || doc.activeElement === focused)
        && opener?.isConnected !== false && !opener?.disabled && !opener?.closest?.("[hidden], [inert]")) {
        opener?.focus?.({ preventScroll: true });
      }
      opener = null;
      return false;
    }
    render();
    onOpenChange(true);
    closeButton?.focus?.();
    if (inventory.accountId) void inventory.refresh("open");
    if (activeView === "book") void collectionBook?.refresh();
    return true;
  }

  // Any state change re-renders; an account change shows LOADING / SIGNED_OUT at once, so the
  // previous account's items never stay on screen.
  inventory.onChange(() => render());
  collectionBook?.onChange(() => { if (activeView === "book") render(); });
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  doc.addEventListener("keydown", (event) => {
    if (open && event.code === "Escape") setOpen(false);
  });

  return {
    get open() { return open; },
    setOpen,
    render,
    status: () => ({ open, activeTab, activeView })
  };
}
