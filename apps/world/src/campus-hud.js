// Compact Campus HUD menu controller.
// Keeps low-frequency actions out of the play surface while preserving existing button contracts.

export function createCampusHudMenu({
  toggle,
  panel,
  onOpen = () => {},
  onClose = () => {},
  doc = document
} = {}) {
  if (!toggle || !panel) throw new Error("Campus HUD menu requires toggle and panel");

  let open = false;

  function setOpen(next, { focus = true } = {}) {
    open = Boolean(next);
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
    toggle.textContent = open ? "×" : "☰";
    if (open) onOpen();
    else {
      onClose();
      if (focus) toggle.focus?.();
    }
    return open;
  }

  toggle.addEventListener("click", () => setOpen(!open, { focus: false }));
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  panel.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button");
    if (!button) return;
    if (["open-profile", "open-shop", "open-inventory", "open-wardrobe", "open-friends", "toggle-first-person", "open-keyboard-help", "open-settings"].includes(button.id)) {
      setOpen(false, { focus: false });
    }
  });
  doc.addEventListener("pointerdown", (event) => {
    if (!open) return;
    if (panel.contains?.(event.target) || toggle.contains?.(event.target)) return;
    setOpen(false, { focus: false });
  });
  doc.addEventListener("keydown", (event) => {
    if (open && event.code === "Escape") setOpen(false);
  });

  setOpen(false, { focus: false });

  return {
    get open() { return open; },
    setOpen
  };
}

export function menuReturnFocus(element, fallback) {
  if (!element || !fallback) return fallback ?? element ?? null;
  return element.closest?.("[hidden]") ? fallback : element;
}
