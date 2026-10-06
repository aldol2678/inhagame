// Public, deliberately nonfunctional credentials and identities for offline container QA only.
export const PUBLIC_ENV = Object.freeze({
  PORT: '8080', NPC_AI_ENABLED: '1', NPC_AI_PROJECT: 'collection-fixture-project',
  SUPABASE_URL: 'https://collection-fixture.invalid',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_collection_fixture_only',
  SUPABASE_SERVICE_ROLE_KEY: 'collection-fixture-service-key-not-a-real-credential'
});
export const ACTORS = Object.freeze({
  a: '11111111-1111-4111-8111-111111111111',
  b: '22222222-2222-4222-8222-222222222222',
  foreign: '33333333-3333-4333-8333-333333333333'
});
export const TOKENS = Object.freeze(Object.fromEntries(['a', 'b', 'foreign', 'anonymous', 'expired']
  .map(label => [label, `collection-fixture-${label}-not-a-real-token`])));
const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' }
});
const row = (entryId, category, found = false, catalogStatus = 'ACTIVE') => ({
  entryId, category, persistenceMode: 'SERVER_PERSISTED', ownerDomain: null, ownerRef: null,
  catalogStatus, definitionVersion: 1, discoveryState: found ? 'DISCOVERED' : 'UNKNOWN', discovered: found,
  firstDiscoveredAt: found ? '2026-01-01T00:00:00.000Z' : null,
  lastDiscoveredAt: found ? '2026-01-02T00:00:00.000Z' : null,
  discoveryCount: found ? 2 : 0, version: found ? 2 : 0, sourceRef: 'FIXTURE_PRIVATE_SOURCE'
});
function ledger(label) {
  return { userId: ACTORS[label === 'foreign' ? 'b' : label], internal: 'FIXTURE_PRIVATE_LEDGER', entries: [
    row('collection.fish.carp', 'FISH', label === 'a'),
    row('collection.plant.campus_leaf', 'PLANT', false, 'COMING_SOON'),
    row('collection.artifact.campus_fragment_01', 'ARTIFACT', false, 'COMING_SOON'),
    row('collection.fixture.hidden', 'LORE'),
    { entryId: 'collection.place.biryong_tower', category: 'PLACE', persistenceMode: 'DERIVED_FROM_OWNER',
      ownerDomain: 'BIRYONG', ownerRef: 'BR01', catalogStatus: 'ACTIVE', definitionVersion: 1,
      discoveryState: 'OWNER_DERIVED', discovered: null, firstDiscoveredAt: null, lastDiscoveredAt: null,
      discoveryCount: null, version: null, sourceRef: 'FIXTURE_PRIVATE_OWNER' }
  ] };
}

// No fallback to native fetch: every unexpected URL, method, credential or argument is denied.
export function createFixtureFetch(report = () => {}) {
  const denied = () => { report({ kind: 'denied' }); throw Error('COLLECTION_FIXTURE_REQUEST_DENIED'); };
  return async (url, options = {}) => {
    const headers = new Headers(options.headers);
    if (url === `${PUBLIC_ENV.SUPABASE_URL}/auth/v1/user`) {
      const label = Object.keys(TOKENS).find(key => headers.get('authorization') === `Bearer ${TOKENS[key]}`);
      if ((options.method ?? 'GET') !== 'GET' || options.body !== undefined || !label ||
        headers.get('apikey') !== PUBLIC_ENV.SUPABASE_PUBLISHABLE_KEY ||
        [...headers.keys()].sort().join() !== 'apikey,authorization') return denied();
      report({ kind: `auth-${label}` });
      if (label === 'expired') return reply({ error: 'fixture_expired' }, 401);
      return reply({ id: ACTORS[label] ?? ACTORS.a, is_anonymous: label === 'anonymous' });
    }
    if (url === `${PUBLIC_ENV.SUPABASE_URL}/rest/v1/rpc/world_collection_list_v1`) {
      let args;
      try { args = JSON.parse(options.body); } catch { return denied(); }
      const label = Object.keys(ACTORS).find(key => ACTORS[key] === args?.p_user);
      if (options.method !== 'POST' || options.redirect !== 'error' || !label ||
        Object.keys(args).join() !== 'p_user' || headers.get('apikey') !== PUBLIC_ENV.SUPABASE_SERVICE_ROLE_KEY ||
        headers.get('authorization') !== `Bearer ${PUBLIC_ENV.SUPABASE_SERVICE_ROLE_KEY}` ||
        headers.get('content-type') !== 'application/json' ||
        [...headers.keys()].sort().join() !== 'apikey,authorization,content-type') return denied();
      report({ kind: `rpc-${label}` });
      return reply(ledger(label));
    }
    return denied();
  };
}
