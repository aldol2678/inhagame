import type { Body } from 'matter-js';
import { tuning } from '../config/tuning';

export interface Feather { id: number; x: number; y: number }

/** Items are visual pickups; keeping them outside Matter avoids altering ball rebounds. */
export class FeatherGrowth {
  get targetXp(): number { return this.wave === 1 ? 8 : 12; }
  readonly feathers: Feather[] = [];
  private readonly waiting: Feather[] = [];
  private nextId = 0;
  bricksBroken = 0;
  xp = 0;
  evolutions = 0;
  wave = 1;
  get evolved(): boolean { return this.evolutions > 0; }
  private get collecting(): boolean { return this.wave === this.evolutions + 1 && this.evolutions < 2; }

  brickBroken(x: number, y: number): void {
    if (!this.collecting || this.xp >= this.targetXp) return;
    this.bricksBroken++;
    this.addXp(1);
    // Give immediate feedback on the first break, then keep a two-brick cadence.
    if (this.bricksBroken % 2 === 1) this.waiting.push({ id: ++this.nextId, x, y });
    this.fillSlots();
  }

  private fillSlots(): void {
    while (this.feathers.length < 5 && this.waiting.length) this.feathers.push(this.waiting.shift()!);
  }

  addXp(amount: number): void {
    if (!this.collecting || !Number.isFinite(amount)) return;
    this.xp = Math.min(this.targetXp, this.xp + Math.max(0, Math.trunc(amount)));
  }

  /** Return the index of the duck that caught each feather. */
  update(deltaMs: number, ducks: readonly Body[]): number[] {
    const caught: number[] = [];
    for (let i = this.feathers.length - 1; i >= 0; i--) {
      const feather = this.feathers[i];
      feather.y += deltaMs * 0.17;
      const index = ducks.findIndex(duck => {
        const torso = duck.parts[1] ?? duck;
        const dx = feather.x - torso.position.x, dy = feather.y - torso.position.y;
        const localX = dx * Math.cos(duck.angle) + dy * Math.sin(duck.angle);
        const localY = -dx * Math.sin(duck.angle) + dy * Math.cos(duck.angle);
        return (localX / (tuning.paddle.bodyHalfWidth + 7)) ** 2
          + (localY / (tuning.paddle.bodyHalfHeight + 7)) ** 2 <= 1;
      });
      if (index >= 0) {
        this.feathers.splice(i, 1);
        if (this.collecting && this.xp < this.targetXp) { this.addXp(2); caught.push(index); }
      } else if (feather.y > 590) this.feathers.splice(i, 1);
    }
    this.fillSlots();
    return caught;
  }

  get pending(): boolean { return this.collecting && this.xp >= this.targetXp; }
  get level(): number { return 1 + this.evolutions + Number(this.pending); }
  get empty(): boolean { return this.feathers.length === 0 && this.waiting.length === 0; }

  evolve(): void {
    if (!this.pending) return;
    this.evolutions++;
    this.feathers.length = 0;
    this.waiting.length = 0;
  }

  startSecondWave(): void {
    if (this.wave !== 1) return;
    this.wave = 2;
    this.xp = 0;
    this.bricksBroken = 0;
    this.feathers.length = 0;
    this.waiting.length = 0;
  }
}
