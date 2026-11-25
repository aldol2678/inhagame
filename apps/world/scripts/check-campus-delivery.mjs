// Read-only check of the player-facing URLs. A Worker route may override Pages assets.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { campusBootAssets, digest } from './campus-boot-assets.mjs';

const run = promisify(execFile);
const origin = 'https://inhagame.app';
const reference = JSON.parse(readFileSync(new URL('../release/cloudflare-live/reference.json', import.meta.url))).files;

async function read(path, file) {
  const url = new URL(path, origin);
  assert.equal(url.origin, origin);
  const { stdout } = await run('curl', ['--fail', '--silent', '--show-error', '--max-time', '15', url.href],
    { encoding: 'buffer', maxBuffer: 12 * 1024 * 1024 });
  const actual = digest(stdout);
  if (actual !== reference[file]) throw new Error(path + ' expected ' + reference[file] + ' received ' + actual);
  return stdout;
}

const attempts = process.argv.includes('--wait') ? 10 : 1;
for (let attempt = 1; attempt <= attempts; attempt++) {
  try {
    const html = await read('/campus/?lobby=1', 'campus/index.html');
    const { urls } = campusBootAssets(html.toString('utf8'));
    const checks = await Promise.allSettled(urls.map(path => read(path, new URL(path, origin).pathname.slice(1))));
    const failures = checks.filter(result => result.status === 'rejected');
    if (failures.length) throw new Error(failures.map(result => result.reason.message).join('\n'));
    console.log('Verified production campus HTML and ' + urls.length + ' boot assets.');
    break;
  } catch (error) {
    if (attempt === attempts) throw error;
    console.warn('Waiting for production (' + attempt + '/' + attempts + '): ' + error.message);
    await delay(12000);
  }
}
