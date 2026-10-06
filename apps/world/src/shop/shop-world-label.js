// Floating world-space marker for the Student Center shop entry. Discovery only: the interaction
// slot action (F / #context-action) stays the only way to open the shop.

export const SHOP_MARKER_MAX_DISTANCE = 26;

// Discovery copy must yield to the tracked objective and the screens the player is using.
const SHOP_MARKER_OBSTRUCTIONS = '#quest-hud, #minimap, [aria-modal="true"], #hud-menu, #view-settings, .main2-guide-dialogue';
const SHOP_MARKER_CLEARANCE = 8;

export function shopMarkerCopy({ nearby = false, available = false, coarsePointer = false } = {}) {
  if (!available) return Object.freeze({ icon: "🔒", title: "학생회관 상점", hint: "로그인 후 이용" });
  if (nearby) return Object.freeze({ icon: "🛍", title: "학생회관 상점", hint: coarsePointer ? "버튼으로 상점 열기" : "F · 상점 열기" });
  return Object.freeze({ icon: "🛍", title: "학생회관 상점", hint: "굿즈를 둘러보세요" });
}

export function createShopWorldLabel({
  element,
  camera,
  canvas,
  getWorldPosition,
  maxDistance = SHOP_MARKER_MAX_DISTANCE,
  coarsePointer = globalThis.matchMedia?.("(pointer: coarse)")?.matches ?? false
} = {}) {
  if (!element || !camera?.camera || !canvas || typeof getWorldPosition !== "function") {
    throw new Error("Shop world label dependencies required");
  }
  const icon = element.querySelector?.("[data-shop-marker-icon]");
  const title = element.querySelector?.("[data-shop-marker-title]");
  const hint = element.querySelector?.("[data-shop-marker-hint]");

  function overlapsCriticalUi() {
    const document = element.ownerDocument;
    const obstructions = document?.querySelectorAll?.(SHOP_MARKER_OBSTRUCTIONS) ?? [];
    if (!obstructions.length) return false;
    const marker = element.getBoundingClientRect();
    return [...obstructions].some(obstruction => {
      if (obstruction.hidden) return false;
      const rect = obstruction.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = document.defaultView?.getComputedStyle(obstruction);
      if (style?.display === "none" || style?.visibility === "hidden" || style?.opacity === "0") return false;
      return marker.left < rect.right + SHOP_MARKER_CLEARANCE &&
        marker.right > rect.left - SHOP_MARKER_CLEARANCE &&
        marker.top < rect.bottom + SHOP_MARKER_CLEARANCE &&
        marker.bottom > rect.top - SHOP_MARKER_CLEARANCE;
    });
  }

  function hide() {
    element.hidden = true;
    element.classList?.remove?.("is-near");
    return false;
  }

  function update({ visible = true, nearby = false, available = false } = {}) {
    if (!visible) return hide();
    const point = getWorldPosition();
    if (!point) return hide();
    const cameraPosition = camera.getPosition();
    const distance = Math.hypot(point.x - cameraPosition.x, point.y - cameraPosition.y, point.z - cameraPosition.z);
    if (!Number.isFinite(distance) || distance > maxDistance) return hide();

    const projected = camera.camera.worldToScreen(point);
    const rect = canvas.getBoundingClientRect();
    const onScreen = projected.z > 0 &&
      projected.x >= 0 && projected.x <= canvas.clientWidth &&
      projected.y >= 0 && projected.y <= canvas.clientHeight;
    if (!onScreen) return hide();

    const copy = shopMarkerCopy({ nearby, available, coarsePointer });
    if (icon) icon.textContent = copy.icon;
    if (title) title.textContent = copy.title;
    if (hint) hint.textContent = copy.hint;
    element.dataset.state = available ? (nearby ? "near" : "ready") : "locked";
    element.classList?.toggle?.("is-near", nearby && available);
    element.style.left = `${projected.x + rect.left}px`;
    element.style.top = `${projected.y + rect.top}px`;
    element.hidden = false;
    if (overlapsCriticalUi()) return hide();
    return true;
  }

  return Object.freeze({ update, hide });
}
