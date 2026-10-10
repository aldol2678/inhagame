// INHA WORLD P0-F3b · Student Center Shop panel (presentation).
// Shows what the server returned: the lock state and the buy button follow each offer's
// `purchasable` / `unavailableReason`. Pending operations and unconfirmed receipts pause repeat buys.
// `requiredLevel` and `playerLevel` are display text; this
// module never compares them to decide anything. Item names and descriptions come from the code
// catalog (presentation metadata only); price and every gameplay field come from the Shop RPC.
// The optional wallet line shows the server balance from the wallet read-model as served; it is
// re-read after a purchase, never derived from a price.

import { getItemDefinition } from "../collection/item-catalog.js";
import { furnitureOfferDetails, ownsShopFurniture } from "./shop-furniture-handoff.js";
import { SHOP_STATE } from "./shop-client.js";
import { INDUCK_COIN, WALLET_STATE, walletBalance } from "../wallet/wallet-client.js";

const CURRENCY_LABEL = Object.freeze({ "currency.induck_coin": "인덕코인" });
const REASON_TEXT = Object.freeze({
  LISTING_LOCKED: "🔒 잠김",
  LISTING_NOT_STARTED: "판매 예정",
  LISTING_EXPIRED: "판매 종료",
  SHOP_INACTIVE: "상점 운영 중지"
});
const UNAVAILABLE_NOW = new Set([
  "LISTING_INACTIVE", "LISTING_LOCKED", "LISTING_NOT_STARTED", "LISTING_EXPIRED", "SHOP_INACTIVE",
  "ITEM_UNAVAILABLE", "INVALID_LISTING", "SHOP_NOT_FOUND"
]);

const formatCount = (value) => Number(value).toLocaleString("en-US");
const levelNeeded = (offer) => (offer?.requiredLevel ? `Lv.${offer.requiredLevel}` : null);

/** Display model for one server offer. Lock/buyable state is the server's, never recomputed. */
export function offerView(offer, { pending = false, describe = getItemDefinition } = {}) {
  const item = describe(offer.itemId);
  const locked = !offer.purchasable && offer.unavailableReason === "LEVEL_REQUIRED";
  const state = offer.purchasable ? "available" : locked ? "locked" : "unavailable";
  const statusText = offer.purchasable ? "구매 가능"
    : locked ? `🔒 ${levelNeeded(offer) ?? "레벨"} 필요`
      : REASON_TEXT[offer.unavailableReason] ?? "구매 불가";
  return Object.freeze({
    listingId: offer.listingId,
    name: item?.displayName ?? offer.itemId,
    description: item?.description ?? "",
    priceText: `${formatCount(offer.price)} ${CURRENCY_LABEL[offer.currencyId] ?? "코인"}`,
    levelText: offer.requiredLevel ? `Lv.${offer.requiredLevel} 이상` : null,
    statusText,
    state,
    buttonText: pending ? "구매 중…" : "구매",
    buttonDisabled: pending || !offer.purchasable
  });
}

const WALLET_UNAVAILABLE_TEXT = "잔액을 불러오지 못했어요";

/** Wallet read state → the header balance line, or null (hidden) when there is no account. */
export function walletLine(state, snapshot) {
  if (state === WALLET_STATE.LOADING) return "🪙 인덕코인 …";
  if (state === WALLET_STATE.READY) {
    const balance = walletBalance(snapshot, INDUCK_COIN);
    if (balance !== null) return `🪙 인덕코인 ${formatCount(balance)}`;
  }
  if (state === WALLET_STATE.READY || state === WALLET_STATE.UNAVAILABLE) return WALLET_UNAVAILABLE_TEXT;
  return null;
}

/** Stable server code → short player-facing text. Unknown codes never leak internal messages. */
export function purchaseMessage(code, offer = null) {
  if (code === "LEVEL_REQUIRED") return levelNeeded(offer) ? `${levelNeeded(offer)}이 필요해요` : "레벨이 부족해요";
  if (code === "INSUFFICIENT_FUNDS") return "인덕코인이 부족해요";
  if (code === "ITEM_ALREADY_OWNED") return "이미 보유한 아이템이에요";
  if (code === "PURCHASE_LIMIT_REACHED") return "구매 한도에 도달했어요";
  if (UNAVAILABLE_NOW.has(code)) return "지금은 구매할 수 없어요";
  if (code === "PERMANENT_ACCOUNT_REQUIRED" || code === "SIGNED_OUT") return "로그인한 계정만 구매할 수 있어요";
  if (code === "ACCOUNT_UNAVAILABLE") return "현재 이 계정으로는 상점을 이용할 수 없어요";
  return "구매하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

export function createShopPanel({
  panel,
  shop,
  wallet = null,
  inventory = null,
  getFurnitureAction = () => null,
  onDecorate = () => false,
  describe = getItemDefinition,
  onStatus = () => false,
  onPurchase = () => {},
  onOpenChange = () => {},
  doc = globalThis.document
} = {}) {
  if (!panel || !shop) throw new Error("Shop panel requires its panel and shop client");

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  let open = false;
  let hint = "";
  let closeButton = null;
  let walletNode = null;
  let bodyElement = null;
  let opener = null;
  let openingRevision = 0;
  let renderedAccount = shop.accountId;
  const focusTargets = new Map();
  // Keep successful receipts across panel close/reopen. An Inventory failure is never a purchase
  // failure, and a read retry must not call purchase again. Account changes erase these receipts.
  const receipts = new Map();
  const purchases = new Map();
  let accountRevision = 0;
  const owns = itemId => ownsShopFurniture(inventory, shop.accountId, itemId);
  const confirmed = receipt => receipt?.phase === "confirmed" && owns(receipt.itemId);
  const receiptMessage = receipt => receipt.phase === "checking"
    ? "구매는 완료됐어요. 보유 가구를 확인 중이에요."
    : confirmed(receipt) ? "구매 완료 · 보유 확인 완료"
      : "구매는 완료됐어요. 보유 목록 반영을 확인하지 못했어요. 다시 구매하지 말고 보유 가구를 다시 확인해 주세요.";

  async function refreshOwnership(listingId) {
    const receipt = receipts.get(listingId);
    if (!receipt || receipt.phase === "checking") return;
    const account = accountRevision;
    receipt.phase = "checking";
    render();
    let ready = false;
    try { ready = await inventory.refresh("shop-furniture-retry"); } catch { /* safe read-only retry */ }
    if (account !== accountRevision || receipts.get(listingId) !== receipt) return;
    receipt.phase = ready && owns(receipt.itemId) ? "confirmed" : "unconfirmed";
    render();
  }

  // Updated in place so a balance re-read never rebuilds (or scrolls) the offer list.
  function renderWallet() {
    if (!open || !walletNode) return;
    const line = wallet ? walletLine(wallet.state, wallet.snapshot) : null;
    walletNode.textContent = line ?? "";
    walletNode.hidden = !line;
    walletNode.dataset.state = line === WALLET_UNAVAILABLE_TEXT ? WALLET_STATE.UNAVAILABLE : wallet?.state ?? "";
  }

  async function buy(listingId) {
    const prior = receipts.get(listingId);
    if (!open || purchases.has(listingId) || shop.isPending(listingId) || (prior && !confirmed(prior))) return;
    const revision = openingRevision;
    const account = accountRevision;
    const token = {};
    purchases.set(listingId, token);
    hint = "";
    render();
    const result = await shop.purchase(listingId);
    if (result.outcome === "STALE" || account !== accountRevision) return result;
    // Money may have moved (or the shown balance was out of date): re-read the server balance.
    if (result.outcome === "SUCCESS" || result.code === "INSUFFICIENT_FUNDS") void wallet?.refresh("purchase");
    let receipt = null;
    // Other read-models re-read the server. A purchase response alone never proves ownership.
    if (result.outcome === "SUCCESS") {
      if (inventory && furnitureOfferDetails(result.offer?.itemId)) {
        receipt = { itemId: result.offer.itemId, phase: "checking" };
        receipts.set(listingId, receipt);
        render();
      }
      let ready = false;
      try { ready = await onPurchase(result); }
      catch (error) { console.warn("Shop purchase listener failed:", error); }
      if (account !== accountRevision) return result;
      if (receipt) receipt.phase = ready === true && owns(receipt.itemId) ? "confirmed" : "unconfirmed";
    }
    if (purchases.get(listingId) === token) purchases.delete(listingId);
    if (!open || revision !== openingRevision) { render(); return result; }
    const latest = shop.snapshot?.offers.find((offer) => offer.listingId === listingId) ?? result.offer;
    const name = latest ? offerView(latest, { describe }).name : "아이템";
    if (result.outcome === "SUCCESS") {
      hint = `구매 완료 · ${name}`;
      onStatus(hint);
    } else {
      hint = purchaseMessage(result.code, latest);
    }
    render();
    return result;
  }

  function renderReceipt(listingId, receipt) {
    const box = el("div", "shop-furniture-receipt");
    box.tabIndex = -1;
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    box.append(el("p", "shop-furniture-note", receiptMessage(receipt)));
    const isConfirmed = confirmed(receipt);
    const action = isConfirmed ? getFurnitureAction(receipt.itemId) : null;
    if (isConfirmed) box.append(el("p", "shop-furniture-note", action?.text
      ?? "내 방에 들어가 권한과 저장된 배치를 확인한 뒤 ‘꾸미기’에서 배치할 수 있어요."));
    if (action || !isConfirmed) {
      const checking = receipt.phase === "checking";
      const button = el("button", "shop-retry shop-furniture-action", action?.label
        ?? (checking ? "보유 확인 중…" : "보유 가구 다시 확인"));
      button.type = "button";
      button.disabled = checking;
      const focusKey = `furniture:${listingId}`;
      box.dataset.focusKey = focusKey;
      button.dataset.focusKey = focusKey;
      focusTargets.set(focusKey, checking ? box : button);
      button.addEventListener("click", () => {
        if (!open || focusTargets.get(focusKey) !== button || !panel.contains(button) || receipts.get(listingId) !== receipt || button.disabled) return;
        if (!confirmed(receipt)) { void refreshOwnership(listingId); return; }
        if (getFurnitureAction(receipt.itemId) && onDecorate(receipt.itemId) === true) setOpen(false);
        else { hint = "현재 방과 보유 가구를 다시 확인한 뒤 눌러 주세요."; render(); }
      });
      box.append(button);
    }
    return box;
  }

  function renderOffer(offer) {
    const receipt = receipts.get(offer.listingId);
    const pending = purchases.has(offer.listingId) || shop.isPending(offer.listingId);
    const view = offerView(offer, { pending, describe });
    const card = el("li", `shop-offer shop-offer-${view.state}`);
    card.dataset.listingId = view.listingId;
    card.dataset.state = view.state;
    const head = el("div", "shop-offer-head");
    head.append(el("strong", "shop-offer-name", view.name), el("span", "shop-offer-price", view.priceText));
    card.append(head);
    if (view.description) card.append(el("p", "shop-offer-description", view.description));
    const furniture = furnitureOfferDetails(offer.itemId);
    if (furniture) {
      card.append(el("p", "shop-offer-furniture", furniture.sizeText), el("p", "shop-offer-furniture", furniture.surfaceText));
    }
    const foot = el("div", "shop-offer-foot");
    const meta = el("span", "shop-offer-meta");
    if (view.levelText) meta.append(el("span", "shop-offer-level", view.levelText));
    meta.append(el("span", "shop-offer-status", view.statusText));
    const button = el("button", "shop-offer-buy", receipt
      ? (receipt.phase === "checking" ? "보유 확인 중…" : confirmed(receipt) ? (pending ? "구매 중…" : "추가 구매") : "구매 완료")
      : view.buttonText);
    button.type = "button";
    button.disabled = view.buttonDisabled || Boolean(receipt && !confirmed(receipt));
    // Pending/refused controls remain disabled. Their listing is a temporary focus anchor,
    // outside the native Tab order, so a readback can restore the same logical purchase action.
    const focusKey = `listing:${view.listingId}`;
    card.tabIndex = -1;
    card.dataset.focusKey = focusKey;
    button.dataset.focusKey = focusKey;
    focusTargets.set(focusKey, button.disabled ? card : button);
    button.setAttribute("aria-label", `${view.name} ${button.disabled ? receipt ? "구매 완료" : view.statusText : receipt ? "추가 구매" : "구매"}`);
    button.addEventListener("click", () => { if (!button.disabled && focusTargets.get(focusKey) === button && panel.contains(button)) void buy(view.listingId); });
    foot.append(meta, button);
    card.append(foot);
    if (receipt) card.append(renderReceipt(offer.listingId, receipt));
    return card;
  }

  function render() {
    const accountChanged = renderedAccount !== shop.accountId;
    if (accountChanged) {
      openingRevision += 1; accountRevision += 1; hint = "";
      receipts.clear(); purchases.clear();
    }
    renderedAccount = shop.accountId;
    if (!open) return;
    const hadFocus = panel.contains(doc.activeElement);
    const focusKey = !accountChanged && hadFocus ? doc.activeElement?.dataset?.focusKey : null;
    const scrollTop = accountChanged ? 0 : bodyElement?.scrollTop ?? 0;
    const scrollLeft = accountChanged ? 0 : bodyElement?.scrollLeft ?? 0;
    focusTargets.clear();
    const snapshot = shop.state === SHOP_STATE.READY ? shop.snapshot : null;
    const head = el("div", "shop-panel-head");
    const titles = el("div", "shop-panel-titles");
    const title = el("h2", "", "학생회관 상점");
    title.id = "shop-panel-title";
    titles.append(title);
    if (snapshot) titles.append(el("p", "shop-panel-level", `내 레벨 Lv.${snapshot.playerLevel}`));
    walletNode = el("p", "shop-panel-wallet");
    walletNode.setAttribute("aria-live", "polite");
    titles.append(walletNode);
    closeButton = el("button", "profile-close", "×");
    closeButton.type = "button";
    closeButton.dataset.focusKey = "close";
    focusTargets.set("close", closeButton);
    closeButton.setAttribute("aria-label", "상점 닫기");
    closeButton.addEventListener("click", () => setOpen(false));
    head.append(titles, closeButton);

    const status = el("p", "shop-hint", hint);
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.hidden = !hint;

    const body = el("div", "shop-panel-body");
    if (shop.state === SHOP_STATE.SIGNED_OUT) {
      body.append(el("p", "shop-empty", "로그인한 INHAGAME 계정만 상점을 이용할 수 있어요."));
    } else if (shop.state === SHOP_STATE.LOADING) {
      body.append(el("p", "shop-empty", "상점을 불러오는 중…"));
    } else if (shop.state === SHOP_STATE.UNAVAILABLE) {
      body.append(el("p", "shop-empty", "상점을 불러오지 못했어요."));
      const retry = el("button", "shop-retry", "다시 시도");
      retry.type = "button";
      retry.dataset.focusKey = "retry";
      focusTargets.set("retry", retry);
      retry.addEventListener("click", () => void shop.refresh("retry"));
      body.append(retry);
    } else if (!snapshot.offers.length) {
      body.append(el("p", "shop-empty", "판매 중인 상품이 없어요."));
    } else {
      const list = el("ul", "shop-offers");
      list.append(...snapshot.offers.map(renderOffer));
      body.append(list);
    }
    for (const [listingId, receipt] of receipts) {
      if (!snapshot?.offers.some(offer => offer.listingId === listingId)) {
        const name = describe(receipt.itemId)?.displayName ?? receipt.itemId;
        const receiptCard = el("div", "shop-purchased-furniture");
        receiptCard.append(el("strong", "", name), renderReceipt(listingId, receipt));
        body.append(receiptCard);
      }
    }
    panel.dataset.state = shop.state;
    panel.replaceChildren(head, status, body);
    bodyElement = body;
    renderWallet();
    if (hadFocus) (focusTargets.get(focusKey) ?? closeButton).focus?.({ preventScroll: true });
    body.scrollTop = scrollTop;
    body.scrollLeft = scrollLeft;
  }

  function setOpen(next) {
    const value = Boolean(next);
    if (value === open) return open;
    const focused = doc.activeElement;
    const restoreOpener = !value && panel.contains(focused);
    if (value) opener = focused;
    openingRevision += 1;
    open = value;
    panel.hidden = !open;
    hint = "";
    if (!open) {
      walletNode = null;
      bodyElement = null;
      focusTargets.clear();
      panel.replaceChildren();
      onOpenChange(false);
      // Respect a callback's handoff to another panel and never revive an invalid trigger.
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
    if (shop.accountId) void shop.refresh("open");
    if (wallet?.accountId) void wallet.refresh("open");
    return true;
  }

  shop.onChange((change) => {
    // An account change invalidates anything shown for the previous account.
    if (change.reason === "account") hint = "";
    render();
  });
  wallet?.onChange(renderWallet);
  inventory?.onChange(render);
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
