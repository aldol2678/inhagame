import { describe, expect, it } from 'vitest';
import { applyBreachDamage, createCombatStats } from '../../src/p4/CombatStats';
import { applyUpgradeCard, offerUpgradeCards } from '../../src/p4/RogueCards';

describe('P4 combat stats and roguelike cards', () => {
  it('starts at HP 100 / DEF 5 / ball ATK 10 and resolves breach damage', () => {
    const stats = createCombatStats();
    expect(stats).toMatchObject({ hp: 100, maxHp: 100, defense: 5, ballAttack: 10 });
    expect(applyBreachDamage(stats, 30)).toBe(25);
    expect(stats.hp).toBe(75);

    stats.breachShield = 15;
    expect(applyBreachDamage(stats, 30)).toBe(10);
    expect(stats.hp).toBe(65);
    expect(stats.breachShield).toBe(0);
  });

  it('applies stackable attack, defense, HP and evolution synergy cards', () => {
    const stats = createCombatStats();
    applyUpgradeCard(stats, 'ball-power');
    applyUpgradeCard(stats, 'fortify');
    applyUpgradeCard(stats, 'expansion');
    applyUpgradeCard(stats, 'blast-amp');
    applyUpgradeCard(stats, 'clone-core');
    applyUpgradeCard(stats, 'clone-time');
    applyUpgradeCard(stats, 'pierce-core');
    expect(stats).toMatchObject({
      ballAttack: 13,
      defense: 7,
      maxHp: 120,
      hp: 120,
      bombMultiplier: 1,
      cloneDamageMultiplier: 1.25,
      cloneDurationBonusMs: 1500,
      pierceDefenseIgnore: 2,
    });
  });

  it('offers three unique cards and only adds evolved-role synergy to the candidate pool', () => {
    const basic = offerUpgradeCards(2, ['basic', 'basic', 'basic', 'basic', 'basic'], 1234);
    expect(basic).toHaveLength(3);
    expect(new Set(basic.map(card => card.id)).size).toBe(3);
    expect(basic.every(card => !['blast-amp', 'clone-core', 'clone-time', 'pierce-core'].includes(card.id))).toBe(true);

    const evolved = Array.from({ length: 20 }, (_, i) =>
      offerUpgradeCards(4 + i, ['pierce', 'bomb', 'clone', 'basic', 'basic'], 1234 + i)
        .map(card => card.id)).flat();
    expect(evolved.some(id => ['blast-amp', 'clone-core', 'clone-time', 'pierce-core'].includes(id))).toBe(true);
    for (const stage of [1, 2, 3, 4]) {
      expect(offerUpgradeCards(2, ['basic'], 1234, stage)).toEqual(basic);
    }
    const anniversary = offerUpgradeCards(2, ['basic'], 1234, 5);
    expect(anniversary).toHaveLength(3);
    expect(anniversary[2].id).toBe('freeze-training');
    expect(new Set(anniversary.map(card => card.id)).size).toBe(3);
  });
});
