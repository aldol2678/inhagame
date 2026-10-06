// INHA WORLD P0-F3a · Progression HUD (read-only presentation).
// Renders server snapshots from progression-client.js. The only arithmetic here is presentation:
// the bar ratio progressExp / progressRequired and thousands separators. Level, total EXP and the
// next threshold are shown exactly as the server returned them; at the highest defined Level no
// next threshold is invented.

import { PROGRESSION_STATE } from "./progression-client.js";

const formatCount = (value) => Number(value).toLocaleString("en-US");

/** Display strings for one server snapshot, or null when there is nothing to show. */
export function formatProgression(snapshot) {
  if (!snapshot) return null;
  const levelText = `Lv.${snapshot.level}`;
  if (snapshot.isMaxLevel) {
    const expText = `${formatCount(snapshot.totalExp)} EXP`;
    return { levelText, expText, fullText: `${levelText} · ${expText}`, ratio: null, max: true };
  }
  const expText = `${formatCount(snapshot.totalExp)} / ${formatCount(snapshot.nextLevelExp)} EXP`;
  const ratio = Math.min(1, Math.max(0, snapshot.progressExp / snapshot.progressRequired));
  return { levelText, expText, fullText: `${levelText} ${expText}`, ratio, max: false };
}

/** "LEVEL UP · Lv.N" only when the same account's server Level rose between two READY snapshots. */
export function levelUpMessage(change) {
  const { state, snapshot, previous, reason } = change ?? {};
  if (reason === "daily-reward-recovery") return null;
  if (state !== PROGRESSION_STATE.READY || !snapshot || !previous) return null;
  return snapshot.level > previous.level ? `LEVEL UP · Lv.${snapshot.level}` : null;
}

function setText(element, value) {
  const next = String(value ?? "");
  if (element && element.textContent !== next) element.textContent = next;
}
function setHidden(element, hidden) {
  if (element && element.hidden !== hidden) element.hidden = hidden;
}
function setRatio(fill, ratio) {
  const next = `${Number(((ratio ?? 0) * 100).toFixed(1))}%`;
  if (fill && fill.style?.width !== next) fill.style.width = next;
}

/**
 * Three read-only views of the same snapshot:
 * - pill: wide screens, under the location chip (level · EXP · bar)
 * - badge: narrow screens, inside the location chip (Lv.N + thin bar)
 * - menuLine: the HUD menu, where the full EXP numbers fit on narrow screens
 */
export function createProgressionHud({
  pill, pillLevel, pillExp, pillBar, pillFill,
  badge, badgeLevel, badgeBar, badgeFill,
  menuLine
} = {}) {
  const required = { pill, pillLevel, pillExp, pillBar, pillFill, badge, badgeLevel, badgeBar, badgeFill, menuLine };
  if (Object.values(required).some((element) => !element)) throw new Error("Progression HUD requires its DOM contract");

  function render(state, snapshot) {
    const view = state === PROGRESSION_STATE.READY ? formatProgression(snapshot) : null;
    setHidden(pill, !view);
    setHidden(badge, !view);
    if (view) {
      setText(pillLevel, view.levelText);
      setText(pillExp, view.expText);
      setText(badgeLevel, view.levelText);
      setHidden(pillBar, view.max);
      setHidden(badgeBar, view.max);
      if (!view.max) { setRatio(pillFill, view.ratio); setRatio(badgeFill, view.ratio); }
      pill.dataset.max = String(view.max);
      pill.setAttribute("aria-label", `진행도 ${view.fullText}`);
      badge.setAttribute("aria-label", `진행도 ${view.fullText}`);
    }
    if (view) {
      setText(menuLine, `진행도 ${view.fullText}`);
      setHidden(menuLine, false);
    } else if (state === PROGRESSION_STATE.UNAVAILABLE) {
      setText(menuLine, "진행도를 불러오지 못했어요");
      setHidden(menuLine, false);
    } else {
      setText(menuLine, "");
      setHidden(menuLine, true);
    }
    return view;
  }

  render(PROGRESSION_STATE.SIGNED_OUT, null);
  return { render };
}
