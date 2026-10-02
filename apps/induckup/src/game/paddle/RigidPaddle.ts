import { Bodies, Body, Composite, Engine } from 'matter-js';
import { tuning } from '../config/tuning';
import type { PaddleRuntime } from '../core/types';

export class RigidPaddle implements PaddleRuntime {
  readonly mode = 'rigid' as const;
  readonly bodies: Body[];
  readonly constraints = [];

  constructor(engine: Engine, centerX: number) {
    const body = Bodies.rectangle(centerX, tuning.paddle.baselineY, tuning.rigid.width, tuning.rigid.height, {
      isStatic: true,
      label: 'rigid-paddle',
      restitution: 1,
      chamfer: { radius: 10 },
    });
    this.bodies = [body];
    Composite.add(engine.world, body);
  }

  update(targetX: number): void {
    Body.setPosition(this.bodies[0], { x: targetX, y: tuning.paddle.baselineY });
  }

  onBallHit(ball: Body, paddle: Body): void {
    const halfWidth = tuning.rigid.width / 2;
    const offset = Math.max(-1, Math.min(1, (ball.position.x - paddle.position.x) / halfWidth));
    const speed = Math.max(tuning.ball.minSpeed, Math.hypot(ball.velocity.x, ball.velocity.y));
    const vx = ball.velocity.x + offset * 3.1;
    const vy = -Math.max(4.4, Math.abs(ball.velocity.y));
    const magnitude = Math.max(1, Math.hypot(vx, vy));
    Body.setVelocity(ball, { x: (vx / magnitude) * speed, y: (vy / magnitude) * speed });
  }

  getFlexPx(): number {
    return 0;
  }

  getCenterX(): number {
    return this.bodies[0].position.x;
  }

  destroy(engine: Engine): void {
    Composite.remove(engine.world, this.bodies[0]);
  }
}
