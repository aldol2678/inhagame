import { describe, expect, it } from 'vitest';
import { Bodies, Body, Engine } from 'matter-js';
import { BrickField } from '../../src/game/bricks/BrickField';
import { LivingPaddle } from '../../src/game/paddle/LivingPaddle';
import { reflectElasticFromDuck, reflectFromDuck } from '../../src/game/paddle/duckPhysics';
import { duckKinds } from '../../src/game/paddle/duckTypes';
import { PilotTelemetry } from '../../src/game/telemetry/PilotTelemetry';

describe('P1 duck kinds', () => {
  it('keeps three basics and a basic center while moving the two special ducks', () => {
    expect(duckKinds('A')).toEqual(['elastic', 'basic', 'basic', 'basic', 'bomb']);
    expect(duckKinds('B')).toEqual(['basic', 'elastic', 'basic', 'bomb', 'basic']);
    expect(duckKinds('off')).toEqual(['basic', 'basic', 'basic', 'basic', 'basic']);
  });

  it('keeps 600 elastic reflections finite, upward, and locally smooth', () => {
    for (const head of [false, true]) {
      for (let i = 0; i < 300; i += 1) {
        const input = { head, contactOffset: -1 + 2 * i / 299,
          angle: (i % 7 - 3) * 0.06, duckVelocityX: (i % 11 - 5) * 3,
          incomingX: i % 2 ? 3 : -3, incomingY: 8 };
        const elastic = reflectElasticFromDuck(input);
        const basic = reflectFromDuck(input);
        const speed = Math.hypot(elastic.x, elastic.y);
        expect(Number.isFinite(speed)).toBe(true);
        expect(elastic.y).toBeLessThan(0);
        expect(-elastic.y / speed).toBeGreaterThanOrEqual(0.529);
        expect(speed).toBeCloseTo(Math.hypot(basic.x, basic.y), 6);
        expect(Math.abs(elastic.x - basic.x)).toBeLessThanOrEqual(1.24);
      }
    }
    const contact = { head: false, contactOffset: 0.5, angle: 0,
      duckVelocityX: 0, incomingX: 0, incomingY: 8 };
    expect(reflectElasticFromDuck(contact).x).toBeGreaterThan(reflectFromDuck(contact).x);
    expect(reflectElasticFromDuck({ ...contact, contactOffset: -0.5 }).x)
      .toBeLessThan(reflectFromDuck({ ...contact, contactOffset: -0.5 }).x);
  });

  it('returns the actual struck role for torso and head, with no compound separation', () => {
    for (const [layout, indexes] of [['A', [0, 2, 4]], ['B', [1, 2, 3]]] as const) {
      const engine = Engine.create();
      const paddle = new LivingPaddle(engine, 180, layout);
      for (const index of indexes) {
        for (let attempt = 0; attempt < 200; attempt += 1) {
          const duck = paddle.bodies[index];
          const ball = Bodies.circle(duck.position.x + ((attempt % 11) - 5), duck.position.y - 30, 8);
          Body.setVelocity(ball, { x: 0, y: 8 });
          expect(paddle.onBallHit(ball, duck.parts[attempt % 2 ? 1 : 2]))
            .toBe(paddle.kinds[index]);
          expect(ball.velocity.y).toBeLessThan(0);
          expect(duck.parts).toHaveLength(3);
        }
      }
      paddle.destroy(engine);
    }
  });
});

describe('one-shot bomb brick effect', () => {
  it('only removes the closest surviving grid neighbor and tracks extra destruction separately', () => {
    const engine = Engine.create();
    const bricks = new BrickField(engine);
    const telemetry = new PilotTelemetry('living');
    const first = bricks.bodies[0];
    const originalCount = bricks.remainingCount;
    expect(bricks.destroyBrick(first)).toBe(true);
    telemetry.recordBrickHit(true);
    const neighbor = bricks.destroyAdjacentBrick(first);
    expect(neighbor).not.toBeNull();
    telemetry.recordAdditionalBrickDestroyed();
    expect(bricks.remainingCount).toBe(originalCount - 2);
    expect(telemetry.snapshot(0).brickHits).toBe(1);
    expect(telemetry.snapshot(0).bricksDestroyed).toBe(2);
    expect(bricks.destroyBrick(neighbor!)).toBe(false);
    bricks.destroy();
  });

  it('adds no destruction when every adjacent brick is already gone', () => {
    const engine = Engine.create();
    const bricks = new BrickField(engine);
    const first = bricks.bodies[0];
    bricks.destroyBrick(first);
    for (let i = 0; i < 4; i += 1) {
      const neighbor = bricks.destroyAdjacentBrick(first);
      if (!neighbor) break;
    }
    expect(bricks.destroyAdjacentBrick(first)).toBeNull();
    bricks.destroy();
  });
});
