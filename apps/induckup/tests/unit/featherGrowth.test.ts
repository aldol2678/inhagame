import { describe, expect, it } from 'vitest';
import { Engine } from 'matter-js';
import { FeatherGrowth } from '../../src/game/growth/FeatherGrowth';
import { LivingPaddle } from '../../src/game/paddle/LivingPaddle';
import { BrickField } from '../../src/game/bricks/BrickField';

describe('first evolution item loop', () => {
  it('awards XP for brick breaks and bonus XP for torso pickups with an immediate first feather', () => {
    const paddle = new LivingPaddle(Engine.create(), 180, 'off');
    const growth = new FeatherGrowth();
    growth.brickBroken(180, 100);
    expect(growth.feathers).toHaveLength(1);
    expect(growth.xp).toBe(1);
    growth.brickBroken(180, 100);
    expect(growth.feathers).toHaveLength(1);
    expect(growth.xp).toBe(2);
    growth.brickBroken(180, 100);
    expect(growth.feathers).toHaveLength(2);
    growth.update(100, paddle.bodies);
    expect(growth.xp).toBe(3);
    growth.feathers[0].x = paddle.bodies[2].parts[1].position.x;
    growth.feathers[0].y = paddle.bodies[2].parts[1].position.y;
    expect(growth.update(1, paddle.bodies)).toEqual([2]);
    expect(growth.update(1, paddle.bodies)).toEqual([]);
    expect(growth.xp).toBe(5);
    expect(growth.level).toBe(1);
  });

  it('clamps XP at LV.2 and freezes growth after the first evolution', () => {
    const paddle = new LivingPaddle(Engine.create(), 180, 'off');
    const growth = new FeatherGrowth();
    for (let i = 0; i < 14; i++) growth.brickBroken(180, 90);
    expect(growth.feathers).toHaveLength(4);
    expect(growth.xp).toBe(8);
    growth.feathers[0].x = paddle.bodies[2].parts[1].position.x;
    growth.feathers[0].y = paddle.bodies[2].parts[1].position.y;
    growth.update(1, paddle.bodies);
    expect(growth.xp).toBe(8);
    expect(growth.level).toBe(2);
    expect(growth.pending).toBe(true);
    growth.evolve();
    expect(growth.pending).toBe(false);
    expect(growth.empty).toBe(true);
    growth.brickBroken(180, 90);
    expect(growth.feathers).toHaveLength(0);
    expect(growth.xp).toBe(8);
  });

  it('resumes at 0/12 in wave two, reaches LV.3, then caps after a second evolution', () => {
    const growth = new FeatherGrowth();
    growth.addXp(8);
    growth.evolve();
    expect(growth.evolutions).toBe(1);
    expect(growth.level).toBe(2);
    growth.startSecondWave();
    expect(growth.xp).toBe(0);
    expect(growth.targetXp).toBe(12);
    growth.brickBroken(180, 90);
    expect(growth.xp).toBe(1);
    expect(growth.feathers).toHaveLength(1);
    growth.addXp(99);
    expect(growth.xp).toBe(12);
    expect(growth.pending).toBe(true);
    expect(growth.level).toBe(3);
    growth.evolve();
    growth.brickBroken(180, 90);
    expect(growth.evolutions).toBe(2);
    expect(growth.pending).toBe(false);
    expect(growth.xp).toBe(12);
    expect(growth.feathers).toHaveLength(0);
  });

  it('evolves exactly one selected duck without rebuilding the compound body', () => {
    const paddle = new LivingPaddle(Engine.create(), 180, 'off');
    const ids = paddle.bodies.map(body => body.id);
    expect(paddle.evolveDuck(2, 'clone')).toBe(true);
    expect(paddle.evolveDuck(2, 'bomb')).toBe(false);
    expect(paddle.kinds).toEqual(['basic', 'basic', 'clone', 'basic', 'basic']);
    expect(paddle.bodies.map(body => body.id)).toEqual(ids);
    expect(paddle.bodies.every(body => body.parts.length === 3)).toBe(true);
  });
});

describe('second wave armored bricks', () => {
  it('needs two ball hits, but an adjacent bomb blast clears armor immediately', () => {
    const engine = Engine.create();
    const field = new BrickField(engine, 'clusters', true);
    const armored = field.bodies.find(body => field.durability.has(body.id))!;
    expect(field.remainingCount).toBe(35);
    expect(field.durability.size).toBeGreaterThanOrEqual(6);
    expect(field.hitBrick(armored)).toBe('damaged');
    expect(field.remainingCount).toBe(35);
    expect(field.durability.get(armored.id)?.hp).toBe(1);
    expect(field.hitBrick(armored)).toBe('destroyed');
    expect(field.remainingCount).toBe(34);
    expect(field.hitBrick(armored)).toBe('none');
    const source = field.bodies.find(body => field.durability.has(body.id)
      && field.bodies.some(other => !field.durability.has(other.id)
        && Math.hypot(other.position.x - body.position.x, other.position.y - body.position.y) < 55))!;
    const adjacent = field.destroyAdjacentBrick(source);
    expect(adjacent).not.toBeNull();
    expect(field.remainingCount).toBe(33);
    field.destroy();
    expect(field.durability.size).toBe(0);
  });
});
