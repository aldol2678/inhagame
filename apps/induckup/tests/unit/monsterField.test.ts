import { Engine } from 'matter-js';
import { describe, expect, it } from 'vitest';
import { BOOKSHELF_CATEGORY, MonsterField } from '../../src/p4/MonsterField';

describe('MonsterField combat stats', () => {
  it('spawns wave monsters with HP/ATK/DEF and applies damage', () => {
    const field = new MonsterField(Engine.create(), 1, true);
    expect(field.target).toBe(18);
    expect(field.activeCount).toBe(3);
    const first = field.views[0];
    expect(first).toMatchObject({ kind: 'wave', hp: 10, maxHp: 10, attack: 30, defense: 0 });

    const chipped = field.hit(first.body, 6);
    expect(chipped).toMatchObject({ damage: 6, destroyed: false });
    expect(field.views.find(view => view.body.id === first.body.id)?.hp).toBe(4);

    const killed = field.hit(first.body, 10);
    expect(killed).toMatchObject({ damage: 10, destroyed: true });
    expect(field.defeatedCount).toBe(1);
    field.destroy();
  });

  it('returns each breached monster attack instead of a flat life loss', () => {
    const field = new MonsterField(Engine.create(), 1, true);
    field.forceBreachForTest();
    expect(field.update(16)).toEqual([30]);
    expect(field.breachedCount).toBe(1);
    field.destroy();
  });

  it('introduces faster 40 ATK rapid monsters in area two', () => {
    const field = new MonsterField(Engine.create(), 2, true);
    const rapid = field.views.find(view => view.kind === 'rapid');
    expect(rapid).toBeDefined();
    expect(rapid).toMatchObject({ hp: 10, attack: 40, defense: 0 });
    field.destroy();
  });

  it('damages nearest targets without requiring immediate kills', () => {
    const field = new MonsterField(Engine.create(), 1, true);
    const origin = field.views[0].body;
    const results = field.hitNearest(origin, 2, 4);
    expect(results).toHaveLength(2);
    expect(results.every(result => result.damage === 4 && !result.destroyed)).toBe(true);
    expect(field.defeatedCount).toBe(0);
    field.destroy();
  });

  it('keeps Stage 2 bombs local to a clustered front and adds reflecting pillars', () => {
    const field = new MonsterField(Engine.create(), 1, true, 2);
    expect(field.obstacles).toHaveLength(2);
    expect(field.views.map(view => view.kind)).toEqual(['armor', 'swarm', 'swarm']);
    const origin = field.views[1].body;
    const hits = field.hitNearest(origin, 4, 10);
    expect(hits).toHaveLength(2);
    expect(hits.every(hit => hit.damage === 10)).toBe(true);
    field.destroy();
  });

  it('spawns the administration wall in the final wave and weakens its defense as guards fall', () => {
    const field = new MonsterField(Engine.create(), 2, true, 2);
    for (let i = 0; i < 10 && !field.views.some(view => view.kind === 'boss'); i += 1) field.update(700);
    const boss = field.views.find(view => view.kind === 'boss');
    const guards = field.views.filter(view => view.kind === 'guard');
    expect(boss).toMatchObject({ hp: 90, defense: 12 });
    expect(guards).toHaveLength(2);
    field.hit(guards[0].body, 100);
    expect(field.views.find(view => view.kind === 'boss')?.defense).toBe(7);
    field.hit(guards[1].body, 100);
    expect(field.hit(boss!.body, 10)).toMatchObject({ damage: 8 });
    field.destroy();
  });

  it('gives library shields a front and a weak side while piercing ignores their defense', () => {
    const field = new MonsterField(Engine.create(), 1, true, 3);
    expect(field.views.map(view => view.kind)).toEqual(['support', 'shelf', 'shield']);
    expect(field.obstacles).toHaveLength(3);
    expect(field.obstacles.every(body => body.label === 'stage-bookshelf'
      && body.collisionFilter.category === BOOKSHELF_CATEGORY)).toBe(true);
    const shield = field.views.find(view => view.kind === 'shield')!.body;
    expect(field.hit(shield, 10, 0, { x: 0, y: -7 })?.damage).toBe(1);
    expect(field.hit(shield, 10, 0, { x: 7, y: -1 })?.damage).toBe(8);
    expect(field.hit(shield, 10, 14, { x: 0, y: -7 })?.damage).toBe(10);
    field.destroy();
  });

  it('sends the thesis boss after the Stage 3 waves and exposes a weaker back', () => {
    const field = new MonsterField(Engine.create(), 2, true, 3);
    for (let i = 0; i < 10 && !field.views.some(view => view.kind === 'thesis'); i += 1) field.update(700);
    const thesis = field.views.find(view => view.kind === 'thesis');
    expect(thesis).toMatchObject({ hp: 84, defense: 12 });
    expect(field.views.filter(view => view.kind === 'shield').length).toBeGreaterThanOrEqual(2);
    expect(field.hit(thesis!.body, 10, 0, { x: 0, y: -7 })?.damage).toBe(1);
    expect(field.hit(thesis!.body, 10, 0, { x: 0, y: 7 })?.damage).toBe(7);
    field.destroy();
  });

  it('splits a Stage 4 monster once while counting and rewarding only the parent', () => {
    const field = new MonsterField(Engine.create(), 1, true, 4);
    expect(field.views.map(view => view.kind)).toEqual(['wave', 'flank', 'wave']);
    field.update(700);
    const parent = field.views.find(view => view.kind === 'splitter')!;
    expect(parent).toMatchObject({ hp: 16, defense: 1, attack: 28 });
    expect(field.hit(parent.body, 100)).toMatchObject({ destroyed: true, reward: true });
    const fragments = field.views.filter(view => view.kind === 'fragment');
    expect(fragments).toHaveLength(2);
    expect(field.defeatedCount).toBe(1);
    for (const child of fragments) {
      expect(field.hit(child.body, 100)).toMatchObject({ destroyed: true, reward: false });
    }
    expect(field.views.some(view => view.kind === 'fragment')).toBe(false);
    expect(field.defeatedCount).toBe(1);
    field.destroy();
  });

  it('reserves room for every Stage 4 split without exceeding six living fragments', () => {
    const field = new MonsterField(Engine.create(), 1, true, 4);
    for (let wave = 0; wave < 8; wave += 1) {
      field.update(700);
      for (const monster of field.views.filter(view => view.kind === 'splitter')) {
        field.hit(monster.body, 100);
      }
      expect(field.views.filter(view => view.kind === 'fragment').length).toBeLessThanOrEqual(6);
    }
    field.destroy();
  });

  it('keeps a crossing below the Stage 4 divider and requires all boss parts', () => {
    const field = new MonsterField(Engine.create(), 2, true, 4);
    expect(field.obstacles).toHaveLength(1);
    expect(field.obstacles[0].label).toBe('stage-crossroad');
    expect(field.obstacles[0].bounds.max.y).toBeLessThan(400);
    for (let i = 0; i < 12 && !field.views.some(view => view.kind === 'team-contact'); i += 1) {
      field.update(700);
    }
    const contact = field.views.find(view => view.kind === 'team-contact')!;
    const doc = field.views.find(view => view.kind === 'team-doc')!;
    const slide = field.views.find(view => view.kind === 'team-slide')!;
    expect(contact.defense).toBe(6);
    field.hit(doc.body, 100);
    expect(field.bossPartsCleared).toBe(1);
    expect(field.views.find(view => view.kind === 'team-contact')?.defense).toBe(6);
    field.hit(slide.body, 100);
    expect(field.views.find(view => view.kind === 'team-contact')?.defense).toBe(3);
    field.hit(contact.body, 100);
    expect(field.bossPartsCleared).toBe(3);
    expect(field.bossBreached).toBe(false);
    field.destroy();
  });

  it('marks a Stage 4 boss breach as a failed objective even before HP reaches zero', () => {
    const field = new MonsterField(Engine.create(), 2, true, 4);
    for (let i = 0; i < 12 && !field.views.some(view => view.kind === 'team-doc'); i += 1) {
      field.update(700);
    }
    field.forceBreachForTest('team-doc');
    expect(field.update(16)).toContain(34);
    expect(field.bossBreached).toBe(true);
    expect(field.bossPartsCleared).toBe(0);
    field.destroy();
  });
});
