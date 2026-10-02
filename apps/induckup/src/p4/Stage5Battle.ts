/** Stage 5 data stays separate from the earlier campaign wave patterns. */
export const ANNIVERSARY_EXHIBITS = [
  { x: 104, y: 250, width: 16, height: 72 },
  { x: 256, y: 250, width: 16, height: 72 },
] as const;
export const ANNIVERSARY_LECTERN = { x: 180, y: 246, width: 22, height: 76 } as const;
export const ANNIVERSARY_STATS = {
  'elite-command': { maxHp: 36, attack: 32, defense: 3, speed: 12 },
  'elite-giant': { maxHp: 64, attack: 42, defense: 4, speed: 10 },
} as const;
export const ANNIVERSARY_COMMAND_RADIUS = 70;
export const ANNIVERSARY_COMMAND_DEFENSE = 2;
export const ANNIVERSARY_FINALS = {
  1: [{ column: 2, kind: 'elite-command' }, { column: 3, kind: 'wave' }],
  2: [{ column: 1, kind: 'shield' }, { column: 3, kind: 'elite-giant' },
    { column: 5, kind: 'swarm' }],
} as const;
export const ANNIVERSARY_FREEZE_COOLDOWN_MS = 6000;
export const ANNIVERSARY_FREEZE_SLOW = 0.6;
export const ANNIVERSARY_FREEZE_NORMAL_MS = 1200;
export const ANNIVERSARY_FREEZE_ELITE_MS = 600;
export const ANNIVERSARY_WAVES = {
  1: [
    { columns: [0, 3, 5], kinds: ['wave', 'swarm', 'armor'] },
    { columns: [1, 3, 5], kinds: ['support', 'shield', 'wave'] },
    { columns: [0, 2, 4], kinds: ['swarm', 'armor', 'wave'] },
    { columns: [1, 3, 5], kinds: ['wave', 'support', 'shield'] },
  ],
  2: [
    { columns: [0, 2, 4, 5], kinds: ['wave', 'swarm', 'shelf', 'rapid'] },
    { columns: [0, 2, 5], kinds: ['splitter', 'wave', 'rapid'] },
    { columns: [1, 3, 5], kinds: ['armor', 'swarm', 'shield'] },
    { columns: [0, 2, 4], kinds: ['rapid', 'splitter', 'wave'] },
  ],
} as const;
