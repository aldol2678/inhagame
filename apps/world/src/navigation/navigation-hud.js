// INHA WORLD M3 guidance chip under the Mini-map: destination · direction · distance · cancel.
// Consumes Guidance State snapshots only; never computes routes or reads world registries.

import { NAV_STATUS, formatGuidanceDistance, navigationPauseLabel } from "./navigation-state.js";

function setText(element, value) {
  const next = String(value ?? "");
  if (element && element.textContent !== next) element.textContent = next;
}

export function createNavigationHud({ root, arrow, title, detail, cancelButton, announcer = null, onCancel = () => {} } = {}) {
  if (!root || !arrow || !title || !detail || !cancelButton) throw new Error("Navigation HUD requires its DOM contract");
  let lastKey = null;
  let arrowDeg = null;

  cancelButton.addEventListener("click", event => {
    event?.stopPropagation?.();
    onCancel();
  });

  function render(snapshot, { visible = true } = {}) {
    const active = visible && snapshot?.active === true && snapshot.destination;
    if (!active) {
      if (!root.hidden) root.hidden = true;
      if (lastKey !== null && snapshot?.active !== true) setText(announcer, "");
      lastKey = null;
      return false;
    }
    root.hidden = false;
    const status = snapshot.status;
    if (root.dataset.status !== status) root.dataset.status = status;
    setText(title, snapshot.destination.title);

    if (status === NAV_STATUS.GUIDING) {
      setText(detail, formatGuidanceDistance(snapshot.remainingDistance));
      const bearing = snapshot.guidanceBearing ?? snapshot.destinationBearing;
      if (Number.isFinite(bearing)) {
        // Quantize to 2° so the arrow does not repaint on every sub-pixel camera change.
        const deg = Math.round(bearing * 180 / Math.PI / 2) * 2;
        if (deg !== arrowDeg) {
          arrowDeg = deg;
          arrow.style.setProperty("--nav-bearing", `${deg}deg`);
        }
      }
      setText(arrow, "↑");
    } else if (status === NAV_STATUS.PAUSED) {
      setText(detail, navigationPauseLabel(snapshot));
      setText(arrow, "⏸");
    } else if (status === NAV_STATUS.ARRIVED) {
      setText(detail, "도착했어요");
      setText(arrow, "✓");
    }
    const key = `${status}|${snapshot.destination.id}`;
    if (key !== lastKey) {
      lastKey = key;
      // Status changes only (not every distance tick) reach assistive technology.
      const name = snapshot.destination.title;
      setText(announcer, status === NAV_STATUS.ARRIVED ? `${name}에 도착했어요`
        : status === NAV_STATUS.PAUSED ? `${name} 안내 일시정지`
        : `${name} 안내 중`);
      cancelButton.setAttribute("aria-label", status === NAV_STATUS.ARRIVED ? "도착 안내 닫기" : `${snapshot.destination.title} 안내 종료`);
    }
    return true;
  }

  return Object.freeze({ render, get visible() { return !root.hidden; } });
}
