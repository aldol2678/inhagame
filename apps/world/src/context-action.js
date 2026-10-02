// Contextual action slot for the Campus mobile/desktop HUD.
// Providers publish candidate actions; the controller chooses one deterministic primary action.
// The World runs two independent slots: interaction (F) and transport (M). A slot `shortcut`
// names the key that triggers it, so every action in the slot shows that key.

export function selectContextAction(actions = []) {
  return actions
    .filter(Boolean)
    .filter(action => action.visible !== false)
    .slice()
    .sort((a, b) => {
      const priority = (Number(b.priority) || 0) - (Number(a.priority) || 0);
      if (priority) return priority;
      const ad = Number.isFinite(a.distance) ? a.distance : Number.POSITIVE_INFINITY;
      const bd = Number.isFinite(b.distance) ? b.distance : Number.POSITIVE_INFINITY;
      if (ad !== bd) return ad - bd;
      return String(a.id ?? '').localeCompare(String(b.id ?? ''));
    })[0] ?? null;
}

export function createContextActionController({
  button,
  shortcut: slotShortcut = null,
  coarsePointer = globalThis.matchMedia?.('(pointer: coarse)')?.matches ?? false,
  onTriggered = null
} = {}) {
  if (!button) throw new Error('Context action button is required');

  const candidates = new Map();
  let active = null;
  let suspended = false;

  function render() {
    if (suspended) {
      active = null;
      button.hidden = true;
      return null;
    }

    active = selectContextAction([...candidates.values()]);
    button.hidden = !active;
    if (!active) {
      button.textContent = '';
      button.removeAttribute('data-shortcut');
      button.removeAttribute('aria-keyshortcuts');
      button.removeAttribute('aria-pressed');
      button.disabled = false;
      return null;
    }

    const icon = active.icon ? `${active.icon} ` : '';
    const shortcut = slotShortcut ?? active.shortcut;
    // Touch HUD space is tight: an action may offer a short label; assistive tech keeps the full one.
    const label = coarsePointer && active.compactLabel ? active.compactLabel : active.label;
    button.textContent = `${icon}${label}`;
    button.disabled = active.disabled === true;
    button.setAttribute('aria-label', coarsePointer || !shortcut
      ? active.label
      : `${shortcut} · ${active.label}`);

    if (shortcut) {
      button.setAttribute('aria-keyshortcuts', shortcut);
      if (coarsePointer) button.removeAttribute('data-shortcut');
      else button.dataset.shortcut = shortcut;
    } else {
      button.removeAttribute('data-shortcut');
      button.removeAttribute('aria-keyshortcuts');
    }

    if (typeof active.pressed === 'boolean') button.setAttribute('aria-pressed', String(active.pressed));
    else button.removeAttribute('aria-pressed');
    return active;
  }

  function trigger() {
    if (!active || active.disabled === true) return false;
    const result = active.trigger?.();
    if (result === false) return false;
    try { onTriggered?.(active, result); } catch { /* Observers never break the shared action slot. */ }
    return true;
  }

  button.addEventListener('click', trigger);
  button.addEventListener('pointerdown', event => event.stopPropagation());

  return {
    set(id, action) {
      if (!action) candidates.delete(id);
      else candidates.set(id, { ...action, id: action.id ?? id });
    },
    clear(id) { candidates.delete(id); },
    clearAll() { candidates.clear(); },
    setSuspended(value) { suspended = Boolean(value); },
    refresh: render,
    trigger,
    get active() { return active; },
    get suspended() { return suspended; },
    get shortcut() { return slotShortcut; }
  };
}
