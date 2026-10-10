import { CARP_RECIPE, COOKING_ERRORS } from "./cooking-client.js";

// DOM-only consumer. No player-facing entry point exists unless the caller explicitly enables it.
export function createCookingPanel({ client, onOpenChange = () => {}, doc = document }) {
  const panel = doc.createElement("section"); panel.id = "cooking-panel"; panel.className = "furniture-editor";
  panel.hidden = true; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "내 방 요리"); doc.body.append(panel);
  const backdrop = doc.createElement("div"); backdrop.className = "furniture-editor-backdrop"; backdrop.hidden = true; doc.body.append(backdrop);
  let previousFocus = null, scope = null, signature = "";
  const scopeOf = () => `${client.state().accountId ?? ""}:${client.state().roomId ?? ""}`;
  const node = (tag, text) => { const el = doc.createElement(tag); el.textContent = text; return el; };
  const button = (label, action, disabled = false) => {
    const el = node("button", label); el.type = "button"; el.disabled = disabled;
    el.addEventListener("click", action); return el;
  };
  function close({ restoreFocus = true } = {}) {
    if (panel.hidden) return true;
    panel.hidden = true; backdrop.hidden = true; onOpenChange(false); if (restoreFocus) previousFocus?.focus?.({ preventScroll: true }); previousFocus = null; scope = null; signature = ""; return true;
  }
  function render() {
    if (panel.hidden) return;
    if (!client.available() || scope !== scopeOf()) { close({ restoreFocus: false }); return; }
    const state = client.state(), next = JSON.stringify(state);
    if (next === signature) return;
    signature = next;
    const focused = panel.contains(doc.activeElement) ? doc.activeElement?.textContent : null;
    panel.replaceChildren();
    const header = node("header", ""); header.append(node("h2", "내 방 요리"), button("닫기", close)); panel.append(header);
    panel.append(node("p", "붕어 1개 → 인경호 붕어구이 1개"));
    panel.append(node("p", "음식 사용은 서버 전투 준비 기능이 연결된 뒤 열려요. 지금은 먹거나 전투 효과를 받을 수 없어요."));
    const inventoryUnconfirmed = !!state.receipt && state.inventoryStatus !== "READY";
    const status = node("p", state.receipt
      ? state.inventoryStatus === "READY" ? "붕어구이 1개를 만들었어요. 최신 보유 수량을 확인했어요."
        : state.inventoryReading ? "붕어구이 1개를 만들었어요. 최신 보유 수량을 확인 중이에요."
          : "붕어구이 1개를 만들었어요. 최신 보유 수량을 확인하지 못했어요. 보유 수량만 다시 확인해 주세요."
      : state.pending ? "요리 결과를 확인 중이에요." : state.error ? COOKING_ERRORS[state.error] : "조리하면 붕어 1개가 소모돼요.");
    status.setAttribute("role", "status"); panel.append(status);
    if (inventoryUnconfirmed) panel.append(button("보유 수량만 다시 확인", () => void client.retryInventory(), state.pending || state.inventoryReading));
    panel.append(button(state.retryId ? "같은 요청 다시 확인" : "붕어구이 만들기", () => void client.cook(CARP_RECIPE.recipeId),
      state.pending || state.inventoryReading || inventoryUnconfirmed));
    const buttons = [...panel.querySelectorAll("button")];
    (buttons.find(el => el.textContent === focused && !el.disabled) ?? buttons[0])?.focus?.();
  }
  panel.addEventListener("pointerdown", event => event.stopPropagation());
  backdrop.addEventListener("pointerdown", event => event.stopPropagation());
  backdrop.addEventListener("click", () => close());
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === "Tab") {
      const buttons = [...panel.querySelectorAll("button")].filter(el => !el.disabled);
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  return {
    get open() { return !panel.hidden; },
    openPanel() {
      client.sync(); if (!client.available() || !panel.hidden) return false;
      signature = ""; scope = scopeOf(); previousFocus = doc.activeElement; panel.hidden = false; backdrop.hidden = false; onOpenChange(true); render(); return true;
    },
    update() { client.sync(); render(); }, close
  };
}
