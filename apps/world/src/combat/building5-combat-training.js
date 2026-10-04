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

export const BUILDING5_TRAINING_PLAYER = frozen({
  maxHp: 1000,
  dodgeDurationMs: 280,
  dodgeDistance: 2.2,
  iframeStartMs: 70,
  iframeEndMs: 230,
  perfectStartMs: 70,
  perfectEndMs: 180
});

// v9.22 support-drone facts with a learnable telegraph added for the campus training slice.
// Damage/range/cadence are inherited from the prototype; windup is the training presentation contract.
export const BUILDING5_TRAINING_ATTACK = frozen({
  id: 'training_pulse',
  title: '공명 펄스',
  damage: 44,
  range: 5,
  impactRadius: 1.15,
  cooldownMs: 2000,
  firstDelayMs: 1200,
  windupMs: 680
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
  getDodgeDirection = () => ({ x: 0, z: 1 }),
  target = BUILDING5_TRAINING_TARGET,
  playerDefinition = BUILDING5_TRAINING_PLAYER,
  enemyAttack = BUILDING5_TRAINING_ATTACK
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

  let playerHp = playerDefinition.maxHp;
  let playerDefeatedAt = null;
  let playerHitSerial = 0;
  let perfectDodgeSerial = 0;
  let lastPlayerHit = null;
  let dodge = frozen({
    active: false,
    startedAt: 0,
    endsAt: 0,
    iframeStartAt: 0,
    iframeEndAt: 0,
    perfectStartAt: 0,
    perfectEndAt: 0,
    perfectUsed: false,
    dirX: 0,
    dirZ: 1,
    travelled: 0
  });

  let enemyAttackSerial = 0;
  let nextEnemyAttackAt = 0;
  let enemyWindup = null;
  let lastEnemyAttack = null;

  const cooldownUntil = { basic: 0, active_1: 0, active_2: 0, active_3: 0, dodge: 0 };

  const now = () => Number(clock.now());
  const cooldowns = at => frozen(Object.fromEntries(Object.entries(cooldownUntil).map(([key, until]) => [
    key, Math.max(0, until - at)
  ])));

  const dodgeSnapshot = at => frozen({
    ...dodge,
    active: dodge.active && at < dodge.endsAt,
    elapsedMs: dodge.active ? clamp(at - dodge.startedAt, 0, playerDefinition.dodgeDurationMs) : 0,
    remainingMs: dodge.active ? Math.max(0, dodge.endsAt - at) : 0,
    iframe: dodge.active && at >= dodge.iframeStartAt && at <= dodge.iframeEndAt,
    perfectWindow: dodge.active && !dodge.perfectUsed && at >= dodge.perfectStartAt && at <= dodge.perfectEndAt
  });

  const enemyAttackSnapshot = at => {
    if (!enemyWindup) return frozen({
      phase: 'IDLE',
      id: enemyAttack.id,
      title: enemyAttack.title,
      damage: enemyAttack.damage,
      range: enemyAttack.range,
      impactRadius: enemyAttack.impactRadius,
      nextInMs: Math.max(0, nextEnemyAttackAt - at),
      remainingMs: 0,
      progress: 0,
      aimX: null,
      aimZ: null,
      serial: enemyAttackSerial
    });
    const remaining = Math.max(0, enemyWindup.impactAt - at);
    return frozen({
      phase: 'WINDUP',
      id: enemyAttack.id,
      title: enemyAttack.title,
      damage: enemyAttack.damage,
      range: enemyAttack.range,
      impactRadius: enemyAttack.impactRadius,
      nextInMs: 0,
      remainingMs: remaining,
      progress: clamp(1 - remaining / Math.max(1, enemyAttack.windupMs), 0, 1),
      aimX: enemyWindup.aimX,
      aimZ: enemyWindup.aimZ,
      serial: enemyWindup.serial
    });
  };

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
      lastHit,
      player: frozen({
        hp: playerHp,
        maxHp: playerDefinition.maxHp,
        hpRatio: playerDefinition.maxHp > 0 ? playerHp / playerDefinition.maxHp : 0,
        defeated: playerHp <= 0,
        defeatedAt: playerDefeatedAt,
        hitSerial: playerHitSerial,
        perfectDodgeSerial,
        lastHit: lastPlayerHit,
        dodge: dodgeSnapshot(at)
      }),
      enemyAttack: enemyAttackSnapshot(at),
      lastEnemyAttack
    });
  };

  const emit = event => {
    const state = snapshot();
    for (const listener of listeners) listener(state, event);
    return state;
  };

  const playerPosition = () => {
    const player = getPlayerPosition?.();
    return player && Number.isFinite(player.x) && Number.isFinite(player.z) ? player : null;
  };

  const distanceToTarget = () => {
    const player = playerPosition();
    if (!player) return Infinity;
    return Math.hypot(player.x - target.x, player.z - target.z);
  };

  function clearDodge() {
    dodge = frozen({
      active: false,
      startedAt: 0,
      endsAt: 0,
      iframeStartAt: 0,
      iframeEndAt: 0,
      perfectStartAt: 0,
      perfectEndAt: 0,
      perfectUsed: false,
      dirX: 0,
      dirZ: 1,
      travelled: 0
    });
  }

  function clearEnemyAttack(at, delayMs = enemyAttack.cooldownMs) {
    enemyWindup = null;
    nextEnemyAttackAt = at + delayMs;
  }

  function resetTarget({ preserveMomentum = true } = {}) {
    const at = now();
    generation += 1;
    hp = target.maxHp;
    breakValue = 0;
    brokenUntil = 0;
    defeatedAt = null;
    hitSerial = 0;
    breakSerial = 0;
    lastHit = null;
    playerHp = playerDefinition.maxHp;
    playerDefeatedAt = null;
    playerHitSerial = 0;
    perfectDodgeSerial = 0;
    lastPlayerHit = null;
    for (const key of Object.keys(cooldownUntil)) cooldownUntil[key] = 0;
    rapidBuffUntil = 0;
    overdriveUntil = 0;
    clearDodge();
    enemyAttackSerial = 0;
    lastEnemyAttack = null;
    clearEnemyAttack(at, enemyAttack.firstDelayMs);
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
    clearDodge();
    enemyWindup = null;
    emit('end');
    return true;
  }

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
          clearEnemyAttack(at, target.breakStunMs + 450);
        }
      }
    }

    if (damagePackets.length > 0) hitSerial += 1;
    if (hp <= 0 && defeatedAt == null) {
      defeatedAt = at;
      enemyWindup = null;
    }
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

  function startDodge(at) {
    const raw = getDodgeDirection?.() ?? { x: 0, z: 1 };
    const length = Math.hypot(Number(raw.x) || 0, Number(raw.z) || 0) || 1;
    dodge = frozen({
      active: true,
      startedAt: at,
      endsAt: at + playerDefinition.dodgeDurationMs,
      iframeStartAt: at + playerDefinition.iframeStartMs,
      iframeEndAt: at + playerDefinition.iframeEndMs,
      perfectStartAt: at + playerDefinition.perfectStartMs,
      perfectEndAt: at + playerDefinition.perfectEndMs,
      perfectUsed: false,
      dirX: (Number(raw.x) || 0) / length,
      dirZ: (Number(raw.z) || 0) / length,
      travelled: 0
    });
  }

  function consumeDodgeTravel() {
    if (!dodge.active) return frozen({ x: 0, z: 0, distance: 0, done: true });
    const at = now();
    const q = clamp((at - dodge.startedAt) / Math.max(1, playerDefinition.dodgeDurationMs), 0, 1);
    const targetTravel = playerDefinition.dodgeDistance * .5 * (1 - Math.cos(Math.PI * q));
    const delta = Math.max(0, targetTravel - dodge.travelled);
    const done = q >= 1;
    const result = frozen({
      x: dodge.dirX * delta,
      z: dodge.dirZ * delta,
      distance: delta,
      totalDistance: targetTravel,
      done
    });
    dodge = frozen({ ...dodge, travelled: targetTravel, active: !done });
    return result;
  }

  function resolveAction({ action, identity } = {}) {
    if (!active) return frozen({ accepted: false, reason: 'TRAINING_NOT_ACTIVE' });
    if (playerHp <= 0) return frozen({ accepted: false, reason: 'PLAYER_DEFEATED' });
    if (hp <= 0 && action !== 'dodge') return frozen({ accepted: false, reason: 'TARGET_DEFEATED' });

    const at = now();
    const definition = BUILDING5_BLASTER_RAPID_ACTIONS[identity] ?? BUILDING5_BLASTER_RAPID_ACTIONS[action];
    if (!definition) return frozen({ accepted: false, reason: 'UNIMPLEMENTED_TRAINING_ACTION', identity });

    const key = action === 'basic' ? 'basic' : cooldownKey(identity);
    if (key && cooldownUntil[key] > at) {
      return frozen({ accepted: false, reason: 'COOLDOWN', cooldownRemainingMs: cooldownUntil[key] - at });
    }

    if (definition.momentumCost && momentum < definition.momentumCost) {
      return frozen({
        accepted: false,
        reason: 'RESOURCE_REQUIRED',
        resource: 'overcharge',
        required: definition.momentumCost,
        current: momentum
      });
    }

    if (action === 'basic') {
      const basicIntervalMs = rapidBuffUntil > at ? 145 : momentum >= 70 ? 180 : 220;
      cooldownUntil.basic = at + basicIntervalMs;
    } else if (key && definition.cooldownMs) {
      cooldownUntil[key] = at + definition.cooldownMs;
    }
    if (action === 'dodge') {
      startDodge(at);
      emit('dodge');
      return frozen({ accepted: true, action, identity, dodge: dodgeSnapshot(at), training: snapshot() });
    }

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

  function beginEnemyWindup(at) {
    const player = playerPosition();
    if (!player || distanceToTarget() > enemyAttack.range) return null;
    enemyAttackSerial += 1;
    enemyWindup = frozen({
      serial: enemyAttackSerial,
      startedAt: at,
      impactAt: at + enemyAttack.windupMs,
      aimX: player.x,
      aimZ: player.z
    });
    emit('enemy-windup');
    return enemyWindup;
  }

  function resolveEnemyImpact(at) {
    if (!enemyWindup) return null;
    const attack = enemyWindup;
    enemyWindup = null;

    const dodgeState = dodgeSnapshot(at);
    const player = playerPosition();
    const inRange = !!player && Math.hypot(player.x - attack.aimX, player.z - attack.aimZ) <= enemyAttack.impactRadius;
    let outcome = 'MISS';
    let damage = 0;
    let perfectDodge = false;

    if (inRange) {
      if (dodgeState.iframe) {
        outcome = dodgeState.perfectWindow ? 'PERFECT_DODGE' : 'DODGE';
        if (dodgeState.perfectWindow) {
          perfectDodge = true;
          perfectDodgeSerial += 1;
          momentum = clamp(momentum + 20, 0, 100);
          cooldownUntil.active_1 = Math.max(at, cooldownUntil.active_1 - 1000);
          dodge = frozen({ ...dodge, perfectUsed: true });
        }
      } else {
        outcome = 'HIT';
        damage = enemyAttack.damage;
        playerHp = Math.max(0, playerHp - damage);
        playerHitSerial += 1;
        if (playerHp <= 0 && playerDefeatedAt == null) playerDefeatedAt = at;
      }
    }

    lastPlayerHit = frozen({
      serial: enemyAttackSerial,
      attackId: enemyAttack.id,
      outcome,
      damage,
      perfectDodge,
      at
    });
    lastEnemyAttack = frozen({
      ...lastPlayerHit,
      aimX: attack.aimX,
      aimZ: attack.aimZ
    });
    clearEnemyAttack(at);
    emit(perfectDodge ? 'perfect-dodge' : outcome === 'HIT' ? 'player-hit' : 'enemy-impact');
    return frozen({
      type: 'enemy-impact',
      outcome,
      damage,
      perfectDodge,
      playerDefeated: playerHp <= 0,
      attack: lastEnemyAttack
    });
  }

  function update() {
    if (!active) return null;
    const at = now();

    if (hp <= 0 || playerHp <= 0) {
      enemyWindup = null;
      return null;
    }

    if (brokenUntil > at) {
      if (enemyWindup) clearEnemyAttack(at, target.breakStunMs + 450);
      return null;
    }

    if (enemyWindup && at >= enemyWindup.impactAt) return resolveEnemyImpact(at);
    if (!enemyWindup && at >= nextEnemyAttackAt) {
      const started = beginEnemyWindup(at);
      if (!started) {
        nextEnemyAttackAt = at + 250;
        return null;
      }
      return frozen({ type: 'enemy-windup', attack: enemyAttackSnapshot(at) });
    }
    return null;
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
    consumeDodgeTravel,
    update,
    subscribe
  });
}
