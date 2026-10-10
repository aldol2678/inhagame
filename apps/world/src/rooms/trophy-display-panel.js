import { TROPHY_DISPLAY_NOTICE, TROPHY_VISITOR_NOTICE } from "./trophy-display.js";

export function createTrophyDisplayPanel({ display, onOpenChange = () => {}, doc = document }) {
  const panel = doc.createElement("section");
  panel.id = "trophy-display-panel"; panel.className = "furniture-editor trophy-display-panel"; panel.hidden = true;
  panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-label", "기념품 임시 전시");
  const backdrop = doc.createElement("div"); backdrop.className = "furniture-editor-backdrop"; backdrop.hidden = true;
  doc.body.append(panel, backdrop);
  let objectId = null, scope = null, opener = null, buttons = [];
  const keyOf = state => `${state.roomId}:${state.accountId}:${state.role}`;
  const node = (tag, text) => { const element = doc.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
  const button = (label, key, action, disabled = false) => {
    const element = node("button", label); element.type = "button"; element.dataset.focus = key; element.disabled = disabled;
    element.addEventListener("click", () => { if (!element.disabled) action(); }); buttons.push(element); return element;
  };
  function close({ restoreFocus = true } = {}) {
    if (panel.hidden) return false;
    const hadFocus = panel.contains(doc.activeElement);
    panel.hidden = true; backdrop.hidden = true; panel.replaceChildren(); objectId = null; scope = null; buttons = [];
    onOpenChange(false);
    if (restoreFocus && hadFocus && opener?.isConnected !== false && !opener?.disabled && !opener?.closest?.("[hidden], [inert]")) opener?.focus?.({ preventScroll: true });
    opener = null; return true;
  }
  function render(state = display.state()) {
    if (panel.hidden) return;
    if (state.editing || state.roomId === null || scope !== keyOf(state) || !state.shelves.some(item => item.id === objectId)) {
      close({ restoreFocus: false }); return;
    }
    const focusKey = panel.contains(doc.activeElement) ? doc.activeElement?.dataset?.focus : null;
    buttons = [];
    const header = node("header"); header.append(node("h2", state.role === "visitor" ? "기념품 전시" : "내 기념품 임시 전시"), button("닫기", "close", () => close()));
    panel.replaceChildren(header); panel.dataset.state = state.status;
    if (state.status === "VISITOR") panel.append(node("p", TROPHY_VISITOR_NOTICE));
    else {
      panel.append(node("p", TROPHY_DISPLAY_NOTICE));
      if (state.status === "LOADING") panel.append(node("p", "현재 보유 기념품을 확인하는 중…"));
      else if (state.status !== "READY") {
        panel.append(node("p", "현재 보유 기념품을 확인하지 못했어요."), button("다시 확인", "retry", () => void display.refresh()));
      } else {
        panel.append(node("p", "현재 인벤토리에 있는 배지와 기념품만 선택할 수 있어요."));
        if (!state.items.length) panel.append(node("p", "지금 보유한 전시용 배지나 기념품이 없어요."));
        const current = state.selections.find(row => row.objectId === objectId)?.itemId ?? null;
        const choices = node("div"); choices.className = "trophy-display-choices";
        for (const item of state.items) {
          const select = button(`${item.name} · 보유 ${item.quantity}`, item.itemId, () => display.select(objectId, item.itemId));
          select.setAttribute("aria-pressed", String(current === item.itemId)); choices.append(select);
        }
        choices.append(button("선반 비우기", "clear", () => display.select(objectId, null), current === null));
        panel.append(choices, button("보유 목록 새로 확인", "refresh", () => void display.refresh()));
        const name = state.items.find(item => item.itemId === current)?.name;
        const selected = node("p", name ? `임시 전시 중: ${name}` : "선반이 비어 있어요.");
        selected.setAttribute("role", "status"); panel.append(selected);
      }
    }
    if (focusKey) (buttons.find(item => item.dataset.focus === focusKey && !item.disabled) ?? buttons[0])?.focus?.({ preventScroll: true });
  }
  function open(target) {
    const state = display.state();
    if (state.editing || !["owner", "visitor"].includes(state.role) || !state.shelves.some(item => item.id === target?.id)) return false;
    if (!panel.hidden) return false;
    objectId = target.id; scope = keyOf(state); opener = doc.activeElement;
    panel.hidden = false; backdrop.hidden = false; onOpenChange(true); render(); buttons[0]?.focus?.();
    if (state.role === "owner") void display.refresh();
    return true;
  }
  panel.addEventListener("pointerdown", event => event.stopPropagation());
  backdrop.addEventListener("pointerdown", event => event.stopPropagation());
  backdrop.addEventListener("click", () => close());
  doc.addEventListener("keydown", event => {
    if (panel.hidden) return;
    if (event.code === "Escape") { event.preventDefault(); close(); }
    if (event.code === "Tab") {
      const focusable = buttons.filter(button => !button.disabled);
      const index = focusable.indexOf(doc.activeElement);
      if (event.shiftKey ? index <= 0 : index < 0 || index === focusable.length - 1) {
        event.preventDefault(); (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus?.();
      }
    }
  });
  return { open, close, update: render,
    observeFocus(snapshot) {
      if (!panel.hidden && snapshot?.topOwners?.some(owner => owner !== "room-trophy-display")) close({ restoreFocus: false });
    },
    get isOpen() { return !panel.hidden; }
  };
}
