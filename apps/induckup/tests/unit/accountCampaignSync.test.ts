import { afterEach, describe, expect, it, vi } from 'vitest';
import { InhaGameAccount } from '../../src/account/InhaGameAccount';
import { emptyCampaignProgress, recordStageClear } from '../../src/home/progress';

afterEach(() => vi.unstubAllGlobals());

describe('campaign progress on INHAGAME accounts', () => {
  it('merges local and cloud stars, and restores clear on another device', async () => {
    let remote: unknown = { version: 1, clears: 1, campaign: recordStageClear(emptyCampaignProgress(), 1, {
      remainingHp: 80, durationMs: 110000, level: 5, maxCombo: 2, fusionCount: 0,
    }) };
    const rpc = vi.fn(async (name: string, args?: { p_progress?: unknown }) => {
      if (name === 'my_inha_mail_badge') return { data: false, error: null };
      if (name === 'get_my_game_progress') return { data: [{ progress: remote }], error: null };
      if (name === 'save_my_game_progress') { remote = args?.p_progress; return { data: null, error: null }; }
      return { data: null, error: null };
    });
    const client = {
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'account-a', is_anonymous: false } } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      }, rpc,
    };
    vi.stubGlobal('window', { supabase: { createClient: () => client }, setTimeout, clearTimeout });
    function useDevice() {
      const values = new Map<string, string>();
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
      });
    }
    useDevice();
    const first = new InhaGameAccount();
    first.recordRun({ result: 'CLEAR', wave: 2, level: 6, evolutions: 2, evolvedKind: 'pierce',
      campaign: { stageId: 1, remainingHp: 20, durationMs: 90000, level: 6,
        maxCombo: 4, fusionCount: 1 } });
    await first.init();
    expect(first.getProgress().campaign.stages[1].goals).toEqual(['clear', 'hp50', 'fusion']);
    expect(rpc).toHaveBeenCalledWith('save_my_game_progress',
      expect.objectContaining({ p_game_slug: 'induckup', p_schema_version: 1 }));

    useDevice();
    const second = new InhaGameAccount();
    await second.init();
    expect(second.getProgress().campaign.clearedStages).toEqual([1]);
    expect(second.getProgress().campaign.stages[1].goals).toHaveLength(3);
    expect(second.getProgress().campaign.rankingUnlocked).toBe(false);
  });
});
