export function createKeyboardShortcutsPanel({
  open,
  close,
  panel,
  fallbackFocus = null,
  onOpen = () => {},
  onClose = () => {},
  doc = document
} = {}) {
  if (!open || !close || !panel) throw new Error("Keyboard shortcuts panel requires open, close and panel");

  let isOpen = false;

  function setOpen(next) {
    isOpen = Boolean(next);
    panel.hidden = !isOpen;
    open.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) {
      onOpen();
      close.focus?.();
    } else {
      onClose();
      const target = open.closest?.("[hidden]") ? fallbackFocus : open;
      target?.focus?.();
    }
    return isOpen;
  }

  open.addEventListener("click", () => setOpen(true));
  close.addEventListener("click", () => setOpen(false));
  panel.addEventListener("pointerdown", event => event.stopPropagation());
  doc.addEventListener("keydown", event => {
    if (isOpen && event.code === "Escape") {
      event.preventDefault?.();
      setOpen(false);
    }
  });

  return {
    get open() { return isOpen; },
    setOpen
  };
}
