import { describe, expect, it } from 'vitest';
import { Bodies, Body, Composite, Engine, Events } from 'matter-js';
import { LivingPaddle } from '../../src/game/paddle/LivingPaddle';
import { clampDuckAngle, reflectFromDuck, softSeparation } from '../../src/game/paddle/duckPhysics';
import { createWorld } from '../../src/game/physics/createWorld';
import { tuning } from '../../src/game/config/tuning';

describe('duck body reflection', () => {
  it('has predictable upper directions for 500 torso/head contacts', () => {
    let count = 0;
    for (const head of [false, true]) {
      for (let i = 0; i < 250; i += 1) {
        const offset = -1 + i * 2 / 249;
        const { x, y } = reflectFromDuck({ contactOffset: offset, head,
          angle: (i % 7 - 3) * 0.06, duckVelocityX: (i % 9 - 4) * 2,
          incomingX: i % 2 ? 3 : -3, incomingY: 8 });
        const speed = Math.hypot(x, y);
        expect(Number.isFinite(speed)).toBe(true);
        expect(y).toBeLessThan(0);
        expect(-y / speed).toBeGreaterThanOrEqual(0.529);
        expect(speed).toBeGreaterThanOrEqual(tuning.ball.minSpeed);
        count += 1;
      }
    }
    expect(count).toBe(500);
    expect(reflectFromDuck({ contactOffset: -0.8, angle: 0, duckVelocityX: 0,
      incomingX: 0, incomingY: 8, head: false }).x).toBeLessThan(0);
    expect(reflectFromDuck({ contactOffset: 0.8, angle: 0, duckVelocityX: 0,
      incomingX: 0, incomingY: 8, head: false }).x).toBeGreaterThan(0);
  });

  it('is locally smooth and head contact has more lateral reach', () => {
    const reflect = (offset: number, head: boolean) => reflectFromDuck({
      contactOffset: offset, head, angle: 0, duckVelocityX: 0, incomingX: 0, incomingY: 8,
    });
    expect(Math.abs(reflect(0.41, false).x - reflect(0.4, false).x)).toBeLessThan(0.1);
    expect(reflect(0.7, true).x).toBeGreaterThan(reflect(0.7, false).x);
  });

  it('clamps duck rotation and applies separation only below threshold', () => {
    expect(clampDuckAngle(1)).toBe(tuning.paddle.maxAngle);
    expect(clampDuckAngle(-1)).toBe(-tuning.paddle.maxAngle);
    expect(softSeparation(40, 38, 1)).toBe(0);
    expect(softSeparation(25, 38, 1)).toBeGreaterThan(0);
  });

  it('marks only the struck duck for a brief visual reaction', () => {
    const engine = Engine.create();
    const paddle = new LivingPaddle(engine, 180);
    const duck = paddle.bodies[1];
    const ball = Bodies.circle(duck.position.x, duck.position.y - 28, 8);
    Body.setVelocity(ball, { x: 0, y: 8 });
    paddle.onBallHit(ball, duck.parts[1]);
    expect(paddle.getHitFlash()).toEqual([0, 1, 0, 0, 0]);
    expect(ball.velocity.y).toBeLessThan(0);
    paddle.update(180, 90);
    expect(paddle.getHitFlash()).toEqual([0, 0.5, 0, 0, 0]);
    paddle.update(180, 90);
    expect(paddle.getHitFlash()).toEqual([0, 0, 0, 0, 0]);
    paddle.destroy(engine);
  });

  it('runs 200 physical single-duck hits with intact compound parts', () => {
    let hits = 0;
    for (let i = 0; i < 200; i += 1) {
      const engine = Engine.create({ gravity: { x: 0, y: 0, scale: 0 } });
      const paddle = new LivingPaddle(engine, 180);
      const duck = paddle.bodies[2];
      paddle.constraints.forEach(constraint => Composite.remove(engine.world, constraint));
      paddle.bodies.filter(body => body !== duck).forEach(body => Composite.remove(engine.world, body));
      const before = duck.parts.map(part => ({ x: part.position.x - duck.position.x,
        y: part.position.y - duck.position.y }));
      const offset = -15 + (i % 11) * 3;
      const ball = Bodies.circle(duck.position.x + offset, duck.position.y - 38, 8, {
        label: 'ball', collisionFilter: { group: 0 }, friction: 0, restitution: 1,
      });
      Composite.add(engine.world, ball);
      Body.setVelocity(ball, { x: 0, y: 8 });
      let handled = false;
      Events.on(engine, 'collisionStart', event => {
        for (const pair of event.pairs) {
          if (handled) continue;
          if (pair.bodyA.parent !== ball && pair.bodyB.parent !== ball) continue;
          const other = pair.bodyA.parent === ball ? pair.bodyB.parent : pair.bodyA.parent;
          if (other !== duck) continue;
          handled = true;
          const part = pair.bodyA.parent === duck ? pair.bodyA : pair.bodyB;
          paddle.onBallHit(ball, part);
          hits += 1;
          expect(ball.velocity.y).toBeLessThan(0);
          expect(-ball.velocity.y / Math.hypot(ball.velocity.x, ball.velocity.y)).toBeGreaterThan(0.529);
        }
      });
      for (let frame = 0; frame < 9 && hits <= i; frame += 1) Engine.update(engine, 16.666);
      expect(hits).toBe(i + 1);
      expect(duck.parts).toHaveLength(3);
      duck.parts.forEach((part, partIndex) => {
        expect(Math.hypot(part.position.x - duck.position.x - before[partIndex].x,
          part.position.y - duck.position.y - before[partIndex].y)).toBeLessThan(7);
      });
      paddle.destroy(engine);
    }
  });
});

describe('wall and restart integrity', () => {
  it('holds against each wall for three seconds then recovers within one second', () => {
    for (const wallX of [0, 360]) {
      const world = createWorld();
      const paddle = new LivingPaddle(world.engine, 180);
      for (let i = 0; i < 190; i += 1) {
        paddle.update(wallX, 16.666);
        Engine.update(world.engine, 16.666);
        paddle.stabilize();
      }
      const positions = paddle.bodies.map(b => b.position.x).sort((a, b) => a - b);
      expect(positions[4] - positions[0]).toBeGreaterThan(140);
      expect(positions.every(Number.isFinite)).toBe(true);
      for (let i = 0; i < 60; i += 1) {
        paddle.update(180, 16.666);
        Engine.update(world.engine, 16.666);
        paddle.stabilize();
      }
      const recovered = paddle.bodies.map(b => b.position.x).sort((a, b) => a - b);
      expect(recovered[4] - recovered[0]).toBeGreaterThan(145);
      paddle.destroy(world.engine);
      expect(Composite.allConstraints(world.engine.world)).toHaveLength(0);
      expect(Composite.allBodies(world.engine.world)).toHaveLength(4);
    }
  });
});
