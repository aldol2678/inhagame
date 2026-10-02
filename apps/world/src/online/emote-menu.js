// Compact emote menu: one toggle button plus a five-button row. DOM only; no engine, no network.
// Keyboard: E toggles, 1–5 play while open, Esc closes. Outside pointer closes.
// Typing in form fields never triggers shortcuts.

import { EMOTE_IDS, EMOTES } from "./emotes.js";

const STATUS_TEXT = Object.freeze({
  busy: "멈춘 상태에서 감정표현을 할 수 있어요.",
  cooldown: "잠시 후 다시 눌러 주세요.",
  started: ""
});

const isTyping = (target) =>
  !!target?.closest?.("input, textarea, select, [contenteditable]");

export function createEmoteMenu({ toggle, menu, status = null, onSelect, shouldIgnoreShortcut = () => false, doc = document, win = window }) {
  const buttons = new Map();
  for (const id of EMOTE_IDS) {
    const def = EMOTES[id];
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "emote-option";
    button.dataset.emote = id;
    button.setAttribute("aria-label", `${def.label} (${EMOTE_IDS.indexOf(id) + 1})`);
    button.setAttribute("role", "menuitem");
    const icon = doc.createElement("span");
    icon.className = "emote-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = def.emoji;
    const label = doc.createElement("span");
    label.className = "emote-label";
    label.textContent = def.label;
    button.append(icon, label);
    button.addEventListener("click", () => select(id));
    menu.append(button);
    buttons.set(id, button);
  }

  let open = false;
  function setOpen(next) {
    open = next;
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (!open && status) status.textContent = "";
  }
  setOpen(false);

  function flash(id, result) {
    const button = buttons.get(id);
    if (status) status.textContent = STATUS_TEXT[result] ?? "";
    if (!button || result === "started") return;
    button.classList.add("emote-blocked");
    win.setTimeout?.(() => button.classList.remove("emote-blocked"), 400);
  }

  function select(id) {
    const result = onSelect(id);
    flash(id, result);
    if (result === "started") setOpen(false);
    return result;
  }

  toggle.addEventListener("click", () => setOpen(!open));
  // Keep taps on the menu from reaching the canvas camera or other handlers.
  for (const element of [toggle, menu]) {
    element.addEventListener("pointerdown", (event) => event.stopPropagation());
  }
  doc.addEventListener("pointerdown", (event) => {
    if (!open) return;
    if (menu.contains?.(event.target) || toggle.contains?.(event.target)) return;
    setOpen(false);
  });
  doc.addEventListener("keydown", (event) => {
    if (event.repeat || isTyping(event.target)) return;
    if (event.code === "KeyE") {
      if (shouldIgnoreShortcut()) { setOpen(false); return; }
      setOpen(!open);
      return;
    }
    if (!open) return;
    if (event.code === "Escape") { setOpen(false); toggle.focus?.(); return; }
    const id = EMOTE_IDS.find((emote) => EMOTES[emote].key === event.code);
    if (id) { event.preventDefault?.(); select(id); }
  });

  return {
    get open() { return open; },
    buttons,
    setOpen,
    select,
    setAvailable(available) {
      toggle.hidden = !available;
      if (!available) setOpen(false);
    }
  };
}
