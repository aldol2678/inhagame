import { afterEach, describe, expect, it, vi } from 'vitest';
import { InhaGameAccount } from '../../src/account/InhaGameAccount';

afterEach(() => vi.unstubAllGlobals());

describe('INHAGAME sign-out', () => {
  it('keeps account progress private until that account signs back in', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    vi.stubGlobal('localStorage', storage);

    let currentId = 'account-a';
    let authChange: ((event: string, session: { user: { id: string; is_anonymous: boolean } } | null) => void) | null = null;
    const signOut = vi.fn(async () => {
      authChange?.('SIGNED_OUT', null);
      return { error: null };
    });
    const client = {
      auth: {
        getSession: async () => ({ data: { session: { user: { id: currentId, is_anonymous: false } } } }),
        signOut,
        onAuthStateChange: (callback: typeof authChange) => {
          authChange = callback;
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
      rpc: async () => ({ data: [], error: null }),
    };
    const reload = vi.fn();
    vi.stubGlobal('window', {
      supabase: { createClient: () => client },
      setTimeout,
      clearTimeout,
      location: { reload },
    });

    const first = new InhaGameAccount();
    await first.init();
    first.recordRun({
      result: 'CLEAR', wave: 2, level: 3, evolutions: 2, evolvedKind: 'bomb',
      finishedAt: '2026-09-25T00:00:00.000Z',
      campaign: { stageId: 1, remainingHp: 64, durationMs: 75000, level: 3,
        maxCombo: 4, fusionCount: 1 },
    });
    expect(await first.signOut()).toBe(true);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(reload).toHaveBeenCalledOnce();
    expect(storage.getItem('induckupProgressV1')).toBeNull();
    expect(JSON.parse(storage.getItem('induckupCampaignV2') ?? 'null').clearedStages).toEqual([]);
    expect(storage.getItem('induckupAccountProgressV1:account-a')).not.toBeNull();

    currentId = 'account-b';
    const second = new InhaGameAccount();
    await second.init();
    expect(second.getProgress().runsRecorded).toBe(0);
    expect(second.getProgress().campaign.clearedStages).toEqual([]);

    currentId = 'account-a';
    const original = new InhaGameAccount();
    await original.init();
    expect(original.getProgress().runsRecorded).toBe(1);
    expect(original.getProgress().campaign.stages[1].goals).toHaveLength(3);
  });
});
