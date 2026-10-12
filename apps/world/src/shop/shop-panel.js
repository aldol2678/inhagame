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
import { furnitureShopCategory, furnitureShopTabs, filterFurnitureShopOffers } from "./furniture-shop-categories.js";
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
  "ITEM_UNAVAILABLE", "INVALID_LISTING", "SHOP_LISTING_MISMATCH", "SHOP_NOT_FOUND"
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
  let renderedShop = shop.shopId;
  let category = "all";
  let detailListingId = null;
  let previewAngle = 35;
  let previewZoom = 1;
  let previewCanvas = null;
  let previewEngine = null;
  let previewStarting = null;
  let previewEpoch = 0;
  let previewUnavailable = false;
  let thumbnailsBusy = false;
  const thumbnailCache = new Map();
  const focusTargets = new Map();
  const isShowroom = () => shop.shopId === "shop.dorm_furniture";

  function clearPreview() {
    previewEpoch++;
    previewEngine?.dispose();
    previewEngine = null;
    previewStarting = null;
    previewCanvas?.remove?.();
    previewCanvas = null;
    thumbnailsBusy = false;
  }

  async function ensurePreview() {
    if (!open || previewUnavailable || !isShowroom()) return null;
    if (previewEngine) return previewEngine;
    if (previewStarting) return previewStarting;
    const canvas = doc.createElement("canvas");
    if (typeof canvas.getContext !== "function" || !doc.body?.append) return null;
    canvas.width = 256; canvas.height = 192;
    canvas.className = "shop-showroom-canvas-offscreen";
    doc.body.append(canvas);
    previewCanvas = canvas;
    const epoch = previewEpoch;
    previewStarting = import("./furniture-shop-preview.js")
      .then(({ createFurnitureShopPreview }) => createFurnitureShopPreview(canvas))
      .then(engine => {
        if (epoch !== previewEpoch || !open || !isShowroom()) {
          engine.dispose();
          canvas.remove();
          return null;
        }
        previewEngine = engine;
        return engine;
      }).catch(() => {
        if (epoch === previewEpoch) {
          previewUnavailable = true;
          canvas.remove();
          previewCanvas = null;
        }
        return null;
      }).finally(() => { if (epoch === previewEpoch) previewStarting = null; });
    return previewStarting;
  }

  async function showDetailPreview(itemId) {
    const epoch = previewEpoch;
    if (thumbnailsBusy) return; // Never rotate the renderer during a capture.
    const engine = await ensurePreview();
    if (!engine) {
      const fallback = panel.querySelector?.(".shop-showroom-preview-fallback");
      if (fallback) fallback.textContent = "이 기기에서는 3D 미리보기를 사용할 수 없어요.";
      return;
    }
    if (epoch !== previewEpoch || !open || !detailListingId) return;
    const selected = shop.snapshot?.offers.find(offer => offer.listingId === detailListingId);
    if (selected?.itemId !== itemId) return;
    const stage = panel.querySelector?.(".shop-showroom-stage");
    if (!stage || !previewCanvas) return;
    previewCanvas.className = "shop-showroom-canvas";
    stage.replaceChildren(previewCanvas);
    engine.show(itemId, previewAngle, previewZoom);
    const fallback = stage.querySelector?.(".shop-showroom-preview-fallback");
    if (fallback) fallback.hidden = true;
  }

  async function populateThumbnails(offers) {
    if (thumbnailsBusy || detailListingId || !open || !isShowroom()) return;
    const ids = [...new Set(offers.filter(offer => furnitureOfferDetails(offer.itemId)).map(offer => offer.itemId))]
      .filter(id => !thumbnailCache.has(id));
    if (!ids.length) return;
    thumbnailsBusy = true;
    try {
      const engine = await ensurePreview();
      if (!engine) return;
      for (const id of ids) {
        if (!open || detailListingId || !isShowroom()) break;
        const thumbnail = await engine.capture(id);
        if (thumbnail) {
          thumbnailCache.set(id, thumbnail);
          for (const img of panel.querySelectorAll?.(".shop-showroom-thumbnail") ?? []) {
            if (img.dataset.itemId === id) { img.src = thumbnail; img.hidden = false; }
          }
        }
      }
    } finally {
      thumbnailsBusy = false;
      if (detailListingId) {
        const offer = shop.snapshot?.offers.find(row => row.listingId === detailListingId);
        if (offer) void showDetailPreview(offer.itemId);
      }
    }
  }
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

  const hasUnresolved = listingId => (shop.unresolvedOffers ?? []).some(offer => offer.listingId === listingId);
  const capabilityLocked = () => shop.mode === "checking" || shop.mode === "unavailable" || shop.capabilityChecking === true;
  async function buy(listingId) {
    const prior = receipts.get(listingId);
    if ((capabilityLocked() && !hasUnresolved(listingId)) || !open || purchases.has(listingId) || shop.isPending(listingId) || (prior && !confirmed(prior))) return;
    const revision = openingRevision;
    const purchaseShopId = shop.shopId;
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
        receipt = { itemId: result.offer.itemId, shopId: purchaseShopId, phase: "checking" };
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

  function purchaseControl(offer, view, receipt, pending, location = "listing") {
    const button = el("button", "shop-offer-buy", receipt
      ? (receipt.phase === "checking" ? "보유 확인 중…" : confirmed(receipt) ? (pending ? "구매 중…" : "추가 구매") : "구매 완료")
      : view.buttonText);
    const recovering = hasUnresolved(view.listingId);
    if (recovering) button.textContent = pending ? "구매 중…" : "이전 구매 결과 확인";
    button.type = "button";
    button.disabled = recovering ? pending : capabilityLocked() || view.buttonDisabled || Boolean(receipt && !confirmed(receipt));
    const focusKey = `${location}:${view.listingId}`;
    button.dataset.focusKey = focusKey;
    focusTargets.set(focusKey, button.disabled ? null : button);
    button.setAttribute("aria-label", `${view.name} ${recovering ? "이전 구매 결과 확인" : button.disabled ? receipt ? "구매 완료" : view.statusText : receipt ? "추가 구매" : "구매"}`);
    button.addEventListener("click", () => {
      if (!button.disabled && focusTargets.get(focusKey) === button && panel.contains(button)) void buy(view.listingId);
    });
    return button;
  }

  function showroomThumb(offer, view) {
    const button = el("button", "shop-showroom-view");
    button.type = "button";
    button.dataset.focusKey = `view:${offer.listingId}`;
    button.setAttribute("aria-label", `${view.name} 3D 미리보기`);
    const picture = el("span", `shop-showroom-picture shop-showroom-picture-${furnitureShopCategory(offer.itemId)}`);
    const image = el("img", "shop-showroom-thumbnail");
    image.dataset.itemId = offer.itemId;
    image.alt = "";
    image.loading = "lazy";
    image.hidden = !thumbnailCache.has(offer.itemId);
    if (!image.hidden) image.src = thumbnailCache.get(offer.itemId);
    const fallback = el("span", "shop-showroom-picture-fallback", ({ bedding: "🛏️", seating: "🪑", light: "💡", floor: "▤", decor: "🧸", wall: "🖼️", storage: "▦", kitchen: "☕" })[furnitureShopCategory(offer.itemId)] ?? "✦");
    picture.append(image, fallback);
    button.append(picture, el("span", "shop-showroom-view-label", "미리보기 ↗"));
    focusTargets.set(button.dataset.focusKey, button);
    button.addEventListener("click", () => {
      if (!open || !isShowroom() || !panel.contains(button)) return;
      detailListingId = offer.listingId;
      previewAngle = 35; previewZoom = 1;
      render();
    });
    return button;
  }

  function renderOffer(offer) {
    const storedReceipt = receipts.get(offer.listingId);
    const receipt = storedReceipt?.shopId === shop.shopId ? storedReceipt : null;
    const pending = purchases.has(offer.listingId) || shop.isPending(offer.listingId);
    const view = offerView(offer, { pending, describe });
    const showroom = isShowroom() && Boolean(furnitureOfferDetails(offer.itemId));
    const card = el("li", `shop-offer shop-offer-${view.state}${showroom ? " shop-showroom-card" : ""}`);
    card.dataset.listingId = view.listingId;
    card.dataset.state = view.state;
    if (showroom) card.append(showroomThumb(offer, view));
    const copy = showroom ? el("div", "shop-showroom-copy") : card;
    const head = el("div", "shop-offer-head");
    head.append(el("strong", "shop-offer-name", view.name), el("span", "shop-offer-price", view.priceText));
    copy.append(head);
    if (view.description && !showroom) copy.append(el("p", "shop-offer-description", view.description));
    const furniture = furnitureOfferDetails(offer.itemId);
    if (furniture && !showroom) {
      copy.append(el("p", "shop-offer-furniture", furniture.sizeText), el("p", "shop-offer-furniture", furniture.surfaceText));
      if (furniture.useText) copy.append(el("p", "shop-offer-furniture", furniture.useText));
    }
    const foot = el("div", "shop-offer-foot");
    const meta = el("span", "shop-offer-meta");
    if (view.levelText) meta.append(el("span", "shop-offer-level", view.levelText));
    meta.append(el("span", "shop-offer-status", view.statusText));
    const button = purchaseControl(offer, view, receipt, pending);
    const focusKey = `listing:${view.listingId}`;
    card.tabIndex = -1;
    card.dataset.focusKey = focusKey;
    if (button.disabled) focusTargets.set(focusKey, card);
    foot.append(meta, button);
    copy.append(foot);
    if (receipt) copy.append(renderReceipt(offer.listingId, receipt));
    if (showroom) card.append(copy);
    return card;
  }

  function renderShowroomDetail(offer) {
    const storedReceipt = receipts.get(offer.listingId);
    const receipt = storedReceipt?.shopId === shop.shopId ? storedReceipt : null;
    const pending = purchases.has(offer.listingId) || shop.isPending(offer.listingId);
    const view = offerView(offer, { pending, describe });
    const wrap = el("section", "shop-showroom-detail");
    const back = el("button", "shop-showroom-back", "← 가구 둘러보기");
    back.type = "button";
    back.dataset.focusKey = "detail-back";
    focusTargets.set("detail-back", back);
    back.addEventListener("click", () => { detailListingId = null; render(); });
    wrap.append(back);
    const stage = el("div", "shop-showroom-stage");
    stage.append(el("span", "shop-showroom-preview-fallback", "3D 미리보기를 불러오는 중…"));
    const controls = el("div", "shop-showroom-rotation");
    for (const [label, step, scale] of [["↶ 왼쪽", -45, 0], ["− 축소", 0, -.15], ["+ 확대", 0, .15], ["오른쪽 ↷", 45, 0]]) {
      const rotate = el("button", "shop-showroom-rotate", label);
      rotate.type = "button";
      rotate.addEventListener("click", () => {
        previewAngle = (previewAngle + step + 360) % 360;
        previewZoom = Math.max(.75, Math.min(1.75, previewZoom + scale));
        previewEngine?.show(offer.itemId, previewAngle, previewZoom);
      });
      controls.append(rotate);
    }
    wrap.append(stage, controls, el("h3", "shop-showroom-detail-name", view.name));
    if (view.description) wrap.append(el("p", "shop-showroom-detail-description", view.description));
    const furniture = furnitureOfferDetails(offer.itemId);
    if (furniture) wrap.append(el("p", "shop-showroom-placement", furniture.surfaceText));
    const row = el("div", "shop-showroom-detail-bottom");
    row.append(el("strong", "shop-showroom-detail-price", view.priceText));
    if (view.levelText) row.append(el("span", "shop-showroom-detail-level", view.levelText));
    row.append(el("span", "shop-showroom-detail-status", view.statusText));
    row.append(purchaseControl(offer, view, receipt, pending, "detail"));
    wrap.append(row);
    if (receipt) wrap.append(renderReceipt(offer.listingId, receipt));
    return wrap;
  }

  function render() {
    const accountChanged = renderedAccount !== shop.accountId;
    const shopChanged = renderedShop !== shop.shopId;
    if (shopChanged) { openingRevision += 1; hint = ""; category = "all"; detailListingId = null; clearPreview(); }
    renderedShop = shop.shopId;
    if (accountChanged) {
      openingRevision += 1; accountRevision += 1; hint = "";
      receipts.clear(); purchases.clear(); detailListingId = null; clearPreview();
    }
    renderedAccount = shop.accountId;
    if (!open) return;
    panel.dataset.presentation = isShowroom() ? "furniture-showroom" : "standard";
    const hadFocus = panel.contains(doc.activeElement);
    const focusKey = !accountChanged && !shopChanged && hadFocus ? doc.activeElement?.dataset?.focusKey : null;
    const scrollTop = accountChanged || shopChanged ? 0 : bodyElement?.scrollTop ?? 0;
    const scrollLeft = accountChanged || shopChanged ? 0 : bodyElement?.scrollLeft ?? 0;
    focusTargets.clear();
    const snapshot = shop.state === SHOP_STATE.READY ? shop.snapshot : null;
    const head = el("div", "shop-panel-head");
    const titles = el("div", "shop-panel-titles");
    const title = el("h2", "", snapshot?.displayName ?? "상점");
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

    const capabilityHint = !shop.accountId ? "" : shop.mode === "unavailable"
      ? "상점 준비 상태를 확인하지 못했어요. 새 구매는 잠겨 있어요. 닫았다가 다시 열어 주세요."
      : shop.mode === "checking" || shop.capabilityChecking === true ? "상점 준비 상태를 확인 중이에요. 새 구매는 잠시 기다려 주세요." : "";
    const status = el("p", "shop-hint", hint || capabilityHint);
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.hidden = !hint && !capabilityHint;

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
    } else if (isShowroom()) {
      const selected = snapshot.offers.find(offer => offer.listingId === detailListingId);
      if (selected && furnitureOfferDetails(selected.itemId)) {
        body.append(renderShowroomDetail(selected));
      } else {
        detailListingId = null;
        const tabs = el("nav", "shop-showroom-tabs");
        tabs.setAttribute("aria-label", "가구 종류");
        for (const tab of furnitureShopTabs(snapshot.offers)) {
          const button = el("button", "shop-showroom-tab", `${tab.icon} ${tab.label}`);
          button.type = "button";
          button.dataset.category = tab.id;
          button.dataset.focusKey = `category:${tab.id}`;
          button.setAttribute("aria-pressed", String(category === tab.id));
          focusTargets.set(button.dataset.focusKey, button);
          button.addEventListener("click", () => { category = tab.id; render(); });
          tabs.append(button);
        }
        body.append(tabs);
        const offers = filterFurnitureShopOffers(snapshot.offers, category);
        body.append(el("p", "shop-showroom-count", `가구 ${offers.length}개`));
        const list = el("ul", "shop-offers shop-showroom-grid");
        list.append(...offers.map(renderOffer));
        body.append(list);
      }
    } else {
      const list = el("ul", "shop-offers");
      list.append(...snapshot.offers.map(renderOffer));
      body.append(list);
    }
    // A moved/hidden listing must not erase the safe retry for an uncertain purchase.
    // The client retains its original shop/key; the server either replays or refuses it.
    for (const offer of shop.unresolvedOffers ?? []) {
      if (snapshot?.offers.some(candidate => candidate.listingId === offer.listingId)) continue;
      const box = el("div", "shop-purchased-furniture");
      box.append(el("p", "shop-furniture-note", `${describe(offer.itemId)?.displayName ?? offer.itemId} · 구매 결과를 아직 확인하지 못했어요.`));
      const retry = el("button", "shop-retry", "구매 결과 다시 확인");
      const focusKey = `unresolved:${offer.listingId}`;
      retry.type = "button"; retry.dataset.focusKey = focusKey;
      retry.disabled = purchases.has(offer.listingId) || shop.isPending(offer.listingId);
      focusTargets.set(focusKey, retry);
      retry.addEventListener("click", () => {
        if (open && !retry.disabled && focusTargets.get(focusKey) === retry && panel.contains(retry)) void buy(offer.listingId);
      });
      box.append(retry); body.append(box);
    }
    for (const [listingId, receipt] of receipts) {
      if (receipt.shopId === shop.shopId && !snapshot?.offers.some(offer => offer.listingId === listingId)) {
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
    if (isShowroom() && snapshot && shop.state === SHOP_STATE.READY) {
      if (detailListingId) {
        const selected = snapshot.offers.find(offer => offer.listingId === detailListingId);
        if (selected) void showDetailPreview(selected.itemId);
      } else {
        void populateThumbnails(snapshot.offers);
      }
    }
  }

  function openShop(shopId) {
    if (typeof shop.select !== "function" || !shop.select(shopId)) return false;
    if (open) { render(); if (shop.accountId) void shop.refresh("shop"); return true; }
    return setOpen(true);
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
      detailListingId = null; clearPreview();
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
    if (open && event.code === "Escape") {
      if (isShowroom() && detailListingId) { detailListingId = null; render(); }
      else setOpen(false);
    }
  });

  return {
    get open() { return open; },
    openShop,
    setOpen,
    render,
    status: () => ({ open, hint })
  };
}
