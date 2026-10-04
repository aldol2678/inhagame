const ACTION_LABELS = Object.freeze({
  basic: '기본',
  active_1: 'S1',
  active_2: 'S2',
  active_3: 'S3',
  dodge: '회피',
  ultimate: 'ULT'
});

export function createCombatHudV03({ root, runtime } = {}) {
  if (!root || !runtime?.subscribe || !runtime?.dispatch) {
    throw new TypeError('Combat HUD v0.3 dependencies required');
  }
  const job = root.querySelector('[data-combat-job]');
  const gauge = root.querySelector('[data-combat-ult-gauge]');
  const lock = root.querySelector('[data-combat-lock]');
  const buttons = [...root.querySelectorAll('[data-combat-action]')];
  const cleanups = [];

  for (const button of buttons) {
    const action = button.dataset.combatAction;
    const fire = event => {
      event?.preventDefault?.();
      runtime.dispatch(action);
    };
    button.addEventListener('pointerdown', fire);
    cleanups.push(() => button.removeEventListener('pointerdown', fire));
  }

  const render = state => {
    root.hidden = !state.active;
    root.setAttribute('aria-hidden', state.active ? 'false' : 'true');
    if (job) job.textContent = state.build.jobId.toUpperCase();
    if (gauge) gauge.textContent = `ULT ${Math.floor(state.ultimateGauge)}%`;
    if (lock) lock.textContent = state.lockOn ? 'LOCK ON' : 'FREE AIM';
    for (const button of buttons) {
      const action = button.dataset.combatAction;
      const index = Number(action.at(-1)) - 1;
      const identity = action.startsWith('active_') ? state.build.activeSkills[index]
        : action === 'ultimate' ? state.build.ultimate : action;
      button.textContent = `${ACTION_LABELS[action] ?? action} · ${identity}`;
      button.disabled = !state.active || (action === 'ultimate' && !state.ultimateReady);
      button.setAttribute('aria-pressed', action === 'ultimate' && state.ultimateReady ? 'true' : 'false');
    }
  };
  const unsubscribe = runtime.subscribe(render, { emitCurrent: true });

  return Object.freeze({
    render: () => render(runtime.snapshot()),
    destroy: () => {
      unsubscribe();
      for (const cleanup of cleanups) cleanup();
    }
  });
}
