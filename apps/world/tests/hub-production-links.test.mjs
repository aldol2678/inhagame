import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

test('hub production links use inhagame.app domains', async () => {
  const [index, hub, entry, api, catalog] = await Promise.all([
    load('../index.html'),
    load('../hub.js'),
    load('../game-entry.js'),
    load('../api/hub-entry.js'),
    load('../data/game-catalog.json'),
  ]);

  const combined = [index, hub, entry, api, catalog].join('\n');
  assert.doesNotMatch(combined, /(?:^|\.)inhagame\.example/);

  for (const url of [
    'https://duck.inhagame.app/',
    'https://induckup.inhagame.app/',
    'https://survival.inhagame.app/',
    'https://grow.inhagame.app/',
  ]) {
    assert.ok(index.includes(url), `hub index must link to ${url}`);
    assert.ok(catalog.includes(url), `game catalog must link to ${url}`);
  }

  assert.ok(index.includes('https://duck.inhagame.app/privacy.html'));
  assert.ok(entry.includes('fetch("https://inhagame.app/api/hub-entry"'));
  for (const origin of [
    'https://inhagame.app',
    'https://duck.inhagame.app',
    'https://induckup.inhagame.app',
    'https://survival.inhagame.app',
    'https://grow.inhagame.app',
  ]) {
    assert.ok(api.includes(origin), `hub-entry allowlist must include ${origin}`);
  }
});
