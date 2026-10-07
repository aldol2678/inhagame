// Test-only server replies. This transport cannot reach a network, account or reward service.
import { createFishingClient } from '../../src/activity/fishing-client.js';
import { FISHING_ACTIVITY_ID, FISHING_SOURCES } from '../../src/activity/fishing-core.js';
// The public repository deliberately withholds the original mascot. Compatibility node names
// such as DuckWing_R in this cuboid are API fixtures, not evidence of duck anatomy.
export const FISHING_AVATAR_PROXY = Object.freeze({
  path: 'apps/world/assets/induck-v3.glb', url: '/assets/induck-v3.glb',
  sha256: '5057f3299a9d7e902b1370d203fa93e8279a2ff27a8bc2bdf68f09fe312c58f2',
  provenance: 'Independent axis-aligned QA box or teal-square sprite; no original geometry/pixels/textures read.',
  representation: 'public-qa-cuboid-proxy', anatomicalFitValidated: false
});
export function validateFishingAvatarProxy({ manifest, notice, sha256 }) {
  const entry = manifest?.assets?.find(asset => asset.path === FISHING_AVATAR_PROXY.path);
  if (!entry || entry.provenance !== FISHING_AVATAR_PROXY.provenance || entry.sha256 !== FISHING_AVATAR_PROXY.sha256 || sha256 !== entry.sha256) {
    throw Error('Public avatar proxy provenance/hash changed; review fixture scope before acceptance');
  }
  if (!/Original source mascot images,[\s\S]*?are withheld/.test(notice) || !/attachment names exist only for API compatibility/.test(notice)) {
    throw Error('Public avatar proxy disclosure changed; review NOTICE.md before acceptance');
  }
  return { ...FISHING_AVATAR_PROXY, notice: 'Original mascot assets withheld; attachment names are compatibility-only. No duck hand-fit acceptance.' };
}

export function createFishingFixture() {
  const epoch = 1_000_000, requests = [];
  let time = epoch, serial = 0, sourceRef = FISHING_SOURCES[0], attempt = null, pendingHook = null;
  const uuid = () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
  const read = () => ({ attempt, settlement: attempt?.status === 'SUCCEEDED' ? 'SETTLED' : 'NOT_REQUIRED',
    inventory: { itemId: 'material.fish_carp', quantity: attempt?.status === 'SUCCEEDED' ? 1 : 0 },
    discovery: { discovered: attempt?.status === 'SUCCEEDED' },
    lifeSkill: { skillId: 'life.fishing', level: 1, totalXp: 0, nextLevelXp: 20 } });
  const response = payload => ({ ok: true, status: 200, json: async () => structuredClone(payload) });
  const client = createFishingClient({ now: () => time, uuid, getToken: async () => 'synthetic-test-only',
    endpoint: 'synthetic:no-network', fetcher: async (url, options) => {
      if (url !== 'synthetic:no-network') throw Error('Fixture rejected a network endpoint');
      const body = JSON.parse(options.body);
      requests.push({ ...body, at: time, transport: 'in-memory synthetic server' });
      if (body.op === 'read') return response(read());
      if (body.op === 'start') {
        attempt = { activityId: FISHING_ACTIVITY_ID, sourceRef: body.sourceRef, attemptId: uuid(), nonce: uuid(),
          status: 'ACTIVE', startedAtMs: time, biteAtMs: time + 3000,
          hookDeadlineMs: time + 5000, expiresAtMs: time + 8000, result: null };
        return response({ status: 'STARTED', attempt });
      }
      if (body.op === 'input' && body.action === 'HOOK') {
        if (pendingHook) throw Error('Duplicate synthetic hook');
        return new Promise(resolve => { pendingHook = resolve; });
      }
      if (body.op === 'settle') return response({ status: 'SETTLED' });
      throw Error(`Unexpected synthetic operation: ${body.op}`);
    }
  });
  return { client, requests,
    async reset(shore) {
      if (pendingHook) throw Error('Cannot reset with a pending synthetic hook');
      if (!FISHING_SOURCES.includes(shore)) throw Error('Unknown fixture shore');
      await client.setAccount(null); time = epoch; attempt = null; sourceRef = shore;
      await client.setAccount('synthetic-fixture-only');
    },
    start: () => client.start(sourceRef), hook: () => client.hook(),
    advance(elapsedMs) {
      if (!Number.isFinite(elapsedMs) || epoch + elapsedMs < time) throw Error('Fixture clock must be monotonic');
      time = epoch + elapsedMs;
    },
    async waitForPendingHook() {
      for (let i = 0; i < 20 && !pendingHook; i++) await Promise.resolve();
      if (!pendingHook) throw Error('Synthetic hook did not reach transport');
    },
    respondHook() {
      if (!pendingHook) throw Error('No pending synthetic hook');
      attempt = { ...attempt, status: 'SUCCEEDED', result: { status: 'SUCCEEDED', reason: 'CAUGHT',
        catch: { itemId: 'material.fish_carp', quantity: 1, lifeXp: 1, skillId: 'life.fishing', collectionEntryId: 'fish.carp' } } };
      const resolve = pendingHook; pendingHook = null; resolve(response({ attempt }));
    }
  };
}

// RGBA from real WebGL readPixels (bottom-left origin); ROI uses camera screen coordinates.
export function pixelEvidence(data, width, height, previous = null, roi = null) {
  if (data.length !== width * height * 4 || (previous && previous.length !== data.length)) throw Error('Invalid framebuffer dimensions');
  let hash = 2166136261, foreground = 0, changed = 0, exactChanged = 0, changedInRoi = 0;
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - data[0]) + Math.abs(data[i + 1] - data[1]) + Math.abs(data[i + 2] - data[2]) > 12) foreground++;
    if (previous) {
      const delta = Math.abs(data[i] - previous[i]) + Math.abs(data[i + 1] - previous[i + 1]) + Math.abs(data[i + 2] - previous[i + 2]);
      if (delta) exactChanged++;
      if (delta > 12) {
        changed++;
        const x = (i / 4) % width, y = height - 1 - Math.floor(i / 4 / width);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        if (roi && x >= roi.minX && x <= roi.maxX && y >= roi.minY && y <= roi.maxY) changedInRoi++;
      }
    }
    for (let k = 0; k < 3; k++) hash = Math.imul((hash ^ data[i + k]) >>> 0, 16777619);
  }
  return { width, height, hash: hash >>> 0, foreground, changed, exactChanged, changedInRoi,
    changedBounds: changed ? { minX, maxX, minY, maxY } : null };
}
export function requirePixelContribution(evidence, minimum) {
  if (evidence.changed < minimum || evidence.changedInRoi < minimum) throw Error(`Missing visible pixel contribution: ${JSON.stringify(evidence)}`);
}
