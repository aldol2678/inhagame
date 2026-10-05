import { Bodies } from 'matter-js';
import { describe, expect, it } from 'vitest';
import { LakeGrowth } from '../../src/p4/LakeGrowth';

describe('LakeGrowth', () => {
  it('levels continuously, preserves overflow, and evolves at Lv.3 and Lv.6', () => {
    const growth = new LakeGrowth();
    expect(growth.level).toBe(1);
    expect(growth.xp).toBe(0);
    expect(growth.targetXp).toBe(7);
    expect(growth.nextEvolutionLevel).toBe(3);

    growth.addXp(7);
    expect(growth.level).toBe(2);
    expect(growth.xp).toBe(0);
    expect(growth.targetXp).toBe(8);
    expect(growth.pending).toBe(false);

    growth.addXp(10);
    expect(growth.totalXp).toBe(17);
    expect(growth.level).toBe(3);
    expect(growth.xp).toBe(2);
    expect(growth.targetXp).toBe(10);
    expect(growth.pending).toBe(true);

    growth.evolve();
    expect(growth.evolutions).toBe(1);
    expect(growth.pending).toBe(false);
    expect(growth.nextEvolutionLevel).toBe(6);

    growth.startArea2();
    expect(growth.totalXp).toBe(17);
    expect(growth.level).toBe(3);
    expect(growth.xp).toBe(2);

    growth.addXp(31);
    expect(growth.totalXp).toBe(48);
    expect(growth.level).toBe(6);
    expect(growth.xp).toBe(0);
    expect(growth.pending).toBe(true);

    growth.evolve();
    expect(growth.evolutions).toBe(2);
    expect(growth.pending).toBe(false);
    expect(growth.nextEvolutionLevel).toBeNull();
  });

  it('drops a feather every three kills and feather XP can cross level boundaries', () => {
    const growth = new LakeGrowth();
    growth.monsterKilled(120, 100);
    growth.monsterKilled(150, 100);
    growth.monsterKilled(180, 100);
    expect(growth.totalXp).toBe(3);
    expect(growth.feathers).toHaveLength(1);

    growth.addXp(3);
    expect(growth.totalXp).toBe(6);
    const duck = Bodies.rectangle(180, 500, 40, 24);
    growth.feathers[0].x = 180;
    growth.feathers[0].y = 500;
    expect(growth.update(16, [duck])).toEqual([0]);
    expect(growth.totalXp).toBe(8);
    expect(growth.level).toBe(2);
    expect(growth.xp).toBe(1);
    expect(growth.targetXp).toBe(8);
  });
});
