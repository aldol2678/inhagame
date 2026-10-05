import { describe, expect, it } from 'vitest';
import { Bodies } from 'matter-js';
import { emptyCampaignProgress, recordStageClear, normalizeCampaignProgress, mergeCampaignProgress } from '../../src/home/progress';
import { activeEquipment, equipmentUnlocked, mergeMeta, normalizeMeta, totalStars } from '../../src/home/equipment';
import { mergeInduckUpProgress, normalizeInduckUpProgress, recordInduckUpRun } from '../../src/account/accountProgress';
import { LakeGrowth } from '../../src/p4/LakeGrowth';
import { offerUpgradeCards, rerollUpgradeCard } from '../../src/p4/RogueCards';
import { projectedLandingX } from '../../src/p4/LandingChalk';

describe('P7 campaign equipment and growth contract', () => {
  const campaign = [1, 2, 3, 4, 5, 6].reduce((state, stage) => recordStageClear(state, stage), emptyCampaignProgress());
  it('requires Stage 6, counts cumulative stars, and never trusts an old ranking flag', () => {
    expect(totalStars(campaign)).toBe(6);
    expect(equipmentUnlocked(campaign, 'feather-recovery')).toBe(true);
    expect(equipmentUnlocked(campaign, 'landing-chalk')).toBe(false);
    const sixWithoutClear = normalizeCampaignProgress({ rankingUnlocked: true, stages: campaign.stages });
    expect(equipmentUnlocked(sixWithoutClear, 'feather-recovery')).toBe(false);
    let more = campaign;
    for (const id of [1, 2, 3, 4, 5, 6]) more = recordStageClear(more, id, {
      remainingHp: 75, durationMs: 3400, level: 6, maxCombo: 2, fusionCount: 1,
    });
    expect(totalStars(more)).toBe(18);
    expect(equipmentUnlocked(more, 'choice-notebook')).toBe(true);
    expect(totalStars(mergeCampaignProgress(more, campaign))).toBe(18);
  });

  it('normalizes unknown IDs, keeps deliberate unequip and provenance across old data and merges', () => {
    const meta = normalizeMeta({ selectedEquipmentId: 'unsafe', equipmentChangedAt: 'bad' });
    expect(activeEquipment(campaign, meta)).toBeNull();
    const equipped = { version: 1, selectedEquipmentId: 'feather-recovery',
      selectedCosmeticId: null, equipmentChangedAt: '2026-09-25T00:00:00Z', cosmeticChangedAt: null };
    const removed = { ...equipped, selectedEquipmentId: null, equipmentChangedAt: '2026-09-25T01:00:00Z' };
    expect(mergeMeta(equipped, removed).selectedEquipmentId).toBeNull();
    const old = normalizeInduckUpProgress({ campaign });
    expect(old.meta.selectedEquipmentId).toBeNull();
    const next = recordInduckUpRun({ ...old, meta: normalizeMeta(equipped) }, {
      result: 'CLEAR', wave: 2, level: 3, evolutions: 0, evolvedKind: null,
      campaign: { stageId: 1, remainingHp: 81, durationMs: 1200, level: 3, maxCombo: 2,
        fusionCount: 0, equipmentId: 'feather-recovery' },
    });
    expect(next.campaign.stages[1]?.best?.equipmentId).toBe('feather-recovery');
    expect(mergeInduckUpProgress(old, next).meta.selectedEquipmentId).toBe('feather-recovery');
  });

  it('recovers one missed feather per Area, requires pickup XP, and never recovers it twice', () => {
    const growth = new LakeGrowth();
    const duck = Bodies.rectangle(170, 545, 30, 20);
    growth.enableRecovery();
    growth.feathers.push({ id: 10, x: 180, y: 589 }, { id: 11, x: 240, y: 589 });
    expect(growth.update(16, [duck])).toEqual([]);
    expect(growth.recoveredCount).toBe(1);
    expect(growth.totalXp).toBe(0);
    expect(growth.recoveryRemaining).toBe(0);
    growth.feathers[0].y = 590;
    growth.update(16, [duck]);
    expect(growth.recoveredCount).toBe(1);
    growth.startArea2();
    growth.feathers.push({ id: 30, x: 250, y: 590 });
    growth.update(16, [duck]);
    expect(growth.recoveredCount).toBe(2);
  });

  it('shows a wall reflected landing only for descending primary ball', () => {
    expect(projectedLandingX(180, 400, 1, -1)).toBeNull();
    expect(projectedLandingX(340, 400, 4, 4)).toBeCloseTo(264);
    expect(projectedLandingX(180, 500, 1, 4)).toBeNull();
  });

  it('rerolls exactly one Lv.2 card, keeps the other two and protects Stage 5 freeze', () => {
    const offer = offerUpgradeCards(2, ['basic'], 42, 5);
    const changed = rerollUpgradeCard(offer, 0, ['basic'], 42, 5)!;
    expect(changed[0].id).not.toBe(offer[0].id);
    expect(changed[1]).toEqual(offer[1]);
    expect(changed[2].id).toBe('freeze-training');
    expect(rerollUpgradeCard(offer, 2, ['basic'], 42, 5)).toBeNull();
    expect(new Set(changed.map(card => card.id)).size).toBe(3);
  });
});
