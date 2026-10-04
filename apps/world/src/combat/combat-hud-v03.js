const ACTION_LABELS = Object.freeze({
  basic: '기본',
  active_1: 'S1',
  active_2: 'S2',
  active_3: 'S3',
  dodge: '회피',
  ultimate: 'ULT'
});

const seconds = ms => Math.max(0, Number(ms) || 0) / 1000;

export function createCombatHudV03({ root, runtime } = {}) {
  if (!root || !runtime?.subscribe || !runtime?.dispatch) {
    throw new TypeError('Combat HUD v0.3 dependencies required');
  }
  const job = root.querySelector('[data-combat-job]');
  const gauge = root.querySelector('[data-combat-ult-gauge]');
  const lock = root.querySelector('[data-combat-lock]');
  const targetName = root.querySelector('[data-combat-target-name]');
  const targetHpText = root.querySelector('[data-combat-target-hp]');
  const targetHpFill = root.querySelector('[data-combat-target-hp-fill]');
  const targetBreakText = root.querySelector('[data-combat-target-break]');
  const targetBreakFill = root.querySelector('[data-combat-target-break-fill]');
  const resource = root.querySelector('[data-combat-resource]');
  const status = root.querySelector('[data-combat-status]');
  const reset = root.querySelector('[data-combat-reset]');
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

  if (reset) {
    const resetTarget = event => {
      event?.preventDefault?.();
      runtime.resetTrainingTarget?.();
    };
    reset.addEventListener('pointerdown', resetTarget);
    cleanups.push(() => reset.removeEventListener('pointerdown', resetTarget));
  }

  const render = state => {
    const training = state.training;
    root.hidden = !state.active;
    root.setAttribute('aria-hidden', state.active ? 'false' : 'true');

    if (job) job.textContent = state.build.jobId.toUpperCase();
    if (gauge) gauge.textContent = `ULT ${Math.floor(state.ultimateGauge)}%`;
    if (lock) lock.textContent = state.lockOn ? 'LOCK ON' : 'FREE AIM';

    if (targetName) targetName.textContent = training?.target?.title ?? '훈련 대상 없음';
    if (targetHpText) targetHpText.textContent = training
      ? `${Math.ceil(training.hp)} / ${training.maxHp}`
      : '-';
    if (targetHpFill) targetHpFill.style.width = `${Math.round((training?.hpRatio ?? 0) * 100)}%`;
    if (targetBreakText) targetBreakText.textContent = training
      ? `${Math.floor(training.breakValue)} / ${training.breakMax}`
      : '-';
    if (targetBreakFill) targetBreakFill.style.width = `${Math.round((training?.breakRatio ?? 0) * 100)}%`;
    if (resource) resource.textContent = training ? `과충전 ${Math.floor(training.momentum)} / 100` : '과충전 -';

    if (status) {
      const parts = [];
      if (training?.defeated) parts.push('TARGET DOWN');
      else if (training?.broken) parts.push(`BREAK ${seconds(training.brokenRemainingMs).toFixed(1)}s`);
      if (training?.overdrive) parts.push(`OVERDRIVE ${seconds(training.overdriveRemainingMs).toFixed(1)}s`);
      else if (training?.rapidBuff) parts.push(`ACCEL ${seconds(training.rapidBuffRemainingMs).toFixed(1)}s`);
      status.textContent = parts.join(' · ') || 'TRAINING';
    }
    if (reset) reset.hidden = !state.active || training?.defeated !== true;

    for (const button of buttons) {
      const action = button.dataset.combatAction;
      const index = Number(action.at(-1)) - 1;
      const identity = action.startsWith('active_') ? state.build.activeSkills[index]
        : action === 'ultimate' ? state.build.ultimate : action;
      const cooldown = training?.cooldowns?.[action] ?? 0;
      const resourceBlocked = action === 'active_3' && (training?.momentum ?? 0) < 50;
      const ultimateBlocked = action === 'ultimate' && !state.ultimateReady;
      const targetBlocked = training?.defeated === true && action !== 'dodge';
      const suffix = cooldown > 0 ? ` ${seconds(cooldown).toFixed(1)}s` : '';
      button.textContent = `${ACTION_LABELS[action] ?? action} · ${identity}${suffix}`;
      button.disabled = !state.active || cooldown > 0 || resourceBlocked || ultimateBlocked || targetBlocked;
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
