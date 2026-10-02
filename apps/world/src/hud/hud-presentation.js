// Presentation-only bridge for the shared HUD context.
// It writes state tokens onto the existing root element and never owns input, DOM visibility,
// gameplay state, or overlay lifetime. Existing HUD modules remain the presentation authorities.

function token(value, fallback = "NONE") {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

export function applyHudPresentation(root, state = {}) {
  if (!root?.dataset) throw new TypeError("HUD presentation root with dataset is required");

  root.dataset.hudMode = token(state.mode, "EXPLORE");
  root.dataset.hudLifeMode = token(state.lifeMode);
  root.dataset.hudPetContext = token(state.petContext);
  root.dataset.hudOverlay = token(state.overlay);
  root.dataset.hudInputFocus = token(state.inputFocusClass, "GAMEPLAY");
  return root.dataset;
}

export function bindHudPresentation({
  context,
  root = globalThis.document?.body
} = {}) {
  if (!context?.subscribe || !context?.snapshot) {
    throw new TypeError("HUD presentation requires a HUD context");
  }
  if (!root?.dataset) throw new TypeError("HUD presentation requires a root element");

  const unsubscribe = context.subscribe(state => applyHudPresentation(root, state), { emitCurrent: true });

  return Object.freeze({
    sync() {
      applyHudPresentation(root, context.snapshot());
      return true;
    },
    destroy() {
      unsubscribe?.();
      return true;
    }
  });
}
