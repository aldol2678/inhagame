// Stand-in for npm:@supabase/supabase-js in offline Edge Function tests. Every client is
// served by the FakeSupabase backend the current test installed (see harness.mjs).
export function createClient(url, key, options = {}) {
  const backend = globalThis.__edgeFakeSupabase;
  if (!backend) throw new Error('edge harness: no FakeSupabase installed for this test');
  return backend.createClient(url, key, options);
}
