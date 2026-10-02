import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  COLLECTION_ENTRY_REGISTRY,
  collectionEntryAuthorityRow
} from '../../../apps/world/src/collection/collection-discovery-contract.js';

const DB_URL = process.env.DB_URL;
assert.match(DB_URL ?? '', /^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:127\.0\.0\.1|localhost)(?::\d+)?\//,
  'DB_URL must be the local stack');

function sql(query) {
  const args = ['-v', 'ON_ERROR_STOP=1', '-Atq', '-c', query];
  try {
    return execFileSync('psql', [DB_URL, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch (error) {
    const fallback = process.env.PSQL_FALLBACK_CONTAINER;
    if (error.code !== 'ENOENT' || !fallback) throw error;
    return execFileSync('docker', [
      'exec', fallback, 'psql', '-U', 'postgres', '-d', 'postgres', ...args
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  }
}

test('Collection Entry DB mirror equals the code Registry authority subset', () => {
  const db = JSON.parse(sql(`
    select coalesce(json_agg(c order by c.entry_id), '[]')
      from private.world_collection_entry_catalog c
  `));

  const code = COLLECTION_ENTRY_REGISTRY.list()
    .map(collectionEntryAuthorityRow)
    .sort((a, b) => a.entry_id.localeCompare(b.entry_id));

  assert.deepEqual(db, code);
});

test('owner-derived Biryong stays a mirror pointer, not a player discovery row', () => {
  const row = JSON.parse(sql(`
    select row_to_json(c)
      from private.world_collection_entry_catalog c
     where c.entry_id='collection.place.biryong_tower'
  `));

  assert.deepEqual(
    [row.persistence_mode, row.owner_domain, row.owner_ref],
    ['DERIVED_FROM_OWNER', 'BIRYONG', 'BR01']
  );
  assert.equal(sql(`
    select count(*) from private.world_player_collection_discoveries
     where entry_id='collection.place.biryong_tower'
  `), '0');
});
