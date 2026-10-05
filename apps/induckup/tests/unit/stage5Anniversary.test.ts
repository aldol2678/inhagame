import { Body, Engine } from 'matter-js';
import { describe, expect, it } from 'vitest';
import { MonsterField } from '../../src/p4/MonsterField';

function reachElite(field: MonsterField, name: 'elite-command' | 'elite-giant') {
  for (let i = 0; i < 30 && !field.views.some(view => view.kind === name); i += 1) {
    // Free the tough cap without skipping the reserved wave or awarding fragments.
    for (const view of field.views.filter(view => view.kind === 'armor' || view.kind === 'shield')) {
      field.hit(view.body, 100);
    }
    field.update(700);
  }
  const elite = field.views.find(view => view.kind === name);
  expect(elite).toBeDefined();
  return elite!;
}

describe('Stage 5 anniversary battle', () => {
  it('opens with reachable XP and leaves ball passages around the lobby stands', () => {
    const field = new MonsterField(Engine.create(), 1, true, 5);
    expect(field.target).toBe(18);
    expect(field.views.map(view => view.kind)).toEqual(['wave', 'swarm', 'armor']);
    expect(field.obstacles).toHaveLength(2);
    expect(field.obstacles.every(obstacle => obstacle.label === 'stage-anniversary'
      && obstacle.bounds.max.y < 400)).toBe(true);
    expect(field.hit(field.views[0].body, 10)).toMatchObject({ destroyed: true, reward: true });
    field.destroy();
  });

  it('shows the command radius, grants nearby non-Elites DEF +2, then removes it on defeat', () => {
    const field = new MonsterField(Engine.create(), 1, true, 5);
    const commander = reachElite(field, 'elite-command');
    const near = field.views.find(view => view.kind === 'wave'
      && Math.abs(view.body.position.x - commander.body.position.x) < 70)!;
    expect(commander).toMatchObject({ hp: 36, defense: 3, commandAura: true });
    expect(near.defense).toBe(2);
    expect(field.hit(commander.body, 100)).toMatchObject({ destroyed: true, reward: true });
    expect(field.views.find(view => view.body.id === near.body.id)?.defense).toBe(0);
    field.destroy();
  });

  it('warns for the final giant, makes its breach fail, and preserves a Stage 4 fragment cap', () => {
    const field = new MonsterField(Engine.create(), 2, true, 5);
    expect(field.target).toBe(24);
    expect(field.obstacles).toHaveLength(1);
    const giant = reachElite(field, 'elite-giant');
    expect(giant).toMatchObject({ hp: 64, defense: 4, attack: 42 });
    Body.setPosition(giant.body, { x: giant.body.position.x, y: 430 });
    expect(field.views.find(view => view.body.id === giant.body.id)?.warning).toBe(true);
    field.forceBreachForTest('elite-giant');
    expect(field.update(16)).toContain(42);
    expect(field.eliteBreached).toBe(true);
    field.destroy();

    const splitting = new MonsterField(Engine.create(), 2, true, 5);
    for (let i = 0; i < 12; i += 1) {
      splitting.update(700);
      for (const parent of splitting.views.filter(view => view.kind === 'splitter')) {
        expect(splitting.hit(parent.body, 100)?.reward).toBe(true);
      }
      expect(splitting.views.filter(view => view.kind === 'fragment').length).toBeLessThanOrEqual(6);
    }
    const fragment = splitting.views.find(view => view.kind === 'fragment')!;
    expect(splitting.hit(fragment.body, 100)).toMatchObject({ destroyed: true, reward: false });
    splitting.destroy();
  });

  it('slows only Stage 5 live targets and expires without altering older stages', () => {
    const field = new MonsterField(Engine.create(), 1, true, 5);
    const wave = field.views[0];
    expect(field.freeze(wave.body)).toBe(true);
    expect(field.views[0].frozen).toBe(true);
    const y = wave.body.position.y;
    field.update(1000);
    expect(wave.body.position.y - y).toBeCloseTo(9, 4);
    field.update(500);
    expect(field.views.find(view => view.body.id === wave.body.id)?.frozen).toBe(false);
    field.destroy();
    const older = new MonsterField(Engine.create(), 1, true, 4);
    expect(older.freeze(older.views[0].body)).toBe(false);
    older.destroy();
  });
});
