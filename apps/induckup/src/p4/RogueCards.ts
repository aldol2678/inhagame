import type { DuckKind } from '../game/paddle/duckTypes';
import type { CombatStats } from './CombatStats';

export type UpgradeCardId =
  | 'ball-power'
  | 'condensed-shot'
  | 'fortify'
  | 'repair'
  | 'expansion'
  | 'emergency-shield'
  | 'feather-magnet'
  | 'rich-feather'
  | 'blast-amp'
  | 'clone-core'
  | 'clone-time'
  | 'pierce-core'
  | 'freeze-training';

export interface UpgradeCard {
  id: UpgradeCardId;
  title: string;
  description: string;
  tag: '공격' | '생존' | '성장' | '폭탄' | '복제' | '관통';
}

export const UPGRADE_CARDS: Record<UpgradeCardId, UpgradeCard> = {
  'ball-power': { id: 'ball-power', title: '묵직한 공', description: '공 ATK +3', tag: '공격' },
  'condensed-shot': { id: 'condensed-shot', title: '응축 타격', description: '공 ATK +2 · 폭탄 피해 +10%', tag: '공격' },
  fortify: { id: 'fortify', title: '튼튼한 울타리', description: 'DEF +2', tag: '생존' },
  repair: { id: 'repair', title: '응급 보수', description: 'HP 25 회복', tag: '생존' },
  expansion: { id: 'expansion', title: '증축 공사', description: '최대 HP +20 · HP 20 회복', tag: '생존' },
  'emergency-shield': { id: 'emergency-shield', title: '비상막', description: '다음 침입 피해를 총 15 막음', tag: '생존' },
  'feather-magnet': { id: 'feather-magnet', title: '깃털 자석', description: '깃털 획득 범위 +8', tag: '성장' },
  'rich-feather': { id: 'rich-feather', title: '농축 깃털', description: '깃털 XP +1', tag: '성장' },
  'blast-amp': { id: 'blast-amp', title: '큰 폭발', description: '폭탄 주변 피해 +25%p', tag: '폭탄' },
  'clone-core': { id: 'clone-core', title: '복제 코어', description: '복제공 피해 +25%p', tag: '복제' },
  'clone-time': { id: 'clone-time', title: '긴 잔상', description: '복제 지속시간 +1.5초', tag: '복제' },
  'pierce-core': { id: 'pierce-core', title: '관통 탄두', description: '관통 중 DEF 2 추가 무시', tag: '관통' },
  'freeze-training': { id: 'freeze-training', title: '빙결 훈련',
    description: '직접 명중 시 6초마다 적을 잠시 느리게', tag: '생존' },
};

const GENERIC: UpgradeCardId[] = [
  'ball-power', 'condensed-shot', 'fortify', 'repair',
  'expansion', 'emergency-shield', 'feather-magnet', 'rich-feather',
];

function synergyPool(kinds: readonly DuckKind[]): UpgradeCardId[] {
  const ids: UpgradeCardId[] = [];
  if (kinds.includes('bomb')) ids.push('blast-amp');
  if (kinds.includes('clone')) ids.push('clone-core', 'clone-time');
  if (kinds.includes('pierce')) ids.push('pierce-core');
  return ids;
}

function score(id: string, seed: number): number {
  let h = seed | 0;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  return (h >>> 0) / 0xffffffff;
}

export function offerUpgradeCards(level: number, kinds: readonly DuckKind[], runSeed: number,
  stageId = 1): UpgradeCard[] {
  const pool = [...GENERIC, ...synergyPool(kinds)];
  const seed = (runSeed ^ Math.imul(level, 0x9e3779b1)) | 0;
  const offered = pool
    .map(id => ({ id, n: score(id, seed) }))
    .sort((a, b) => a.n - b.n || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map(item => UPGRADE_CARDS[item.id]);
  // Every Stage 5 run can choose the new card once, with two familiar alternatives.
  if (stageId === 5 && level === 2) offered[2] = UPGRADE_CARDS['freeze-training'];
  return offered;
}

export function rerollUpgradeCard(offer: readonly UpgradeCard[], slot: number, kinds: readonly DuckKind[],
  runSeed: number, stageId: number): UpgradeCard[] | null {
  if (offer.length !== 3 || !Number.isInteger(slot) || slot < 0 || slot > 2
    || (stageId === 5 && slot === 2 && offer[2].id === 'freeze-training')) return null;
  const used = new Set(offer.map(card => card.id));
  const seed = runSeed ^ Math.imul(slot + 1, 0x45d9f3b);
  const candidate = [...GENERIC, ...synergyPool(kinds)]
    .filter(id => !used.has(id))
    .sort((a, b) => score(a, seed) - score(b, seed) || a.localeCompare(b))[0];
  if (!candidate) return null;
  return offer.map((card, index) => index === slot ? UPGRADE_CARDS[candidate] : card);
}

export function applyUpgradeCard(stats: CombatStats, id: UpgradeCardId): void {
  switch (id) {
    case 'ball-power':
      stats.ballAttack += 3;
      break;
    case 'condensed-shot':
      stats.ballAttack += 2;
      stats.bombMultiplier += 0.10;
      break;
    case 'fortify':
      stats.defense += 2;
      break;
    case 'repair':
      stats.hp = Math.min(stats.maxHp, stats.hp + 25);
      break;
    case 'expansion':
      stats.maxHp += 20;
      stats.hp = Math.min(stats.maxHp, stats.hp + 20);
      break;
    case 'emergency-shield':
      stats.breachShield += 15;
      break;
    case 'feather-magnet':
      stats.featherPickupBonus += 8;
      break;
    case 'rich-feather':
      stats.featherXp += 1;
      break;
    case 'blast-amp':
      stats.bombMultiplier += 0.25;
      break;
    case 'clone-core':
      stats.cloneDamageMultiplier += 0.25;
      break;
    case 'clone-time':
      stats.cloneDurationBonusMs += 1500;
      break;
    case 'pierce-core':
      stats.pierceDefenseIgnore += 2;
      break;
    case 'freeze-training':
      // Stage 5's on-hit effect belongs to the current run, not the shared combat schema.
      break;
  }
}
