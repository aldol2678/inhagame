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

test('the NPC AI entrypoint fails fast on missing or placeholder Supabase public config', () => {
  const base = { NPC_AI_ENABLED: '1', NPC_AI_PROJECT: 'local-test-project', SUPABASE_SERVICE_ROLE_KEY: 'dummy-server-key' };
  const run = (env) => spawnSync(process.execPath, ['npc-factory/npc-ai-cloud-run.mjs'], {
    cwd: world, encoding: 'utf8', env: { PATH: process.env.PATH, ...base, ...env }, timeout: 10_000
  });
  for (const env of [{}, { SUPABASE_URL: 'https://abc.supabase.co' }, { SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_dummy' },
    { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_PUBLIC_PLACEHOLDER' },
    { SUPABASE_URL: 'http://localhost:54321', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_dummy' },
    { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_PUBLIC_PLACEHOLDER' },
    { SUPABASE_URL: 'not a url', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_dummy' }]) {
    const result = run(env);
    assert.notEqual(result.status, 0, JSON.stringify(env));
    assert.match(result.stderr, /NPC_AI_SUPABASE_CONFIG_REQUIRED/, JSON.stringify(env));
  }
});

test('the NPC AI entrypoint listens with complete dummy configuration', async () => {
  const { spawn } = await import('node:child_process');
  const port = String(20000 + Math.floor(Math.random() * 20000));
  const child = spawn(process.execPath, ['npc-factory/npc-ai-cloud-run.mjs'], { cwd: world, env: {
    PATH: process.env.PATH, PORT: port, NPC_AI_ENABLED: '1', NPC_AI_PROJECT: 'local-test-project',
    SUPABASE_SERVICE_ROLE_KEY: 'dummy-server-key', SUPABASE_URL: 'https://dummy-ref.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_dummy' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    let listening = false;
    for (let i = 0; i < 50 && !listening && child.exitCode === null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      listening = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1000) })
        .then(() => true, () => false);
    }
    assert.ok(listening, `entrypoint did not listen: ${stderr}`);
  } finally {
    child.kill();
  }
});
