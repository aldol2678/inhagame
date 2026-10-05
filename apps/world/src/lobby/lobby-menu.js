export function createLobbyMenu({
  toggle,
  panel,
  profileButton,
  settingsButton,
  existingProfileButton = null,
  existingSettingsButton = null,
  doc = globalThis.document
} = {}) {
  if (!toggle || !panel) throw new Error("Main Lobby menu requires toggle and panel");

  let open = false;

  const setOpen = (next, { focus = true } = {}) => {
    open = Boolean(next);
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
    toggle.textContent = open ? "×" : "☰";
    if (!open && focus) toggle.focus?.();
    return open;
  };

  const openProfile = () => {
    setOpen(false, { focus: false });
    existingProfileButton?.click?.();
  };
  const openSettings = () => {
    setOpen(false, { focus: false });
    existingSettingsButton?.click?.();
  };

  toggle.addEventListener("click", () => setOpen(!open, { focus: false }));
  profileButton?.addEventListener("click", openProfile);
  settingsButton?.addEventListener("click", openSettings);
  panel.addEventListener("pointerdown", event => event.stopPropagation());
  doc?.addEventListener?.("pointerdown", event => {
    if (!open) return;
    if (panel.contains?.(event.target) || toggle.contains?.(event.target)) return;
    setOpen(false, { focus: false });
  });
  doc?.addEventListener?.("keydown", event => {
    if (open && event.code === "Escape") setOpen(false);
  });

  setOpen(false, { focus: false });

  return {
    get open() { return open; },
    setOpen,
    destroy() {
      profileButton?.removeEventListener?.("click", openProfile);
      settingsButton?.removeEventListener?.("click", openSettings);
    }
  };
}
