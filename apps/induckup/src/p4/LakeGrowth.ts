import type { Body } from 'matter-js';
import { tuning } from '../game/config/tuning';
import type { Feather } from '../game/growth/FeatherGrowth';

const LEVEL_UP_COSTS = [7, 8, 10, 11, 12, 14, 15, 16, 18, 20, 22, 24] as const;

function costForLevel(level: number): number {
  const index = Math.max(0, Math.trunc(level) - 1);
  if (index < LEVEL_UP_COSTS.length) return LEVEL_UP_COSTS[index];
  const lastIndex = LEVEL_UP_COSTS.length - 1;
  return LEVEL_UP_COSTS[lastIndex] + (index - lastIndex) * 2;
}

function levelProgress(totalXp: number): { level: number; xp: number; target: number } {
  let level = 1;
  let remaining = Math.max(0, Math.trunc(totalXp));
  while (remaining >= costForLevel(level)) {
    remaining -= costForLevel(level);
    level += 1;
  }
  return { level, xp: remaining, target: costForLevel(level) };
}

export class LakeGrowth {
  readonly feathers: Feather[] = [];
  private nextId = 0;
  private kills = 0;
  private runXp = 0;
  private recoveryEnabled = false;
  private recoveryAvailable = false;
  private readonly recovered = new Set<number>();
  recoveredCount = 0;
  evolutions = 0;

  get totalXp(): number {
    return this.runXp;
  }

  get level(): number {
    return levelProgress(this.runXp).level;
  }

  get xp(): number {
    return levelProgress(this.runXp).xp;
  }

  get targetXp(): number {
    return levelProgress(this.runXp).target;
  }

  get nextEvolutionLevel(): number | null {
    return this.evolutions < 2 ? (this.evolutions + 1) * 3 : null;
  }

  get pending(): boolean {
    const milestone = this.nextEvolutionLevel;
    return milestone !== null && this.level >= milestone;
  }

  get empty(): boolean {
    return this.feathers.length === 0;
  }

  monsterKilled(x: number, y: number): number {
    const before = this.runXp;
    this.addXp(1);
    this.kills += 1;
    if (this.kills % 3 === 0 && this.feathers.length < 5) {
      this.feathers.push({ id: ++this.nextId, x, y });
    }
    return this.runXp - before;
  }

  addXp(amount: number): void {
    if (!Number.isFinite(amount)) return;
    this.runXp += Math.max(0, Math.trunc(amount));
  }

  enableRecovery(): void {
    this.recoveryEnabled = true;
    this.recoveryAvailable = true;
  }

  get recoveryRemaining(): number { return Number(this.recoveryAvailable); }

  update(deltaMs: number, ducks: readonly Body[], featherXp = 2, pickupBonus = 0): number[] {
    const caught: number[] = [];
    const respawn: Feather[] = [];
    for (let i = this.feathers.length - 1; i >= 0; i -= 1) {
      const feather = this.feathers[i];
      feather.y += deltaMs * 0.17;
      const index = ducks.findIndex(duck => {
        const torso = duck.parts[1] ?? duck;
        const dx = feather.x - torso.position.x;
        const dy = feather.y - torso.position.y;
        const localX = dx * Math.cos(duck.angle) + dy * Math.sin(duck.angle);
        const localY = -dx * Math.sin(duck.angle) + dy * Math.cos(duck.angle);
        return (localX / (tuning.paddle.bodyHalfWidth + 7 + pickupBonus)) ** 2
          + (localY / (tuning.paddle.bodyHalfHeight + 7 + pickupBonus)) ** 2 <= 1;
      });
      if (index >= 0) {
        this.feathers.splice(i, 1);
        this.addXp(Math.max(1, Math.trunc(featherXp)));
        caught.push(index);
      } else if (feather.y > 590) {
        this.feathers.splice(i, 1);
        if (this.recoveryEnabled && this.recoveryAvailable && !this.recovered.has(feather.id) && ducks.length) {
          const duck = ducks[Math.floor(ducks.length / 2)];
          respawn.push({ id: ++this.nextId,
            x: Math.max(18, Math.min(342, duck.position.x)),
            y: Math.min(480, duck.position.y - 80) });
          this.recovered.add(respawn[respawn.length - 1].id);
          this.recoveryAvailable = false;
          this.recoveredCount += 1;
        }
      }
    }
    this.feathers.push(...respawn);
    return caught;
  }

  evolve(): void {
    if (!this.pending) return;
    this.evolutions += 1;
  }

  startArea2(): void {
    // P4 continuous growth: area transitions never reset XP, level,
    // kill cadence, or uncollected feathers.
    this.recoveryAvailable = this.recoveryEnabled;
  }
}
