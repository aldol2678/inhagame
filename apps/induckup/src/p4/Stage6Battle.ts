/** Stage 6's four encounters are isolated from the earlier two-Area campaigns. */
export type BackGateArea = 1 | 2 | 3 | 4;

export const BACK_GATE_TARGETS = [12, 14, 14, 5] as const;
export const BACK_GATE_LAMPS = [
  { x: 92, y: 250, width: 14, height: 62 },
  { x: 268, y: 250, width: 14, height: 62 },
] as const;
export const BACK_GATE_WAVES = {
  1: [
    { columns: [0, 3, 5], kinds: ['wave', 'swarm', 'wave'] },
    { columns: [1, 3, 5], kinds: ['armor', 'wave', 'support'] },
    { columns: [0, 2, 4], kinds: ['shield', 'swarm', 'wave'] },
    { columns: [1, 3, 5], kinds: ['wave', 'armor', 'swarm'] },
  ],
  2: [
    { columns: [0, 2, 5], kinds: ['splitter', 'wave', 'rush'] },
    { columns: [1, 3, 5], kinds: ['flank', 'surge', 'wave'] },
    { columns: [0, 2, 4], kinds: ['splitter', 'rush', 'wave'] },
    { columns: [1, 3, 5], kinds: ['wave', 'surge', 'flank'] },
  ],
  3: [
    { columns: [0, 2, 5], kinds: ['shield', 'support', 'wave'] },
    { columns: [1, 3, 5], kinds: ['rush', 'armor', 'wave'] },
    { columns: [0, 2, 4], kinds: ['splitter', 'surge', 'support'] },
    { columns: [1, 3, 5], kinds: ['wave', 'shield', 'flank'] },
  ],
} as const;
export const FINAL_BOSS_STATS = { maxHp: 120, attack: 45, defense: 4, speed: 10 } as const;
export const FINAL_SHIELD_STATS = { maxHp: 12, attack: 10, defense: 1, speed: 10 } as const;
export const FINAL_PHASE_SPEED = [0, 10, 10, 10, 14, 18] as const;
export const FINAL_PHASE_NAMES = ['','초안 · 방어막','심사 · 이동 약점','수정 · 졸개 소환',
  '발표 · 직접 하강','마감 · Final Rush'] as const;

export function finalPhaseForHp(hp: number): 1 | 2 | 3 | 4 | 5 {
  if (hp <= 24) return 5;
  if (hp <= 48) return 4;
  if (hp <= 72) return 3;
  if (hp <= 96) return 2;
  return 1;
}
