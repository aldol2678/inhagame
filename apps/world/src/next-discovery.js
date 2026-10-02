export const FIRST_CAMPUS_REWARD_ID = "reward.quest.first_campus";
export const NEXT_DISCOVERY_ID = "main2_back_gate_guide";

// Presentation only: both account-scoped status reads must have completed.
// A reward toast is never the authority for the next available activity.
export function selectNextDiscovery({ quest, main2Quest } = {}) {
  if (quest?.enabled !== true || quest.signedIn !== true || quest.ready !== true || quest.stage !== 5 ||
      main2Quest?.enabled !== true || main2Quest.signedIn !== true || main2Quest.ready !== true ||
      main2Quest.available !== true || main2Quest.stage !== 0) return null;
  return Object.freeze({ id: NEXT_DISCOVERY_ID, cta: "길 안내", label: "후문 안내 학생까지 길 안내" });
}

export function createNextDiscovery({
  root,
  primaryButton,
  onPrimary = () => false,
  onProgress = () => {}
} = {}) {
  let current = null;
  function syncProgress(progress) {
    try { onProgress(progress ?? {}); } catch { /* Secondary read-only consumers cannot block the HUD. */ }
    current = selectNextDiscovery(progress ?? {});
    if (root) root.hidden = !current;
    if (primaryButton) {
      primaryButton.disabled = !current;
      primaryButton.textContent = current?.cta ?? "길 안내";
      primaryButton.setAttribute?.("aria-label", current?.label ?? "길 안내");
    }
    return current;
  }
  primaryButton?.addEventListener?.("click", () => {
    if (!current) return;
    // Keep the action after a successful or failed route. Only quest progress
    // removes it, so closing an old popup can no longer lose the next action.
    try { onPrimary(current); } catch { /* Navigation can be retried. */ }
  });
  syncProgress(null);
  return Object.freeze({ syncProgress, status: () => current ? { ...current } : null });
}
