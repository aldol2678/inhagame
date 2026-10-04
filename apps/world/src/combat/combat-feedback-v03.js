const FEEDBACK = Object.freeze({
  basic: Object.freeze({ holdMs: 18, css: 'basic', haptic: [8] }),
  skill: Object.freeze({ holdMs: 32, css: 'skill', haptic: [8] }),
  heavy: Object.freeze({ holdMs: 50, css: 'heavy', haptic: [18] }),
  break: Object.freeze({ holdMs: 68, css: 'break', haptic: [26, 35, 32] }),
  perfect: Object.freeze({ holdMs: 0, css: 'perfect', haptic: [12, 28, 18] }),
  playerHit: Object.freeze({ holdMs: 38, css: 'player-hit', haptic: [22] }),
  defeat: Object.freeze({ holdMs: 0, css: 'defeat', haptic: [35, 55, 45] })
});

const nowDefault = () => typeof performance !== 'undefined' ? performance.now() : Date.now();

function tone(ctx, master, freq, dur, type, gain, endFreq = null, delay = 0) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
  amp.gain.setValueAtTime(.0001, t);
  amp.gain.exponentialRampToValueAtTime(Math.max(.001, gain), t + .006);
  amp.gain.exponentialRampToValueAtTime(.0001, t + dur);
  osc.connect(amp); amp.connect(master); osc.start(t); osc.stop(t + dur + .02);
}

function noise(ctx, master, dur, gain, cut, delay = 0) {
  if (!ctx || !master) return;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), amp = ctx.createGain();
  const t = ctx.currentTime + delay;
  src.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = cut; amp.gain.value = gain;
  src.connect(filter); filter.connect(amp); amp.connect(master); src.start(t);
}

export function createCombatFeedbackV03({
  runtime,
  canvas,
  overlay = null,
  documentLike = typeof document !== 'undefined' ? document : null,
  navigatorLike = typeof navigator !== 'undefined' ? navigator : null,
  AudioContextCtor = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null,
  clock = { now: nowDefault }
} = {}) {
  if (!runtime?.subscribe || !runtime?.snapshot || !canvas) {
    throw new TypeError('Combat feedback v0.3 dependencies required');
  }

  let audio = null, master = null, lastTargetHit = 0, lastBreak = 0, lastPlayerHit = 0, lastPerfect = 0;
  let reaction = null, holdUntil = 0, flashTimer = null;
  const cleanups = [];

  const ensureAudio = () => {
    if (!AudioContextCtor) return null;
    try {
      if (!audio) {
        audio = new AudioContextCtor();
        master = audio.createGain();
        master.gain.value = .38;
        master.connect(audio.destination);
      }
      if (audio.state === 'suspended') {
        try { audio.resume?.()?.catch?.(() => {}); } catch { /* autoplay policy */ }
      }
      return audio;
    } catch {
      return null;
    }
  };

  const vibrate = kind => {
    const pattern = FEEDBACK[kind]?.haptic;
    if (!pattern || !navigatorLike?.vibrate) return;
    try { navigatorLike.vibrate(pattern); } catch { /* unsupported device */ }
  };

  const play = kind => {
    const ctx = ensureAudio();
    if (!ctx) return;
    if (kind === 'basic' || kind === 'skill') {
      tone(ctx, master, 150, .045, 'square', .045, 105); noise(ctx, master, .028, .025, 900);
    } else if (kind === 'heavy') {
      tone(ctx, master, 115, .075, 'sawtooth', .07, 62); noise(ctx, master, .055, .05, 700);
    } else if (kind === 'perfect') {
      tone(ctx, master, 620, .055, 'sine', .055, 920); tone(ctx, master, 920, .07, 'sine', .045, 1250, .045);
    } else if (kind === 'break') {
      tone(ctx, master, 92, .12, 'sawtooth', .085, 48); noise(ctx, master, .11, .075, 650);
      tone(ctx, master, 460, .08, 'square', .035, 230, .035);
    } else if (kind === 'playerHit') {
      tone(ctx, master, 105, .09, 'square', .06, 58); noise(ctx, master, .07, .045, 550);
    } else if (kind === 'defeat') {
      tone(ctx, master, 220, .14, 'sawtooth', .05, 145); tone(ctx, master, 145, .22, 'triangle', .04, 73, .10);
    }
  };

  const flash = kind => {
    if (!overlay) return;
    overlay.dataset.kind = kind;
    overlay.classList.remove('show');
    void overlay.offsetWidth;
    overlay.classList.add('show');
    if (flashTimer != null) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => overlay.classList.remove('show'), kind === 'perfect' ? 180 : 95);
  };

  const cameraKick = kind => {
    const css = FEEDBACK[kind]?.css ?? 'basic';
    canvas.dataset.combatKick = css;
    canvas.classList.remove('combat-camera-kick');
    void canvas.offsetWidth;
    canvas.classList.add('combat-camera-kick');
  };

  const cue = kind => {
    const spec = FEEDBACK[kind] ?? FEEDBACK.basic;
    holdUntil = Math.max(holdUntil, Number(clock.now()) + spec.holdMs);
    reaction = { kind, startedAt: Number(clock.now()), durationMs: kind === 'playerHit' ? 220 : kind === 'perfect' ? 320 : 150 };
    flash(kind); cameraKick(kind); play(kind); vibrate(kind);
  };

  const onState = (state, event) => {
    if (!state.active) return;
    const training = state.training;
    if (!training) return;

    if ((training.breakSerial ?? 0) > lastBreak) {
      lastBreak = training.breakSerial;
      lastTargetHit = Math.max(lastTargetHit, training.hitSerial ?? 0);
      cue('break');
    } else if ((training.hitSerial ?? 0) > lastTargetHit) {
      lastTargetHit = training.hitSerial;
      const action = state.lastAction?.action;
      cue(action === 'active_3' ? 'heavy' : action?.startsWith('active_') ? 'skill' : 'basic');
    }

    if ((training.player?.hitSerial ?? 0) > lastPlayerHit) {
      lastPlayerHit = training.player.hitSerial;
      cue(training.player.defeated ? 'defeat' : 'playerHit');
    }
    if ((training.player?.perfectDodgeSerial ?? 0) > lastPerfect) {
      lastPerfect = training.player.perfectDodgeSerial;
      cue('perfect');
    }
  };

  const unsubscribe = runtime.subscribe(onState, { emitCurrent: true });
  if (documentLike?.addEventListener) {
    const prime = () => ensureAudio();
    documentLike.addEventListener('pointerdown', prime, { once: true, capture: true });
    documentLike.addEventListener('keydown', prime, { once: true, capture: true });
  }

  function poseOffsets() {
    if (!reaction || !runtime.active) return null;
    const elapsed = Number(clock.now()) - reaction.startedAt;
    if (elapsed < 0 || elapsed >= reaction.durationMs) {
      reaction = null;
      return null;
    }
    const q = elapsed / reaction.durationMs;
    const pulse = Math.sin(Math.PI * q);
    if (reaction.kind === 'playerHit' || reaction.kind === 'defeat') {
      return {
        bodyY: -.025 * pulse,
        bodyPitch: 12 * pulse,
        bodyYaw: 0,
        bodyRoll: -9 * pulse,
        wingL: [8 * pulse, -18 * pulse, -24 * pulse],
        wingR: [8 * pulse, 18 * pulse, 24 * pulse],
        legL: 5 * pulse,
        legR: -5 * pulse
      };
    }
    if (reaction.kind === 'perfect') {
      return {
        bodyY: .035 * pulse,
        bodyPitch: -7 * pulse,
        bodyYaw: 12 * pulse,
        bodyRoll: 8 * pulse,
        wingL: [-10 * pulse, -28 * pulse, -32 * pulse],
        wingR: [-10 * pulse, 28 * pulse, 32 * pulse],
        legL: -8 * pulse,
        legR: 8 * pulse
      };
    }
    return null;
  }

  return Object.freeze({
    poseOffsets,
    hitstopActive: () => Number(clock.now()) < holdUntil,
    status: () => Object.freeze({
      hitstopRemainingMs: Math.max(0, holdUntil - Number(clock.now())),
      reaction: reaction?.kind ?? null,
      targetHitSerial: lastTargetHit,
      breakSerial: lastBreak,
      playerHitSerial: lastPlayerHit,
      perfectDodgeSerial: lastPerfect
    }),
    destroy: () => {
      unsubscribe();
      if (flashTimer != null) clearTimeout(flashTimer);
      canvas.classList.remove('combat-camera-kick');
      delete canvas.dataset.combatKick;
      audio?.close?.();
      for (const cleanup of cleanups) cleanup();
    }
  });
}
