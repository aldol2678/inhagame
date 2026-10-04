import { FIVE, FIVE_SOUTH_ENTRY_APPROACH } from '../north-campus-layout.js';

const frozen = value => Object.freeze(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const outward = (() => {
  const dx = FIVE_SOUTH_ENTRY_APPROACH.x - FIVE.center.x;
  const dz = FIVE_SOUTH_ENTRY_APPROACH.z - FIVE.center.z;
  const length = Math.hypot(dx, dz) || 1;
  return frozen({ x: dx / length, z: dz / length });
})();

export const BUILDING5_TRAINING_TARGET = frozen({
  id: 'combat.target.building5_resonance_drone',
  title: '5호관 공명 훈련 드론',
  x: FIVE_SOUTH_ENTRY_APPROACH.x + outward.x * 6,
  z: FIVE_SOUTH_ENTRY_APPROACH.z + outward.z * 6,
  maxHp: 4200,
  breakMax: 100,
  breakStunMs: 1550
});

// v9.22 Blaster / Rapid first-slice values.
// This is a local no-reward training resolver only. It does not create authoritative Combat results.
export const BUILDING5_BLASTER_RAPID_ACTIONS = frozen({
  basic: frozen({
    id: 'basic',
    range: 13.5,
    packets: frozen([frozen({ damage: 88, break: 4, momentum: 8 })])
  }),
  accelerate: frozen({
    id: 'accelerate',
    cooldownMs: 6000,
    rapidBuffMs: 4200,
    momentumGain: 15,
    packets: frozen([])
  }),
  slide: frozen({
    id: 'slide',
    cooldownMs: 5200,
    range: 14.5,
    packets: frozen(Array.from({ length: 3 }, () => frozen({ damage: 72, break: 4, momentum: 5 })))
  }),
  barrage: frozen({
    id: 'barrage',
    cooldownMs: 10000,
    range: 13.8,
    momentumCost: 50,
    packets: frozen(Array.from({ length: 7 }, () => frozen({ damage: 78, break: 6, momentum: 0 })))
  }),
  dodge: frozen({
    id: 'dodge',
    cooldownMs: 1200,
    packets: frozen([])
  }),
  overdrive: frozen({
    id: 'overdrive',
    durationMs: 8000,
    momentumSet: 100,
    packets: frozen([])
  })
});

const cooldownKey = identity => identity === 'accelerate' ? 'active_1'
  : identity === 'slide' ? 'active_2'
  : identity === 'barrage' ? 'active_3'
  : identity === 'dodge' ? 'dodge'
  : null;

export function createBuilding5CombatTraining({
  clock = { now: () => Date.now() },
  getPlayerPosition = () => null,
  target = BUILDING5_TRAINING_TARGET
} = {}) {
  const listeners = new Set();
  let active = false;
  let generation = 0;
  let hp = target.maxHp;
  let breakValue = 0;
  let brokenUntil = 0;
  let defeatedAt = null;
  let momentum = 0;
  let rapidBuffUntil = 0;
  let overdriveUntil = 0;
  let hitSerial = 0;
  let breakSerial = 0;
  let lastHit = null;
  const cooldownUntil = { active_1: 0, active_2: 0, active_3: 0, dodge: 0 };

  const now = () => Number(clock.now());
  const cooldowns = at => frozen(Object.fromEntries(Object.entries(cooldownUntil).map(([key, until]) => [
    key, Math.max(0, until - at)
  ])));

  const snapshot = () => {
    const at = now();
    return frozen({
      active,
      generation,
      target: frozen({ ...target }),
      hp,
      maxHp: target.maxHp,
      hpRatio: target.maxHp > 0 ? hp / target.maxHp : 0,
      breakValue,
      breakMax: target.breakMax,
      breakRatio: target.breakMax > 0 ? breakValue / target.breakMax : 0,
      broken: active && hp > 0 && brokenUntil > at,
      brokenRemainingMs: Math.max(0, brokenUntil - at),
      defeated: hp <= 0,
      defeatedAt,
      momentum,
      rapidBuff: rapidBuffUntil > at,
      rapidBuffRemainingMs: Math.max(0, rapidBuffUntil - at),
      overdrive: overdriveUntil > at,
      overdriveRemainingMs: Math.max(0, overdriveUntil - at),
      cooldowns: cooldowns(at),
      hitSerial,
      breakSerial,
      lastHit
    });
  };

  const emit = event => {
    const state = snapshot();
    for (const listener of listeners) listener(state, event);
    return state;
  };

  function resetTarget({ preserveMomentum = true } = {}) {
    generation += 1;
    hp = target.maxHp;
    breakValue = 0;
    brokenUntil = 0;
    defeatedAt = null;
    hitSerial = 0;
    breakSerial = 0;
    lastHit = null;
    for (const key of Object.keys(cooldownUntil)) cooldownUntil[key] = 0;
    rapidBuffUntil = 0;
    overdriveUntil = 0;
    if (!preserveMomentum) momentum = 0;
    return emit('reset');
  }

  function start() {
    active = true;
    momentum = 0;
    resetTarget({ preserveMomentum: true });
    return emit('start');
  }

  function end() {
    if (!active) return false;
    active = false;
    momentum = 0;
    for (const key of Object.keys(cooldownUntil)) cooldownUntil[key] = 0;
    rapidBuffUntil = 0;
    overdriveUntil = 0;
    emit('end');
    return true;
  }

  const distanceToTarget = () => {
    const player = getPlayerPosition?.();
    if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.z)) return Infinity;
    return Math.hypot(player.x - target.x, player.z - target.z);
  };

  function resolvePackets(definition, at) {
    const distance = distanceToTarget();
    if (Number.isFinite(definition.range) && distance > definition.range) {
      lastHit = frozen({
        hit: false, damage: 0, breakApplied: 0, breakTriggered: 0,
        killed: false, distance, reason: 'OUT_OF_RANGE'
      });
      return frozen({ ...lastHit, damagePackets: frozen([]) });
    }

    let totalDamage = 0;
    let totalBreak = 0;
    let triggered = 0;
    const damagePackets = [];

    for (const packet of definition.packets) {
      if (hp <= 0) break;
      const power = definition.id === 'basic' && momentum >= 70 ? 1.12 : 1;
      const damage = Math.max(0, Math.round(packet.damage * power));
      hp = Math.max(0, hp - damage);
      totalDamage += damage;
      damagePackets.push(damage);
      momentum = clamp(momentum + packet.momentum, 0, 100);

      if (hp > 0) {
        breakValue += packet.break;
        totalBreak += packet.break;
        if (breakValue >= target.breakMax) {
          breakValue = 0;
          brokenUntil = at + target.breakStunMs;
          breakSerial += 1;
          triggered += 1;
        }
      }
    }

    if (damagePackets.length > 0) hitSerial += 1;
    if (hp <= 0 && defeatedAt == null) defeatedAt = at;
    lastHit = frozen({
      hit: damagePackets.length > 0,
      damage: totalDamage,
      breakApplied: totalBreak,
      breakTriggered: triggered,
      killed: hp <= 0,
      distance,
      reason: damagePackets.length > 0 ? null : 'NO_PACKET'
    });
    return frozen({ ...lastHit, damagePackets: frozen(damagePackets) });
  }

  function resolveAction({ action, identity } = {}) {
    if (!active) return frozen({ accepted: false, reason: 'TRAINING_NOT_ACTIVE' });
    if (hp <= 0 && action !== 'dodge') return frozen({ accepted: false, reason: 'TARGET_DEFEATED' });

    const at = now();
    const definition = BUILDING5_BLASTER_RAPID_ACTIONS[identity] ?? BUILDING5_BLASTER_RAPID_ACTIONS[action];
    if (!definition) return frozen({ accepted: false, reason: 'UNIMPLEMENTED_TRAINING_ACTION', identity });

    const key = cooldownKey(identity);
    if (key && cooldownUntil[key] > at) {
      return frozen({ accepted: false, reason: 'COOLDOWN', cooldownRemainingMs: cooldownUntil[key] - at });
    }

    if (definition.momentumCost && momentum < definition.momentumCost) {
      return frozen({ accepted: false, reason: 'RESOURCE_REQUIRED', resource: 'overcharge', required: definition.momentumCost, current: momentum });
    }

    if (key && definition.cooldownMs) cooldownUntil[key] = at + definition.cooldownMs;
    if (definition.momentumCost) momentum = Math.max(0, momentum - definition.momentumCost);
    if (definition.momentumGain) momentum = clamp(momentum + definition.momentumGain, 0, 100);
    if (definition.momentumSet != null) momentum = clamp(definition.momentumSet, 0, 100);
    if (definition.rapidBuffMs) rapidBuffUntil = Math.max(rapidBuffUntil, at + definition.rapidBuffMs);
    if (definition.durationMs && identity === 'overdrive') {
      overdriveUntil = Math.max(overdriveUntil, at + definition.durationMs);
      rapidBuffUntil = Math.max(rapidBuffUntil, at + definition.durationMs);
    }

    const resolved = resolvePackets(definition, at);
    const result = frozen({
      accepted: true,
      identity,
      action,
      activeSkillSucceeded: action.startsWith('active_'),
      ...resolved,
      training: snapshot()
    });
    emit('resolve');
    return result;
  }

  function subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== 'function') throw new TypeError('Training listener must be a function');
    listeners.add(listener);
    if (emitCurrent) listener(snapshot(), 'sync');
    return () => listeners.delete(listener);
  }

  return frozen({
    snapshot,
    start,
    end,
    resetTarget,
    resolveAction,
    subscribe
  });
}
