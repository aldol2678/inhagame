import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const worldRoot = fileURLToPath(new URL('../', import.meta.url));
const legacyNames = [
  'get_world_npc_shared_state_v1',
  'claim_world_npc_shared_tick_v1',
  'commit_world_npc_shared_tick_v1',
  'world_npc_shared_ticks_v1'
];

function runtimeFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(worldRoot, full).replaceAll('\\', '/');
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (rel === 'tests' || rel.startsWith('tests/') || rel === 'docs' || rel.startsWith('docs/')) continue;
      out.push(...runtimeFiles(full));
    } else if (/\.(?:js|mjs)$/u.test(name)) {
      out.push(full);
    }
  }
  return out;
}

test('runtime code cannot revive the superseded world_npc_shared_state_v1 RPCs', () => {
  const offenders = [];
  for (const file of runtimeFiles(worldRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const name of legacyNames) {
      if (source.includes(name)) offenders.push({ file: path.relative(worldRoot, file), name });
    }
  }
  assert.deepEqual(offenders, [], 'legacy shared-NPC DB authority must remain outside runtime code');
});

test('current Shared NPC Authority P0 stays independent of the legacy Supabase decision ledger', () => {
  const files = [
    '../npc-factory/npc-shared-authority-p0.mjs',
    '../npc-factory/npc-shared-authority-server.mjs',
    '../npc-factory/npc-shared-authority-consumer-p0.mjs',
    '../api/npc-shared-state.js'
  ];
  for (const relative of files) {
    const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /supabase|world_npc_shared_ticks_v1|claim_world_npc_shared_tick_v1|commit_world_npc_shared_tick_v1|get_world_npc_shared_state_v1/i, relative);
  }
});
