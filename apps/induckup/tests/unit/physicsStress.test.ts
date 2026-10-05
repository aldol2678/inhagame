import { describe, expect, it } from 'vitest';
import { Body, Engine } from 'matter-js';
import { LivingPaddle } from '../../src/game/paddle/LivingPaddle';
import { createWorld } from '../../src/game/physics/createWorld';
import { tuning } from '../../src/game/config/tuning';

describe('living paddle stress', () => {
  it('keeps five finite connected ducks through three simulated minutes', () => {
    const engine = Engine.create({ gravity: { x: 0, y: 0, scale: 0 }, enableSleeping: false });
    const paddle = new LivingPaddle(engine, 180);

    for (let frame = 0; frame < 10_800; frame += 1) {
      const targetX = 180 + Math.sin(frame / 75) * 125;
      paddle.update(targetX, 16.6667);
      if (frame % 240 === 0) {
        Body.applyForce(paddle.bodies[frame % 480 === 0 ? 0 : 4], paddle.bodies[0].position, {
          x: frame % 480 === 0 ? -0.012 : 0.012,
          y: -0.008,
        });
      }
      Engine.update(engine, 16.6667);
      paddle.stabilize();

      if (frame % 600 === 0) {
        for (const body of paddle.bodies) {
          expect(Number.isFinite(body.position.x)).toBe(true);
          expect(Number.isFinite(body.position.y)).toBe(true);
          expect(Number.isFinite(body.velocity.x)).toBe(true);
          expect(Number.isFinite(body.velocity.y)).toBe(true);
          expect(Math.abs(body.angle)).toBeLessThan(tuning.paddle.maxAngle + 0.06);
        }
      }
    }

    expect(paddle.bodies).toHaveLength(5);
    expect(paddle.constraints).toHaveLength(4);
    expect(Number.isFinite(paddle.getFlexPx())).toBe(true);
  });

  it('does not collapse ducks into each other when held against a wall', () => {
    const world = createWorld();
    const paddle = new LivingPaddle(world.engine, 180);

    for (let frame = 0; frame < 360; frame += 1) {
      paddle.update(0, 16.6667);
      Engine.update(world.engine, 16.6667);
    }

    const xs = paddle.bodies.map((body) => body.position.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(tuning.paddle.duckRadius - 1.5);

    for (let i = 0; i < paddle.bodies.length; i += 1) {
      for (let j = i + 1; j < paddle.bodies.length; j += 1) {
        const a = paddle.bodies[i].position;
        const b = paddle.bodies[j].position;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        expect(distance).toBeGreaterThanOrEqual(tuning.paddle.minDuckDistance - 2.5);
      }
    }
  });
});
