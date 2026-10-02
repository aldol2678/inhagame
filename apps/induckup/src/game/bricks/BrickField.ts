import { Bodies, Body, Composite, Engine } from 'matter-js';
import { LOGICAL_WIDTH, tuning } from '../config/tuning';

export type BrickPattern = 'classic' | 'clusters';
export interface BrickDurability { hp: number; maxHp: number }
const HOLES: Record<BrickPattern, Set<string>> = {
  classic: new Set(['0:3', '1:5', '2:1', '2:6', '3:4']),
  // Same 35 bricks: dense lower field, two isolated top corners with no bomb neighbor.
  clusters: new Set(['0:1', '1:0', '0:6', '1:7', '2:3']),
};

export class BrickField {
  readonly bodies: Body[] = [];
  private remaining = new Set<number>();
  private readonly cells = new Map<number, { row: number; col: number }>();
  readonly durability = new Map<number, BrickDurability>();

  constructor(private readonly engine: Engine, readonly pattern: BrickPattern = 'classic',
    readonly reinforced = false) {
    const { columns, rows, side, gap, top, height } = tuning.bricks;
    const width = (LOGICAL_WIDTH - side * 2 - gap * (columns - 1)) / columns;

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        if (HOLES[pattern].has(`${row}:${col}`)) continue;
        const x = side + width / 2 + col * (width + gap);
        const y = top + row * (height + gap);
        const body = Bodies.rectangle(x, y, width, height, {
          isStatic: true,
          label: 'brick',
          restitution: 1,
          chamfer: { radius: 4 },
        });
        this.bodies.push(body);
        this.remaining.add(body.id);
        this.cells.set(body.id, { row, col });
        // A few separated armored bricks change the route without sealing an entire row.
        if (reinforced && (row === 1 || row === 3) && col % 2 === 1) {
          this.durability.set(body.id, { hp: 2, maxHp: 2 });
        }
      }
    }
    Composite.add(engine.world, this.bodies);
  }

  destroyBrick(body: Body): boolean {
    if (!this.remaining.delete(body.id)) return false;
    this.durability.delete(body.id);
    Composite.remove(this.engine.world, body);
    return true;
  }

  /** A direct ball contact chips armor; only the final hit removes the body. */
  hitBrick(body: Body): 'none' | 'damaged' | 'destroyed' {
    if (!this.remaining.has(body.id)) return 'none';
    const armor = this.durability.get(body.id);
    if (armor && --armor.hp > 0) return 'damaged';
    return this.destroyBrick(body) ? 'destroyed' : 'none';
  }

  /** One neighboring grid cell only; holes and previously broken bricks are skipped. */
  destroyAdjacentBrick(origin: Body): Body | null {
    const cell = this.cells.get(origin.id);
    if (!cell) return null;
    const neighbors = this.bodies.filter(body => {
      if (!this.remaining.has(body.id)) return false;
      const other = this.cells.get(body.id)!;
      return Math.abs(other.row - cell.row) + Math.abs(other.col - cell.col) === 1;
    }).sort((a, b) => {
      const da = Math.hypot(a.position.x - origin.position.x, a.position.y - origin.position.y);
      const db = Math.hypot(b.position.x - origin.position.x, b.position.y - origin.position.y);
      return da - db || a.id - b.id;
    });
    const target = neighbors[0];
    return target && this.destroyBrick(target) ? target : null;
  }

  get remainingCount(): number {
    return this.remaining.size;
  }

  destroy(): void {
    this.bodies.forEach((body) => Composite.remove(this.engine.world, body));
    this.remaining.clear();
    this.durability.clear();
  }
}
