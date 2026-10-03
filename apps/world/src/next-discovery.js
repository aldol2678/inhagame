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
  onRetry = () => false,
  onProgress = () => {}
} = {}) {
  let current = null;
  let canRetry = false;
  function syncProgress(progress) {
    try { onProgress(progress ?? {}); } catch { /* Secondary read-only consumers cannot block the HUD. */ }
    current = selectNextDiscovery(progress ?? {});
    const { quest, main2Quest } = progress ?? {};
    canRetry = quest?.enabled === true && quest.signedIn === true && quest.ready === true && quest.stage === 5 &&
      main2Quest?.enabled === true && main2Quest.signedIn === true && main2Quest.statusState === 'UNAVAILABLE';
    if (root) root.hidden = !current && !canRetry;
    if (primaryButton) {
      primaryButton.disabled = !current && !canRetry;
      primaryButton.textContent = canRetry ? "다시 시도" : current?.cta ?? "길 안내";
      primaryButton.setAttribute?.("aria-label", canRetry ? "Main 2 퀘스트 다시 불러오기" : current?.label ?? "길 안내");
    }
    return current;
  }
  primaryButton?.addEventListener?.("click", () => {
    if (canRetry) {
      try { Promise.resolve(onRetry()).catch(() => {}); } catch { /* The recovery action stays retryable. */ }
      return;
    }
    if (!current) return;
    // Keep the action after a successful or failed route. Only quest progress
    // removes it, so closing an old popup can no longer lose the next action.
    try { onPrimary(current); } catch { /* Navigation can be retried. */ }
  });
  syncProgress(null);
  return Object.freeze({ syncProgress, status: () => current ? { ...current } : null });
}
