const ACTION_LABELS = Object.freeze({
  basic: '기본',
  active_1: 'S1',
  active_2: 'S2',
  active_3: 'S3',
  dodge: '회피',
  ultimate: 'ULT'
});

const seconds = ms => Math.max(0, Number(ms) || 0) / 1000;

export function createCombatHudV03({ root, runtime, inputFocus } = {}) {
  if (!root || !runtime?.subscribe || !runtime?.dispatch || !inputFocus?.can || !inputFocus?.subscribe) {
    throw new TypeError('Combat HUD v0.3 dependencies required');
  }
  const job = root.querySelector('[data-combat-job]');
  const gauge = root.querySelector('[data-combat-ult-gauge]');
  const lock = root.querySelector('[data-combat-lock]');
  const playerHpText = root.querySelector('[data-combat-player-hp]');
  const playerHpFill = root.querySelector('[data-combat-player-hp-fill]');
  const dodgeState = root.querySelector('[data-combat-dodge-state]');
  const targetName = root.querySelector('[data-combat-target-name]');
  const targetHpText = root.querySelector('[data-combat-target-hp]');
  const targetHpFill = root.querySelector('[data-combat-target-hp-fill]');
  const targetBreakText = root.querySelector('[data-combat-target-break]');
  const targetBreakFill = root.querySelector('[data-combat-target-break-fill]');
  const telegraph = root.querySelector('[data-combat-telegraph]');
  const resource = root.querySelector('[data-combat-resource]');
  const status = root.querySelector('[data-combat-status]');
  const reset = root.querySelector('[data-combat-reset]');
  const buttons = [...root.querySelectorAll('[data-combat-action]')];
  const cleanups = [];

  const bindActivation = (button, activate) => {
    const fire = event => {
      if (root.hidden || button.hidden || button.disabled || !inputFocus.can('WORLD_ACTION')) return;
      event.preventDefault?.();
      activate();
    };
    const onPointerDown = event => {
      if (event.button !== undefined && event.button !== 0) return;
      fire(event);
    };
    const onClick = event => {
      // Pointer input already fires on press. Native keyboard and assistive
      // activations produce a zero-detail click without a pointer type.
      if (event.detail > 0 || event.pointerType) return;
      fire(event);
    };
    const onKeyDown = event => {
      if (event.key === 'Shift' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        // Here Shift is a native focus-navigation modifier. The gameplay
        // shortcut keeps ownership when focus is outside these buttons.
        event.stopPropagation();
        return;
      }
      if (!['Enter', 'NumpadEnter', 'Space'].includes(event.code) && event.key !== 'Enter' && event.key !== ' ') return;
      // Keep the native button default action, but don't open chat or jump.
      event.stopPropagation();
      if (event.repeat) event.preventDefault();
    };
    for (const [type, listener] of [['pointerdown', onPointerDown], ['click', onClick], ['keydown', onKeyDown]]) {
      button.addEventListener(type, listener);
      cleanups.push(() => button.removeEventListener(type, listener));
    }
  };

  for (const button of buttons) {
    bindActivation(button, () => runtime.dispatch(button.dataset.combatAction));
  }
  if (reset) bindActivation(reset, () => runtime.resetTrainingTarget?.());

  const render = state => {
    const training = state.training;
    const player = training?.player;
    const attack = training?.enemyAttack;
    root.hidden = !state.active;
    root.setAttribute('aria-hidden', state.active ? 'false' : 'true');

    if (job) job.textContent = state.build.jobId.toUpperCase();
    if (gauge) gauge.textContent = `ULT ${Math.floor(state.ultimateGauge)}%`;
    if (lock) lock.textContent = state.lockOn ? 'LOCK ON' : 'FREE AIM';

    if (playerHpText) playerHpText.textContent = player
      ? `${Math.ceil(player.hp)} / ${player.maxHp}`
      : '-';
    if (playerHpFill) playerHpFill.style.width = `${Math.round((player?.hpRatio ?? 0) * 100)}%`;
    if (dodgeState) {
      dodgeState.textContent = player?.defeated ? 'TRAINING FAIL'
        : player?.dodge?.perfectWindow ? 'PERFECT WINDOW'
        : player?.dodge?.iframe ? 'I-FRAME'
        : player?.dodge?.active ? 'DODGE'
        : 'READY';
      dodgeState.dataset.state = player?.defeated ? 'DEFEAT'
        : player?.dodge?.perfectWindow ? 'PERFECT'
        : player?.dodge?.iframe ? 'IFRAME'
        : player?.dodge?.active ? 'DODGE'
        : 'READY';
    }

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

    if (telegraph) {
      if (attack?.phase === 'WINDUP') {
        telegraph.hidden = false;
        telegraph.textContent = `⚠ ${attack.title} · ${seconds(attack.remainingMs).toFixed(1)}s`;
        telegraph.dataset.urgent = attack.remainingMs <= 240 ? 'true' : 'false';
      } else {
        telegraph.hidden = true;
        telegraph.textContent = '';
        delete telegraph.dataset.urgent;
      }
    }

    if (status) {
      const parts = [];
      if (player?.defeated) parts.push('TRAINING FAIL');
      else if (training?.defeated) parts.push('TARGET DOWN');
      else if (training?.broken) parts.push(`BREAK ${seconds(training.brokenRemainingMs).toFixed(1)}s`);
      if (training?.lastEnemyAttack?.outcome === 'PERFECT_DODGE') parts.push('PERFECT DODGE');
      else if (training?.lastEnemyAttack?.outcome === 'DODGE') parts.push('DODGE');
      else if (training?.lastEnemyAttack?.outcome === 'HIT') parts.push(`HIT -${training.lastEnemyAttack.damage}`);
      if (training?.overdrive) parts.push(`OVERDRIVE ${seconds(training.overdriveRemainingMs).toFixed(1)}s`);
      else if (training?.rapidBuff) parts.push(`ACCEL ${seconds(training.rapidBuffRemainingMs).toFixed(1)}s`);
      status.textContent = parts.join(' · ') || 'TRAINING';
    }

    if (reset) {
      reset.hidden = !state.active || (training?.defeated !== true && player?.defeated !== true);
      reset.disabled = !state.active || !inputFocus.can('WORLD_ACTION');
    }

    for (const button of buttons) {
      const action = button.dataset.combatAction;
      const index = Number(action.at(-1)) - 1;
      const identity = action.startsWith('active_') ? state.build.activeSkills[index]
        : action === 'ultimate' ? state.build.ultimate : action;
      const cooldown = training?.cooldowns?.[action] ?? 0;
      const resourceBlocked = action === 'active_3' && (training?.momentum ?? 0) < 50;
      const ultimateBlocked = action === 'ultimate' && !state.ultimateReady;
      const defeatedBlocked = player?.defeated === true || (training?.defeated === true && action !== 'dodge');
      const suffix = cooldown > 0 ? ` ${seconds(cooldown).toFixed(1)}s` : '';
      button.textContent = `${ACTION_LABELS[action] ?? action} · ${identity}${suffix}`;
      button.disabled = !state.active || !inputFocus.can('WORLD_ACTION') || cooldown > 0 || resourceBlocked || ultimateBlocked || defeatedBlocked;
      button.setAttribute('aria-pressed', action === 'ultimate' && state.ultimateReady ? 'true' : 'false');
    }
  };
  const unsubscribe = runtime.subscribe(render, { emitCurrent: true });
  const unsubscribeFocus = inputFocus.subscribe(() => render(runtime.snapshot()));

  return Object.freeze({
    render: () => render(runtime.snapshot()),
    destroy: () => {
      unsubscribe();
      unsubscribeFocus();
      for (const cleanup of cleanups) cleanup();
    }
  });
}
