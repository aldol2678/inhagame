import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emptyCampaignProgress, getStageStatus, loadCampaignProgress, mergeCampaignProgress,
  normalizeCampaignProgress, recordStageClear, saveCampaignProgress,
} from '../../src/home/progress';
import { mergeInduckUpProgress, normalizeInduckUpProgress } from '../../src/account/accountProgress';

afterEach(() => vi.unstubAllGlobals());

describe('P5 campaign progress contract', () => {
  it('starts at Stage 1, opens the next stage after clear, and never trusts legacy ranking flags', () => {
    const fresh = emptyCampaignProgress();
    expect([1, 2, 3, 4, 5, 6].map(id => getStageStatus(fresh, id)))
      .toEqual(['PLAY', 'LOCKED', 'LOCKED', 'LOCKED', 'LOCKED', 'LOCKED']);
    const migrated = normalizeCampaignProgress({ version: 1, clearedStages: [1],
      highestUnlockedStage: 2, rankingUnlocked: true });
    expect([1, 2, 3, 4, 5, 6].map(id => getStageStatus(migrated, id)))
      .toEqual(['CLEAR', 'PLAY', 'LOCKED', 'LOCKED', 'LOCKED', 'LOCKED']);
    expect(migrated.rankingUnlocked).toBe(false);
    expect(migrated.stages[1].goals).toEqual(['clear']);
    const throughLibrary = recordStageClear(recordStageClear(migrated, 2), 3);
    expect([2, 3, 4].map(id => getStageStatus(throughLibrary, id)))
      .toEqual(['CLEAR', 'CLEAR', 'PLAY']);
    expect(throughLibrary.rankingUnlocked).toBe(false);
    const throughFifth = recordStageClear(throughLibrary, 4);
    expect([4, 5, 6].map(id => getStageStatus(throughFifth, id)))
      .toEqual(['CLEAR', 'PLAY', 'LOCKED']);
    expect(throughFifth.rankingUnlocked).toBe(false);
    const throughAnniversary = recordStageClear(throughFifth, 5);
    expect([5, 6].map(id => getStageStatus(throughAnniversary, id)))
      .toEqual(['CLEAR', 'PLAY']);
    expect(throughAnniversary.rankingUnlocked).toBe(false);
  });

  it('accumulates independent stars even if the best run has different conditions', () => {
    const first = recordStageClear(null, 1, {
      remainingHp: 10, durationMs: 90_000, level: 3, maxCombo: 2,
      fusionCount: 0, finishedAt: '2026-09-25T01:00:00Z',
    });
    const second = recordStageClear(first, 1, {
      remainingHp: 70, durationMs: 120_000, level: 6, maxCombo: 3,
      fusionCount: 0, finishedAt: '2026-09-25T02:00:00Z',
    });
    const third = recordStageClear(second, 1, {
      remainingHp: 20, durationMs: 100_000, level: 6, maxCombo: 8,
      fusionCount: 1, finishedAt: '2026-09-25T03:00:00Z',
    });
    expect(first.stages[1].goals).toEqual(['clear']);
    expect(second.stages[1].goals).toEqual(['clear', 'hp50']);
    expect(third.stages[1].goals).toEqual(['clear', 'hp50', 'fusion']);
    expect(third.stages[1].best?.remainingHp).toBe(70);
  });

  it('migrates/reloads malformed local values without losing a valid counterpart', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    });
    values.set('induckupCampaignV1', '{invalid');
    saveCampaignProgress(recordStageClear(null, 1));
    expect(loadCampaignProgress().clearedStages).toEqual([1]);
    values.set('induckupCampaignV1', JSON.stringify({
      clearedStages: [1], rankingUnlocked: true, highestUnlockedStage: 2,
    }));
    expect(loadCampaignProgress().rankingUnlocked).toBe(false);
  });

  it('merges local and cloud progress monotonically, including old account clears', () => {
    const local = recordStageClear(null, 1, {
      remainingHp: 65, durationMs: 80000, level: 6, maxCombo: 4, fusionCount: 0,
    });
    const cloud = recordStageClear(null, 1, {
      remainingHp: 35, durationMs: 60000, level: 6, maxCombo: 3, fusionCount: 1,
    });
    expect(mergeCampaignProgress(local, cloud).stages[1].goals)
      .toEqual(['clear', 'hp50', 'fusion']);
    const oldCloud = normalizeInduckUpProgress({ version: 1, clears: 1 });
    expect(oldCloud.campaign.clearedStages).toEqual([1]);
    const merged = mergeInduckUpProgress({ campaign: local }, { campaign: cloud });
    expect(merged.campaign.stages[1].goals).toHaveLength(3);
  });

  it('requires Stage 6 CLEAR for the ranking gate', () => {
    expect(normalizeCampaignProgress({ rankingUnlocked: true, clearedStages: [1, 2, 3, 4, 5] })
      .rankingUnlocked).toBe(false);
    const final = recordStageClear(emptyCampaignProgress(), 6);
    expect(final.rankingUnlocked).toBe(true);
    expect(getStageStatus(final, 6)).toBe('CLEAR');
  });
});
