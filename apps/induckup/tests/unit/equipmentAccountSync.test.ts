import { afterEach, expect, it, vi } from 'vitest';
import { InhaGameAccount } from '../../src/account/InhaGameAccount';
import { emptyCampaignProgress, recordStageClear } from '../../src/home/progress';

afterEach(() => vi.unstubAllGlobals());

it('keeps cloud selection across devices and keeps guest choice out of a different account', async () => {
  const campaign = [1, 2, 3, 4, 5, 6].reduce((p, id) => recordStageClear(p, id), emptyCampaignProgress());
  let remote: any = { version: 1, campaign, meta: { version: 1,
    selectedEquipmentId: 'feather-recovery', equipmentChangedAt: '2026-09-24T00:00:00Z' } };
  const rpc = vi.fn(async (name: string, args?: { p_progress?: unknown }) => {
    if (name === 'get_my_game_progress') return { data: [{ progress: remote }], error: null };
    if (name === 'save_my_game_progress') { remote = args?.p_progress; return { data: null, error: null }; }
    return { data: false, error: null };
  });
  const client = { auth: {
    getSession: async () => ({ data: { session: { user: { id: 'account-a', is_anonymous: false } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  }, rpc };
  vi.stubGlobal('window', { supabase: { createClient: () => client }, setTimeout, clearTimeout });
  const device = () => {
    const values = new Map<string, string>();
    values.set('induckupGuestProgressV1', JSON.stringify({ version: 1, campaign, meta: {
      version: 1, selectedEquipmentId: 'landing-chalk', equipmentChangedAt: '2026-09-25T00:00:00Z',
    } }));
    values.set('induckupProgressV1', values.get('induckupGuestProgressV1')!);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    });
  };
  device();
  const first = new InhaGameAccount();
  await first.init();
  expect(first.getProgress().meta.selectedEquipmentId).toBe('feather-recovery');
  expect(first.getActiveEquipment()).toBe('feather-recovery');
  expect(await first.selectEquipment(null)).toBe(true);
  expect(remote.meta.selectedEquipmentId).toBeNull();
  device();
  const second = new InhaGameAccount();
  await second.init();
  expect(second.getActiveEquipment()).toBeNull();
  expect(second.getProgress().campaign.clearedStages).toHaveLength(6);
});

it('refuses a permanent selection if the cloud read fails', async () => {
  const campaign = [1, 2, 3, 4, 5, 6].reduce((p, id) => recordStageClear(p, id), emptyCampaignProgress());
  const values = new Map([['induckupProgressV1', JSON.stringify({ campaign })]]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
  const client = { auth: {
    getSession: async () => ({ data: { session: { user: { id: 'a', is_anonymous: false } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  }, rpc: async () => ({ data: null, error: new Error('offline') }) };
  vi.stubGlobal('window', { supabase: { createClient: () => client }, setTimeout, clearTimeout });
  const account = new InhaGameAccount();
  await account.init();
  expect(await account.selectEquipment('feather-recovery')).toBe(false);
  expect(account.getActiveEquipment()).toBeNull();
});
