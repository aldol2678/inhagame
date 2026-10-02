import { describe, expect, it } from 'vitest';
import { Body, Engine } from 'matter-js';
import { BallSystem } from '../../src/game/ball/BallSystem';
import { tuning } from '../../src/game/config/tuning';

describe('ball anti-stall guard', () => {
  it('restores a meaningful vertical component to near-horizontal motion', () => {
    const engine = Engine.create({ gravity: { x: 0, y: 0, scale: 0 } });
    const ball = new BallSystem(engine);
    Body.setPosition(ball.body, { x: 180, y: 120 });
    Body.setVelocity(ball.body, { x: 8.4, y: 0.05 });

    const speed = ball.clampSpeed();

    expect(Math.abs(ball.body.velocity.y)).toBeGreaterThanOrEqual(
      speed * tuning.ball.minVerticalSpeedRatio - 0.05,
    );
    expect(Math.hypot(ball.body.velocity.x, ball.body.velocity.y)).toBeCloseTo(speed, 2);
  });
});
