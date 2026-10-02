/** Stage 4's battle data is kept separate from the shared Stage 1–3 wave rules. */
export const FIFTH_DIVIDER = { x: 180, y: 258, width: 18, height: 136 } as const;

export const FIFTH_STATS = {
  splitter: { maxHp: 16, attack: 28, defense: 1, speed: 15 },
  fragment: { maxHp: 5, attack: 14, defense: 0, speed: 20 },
  flank: { maxHp: 12, attack: 30, defense: 1, speed: 17 },
  surge: { maxHp: 10, attack: 35, defense: 0, speed: 16 },
  'team-doc': { maxHp: 30, attack: 34, defense: 2, speed: 11 },
  'team-contact': { maxHp: 48, attack: 38, defense: 3, speed: 11 },
  'team-slide': { maxHp: 30, attack: 34, defense: 2, speed: 11 },
} as const;

export type FifthMonsterKind = keyof typeof FIFTH_STATS;
export const FIFTH_TEAM_PARTS: readonly FifthMonsterKind[] =
  ['team-doc', 'team-contact', 'team-slide'];
export const FIFTH_FINAL_WAVE = [
  { column: 1, kind: 'team-doc' },
  { column: 3, kind: 'team-contact' },
  { column: 4, kind: 'team-slide' },
] as const;
export const FIFTH_WAVE_COLUMNS = [[0, 1, 4, 5], [5, 4, 1, 0]] as const;
export const FIFTH_OPENING = ['wave', 'flank', 'wave'] as const;
export const FIFTH_FLANK_SHIFT = 44;
export const FIFTH_SURGE_SPEED = 29;
export const FIFTH_FRAGMENT_CAP = 6;
