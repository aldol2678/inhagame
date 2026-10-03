import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const world = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('each container CMD points at a committed entrypoint', () => {
  for (const [dockerfile, entry] of [['Dockerfile', 'npc-factory/npc-ai-cloud-run.mjs'],
    ['Dockerfile.model-converter', 'model-converter/cloud-run.mjs']]) {
    const cmd = /^CMD \["node", "([^"]+)"\]$/m.exec(read(dockerfile));
    assert.equal(cmd?.[1], entry, dockerfile);
    assert.ok(read(entry).length > 0, entry);
  }
});

test('the NPC AI entrypoint names no cloud project and refuses to start without configuration', () => {
  const source = read('npc-factory/npc-ai-cloud-run.mjs');
  assert.doesNotMatch(source, /NPC_AI_PROJECT\s*!==\s*'/);
  const run = (env) => spawnSync(process.execPath, ['npc-factory/npc-ai-cloud-run.mjs'], {
    cwd: world, encoding: 'utf8', env: { PATH: process.env.PATH, ...env }, timeout: 10_000
  });
  for (const env of [{}, { NPC_AI_ENABLED: '1' }, { NPC_AI_ENABLED: '1', NPC_AI_PROJECT: 'Bad Project' },
    { NPC_AI_ENABLED: '1', NPC_AI_PROJECT: 'local-test-project' }]) {
    const result = run(env);
    assert.notEqual(result.status, 0, JSON.stringify(env));
    assert.match(result.stderr, /NPC_AI_PRODUCTION_CONFIG_REQUIRED/, JSON.stringify(env));
  }
});
