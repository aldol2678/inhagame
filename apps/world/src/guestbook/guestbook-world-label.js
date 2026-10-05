// Floating world-space UI marker above the main-gate guestbook.
// Visual discovery only. The existing contextual action remains the interaction authority.

export const GUESTBOOK_MARKER_MAX_DISTANCE = 28;

export function guestbookMarkerCopy({ nearby = false, available = false } = {}) {
  if (!available) return Object.freeze({ icon: "🔒", title: "방명록", hint: "로그인 후 이용" });
  if (nearby) return Object.freeze({ icon: "📖", title: "방명록", hint: "F · 열기" });
  return Object.freeze({ icon: "📖", title: "방명록", hint: "한마디 남겨보세요" });
}

export function createGuestbookWorldLabel({
  element,
  camera,
  canvas,
  getWorldPosition,
  maxDistance = GUESTBOOK_MARKER_MAX_DISTANCE,
  heightOffset = 0.85
} = {}) {
  if (!element || !camera?.camera || !canvas || typeof getWorldPosition !== "function") {
    throw new Error("Guestbook world label dependencies required");
  }
  const icon = element.querySelector?.("[data-guestbook-marker-icon]");
  const title = element.querySelector?.("[data-guestbook-marker-title]");
  const hint = element.querySelector?.("[data-guestbook-marker-hint]");

  function hide() {
    element.hidden = true;
    element.classList?.remove?.("is-near");
    return false;
  }

  function update({ visible = true, nearby = false, available = false } = {}) {
    if (!visible) return hide();

    const source = getWorldPosition();
    if (!source) return hide();
    const point = typeof source.clone === "function"
      ? source.clone()
      : { x: Number(source.x), y: Number(source.y), z: Number(source.z) };
    point.y += heightOffset;

    const cameraPosition = camera.getPosition();
    const distance = Math.hypot(
      point.x - cameraPosition.x,
      point.y - cameraPosition.y,
      point.z - cameraPosition.z
    );
    if (!Number.isFinite(distance) || distance > maxDistance) return hide();

    const projected = camera.camera.worldToScreen(point);
    const rect = canvas.getBoundingClientRect();
    const onScreen = projected.z > 0 &&
      projected.x >= 0 && projected.x <= canvas.clientWidth &&
      projected.y >= 0 && projected.y <= canvas.clientHeight;
    if (!onScreen) return hide();

    const copy = guestbookMarkerCopy({ nearby, available });
    if (icon) icon.textContent = copy.icon;
    if (title) title.textContent = copy.title;
    if (hint) hint.textContent = copy.hint;

    element.dataset.state = available ? (nearby ? "near" : "ready") : "locked";
    element.classList?.toggle?.("is-near", nearby && available);
    element.style.left = `${projected.x + rect.left}px`;
    element.style.top = `${projected.y + rect.top}px`;
    element.style.setProperty?.("--guestbook-marker-distance", String(distance));
    element.hidden = false;
    return true;
  }

  return Object.freeze({ update, hide });
}
