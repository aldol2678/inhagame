const LIVE_CLOCK_STATES = new Set(['SYNCED', 'HOLDOVER']);

export const WORLD_TIME_PHASES = Object.freeze({
  morning: Object.freeze({ icon: '🌅', label: '아침' }),
  class_time: Object.freeze({ icon: '☀️', label: '낮' }),
  lunch: Object.freeze({ icon: '☀️', label: '점심' }),
  evening: Object.freeze({ icon: '🌇', label: '저녁' }),
  night: Object.freeze({ icon: '🌙', label: '밤' })
});

export function worldTimeHudPresentation(status = null) {
  const period = String(status?.period ?? '');
  const phase = WORLD_TIME_PHASES[period] ?? null;
  const state = String(status?.state ?? '');
  const visible = status?.enabled === true && LIVE_CLOCK_STATES.has(state) && phase !== null;

  if (!visible) return Object.freeze({
    visible: false,
    period: null,
    icon: '',
    label: '',
    text: '',
    ariaLabel: 'INHA WORLD 시간 동기화 중'
  });

  return Object.freeze({
    visible: true,
    period,
    icon: phase.icon,
    label: phase.label,
    text: `${phase.icon} ${phase.label}`,
    ariaLabel: `INHA WORLD 시간 · ${phase.label}`
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
    const key = [next.visible, next.period, next.text].join('|');
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
