import { Bodies, Body, Composite, Engine } from 'matter-js';
import { LOGICAL_WIDTH, tuning } from '../config/tuning';

export class BallSystem {
  readonly body: Body;
  private readonly active = new Set<Body>();

  constructor(private readonly engine: Engine) {
    this.body = Bodies.circle(LOGICAL_WIDTH / 2, 500, tuning.ball.radius, {
      label: 'ball',
      restitution: 1,
      friction: 0,
      frictionAir: 0,
      inertia: Infinity,
      collisionFilter: { group: -42 },
    });
    Composite.add(engine.world, this.body);
    this.active.add(this.body);
  }

  get bodies(): Body[] { return [...this.active]; }

  has(body: Body): boolean { return this.active.has(body); }

  /** A second real Matter body, with separate collisions and a stable upward split. */
  spawnClone(origin: Body): Body | null {
    if (!this.active.has(origin) || this.active.size !== 1) return null;
    const radius = tuning.ball.radius;
    const x = Math.max(radius + 2, Math.min(LOGICAL_WIDTH - radius - 2, origin.position.x));
    const direction = x > LOGICAL_WIDTH - 34 ? -1 : 1;
    const clone = Bodies.circle(x + direction * (radius * 2 + 4), origin.position.y,
      radius, { label: 'ball', restitution: 1, friction: 0, frictionAir: 0,
        inertia: Infinity, collisionFilter: { group: -42 } });
    const speed = Math.max(tuning.ball.minSpeed, Math.min(tuning.ball.maxSpeed,
      Math.hypot(origin.velocity.x, origin.velocity.y) || tuning.ball.speed));
    const maxX = Math.sqrt(1 - Math.max(0.53, tuning.ball.minVerticalSpeedRatio) ** 2);
    const midX = origin.velocity.x / speed;
    for (const [ball, side] of [[origin, -1], [clone, 1]] as const) {
      const nx = Math.max(-maxX, Math.min(maxX, midX + direction * side * 0.18));
      Body.setVelocity(ball, { x: nx * speed, y: -Math.sqrt(1 - nx * nx) * speed });
    }
    Composite.add(this.engine.world, clone);
    this.active.add(clone);
    return clone;
  }

  remove(body: Body): boolean {
    if (!this.active.delete(body)) return false;
    Composite.remove(this.engine.world, body);
    return true;
  }

  launch(): void {
    const angle = -Math.PI / 2 + 0.34;
    Body.setPosition(this.body, { x: LOGICAL_WIDTH / 2, y: 500 });
    Body.setVelocity(this.body, {
      x: Math.cos(angle) * tuning.ball.speed,
      y: Math.sin(angle) * tuning.ball.speed,
    });
  }

  clampSpeed(body: Body = this.body): number {
    if (!this.active.has(body)) return 0;
    const speed = Math.hypot(body.velocity.x, body.velocity.y);
    if (speed === 0) return 0;
    const target = Math.max(tuning.ball.minSpeed, Math.min(tuning.ball.maxSpeed, speed));

    let vx = (body.velocity.x / speed) * target;
    let vy = (body.velocity.y / speed) * target;
    const minVy = target * tuning.ball.minVerticalSpeedRatio;

    if (Math.abs(vy) < minVy) {
      const ySign = Math.sign(vy) || (body.position.y < 300 ? 1 : -1);
      const xSign = Math.sign(vx) || 1;
      vy = ySign * minVy;
      vx = xSign * Math.sqrt(Math.max(0, target * target - vy * vy));
    }

    if (
      Math.abs(vx - body.velocity.x) > 0.05 ||
      Math.abs(vy - body.velocity.y) > 0.05
    ) {
      Body.setVelocity(body, { x: vx, y: vy });
    }
    return target;
  }

  destroy(): void {
    this.bodies.forEach(body => this.remove(body));
  }
}
