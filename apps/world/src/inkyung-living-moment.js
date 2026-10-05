export const INKYUNG_LIVING_ZONE_ID = "AREA_INKYUNG_STUDENT_CENTER";
export const INKYUNG_LIVING_MOMENT_STORAGE_KEY = "inhagame-inkyung-living-moment-v1";
export const INKYUNG_LIVING_AUTO_COLLAPSE_MS = 4200;

const COMPLETING_ACTION_IDS = new Set([
  "seat",
  "npc-talk",
  "inkyung-ordinary-duck",
  "inkyung-mechanical-duck",
  "student-center-shop"
]);

const baseSuggestions = Object.freeze([
  Object.freeze({ id: "duck", text: "🦆 오리 살펴보기" }),
  Object.freeze({ id: "seat", text: "🪑 벤치에 앉기" })
]);

const npcSuggestion = Object.freeze({ id: "npc", text: "💬 NPC와 대화" });

export function createInkyungLivingMoment({
  root,
  actionsElement,
  storage = undefined,
  storageKey = INKYUNG_LIVING_MOMENT_STORAGE_KEY,
  autoCollapseMs = INKYUNG_LIVING_AUTO_COLLAPSE_MS,
  setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
  clearTimeoutFn = globalThis.clearTimeout?.bind(globalThis)
} = {}) {
  if (storage === undefined) {
    try { storage = globalThis.localStorage ?? null; } catch { storage = null; }
  }

  const toggleElement = root?.querySelector?.("#inkyung-living-toggle") ?? null;
  const countElement = root?.querySelector?.("#inkyung-living-count") ?? null;

  let placeZoneId = null;
  let suppressed = false;
  let npcAvailable = false;
  let completed = false;
  let collapsed = false;
  let collapseTimer = null;

  try { completed = storage?.getItem?.(storageKey) === "done"; } catch { completed = false; }

  function suggestions() {
    return npcAvailable ? [...baseSuggestions, npcSuggestion] : [...baseSuggestions];
  }

  function visible() {
    return !completed && !suppressed && placeZoneId === INKYUNG_LIVING_ZONE_ID;
  }

  function clearCollapseTimer() {
    if (collapseTimer == null) return;
    clearTimeoutFn?.(collapseTimer);
    collapseTimer = null;
  }

  function scheduleCollapse() {
    clearCollapseTimer();
    if (!visible() || collapsed || !(autoCollapseMs > 0) || typeof setTimeoutFn !== "function") return;
    collapseTimer = setTimeoutFn(() => {
      collapseTimer = null;
      if (!visible()) return;
      collapsed = true;
      render();
    }, autoCollapseMs);
  }

  function render() {
    const show = visible();
    const count = suggestions().length;
    if (root) {
      root.hidden = !show;
      root.dataset.state = completed ? "COMPLETE" : show ? "ACTIVE" : "IDLE";
      root.dataset.mode = collapsed ? "COLLAPSED" : "EXPANDED";
    }
    if (actionsElement) actionsElement.textContent = suggestions().map(item => item.text).join(" · ");
    if (countElement) countElement.textContent = String(count);
    if (toggleElement) toggleElement.setAttribute?.("aria-expanded", collapsed ? "false" : "true");
    return show;
  }

  function saveComplete() {
    try { storage?.setItem?.(storageKey, "done"); } catch { /* UI affordance remains session-only. */ }
  }

  function expand() {
    if (!visible()) return false;
    collapsed = false;
    render();
    scheduleCollapse();
    return true;
  }

  toggleElement?.addEventListener?.("click", () => {
    if (collapsed) expand();
  });

  render();

  return {
    setZone(nextPlaceZoneId) {
      const previousZoneId = placeZoneId;
      placeZoneId = nextPlaceZoneId ?? null;
      if (placeZoneId !== INKYUNG_LIVING_ZONE_ID) {
        collapsed = false;
        clearCollapseTimer();
        return render();
      }
      if (previousZoneId !== INKYUNG_LIVING_ZONE_ID) collapsed = false;
      const show = render();
      scheduleCollapse();
      return show;
    },
    setSuppressed(value) {
      const next = Boolean(value);
      if (next === suppressed) return visible();
      suppressed = next;
      if (suppressed) clearCollapseTimer();
      const show = render();
      if (show && !collapsed) scheduleCollapse();
      return show;
    },
    setNpcAvailable(value) {
      const next = Boolean(value);
      if (next === npcAvailable) return visible();
      npcAvailable = next;
      return render();
    },
    expand,
    collapse() {
      if (!visible()) return false;
      collapsed = true;
      clearCollapseTimer();
      render();
      return true;
    },
    recordAction(actionId) {
      if (completed || placeZoneId !== INKYUNG_LIVING_ZONE_ID || !COMPLETING_ACTION_IDS.has(actionId)) return false;
      completed = true;
      clearCollapseTimer();
      saveComplete();
      render();
      return true;
    },
    reset() {
      completed = false;
      collapsed = false;
      clearCollapseTimer();
      try { storage?.removeItem?.(storageKey); } catch { /* Ignore unavailable storage. */ }
      const show = render();
      if (show) scheduleCollapse();
      return show;
    },
    status() {
      return Object.freeze({
        placeZoneId,
        suppressed,
        npcAvailable,
        completed,
        collapsed,
        visible: visible(),
        suggestions: suggestions().map(item => item.id)
      });
    }
  };
}
