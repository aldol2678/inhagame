// A short authored greeting only; pricing, purchasing and owned-furniture handoff stay in ShopPanel.
export function createDormShopDialogue({ doc = globalThis.document, onOpenChange = () => {} } = {}) {
  const el = (tag, text) => { const node = doc.createElement(tag); if (text) node.textContent = text; return node; };
  const panel = el('section');
  panel.id = 'dorm-shop-dialogue';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'dorm-shop-dialogue-name');
  panel.setAttribute('style', 'position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:105;width:min(420px,calc(100vw - 24px));max-height:60vh;overflow:auto;box-sizing:border-box;padding:16px;border-radius:14px;border:1px solid #d9c399;background:#19332ff5;color:#fff;font:14px/1.6 system-ui,sans-serif;box-shadow:0 12px 34px #0008');
  panel.hidden = true;
  doc.body.append(panel);
  let current = null, opener = null, closeButton = null, browseButton = null;
  let disposed = false;
  function close({ restoreFocus = false } = {}) {
    if (!current) return;
    current = null;
    const focused = doc.activeElement, hadFocus = panel.contains(focused);
    panel.hidden = true;
    panel.replaceChildren();
    onOpenChange(false);
    if (restoreFocus && hadFocus && (!doc.activeElement || doc.activeElement === doc.body || doc.activeElement === focused) &&
        opener?.isConnected !== false && !opener?.disabled && !opener?.closest?.('[hidden], [inert]')) opener?.focus?.({ preventScroll: true });
    opener = null; closeButton = null; browseButton = null;
  }
  function show({ vendor, onBrowse, onClose }) {
    if (disposed || current) return false;
    const token = {};
    current = token; opener = doc.activeElement;
    const title = el('strong', vendor.name); title.id = 'dorm-shop-dialogue-name';
    title.setAttribute('style', 'display:block;font-size:20px');
    const role = el('small', vendor.role), line = el('p', vendor.greeting);
    browseButton = el('button', '가구 둘러보기'); closeButton = el('button', '다음에 올게요');
    for (const button of [browseButton, closeButton]) {
      button.type = 'button';
      button.setAttribute('style', 'display:block;width:100%;min-height:44px;margin-top:8px;padding:8px;border-radius:9px;border:1px solid #d9c399;background:#e5ca9e;color:#19332f;font:700 14px system-ui,sans-serif');
    }
    browseButton.dataset.action = 'browse'; closeButton.dataset.action = 'close';
    browseButton.addEventListener('click', () => { if (current === token) onBrowse(); });
    closeButton.addEventListener('click', () => { if (current === token) onClose(); });
    token.onClose = onClose;
    panel.replaceChildren(title, role, line, browseButton, closeButton);
    panel.hidden = false; onOpenChange(true); browseButton.focus?.({ preventScroll: true });
    return true;
  }
  function keydown(event) {
    if (!current) return;
    if (event.code === 'Escape') { event.preventDefault(); current.onClose(); }
    else if (event.key === 'Tab' || event.code === 'Tab') {
      event.preventDefault();
      const next = doc.activeElement === browseButton ? closeButton : browseButton;
      next?.focus?.({ preventScroll: true });
    }
  }
  const stopPointer = event => event.stopPropagation();
  panel.addEventListener('pointerdown', stopPointer);
  doc.addEventListener('keydown', keydown);
  return { show, close, get open() { return current !== null; },
    destroy() {
      if (disposed) return;
      close(); disposed = true;
      doc.removeEventListener('keydown', keydown);
      panel.removeEventListener('pointerdown', stopPointer);
      panel.remove();
    }
  };
}
