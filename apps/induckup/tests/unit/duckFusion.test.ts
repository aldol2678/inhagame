import { describe, expect, it } from 'vitest';
import { Bodies, Body, Composite, Engine } from 'matter-js';
import { adjacentFusionSource } from '../../src/game/paddle/duckFusion';
import { LivingPaddle } from '../../src/game/paddle/LivingPaddle';

describe('same-kind adjacent fusion', () => {
  it('only selects a basic slot next to a matching evolved duck', () => {
    const kinds = ['elastic', 'basic', 'basic', 'bomb', 'basic'] as const;
    expect(adjacentFusionSource(kinds, 1, 'elastic')).toBe(0);
    expect(adjacentFusionSource(['pierce', 'basic', 'basic'], 1, 'pierce')).toBe(0);
    expect(adjacentFusionSource(kinds, 2, 'bomb')).toBe(3);
    expect(adjacentFusionSource(kinds, 4, 'elastic')).toBeNull();
    expect(adjacentFusionSource(kinds, 0, 'elastic')).toBeNull();
    expect(adjacentFusionSource(kinds, -1, 'bomb')).toBeNull();
    expect(adjacentFusionSource(kinds, 1.5, 'elastic')).toBeNull();
  });

  it('replaces two adjacent ducks with one wider compound duck and three anchors', () => {
    const engine = Engine.create();
    const paddle = new LivingPaddle(engine, 180, 'off');
    const bodyIds = paddle.bodies.map(body => body.id);
    expect(paddle.evolveDuck(1, 'bomb')).toBe(true);
    expect(paddle.fuseAdjacentDuck(3, 'bomb')).toBeNull();
    expect(paddle.kinds).toEqual(['basic', 'bomb', 'basic', 'basic', 'basic']);
    expect(paddle.fuseAdjacentDuck(2, 'bomb')).toBe(1);
    expect(paddle.kinds).toEqual(['basic', 'bomb', 'basic', 'basic']);
    expect(paddle.fusionTiers).toEqual([0, 2, 0, 0]);
    expect(paddle.bodies).toHaveLength(4);
    expect(paddle.constraints).toHaveLength(3);
    expect(paddle.bodies[1].id).not.toBe(bodyIds[1]);
    expect(paddle.bodies[1].bounds.max.x - paddle.bodies[1].bounds.min.x).toBeGreaterThan(57);
    expect(Composite.allBodies(engine.world)).toHaveLength(4);
    expect(Composite.allConstraints(engine.world)).toHaveLength(3);
    expect(paddle.bodies.every(body => body.parts.length === 3)).toBe(true);
    expect(paddle.fuseAdjacentDuck(2, 'bomb')).toBeNull();
  });

  it('strengthens elastic english yet retains an upward rebound floor', () => {
    const plain = new LivingPaddle(Engine.create(), 180, 'off');
    const fused = new LivingPaddle(Engine.create(), 180, 'off');
    plain.evolveDuck(2, 'elastic');
    fused.evolveDuck(1, 'elastic');
    expect(fused.fuseAdjacentDuck(2, 'elastic')).toBe(1);
    const fire = (paddle: LivingPaddle) => {
      const torso = paddle.bodies.find((_body, index) => paddle.kinds[index] === 'elastic')!.parts[1];
      const offset = paddle.fusionTiers.includes(2) ? 15 : 11;
      const ball = Bodies.circle(torso.position.x + offset, torso.position.y - 23, 8);
      Body.setVelocity(ball, { x: 2, y: 8 });
      paddle.onBallHit(ball, torso);
      return ball.velocity;
    };
    const normal = fire(plain);
    const enhanced = fire(fused);
    expect(enhanced.x).toBeGreaterThan(normal.x);
    expect(enhanced.y).toBeLessThan(0);
    expect(-enhanced.y / Math.hypot(enhanced.x, enhanced.y)).toBeGreaterThanOrEqual(0.529);
  });

  it('merges toward the left when the evolved duck is on the right and keeps center control', () => {
    const engine = Engine.create();
    const paddle = new LivingPaddle(engine, 180, 'off');
    const center = paddle.bodies[2];
    paddle.evolveDuck(4, 'bomb');
    expect(paddle.fuseAdjacentDuck(3, 'bomb')).toBe(3);
    expect(paddle.kinds).toEqual(['basic', 'basic', 'basic', 'bomb']);
    expect(paddle.fusionTiers).toEqual([0, 0, 0, 2]);
    expect(paddle.bodies[2]).toBe(center);
    expect(paddle.getCenterX()).toBeCloseTo(center.position.x);
    expect(Composite.allBodies(engine.world)).toHaveLength(4);
    expect(Composite.allConstraints(engine.world)).toHaveLength(3);
  });

  it('holds four finite ducks against a wall after fusion and recovers when released', () => {
    const engine = Engine.create();
    const paddle = new LivingPaddle(engine, 180, 'off');
    paddle.evolveDuck(1, 'clone');
    paddle.fuseAdjacentDuck(2, 'clone');
    for (let i = 0; i < 300; i++) {
      paddle.update(i < 190 ? 0 : 180, 16.667);
      Engine.update(engine, 16.667);
      paddle.stabilize();
      expect(paddle.bodies.every(body => Number.isFinite(body.position.x)
        && Number.isFinite(body.position.y) && Number.isFinite(body.angle))).toBe(true);
    }
    expect(paddle.bodies).toHaveLength(4);
    expect(paddle.constraints).toHaveLength(3);
    expect(Math.abs(paddle.getCenterX() - 180)).toBeLessThan(45);
    for (let i = 0; i < 10_500; i++) {
      paddle.update(180 + 95 * Math.sin(i / 80), 16.667);
      Engine.update(engine, 16.667);
      paddle.stabilize();
      if (i % 300 === 0) {
        expect(paddle.bodies.every(body => Number.isFinite(body.position.x)
          && Number.isFinite(body.position.y) && Number.isFinite(body.angle)
          && body.parts.length === 3)).toBe(true);
      }
    }
    expect(paddle.bodies).toHaveLength(4);
    expect(paddle.constraints).toHaveLength(3);
  });
});
