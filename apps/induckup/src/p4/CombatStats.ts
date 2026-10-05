export interface CombatStats {
  hp: number;
  maxHp: number;
  defense: number;
  ballAttack: number;
  bombMultiplier: number;
  cloneDamageMultiplier: number;
  cloneDurationBonusMs: number;
  pierceDefenseIgnore: number;
  breachShield: number;
  featherPickupBonus: number;
  featherXp: number;
}

export function createCombatStats(): CombatStats {
  return {
    hp: 100,
    maxHp: 100,
    defense: 5,
    ballAttack: 10,
    bombMultiplier: 0.75,
    cloneDamageMultiplier: 1,
    cloneDurationBonusMs: 0,
    pierceDefenseIgnore: 0,
    breachShield: 0,
    featherPickupBonus: 0,
    featherXp: 2,
  };
}

export function applyBreachDamage(stats: CombatStats, attack: number): number {
  let damage = Math.max(1, Math.trunc(attack) - stats.defense);
  if (stats.breachShield > 0) {
    const blocked = Math.min(stats.breachShield, damage);
    stats.breachShield -= blocked;
    damage -= blocked;
  }
  stats.hp = Math.max(0, stats.hp - damage);
  return damage;
}
