// 비룡탑 discovery, 울림돌 shout/echo and BR01 「돌아오는 목소리」 progress. Pure: no renderer or
// DOM. Storage is injected (browser localStorage in the World, a Map-backed stub in tests).
import { BIRYONG_PLACE_ID } from './biryong-layout.js';
import { EVENT_ID } from '../events/event-registry.js';

export const BIRYONG_STORAGE_KEY = 'inha-world-biryong-v1';

export const BIRYONG_PLACE = Object.freeze({
  id: BIRYONG_PLACE_ID,
  type: 'LANDMARK',
  title: '비룡탑',
  icon: '🐉',
  description: '인하대학교를 상징하는 비룡이 내려다보는 캠퍼스의 랜드마크.',
  mapVisible: true,
  autoMove: true
});

export const CAMPUS_LORE = Object.freeze({
  BIRYONG_TOWER: Object.freeze({
    id: 'CAMPUS_LORE_BIRYONG_01',
    title: '비룡탑',
    detail: '캠퍼스 어디서든 올려다보이는 비룡. 인하를 상징하는 용이 탑 위에서 캠퍼스를 내려다본다.'
  }),
  ECHO_STONE: Object.freeze({
    id: 'CAMPUS_LORE_BIRYONG_02',
    title: '울림돌',
    detail: '괄호처럼 마주 선 열여덟 개의 돌. 가운데서 소리를 내면 목소리가 되돌아온다는 캠퍼스 이야기.'
  })
});

// BR01 steps, in order. Discovery happens before INTRO; COMPLETE is terminal.
export const BR01_STEP = Object.freeze({
  INTRO: 'INTRO',             // student NPC waits near the stones
  FIND_CENTER: 'FIND_CENTER', // move into the echo centre
  SHOUT: 'SHOUT',             // at the centre, [F] 외쳐본다
  REACTION: 'REACTION',       // NPC: "들렸지?" then the legend
  COMPLETE: 'COMPLETE'
});
const STEP_ORDER = Object.freeze(Object.values(BR01_STEP));

export const BR01_EVENT = Object.freeze({
  id: EVENT_ID.BIRYONG_BR01,
  title: '돌아오는 목소리',
  category: 'Campus Discovery Event',
  objectiveFindCenter: '울림돌 중앙으로 이동하기',
  objectiveShout: '울림돌 가운데서 외쳐보기'
});

// Local-only reward presentation. Economy grants are deliberately not issued from the client.
export const BR01_REWARD_PREVIEW = Object.freeze({ exp: 30, coin: 10 });

export const SHOUT_LINES = Object.freeze(['인하!', '아아!', '거기 누구 없어요?', '시험 없어져라!', '비룡아, 들리니?']);
export const FIRST_SHOUT = '아아!';

// Delays are relative to the shout: +180 ms, then a further +260 ms.
export const ECHO_TAPS = Object.freeze([
  Object.freeze({ delayMs: 180, gainDb: -6 }),
  Object.freeze({ delayMs: 440, gainDb: -12 })
]);
export const dbToGain = db => 10 ** (db / 20);

export function echoText(line) {
  const words = String(line ?? '').replace(/[!?.,…~]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const last = words.at(-1) ?? '';
  if (!last) return '…';
  const chars = [...last];
  const tail = chars.length > 2 ? chars.slice(-2).join('') : last;
  return `…${last}… ${tail}…`;
}

export function echoSchedule(line) {
  const echo = echoText(line);
  return Object.freeze([
    Object.freeze({ kind: 'shout', delayMs: 0, gain: 1, text: line }),
    ...ECHO_TAPS.map((tap, i) => Object.freeze({
      kind: 'echo', delayMs: tap.delayMs, gain: dbToGain(tap.gainDb), gainDb: tap.gainDb,
      text: i === ECHO_TAPS.length - 1 ? echo : null
    }))
  ]);
}

// Local-only player pose for the shout: LookAround → HandNearMouth → Shout → Reaction.
// Same offset contract as emotes (degrees / world units on top of locomotion). Not networked.
export const SHOUT_POSE = Object.freeze({ lookAroundMs: 520, handMs: 900, shoutMs: 1550, durationMs: 2300 });
export function shoutPoseOffsets(elapsedMs) {
  const t = Number(elapsedMs);
  if (!Number.isFinite(t) || t < 0 || t >= SHOUT_POSE.durationMs) return null;
  const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  const out = Math.min(1, (SHOUT_POSE.durationMs - t) / 200);
  if (t < SHOUT_POSE.lookAroundMs) {
    const w = Math.min(1, t / 150);
    return { ...SHOUT_REST, bodyYaw: w * 20 * Math.sin(t / SHOUT_POSE.lookAroundMs * Math.PI * 2) };
  }
  // Wings cup the beak from HandNearMouth through Shout, then drop for the Reaction.
  const cup = ease((t - SHOUT_POSE.lookAroundMs) / 240) * (t < SHOUT_POSE.shoutMs ? 1 : 1 - ease((t - SHOUT_POSE.shoutMs) / 260));
  const shout = t >= SHOUT_POSE.handMs && t < SHOUT_POSE.shoutMs ? ease((t - SHOUT_POSE.handMs) / 120) : 0;
  const react = t >= SHOUT_POSE.shoutMs ? ease((t - SHOUT_POSE.shoutMs) / 300) * out : 0;
  return {
    ...SHOUT_REST,
    bodyY: 0.03 * shout,
    bodyPitch: -14 * shout + 7 * react,
    bodyRoll: 7 * react,
    bodyYaw: -10 * react,
    wingL: [0, -62 * cup, -48 * cup],
    wingR: [0, 62 * cup, 48 * cup]
  };
}
const SHOUT_REST = Object.freeze({ bodyY: 0, bodyPitch: 0, bodyYaw: 0, bodyRoll: 0, wingL: [0, 0, 0], wingR: [0, 0, 0], legL: 0, legR: 0 });

export function pickShoutLine(random = Math.random, previous = null) {
  const pool = SHOUT_LINES.filter(line => line !== previous);
  const r = Number(random());
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * pool.length)));
  return pool[index];
}

// BR01 dialogue script. `choices` are shown as buttons; every choice advances the same beat.
export const BR01_SCRIPT = Object.freeze({
  intro: Object.freeze([
    Object.freeze({
      speaker: 'npc', text: '혹시 저 돌 사이에 서본 적 있어?',
      choices: Object.freeze(['아직 안 해봤어.', '왜? 뭐 있는데?', '돌이 뭐가 특별한데?'])
    }),
    Object.freeze({ speaker: 'npc', text: '가운데 서서 소리 내봐.', choices: Object.freeze(['해볼게.']) })
  ]),
  reaction: Object.freeze([
    Object.freeze({ speaker: 'npc', text: '들렸지?', choices: Object.freeze(['방금 그거 뭐야?']) }),
    Object.freeze({
      speaker: 'npc',
      text: '옛날에는 여기서 소리가 안 돌아오면 나쁜 학생이라는 얘기도 했대.',
      choices: Object.freeze(['그럼 나는?'])
    }),
    Object.freeze({ speaker: 'npc', text: '시험기간 지나고 다시 판정하자.', choices: Object.freeze(['…알았어.']) })
  ])
});

function readStore(storage) {
  try {
    const raw = storage?.getItem(BIRYONG_STORAGE_KEY);
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? value : {};
  } catch { return {}; }
}

function validTime(value) {
  return Number.isFinite(value) ? value : null;
}

export function normalizeBiryongSnapshot(value = {}) {
  const rawStep = STEP_ORDER.includes(value?.step) ? value.step : BR01_STEP.INTRO;
  // REACTION is mid-dialogue, so a reload or another device resumes from the actionable SHOUT step.
  const step = rawStep === BR01_STEP.REACTION ? BR01_STEP.SHOUT : rawStep;
  const completedAt = step === BR01_STEP.COMPLETE ? validTime(value?.completedAt) : null;
  return Object.freeze({
    discoveredAt: validTime(value?.discoveredAt),
    step,
    lore: Object.freeze(Array.isArray(value?.lore) ? [...new Set(value.lore.filter(id => typeof id === 'string'))] : []),
    shouts: Number.isInteger(value?.shouts) && value.shouts >= 0 ? value.shouts : 0,
    completedAt
  });
}

function firstTime(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

export function mergeBiryongSnapshots(left, right) {
  const a = normalizeBiryongSnapshot(left);
  const b = normalizeBiryongSnapshot(right);
  const step = STEP_ORDER.indexOf(b.step) > STEP_ORDER.indexOf(a.step) ? b.step : a.step;
  const discoveredAt = firstTime(a.discoveredAt, b.discoveredAt);
  const completedAt = step === BR01_STEP.COMPLETE
    ? firstTime(a.completedAt, b.completedAt) ?? Date.now()
    : null;
  return Object.freeze({
    discoveredAt,
    step,
    lore: Object.freeze([...new Set([...a.lore, ...b.lore])]),
    shouts: Math.max(a.shouts, b.shouts),
    completedAt
  });
}

export function createBiryongProgress({ storage = null, now = () => Date.now(), onChange = () => {} } = {}) {
  const saved = readStore(storage);
  const initial = normalizeBiryongSnapshot(saved);
  let state = {
    ...initial,
    lore: [...initial.lore],
    scope: typeof saved.scope === 'string' && saved.scope ? saved.scope : null
  };

  const snapshot = () => Object.freeze({
    discoveredAt: state.discoveredAt,
    step: state.step,
    lore: Object.freeze(state.lore.slice()),
    shouts: state.shouts,
    completedAt: state.completedAt
  });
  const save = (notify = true) => {
    try { storage?.setItem(BIRYONG_STORAGE_KEY, JSON.stringify(state)); } catch { /* Session-only progress. */ }
    if (notify) {
      try { onChange(snapshot()); } catch { /* Persistence observers are best effort. */ }
    }
  };
  const assign = value => {
    state.discoveredAt = value.discoveredAt;
    state.step = value.step;
    state.lore = [...value.lore];
    state.shouts = value.shouts;
    state.completedAt = value.completedAt;
  };

  return {
    get discovered() { return state.discoveredAt !== null; },
    get step() { return state.step; },
    get complete() { return state.step === BR01_STEP.COMPLETE; },
    get shouts() { return state.shouts; },
    get lore() { return state.lore.slice(); },
    get localScope() { return state.scope; },
    hasLore: id => state.lore.includes(id),
    discover() {
      if (state.discoveredAt !== null) return false;
      state.discoveredAt = now();
      save();
      return true;
    },
    // Only forward moves are accepted; COMPLETE is terminal.
    advance(step) {
      const from = STEP_ORDER.indexOf(state.step), to = STEP_ORDER.indexOf(step);
      if (to < 0 || to <= from || !this.discovered) return false;
      state.step = step;
      if (step === BR01_STEP.COMPLETE) state.completedAt = now();
      save();
      return true;
    },
    addLore(id) {
      if (typeof id !== 'string' || state.lore.includes(id)) return false;
      state.lore.push(id);
      save();
      return true;
    },
    recordShout() { state.shouts += 1; save(); return state.shouts; },
    // Legacy localStorage is adopted by the first permanent account only. Switching accounts resets
    // the local cache before the new account's server snapshot is applied, preventing cross-account carryover.
    setScope(scope, { adoptLegacy = false } = {}) {
      if (typeof scope !== 'string' || !scope) return Object.freeze({ changed: false, migrated: false, reset: false });
      if (state.scope === scope) return Object.freeze({ changed: false, migrated: false, reset: false });
      if (state.scope === null && adoptLegacy) {
        const migrated = state.discoveredAt !== null || state.step !== BR01_STEP.INTRO ||
          state.lore.length > 0 || state.shouts > 0 || state.completedAt !== null;
        state.scope = scope;
        save(false);
        return Object.freeze({ changed: true, migrated, reset: false });
      }
      state = { ...normalizeBiryongSnapshot({}), lore: [], scope };
      save(false);
      return Object.freeze({ changed: true, migrated: false, reset: true });
    },
    merge(value, { notify = false } = {}) {
      const merged = mergeBiryongSnapshots(snapshot(), value);
      const before = JSON.stringify(snapshot());
      const after = JSON.stringify(merged);
      if (before === after) return false;
      assign(merged);
      save(notify);
      return true;
    },
    replace(value, { notify = false } = {}) {
      const next = normalizeBiryongSnapshot(value);
      const before = JSON.stringify(snapshot());
      const after = JSON.stringify(next);
      if (before === after) return false;
      assign(next);
      save(notify);
      return true;
    },
    snapshot
  };
}
