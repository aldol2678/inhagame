import type { CampaignProgress } from './progress';
import { normalizeCampaignProgress } from './progress';

export const EQUIPMENT = [
  { id: 'feather-recovery', name: '회수 가방', stars: 6, description: 'Area마다 놓친 깃털 하나를 한 번 다시 떨어뜨립니다.' },
  { id: 'landing-chalk', name: '착지 분필', stars: 12, description: '첫 오리 반사 전, 내려오는 기본 공의 예상 착지점을 표시합니다.' },
  { id: 'choice-notebook', name: '선택 노트', stars: 18, description: '첫 Lv.2 카드 선택에서 카드 한 장을 한 번 재추첨합니다.' },
] as const;
export const COSMETICS = [
  { id: 'ribbon-basic', name: '완주 리본', stars: 6 },
  { id: 'ribbon-navy', name: '남색 리본', stars: 12 },
  { id: 'nameplate-graduation', name: '졸업 명찰', stars: 18 },
] as const;
export type EquipmentId = typeof EQUIPMENT[number]['id'];
export type CosmeticId = typeof COSMETICS[number]['id'];
export interface MetaProgress {
  version: 1;
  selectedEquipmentId: EquipmentId | null;
  selectedCosmeticId: CosmeticId | null;
  equipmentChangedAt: string | null;
  cosmeticChangedAt: string | null;
}
export function emptyMeta(): MetaProgress {
  return { version: 1, selectedEquipmentId: null, selectedCosmeticId: null,
    equipmentChangedAt: null, cosmeticChangedAt: null };
}
function timestamp(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString() : null;
}
export function normalizeMeta(value: unknown): MetaProgress {
  const src = value && typeof value === 'object' ? value as Partial<MetaProgress> : {};
  return {
    version: 1,
    selectedEquipmentId: EQUIPMENT.some(item => item.id === src.selectedEquipmentId)
      ? src.selectedEquipmentId! : null,
    selectedCosmeticId: COSMETICS.some(item => item.id === src.selectedCosmeticId)
      ? src.selectedCosmeticId! : null,
    equipmentChangedAt: timestamp(src.equipmentChangedAt),
    cosmeticChangedAt: timestamp(src.cosmeticChangedAt),
  };
}
export function mergeMeta(aValue: unknown, bValue: unknown): MetaProgress {
  const a = normalizeMeta(aValue), b = normalizeMeta(bValue);
  // A null ID with a later timestamp is an intentional unequip, not missing data.
  return { version: 1,
    selectedEquipmentId: (b.equipmentChangedAt ?? '') > (a.equipmentChangedAt ?? '')
      ? b.selectedEquipmentId : a.selectedEquipmentId,
    equipmentChangedAt: [a.equipmentChangedAt, b.equipmentChangedAt].filter(Boolean).sort().at(-1) ?? null,
    selectedCosmeticId: (b.cosmeticChangedAt ?? '') > (a.cosmeticChangedAt ?? '')
      ? b.selectedCosmeticId : a.selectedCosmeticId,
    cosmeticChangedAt: [a.cosmeticChangedAt, b.cosmeticChangedAt].filter(Boolean).sort().at(-1) ?? null,
  };
}
export function totalStars(value: unknown): number {
  const progress = normalizeCampaignProgress(value);
  return Object.values(progress.stages).reduce((sum, stage) => sum + stage.goals.length, 0);
}
export function equipmentUnlocked(value: CampaignProgress, id: EquipmentId): boolean {
  return value.clearedStages.includes(6) && totalStars(value) >= EQUIPMENT.find(item => item.id === id)!.stars;
}
export function cosmeticUnlocked(value: CampaignProgress, id: CosmeticId): boolean {
  return value.clearedStages.includes(6) && totalStars(value) >= COSMETICS.find(item => item.id === id)!.stars;
}
export function activeEquipment(value: CampaignProgress, meta: MetaProgress): EquipmentId | null {
  const id = normalizeMeta(meta).selectedEquipmentId;
  return id && equipmentUnlocked(value, id) ? id : null;
}
export function activeCosmetic(value: CampaignProgress, meta: MetaProgress): CosmeticId | null {
  const id = normalizeMeta(meta).selectedCosmeticId;
  return id && cosmeticUnlocked(value, id) ? id : null;
}
