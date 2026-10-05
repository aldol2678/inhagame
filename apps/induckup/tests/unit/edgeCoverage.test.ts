import { describe, expect, it } from 'vitest';
import { Bodies, Body, Composite, Engine, Events } from 'matter-js';
import { LivingPaddle } from '../../src/game/paddle/LivingPaddle';
import { createWorld } from '../../src/game/physics/createWorld';
import { tuning } from '../../src/game/config/tuning';

describe('flock edge coverage', () => {
  for (const side of ['left', 'right'] as const) {
    for (const fusedIndex of [-1, 0, 1, 2, 3]) {
      it(`catches a vertical edge drop at the ${side} wall with fusion at ${fusedIndex}`, () => {
        const world = createWorld();
        const paddle = new LivingPaddle(world.engine, 180, 'off');
        if (fusedIndex >= 0) {
          paddle.evolveDuck(fusedIndex, 'bomb');
          paddle.fuseAdjacentDuck(fusedIndex + 1, 'bomb');
        }
        for (let frame = 0; frame < 240; frame++) {
          paddle.update(side === 'left' ? 0 : 360, 16.666);
          Engine.update(world.engine, 16.666);
          paddle.stabilize();
        }
        const outer = paddle.bodies[side === 'left' ? 0 : paddle.bodies.length - 1];
        const uncovered = side === 'left' ? outer.parts[1].bounds.min.x
          : 360 - outer.parts[1].bounds.max.x;
        expect(uncovered, `uncovered ${side} edge`).toBeLessThan(12);
        const ball = Bodies.circle(side === 'left' ? tuning.ball.radius : 360 - tuning.ball.radius,
          485, tuning.ball.radius, { label: 'ball', restitution: 1 });
        Composite.add(world.engine.world, ball);
        Body.setVelocity(ball, { x: 0, y: tuning.ball.speed });
        let hits = 0;
        Events.on(world.engine, 'collisionStart', ({ pairs }) => {
          for (const pair of pairs) {
            const duck = pair.bodyA.parent.label === 'living-duck' ? pair.bodyA
              : pair.bodyB.parent.label === 'living-duck' ? pair.bodyB : null;
            if (!duck || (pair.bodyA.parent !== ball && pair.bodyB.parent !== ball)) continue;
            paddle.onBallHit(ball, duck);
            hits++;
            break;
          }
        });
        for (let frame = 0; frame < 25; frame++) {
          paddle.update(side === 'left' ? 0 : 360, 16.666);
          Engine.update(world.engine, 16.666);
          paddle.stabilize();
        }
        expect(hits, `ball escaped past ${side} paddle`).toBeGreaterThan(0);
        expect(ball.velocity.y).toBeLessThan(0);
        Composite.remove(world.engine.world, ball);
        for (let frame = 0; frame < 60; frame++) {
          paddle.update(180, 16.666);
          Engine.update(world.engine, 16.666);
          paddle.stabilize();
        }
        expect(Math.abs(paddle.getCenterX() - 180)).toBeLessThan(30);
      });
    }
  }
});
