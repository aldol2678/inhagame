// Build the public PlayCanvas site from the reviewed paths in this checkout.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const world = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.argv[2] || join(world, 'dist-cloudflare-live'));
if (existsSync(output)) throw new Error('Choose a new build directory: ' + output);
const release = join(world, 'release/cloudflare-live');
const reference = JSON.parse(readFileSync(join(release, 'reference.json'), 'utf8'));
const files = Object.keys(reference.files);
const overrides = new Set(reference.overrides);
for (const name of overrides) assert.ok(files.includes(name), 'Override is outside the public file list: ' + name);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const duckPath = 'assets/induck-v3.glb';
const dragonPath = 'assets/annyongi-flight-v1.glb';
const pins = {
  [duckPath]: 'bec8585e3e64f092585c23e353ae833215a25ceffa850d819bce7d34d70f01ea',
  [dragonPath]: '5b53dd9a13e2123bab399f68483c3fa72259b75888edf67b9bab32553a53fc23'
};
for (const name of [duckPath, dragonPath, 'campus/index.html', 'styles.css', 'src/main.js', 'hub-account.js', 'hub-friends.js', 'hub-messages.js']) {
  assert.ok(files.includes(name), 'Missing release input: ' + name);
}

mkdirSync(dirname(output), { recursive: true });
const stage = mkdtempSync(output + '.tmp-');
try {
  for (const name of files) {
    assert.ok(name.split('/').every(part => part && !part.startsWith('.')) && !name.includes('\\'), 'Invalid public path: ' + name);
    const dest = join(stage, name);
    mkdirSync(dirname(dest), { recursive: true });
    if (name === duckPath) {
      const encoded = readFileSync(join(world, 'private-qa/induck-legacy-production-202610.glb.base64'), 'utf8');
      writeFileSync(dest, Buffer.from(encoded, 'base64'));
    } else {
      const source = overrides.has(name) ? join(release, 'overrides', name) : join(world, name);
      copyFileSync(source, dest);
    }
    if (pins[name]) assert.equal(sha256(readFileSync(dest)), pins[name], 'Unexpected model: ' + name);
  }
  // Apply only the guest wiring to the shared campus entry points. A conflicting edit fails the build.
  execFileSync('git', ['apply', '--no-index', '--whitespace=nowarn', join(release, 'campus.patch')], {
    cwd: stage, env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(stage) }, stdio: 'inherit'
  });
  const entry = join(stage, 'campus/index.html');
  let html = readFileSync(entry, 'utf8');
  for (const [asset, pattern] of [
    ['src/main.js', /src="\/src\/main\.js(?:\?v=[a-zA-Z0-9_-]+)?"/g],
    ['styles.css', /href="\/styles\.css(?:\?v=[a-zA-Z0-9_-]+)?"/g]
  ]) {
    assert.equal([...html.matchAll(pattern)].length, 1, 'Expected one campus reference to ' + asset);
    const revision = sha256(readFileSync(join(stage, asset))).slice(0, 12);
    html = html.replace(pattern, match => match.slice(0, match.indexOf('"')) + '"/' + asset + '?v=' + revision + '"');
  }
  writeFileSync(entry, html);
  renameSync(stage, output);
  console.log('Built ' + files.length + ' static files at ' + output);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
