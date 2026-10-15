// Presentation only: the transition owns cancellation, readiness and scene changes.
// The door is a UI illustration, not an animation of a world-space door.
let nextOverlayId = 0;

export function createRoomLoadingOverlay({ document: doc = globalThis.document, root = doc?.body } = {}) {
  if (!doc?.createElement || !root?.append) throw new TypeError('Room loading overlay needs a document and root');
  const id = `room-loading-${++nextOverlayId}`;
  const make = (tag, className, text) => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const overlay = make('div', 'room-loading-overlay');
  overlay.hidden = true;
  const panel = make('section', 'room-loading-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', `${id}-title`);
  panel.setAttribute('aria-describedby', `${id}-stage`);
  panel.tabIndex = -1;
  const door = make('div', 'room-loading-door');
  door.setAttribute('aria-hidden', 'true');
  door.append(make('div', 'room-loading-door-leaf'));
  const title = make('h2', 'room-loading-title', '방으로 들어가는 중');
  title.id = `${id}-title`;
  const status = make('p', 'room-loading-stage', '방 준비 중');
  status.id = `${id}-stage`;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  const hint = make('p', 'room-loading-hint', '준비가 끝나면 방이 보여요.');
  const cancel = make('button', 'room-loading-cancel', '취소');
  cancel.type = 'button';
  panel.append(door, title, status, hint, cancel);
  overlay.append(panel);
  root.append(overlay);

  let visible = false;
  let destroyed = false;
  let previousFocus = null;
  let onCancel = null;
  let cancellationRequested = false;
  let siblings = [];
  const focusTarget = () => cancel.disabled ? panel : cancel;
  const containInput = event => { if (visible) event.stopPropagation(); };
  function requestCancel() {
    if (!visible || cancellationRequested || !onCancel) return;
    cancellationRequested = true;
    cancel.disabled = true;
    // Do not hide optimistically; the caller must finish restoring the entrance.
    status.textContent = '이전 화면으로 돌아가는 중';
    panel.focus();
    onCancel();
  }
  function keydown(event) {
    if (!visible) return;
    event.stopImmediatePropagation?.();
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      requestCancel();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      focusTarget().focus();
    }
  }
  function keepFocus(event) {
    if (visible && !panel.contains(event.target)) focusTarget().focus();
  }
  cancel.addEventListener('click', requestCancel);
  for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'touchstart', 'touchmove']) {
    overlay.addEventListener(type, containInput);
  }
  function hide({ restoreFocus = true } = {}) {
    if (!visible) return;
    visible = false;
    overlay.hidden = true;
    doc.removeEventListener('keydown', keydown, true);
    doc.removeEventListener('keyup', containInput, true);
    doc.removeEventListener('focusin', keepFocus, true);
    for (const [node, wasInert] of siblings) node.inert = wasInert;
    siblings = [];
    onCancel = null;
    const target = previousFocus;
    previousFocus = null;
    if (restoreFocus && target?.isConnected !== false) target?.focus?.({ preventScroll: true });
  }
  return {
    show({ onCancel: callback } = {}) {
      if (destroyed || visible) return false;
      previousFocus = doc.activeElement;
      onCancel = typeof callback === 'function' ? callback : null;
      cancellationRequested = false;
      cancel.disabled = !onCancel;
      status.textContent = '방 준비 중';
      siblings = Array.from(root.children).filter(node => node !== overlay).map(node => [node, Boolean(node.inert)]);
      for (const [node] of siblings) node.inert = true;
      visible = true;
      overlay.hidden = false;
      doc.addEventListener('keydown', keydown, true);
      doc.addEventListener('keyup', containInput, true);
      doc.addEventListener('focusin', keepFocus, true);
      focusTarget().focus({ preventScroll: true });
      return true;
    },
    stage(text) {
      if (!visible || cancellationRequested || typeof text !== 'string' || !text.trim()) return false;
      status.textContent = text;
      return true;
    },
    hide,
    isVisible: () => visible,
    destroy() {
      hide();
      destroyed = true;
      overlay.remove();
    }
  };
}
