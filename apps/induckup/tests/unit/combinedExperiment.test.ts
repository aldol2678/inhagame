import { describe, expect, it } from 'vitest';
import { Body, Composite, Engine } from 'matter-js';
import { BallSystem } from '../../src/game/ball/BallSystem';
import { BrickField } from '../../src/game/bricks/BrickField';
import { reflectElasticFromDuck } from '../../src/game/paddle/duckPhysics';
import { duckKinds } from '../../src/game/paddle/duckTypes';
import { PilotTelemetry } from '../../src/game/telemetry/PilotTelemetry';
import { LivingPaddle } from '../../src/game/paddle/LivingPaddle';
import { createWorld } from '../../src/game/physics/createWorld';

describe('combined duck experiment', () => {
  it('preserves the basic center and disables clone in the P0 comparator', () => {
    expect(duckKinds('A', true)).toEqual(['elastic', 'clone', 'basic', 'basic', 'bomb']);
    expect(duckKinds('B', true)).toEqual(['basic', 'elastic', 'basic', 'bomb', 'clone']);
    expect(duckKinds('off', true)).toEqual(Array(5).fill('basic'));
  });

  it('strong elastic remains smooth and upward through 600 head and torso contacts', () => {
    for (const head of [false, true]) {
      for (let i = 0; i < 300; i++) {
        const input = { head, contactOffset: -1 + 2 * i / 299,
          angle: (i % 5 - 2) * 0.08, duckVelocityX: (i % 9 - 4) * 4,
          incomingX: i % 2 ? 3 : -3, incomingY: 8 };
        const strong = reflectElasticFromDuck(input, 'strong');
        const speed = Math.hypot(strong.x, strong.y);
        expect(Number.isFinite(speed)).toBe(true);
        expect(-strong.y / speed).toBeGreaterThanOrEqual(0.529);
      }
    }
    const input = { head: false, contactOffset: 0.5, angle: 0,
      duckVelocityX: 0, incomingX: 0, incomingY: 8 };
    expect(reflectElasticFromDuck(input, 'strong').x)
      .toBeGreaterThan(reflectElasticFromDuck(input, 'standard').x);
  });

  it('spawns at most two independently moving collision bodies, then cleans both up', () => {
    const engine = Engine.create({ gravity: { x: 0, y: 0, scale: 0 } });
    const balls = new BallSystem(engine);
    balls.launch();
    const clone = balls.spawnClone(balls.body);
    expect(clone).not.toBeNull();
    expect(balls.bodies).toHaveLength(2);
    expect(balls.spawnClone(clone!)).toBeNull();
    expect(Math.hypot(clone!.position.x - balls.body.position.x,
      clone!.position.y - balls.body.position.y)).toBeGreaterThan(16);
    const before = clone!.position.x;
    for (let i = 0; i < 360; i++) {
      Engine.update(engine, 1000 / 60);
      for (const body of balls.bodies) {
        balls.clampSpeed(body);
        expect(Number.isFinite(body.position.x + body.position.y)).toBe(true);
      }
    }
    expect(clone!.position.x).not.toBe(before);
    expect(balls.remove(balls.body)).toBe(true);
    expect(balls.bodies).toEqual([clone]);
    balls.destroy();
    expect(Composite.allBodies(engine.world)).toHaveLength(0);
  });

  it('offers equally sized brick patterns and skips nonadjacent bomb targets', () => {
    const classic = new BrickField(Engine.create(), 'classic');
    const clusters = new BrickField(Engine.create(), 'clusters');
    expect(clusters.remainingCount).toBe(classic.remainingCount);
    const isolated = clusters.bodies[0];
    expect(clusters.destroyBrick(isolated)).toBe(true);
    expect(clusters.destroyAdjacentBrick(isolated)).toBeNull();
    const first = clusters.bodies.find(body => body.position.y > 180)!;
    expect(clusters.destroyBrick(first)).toBe(true);
    const neighbor = clusters.destroyAdjacentBrick(first);
    expect(neighbor).not.toBeNull();
    expect(Math.hypot(neighbor!.position.x - first.position.x,
      neighbor!.position.y - first.position.y)).toBeLessThan(50);
    classic.destroy();
    clusters.destroy();
  });

  it('records per-kind contacts, real splits and actual bomb bonus bricks', () => {
    const log = new PilotTelemetry('living');
    log.recordPaddleHit('basic');
    log.recordPaddleHit('clone');
    log.recordPaddleHit('bomb');
    log.recordClone(2);
    log.recordAdditionalBrickDestroyed();
    expect(log.snapshot(0)).toMatchObject({ paddleHits: 3,
      hitsByDuckKind: { basic: 1, elastic: 0, bomb: 1, clone: 1 },
      bombBonusBricks: 1, cloneTriggers: 1, maxActiveBalls: 2 });
  });

  it('keeps two balls and the five compound ducks finite across three simulated minutes', () => {
    const { engine } = createWorld();
    const paddle = new LivingPaddle(engine, 180, 'A', true, 'strong');
    const bricks = new BrickField(engine, 'clusters');
    const balls = new BallSystem(engine);
    balls.launch();
    expect(balls.spawnClone(balls.body)).not.toBeNull();
    for (let tick = 0; tick < 10_800; tick++) {
      paddle.update(180 + Math.sin(tick / 80) * 68, 1000 / 60);
      Engine.update(engine, 1000 / 60);
      paddle.stabilize();
      for (const body of balls.bodies) {
        balls.clampSpeed(body);
        if (body.position.y > 650) {
          Body.setPosition(body, { x: 180, y: 310 });
          Body.setVelocity(body, { x: 1, y: -8 });
        }
        expect(Number.isFinite(body.position.x + body.position.y + body.velocity.x)).toBe(true);
      }
    }
    expect(paddle.bodies.every(duck => duck.parts.length === 3 &&
      Number.isFinite(duck.position.x + duck.position.y + duck.angle))).toBe(true);
    expect(Composite.allBodies(engine.world)).toHaveLength(4 + 5 + 2 + bricks.remainingCount);
    balls.destroy();
    bricks.destroy();
    paddle.destroy(engine);
  }, 15_000);
});
