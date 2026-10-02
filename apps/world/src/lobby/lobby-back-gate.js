import { DEFAULT_SPAWN_DEFINITIONS, SPAWN_ID, canStartSpawn, spawnLockSummary } from "./spawn-registry.js";

export const BACK_GATE_LOCK = spawnLockSummary(DEFAULT_SPAWN_DEFINITIONS[SPAWN_ID.BACK_GATE]);

export function bindLockedBackGate({
  button,
  dialog,
  closeButton,
  confirmButton,
  documentLike = globalThis.document,
  definition = BACK_GATE_LOCK,
  getDefinition = null,
  onStart = null
} = {}) {
  let open = false;
  let previousFocus = null;
  let currentDefinition = null;

  const normalize = (value) => Object.freeze({
    spawnId: value?.spawnId ?? definition.spawnId,
    state: value?.state ?? definition.state,
    unlockType: value?.unlockType ?? definition.unlockType,
    unlockQuestId: value?.unlockQuestId ?? value?.unlockCondition?.questId ?? definition.unlockQuestId ?? null,
    title: value?.title ?? value?.name ?? definition.title ?? "후문",
    spawnAnchor: value?.spawnAnchor ?? definition.spawnAnchor ?? null
  });

  const resolveDefinition = () => {
    try { currentDefinition = normalize(getDefinition?.() ?? definition); }
    catch { currentDefinition = normalize(definition); }
    return currentDefinition;
  };

  const setOpen = (next) => {
    if (!dialog || !button) return false;
    open = next === true;
    dialog.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) {
      previousFocus = documentLike?.activeElement ?? button;
      const focusTarget = closeButton ?? confirmButton;
      focusTarget?.focus?.();
    } else {
      previousFocus?.focus?.();
      previousFocus = null;
    }
    return true;
  };

  const refresh = () => {
    const resolved = resolveDefinition();
    const startable = canStartSpawn(resolved);
    if (button) {
      if (button.dataset) button.dataset.spawnState = resolved.state;
      button.classList?.toggle?.("is-unlocked", startable);
      button.setAttribute?.("aria-haspopup", startable ? "false" : "dialog");
      const icon = button.querySelector?.(".world-lobby-lock-icon");
      const detail = button.querySelector?.("small");
      if (icon) icon.textContent = startable ? "📍" : "🔒";
      if (detail) detail.textContent = startable ? "첫 캠퍼스 탐방 완료 · 여기서 시작" : "첫 캠퍼스 탐방 완료 후 개방";
    }
    if (startable && open) setOpen(false);
    return resolved;
  };

  const onOpen = () => {
    const resolved = refresh();
    if (canStartSpawn(resolved)) {
      setOpen(false);
      return onStart?.(resolved) === true;
    }
    return setOpen(true);
  };
  const onClose = () => setOpen(false);
  const onKey = (event) => {
    if (!open || event.key !== "Escape") return;
    event.preventDefault?.();
    setOpen(false);
  };

  button?.addEventListener?.("click", onOpen);
  closeButton?.addEventListener?.("click", onClose);
  confirmButton?.addEventListener?.("click", onClose);
  documentLike?.addEventListener?.("keydown", onKey);
  refresh();

  return {
    get definition() { return currentDefinition ?? resolveDefinition(); },
    get open() { return open; },
    openDialog: onOpen,
    closeDialog: onClose,
    refresh,
    canStart: () => canStartSpawn(refresh()),
    destroy() {
      button?.removeEventListener?.("click", onOpen);
      closeButton?.removeEventListener?.("click", onClose);
      confirmButton?.removeEventListener?.("click", onClose);
      documentLike?.removeEventListener?.("keydown", onKey);
    }
  };
}
