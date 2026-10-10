const LIVE_CLOCK_STATES = new Set(['SYNCED', 'HOLDOVER']);
const PERIOD_SECONDS = 900;

// Display-only clock ranges. The authoritative schedule still owns five equal
// server periods; this mapping gives those periods familiar campus-day clock
// labels without changing schedule timing or environment transitions.
export const WORLD_TIME_DISPLAY_RANGES = Object.freeze({
  morning: Object.freeze({ startMinute: 6 * 60, endMinute: 9 * 60, icon: '🌅', label: '아침' }),
  class_time: Object.freeze({ startMinute: 9 * 60, endMinute: 12 * 60, icon: '☀️', label: '낮' }),
  lunch: Object.freeze({ startMinute: 12 * 60, endMinute: 17 * 60, icon: '☀️', label: '점심' }),
  evening: Object.freeze({ startMinute: 17 * 60, endMinute: 21 * 60, icon: '🌇', label: '저녁' }),
  night: Object.freeze({ startMinute: 21 * 60, endMinute: 30 * 60, icon: '🌙', label: '밤' })
});

export const WORLD_TIME_PHASES = Object.freeze(Object.fromEntries(
  Object.entries(WORLD_TIME_DISPLAY_RANGES).map(([period, value]) => [
    period,
    Object.freeze({ icon: value.icon, label: value.label })
  ])
));

function clamp01(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function worldTimeClockMinute(period, offsetSeconds) {
  const range = WORLD_TIME_DISPLAY_RANGES[String(period ?? '')];
  if (!range || !Number.isFinite(offsetSeconds)) return null;
  const progress = clamp01(offsetSeconds / PERIOD_SECONDS);
  const raw = range.startMinute + (range.endMinute - range.startMinute) * progress;
  return Math.floor(raw) % (24 * 60);
}

export function formatWorldTimeClock(period, offsetSeconds) {
  const minute = worldTimeClockMinute(period, offsetSeconds);
  if (minute === null) return null;
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function worldTimeHudPresentation(status = null) {
  const period = String(status?.period ?? '');
  const phase = WORLD_TIME_PHASES[period] ?? null;
  const state = String(status?.state ?? '');
  const clock = formatWorldTimeClock(period, status?.offsetSeconds);
  const visible = status?.enabled === true &&
    LIVE_CLOCK_STATES.has(state) &&
    phase !== null &&
    clock !== null;

  if (!visible) return Object.freeze({
    visible: false,
    period: null,
    icon: '',
    label: '',
    clock: null,
    text: '',
    ariaLabel: 'INHA WORLD 시간 동기화 중'
  });

  return Object.freeze({
    visible: true,
    period,
    icon: phase.icon,
    label: phase.label,
    clock,
    text: `${phase.icon} ${clock}`,
    ariaLabel: `INHA WORLD 시간 · ${phase.label} · ${clock}`
  });
}

export function createWorldTimeHud({
  element,
  getStatus,
  refreshSeconds = 1
} = {}) {
  if (!element) throw new TypeError('world-time HUD element is required');
  if (typeof getStatus !== 'function') throw new TypeError('world-time HUD getStatus is required');

  const interval = Math.max(0.25, Number.isFinite(refreshSeconds) ? refreshSeconds : 1);
  let elapsed = 0;
  let presentation = worldTimeHudPresentation(null);
  let renderKey = '';

  function render() {
    const next = worldTimeHudPresentation(getStatus());
    const key = [next.visible, next.period, next.clock, next.text].join('|');
    presentation = next;
    if (key === renderKey) return false;
    renderKey = key;

    element.hidden = !next.visible;
    element.textContent = next.text;
    element.title = next.visible ? next.ariaLabel : '';
    element.setAttribute?.('aria-label', next.ariaLabel);
    if (next.visible) element.dataset.period = next.period;
    else if (element.dataset) delete element.dataset.period;
    return true;
  }

  function update(dt = 0) {
    elapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
    if (elapsed < interval) return false;
    elapsed %= interval;
    return render();
  }

  function status() {
    return presentation;
  }

  render();
  return Object.freeze({ render, update, status });
}
