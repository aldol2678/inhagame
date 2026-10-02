import type { LakeMonsterKind } from './MonsterField';

export type RankedWaveType = 'normal' | 'mixed' | 'elite' | 'boss';

export interface RankedWavePlan {
  type: RankedWaveType;
  enemies: LakeMonsterKind[];
  multiplier: number;
  spawnIntervalMs: number;
}

/** Local practice rules. Official ranking rules and score are defined separately. */
export function rankedWavePlan(wave: number): RankedWavePlan {
  const number = Math.max(1, Math.trunc(Number.isFinite(wave) ? wave : 1));
  const cycle = (number - 1) % 10 + 1;
  const multiplier = Math.min(3, 1 + (number - 1) * 0.075);
  const spawnIntervalMs = Math.max(2600, 5200 - Math.min(number - 1, 30) * 80);
  if (cycle === 10) return {
    type: 'boss', enemies: ['guard', 'guard', 'boss'], multiplier, spawnIntervalMs,
  };
  if (cycle === 5) return {
    type: 'elite', enemies: ['wave', 'armor', 'elite-giant', 'rapid', 'armor'],
    multiplier, spawnIntervalMs,
  };
  const mixed = cycle === 3 || cycle === 7 || cycle === 9;
  const ordinary: LakeMonsterKind[] = mixed
    ? ['wave', 'rapid', 'armor', 'rush', 'wave', 'guard', 'rapid']
    : ['wave', 'rapid', 'wave', 'swarm', 'wave', 'armor', 'rapid'];
  return {
    type: mixed ? 'mixed' : 'normal',
    enemies: ordinary.slice(0, Math.min(ordinary.length, 5 + Math.floor(cycle / 3))),
    multiplier, spawnIntervalMs,
  };
}
