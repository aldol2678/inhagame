import { Body, Engine } from 'matter-js';
import { describe, expect, it } from 'vitest';
import { MonsterField } from '../../src/p4/MonsterField';
import { BACK_GATE_TARGETS, finalPhaseForHp } from '../../src/p4/Stage6Battle';

describe('Stage 6 back gate and finale', () => {
  it('keeps the three preparation Areas finite and the boss Area free of timed waves', () => {
    expect(BACK_GATE_TARGETS).toEqual([12, 14, 14, 5]);
    const field = new MonsterField(Engine.create(), 1, true, 6);
    expect(field.views.map(view => view.kind)).toEqual(['wave', 'swarm', 'wave']);
    expect(field.obstacles.map(body => body.label)).toEqual([
      'stage-backgate-lamp', 'stage-backgate-lamp',
    ]);
    expect(field.hit(field.views[0].body, 10)).toMatchObject({ destroyed: true, reward: true });
    field.destroy();
    const finale = new MonsterField(Engine.create(), 4, true, 6);
    expect(finale.views.map(view => view.kind)).toEqual([
      'final-shield', 'final-shield', 'final-thesis',
    ]);
    finale.update(30000);
    expect(finale.views.filter(view => view.kind === 'final-thesis')).toHaveLength(1);
    finale.destroy();
  });

  it('spawns the two returning Elite one after the other', () => {
    const field = new MonsterField(Engine.create(), 2, true, 6);
    for (let i = 0; i < 12 && !field.views.some(view => view.kind === 'elite-command'); i += 1)
      field.update(700);
    const commander = field.views.find(view => view.kind === 'elite-command');
    expect(commander).toBeDefined();
    const nearby = field.views.find(view => view.kind === 'wave')!;
    Body.setPosition(nearby.body, {
      x: commander!.body.position.x, y: commander!.body.position.y + 10,
    });
    expect(field.views.find(view => view.body.id === nearby.body.id)?.defense).toBe(2);
    for (let i = 0; i < 4; i += 1) field.update(700);
    expect(field.views.some(view => view.kind === 'elite-giant')).toBe(false);
    field.hit(commander!.body, 100);
    expect(field.views.find(view => view.body.id === nearby.body.id)?.defense).toBe(0);
    field.update(700);
    expect(field.views.filter(view => view.kind === 'elite-giant')).toHaveLength(1);
    field.destroy();
  });

  it('uses destructible shields, a reachable weak spot and one finite minion pair across all phases', () => {
    const field = new MonsterField(Engine.create(), 4, true, 6);
    const boss = field.views.find(view => view.kind === 'final-thesis')!;
    expect(boss.defense).toBe(6);
    for (const shield of field.views.filter(view => view.kind === 'final-shield'))
      expect(field.hit(shield.body, 100)).toMatchObject({ destroyed: true, reward: true });
    expect(field.views.find(view => view.body.id === boss.body.id)?.defense).toBe(4);
    expect(field.hit(boss.body, 28)?.damage).toBe(24);
    expect(field.finalPhase).toBe(2);
    const weakSpot = field.views.find(view => view.body.id === boss.body.id)?.weakSpotX;
    expect(weakSpot).toBeTypeOf('number');
    expect(field.hit(boss.body, 10, 0, { x: 0, y: -1 }, weakSpot)?.damage).toBe(10);
    expect(field.hit(boss.body, 20)?.damage).toBe(16);
    expect(field.finalPhase).toBe(3);
    expect(field.views.filter(view => view.kind === 'shield' || view.kind === 'rush'))
      .toHaveLength(2);
    field.hit(boss.body, 26);
    expect(field.finalPhase).toBe(4);
    field.hit(boss.body, 28);
    expect(field.finalPhase).toBe(5);
    expect(field.views.filter(view => view.kind === 'shield' || view.kind === 'rush'))
      .toHaveLength(2);
    expect(finalPhaseForHp(0)).toBe(5);
    field.hit(boss.body, 100);
    expect(field.complete).toBe(false);
    for (const minion of field.views) field.hit(minion.body, 100);
    expect(field.complete).toBe(true);
    field.destroy();
  });

  it('warns at the danger line and loses immediately if the final body breaches', () => {
    const field = new MonsterField(Engine.create(), 4, true, 6);
    const boss = field.views.find(view => view.kind === 'final-thesis')!;
    Body.setPosition(boss.body, { x: boss.body.position.x, y: 425 });
    expect(field.views.find(view => view.body.id === boss.body.id)?.warning).toBe(true);
    field.forceBreachForTest('final-thesis');
    expect(field.update(16)).toContain(45);
    expect(field.finalBreached).toBe(true);
    field.destroy();
  });
});
