// Offline verification of the integrated public files. Temporary inputs are disposable.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const world = fileURLToPath(new URL('../', import.meta.url));
const release = 'release/cloudflare-live';
const { files, overrides } = JSON.parse(readFileSync(join(world, release, 'reference.json'), 'utf8'));
const overridden = new Set(overrides);
const scratch = mkdtempSync(join(tmpdir(), 'inha-campus-build-'));
const clean = join(scratch, 'source');
const buildScript = 'scripts/build-cloudflare-live.mjs';
const originalDuck = 'private-qa/induck-legacy-production-202610.glb.base64';
const paths = Object.keys(files).sort();
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function source(name) {
  if (name === 'assets/induck-v3.glb') return originalDuck;
  return overridden.has(name) ? join(release, 'overrides', name) : name;
}
function build(name) {
  const out = join(scratch, name);
  execFileSync(process.execPath, [join(clean, buildScript), out], { stdio: 'inherit' });
  const actual = readdirSync(out, {recursive:true, withFileTypes:true}).filter(e => e.isFile())
    .map(e => join(e.parentPath || e.path, e.name).slice(out.length + 1)).sort();
  assert.deepEqual(actual, paths, 'public file set changed');
  return Object.fromEntries(paths.map(p => [p, sha(join(out, p))]));
}
try {
  const inputs = new Set([...paths.map(source), buildScript, 'scripts/campus-boot-assets.mjs', release + '/reference.json', release + '/campus.patch']);
  for (const name of inputs) {
    mkdirSync(dirname(join(clean, name)), { recursive: true });
    copyFileSync(join(world, name), join(clean, name));
  }
  const first = build('first');
  assert.deepEqual(first, files, 'reviewed deployment fingerprint mismatch');
  assert.deepEqual(build('second'), first, 'non-reproducible output');
  const hub = 'hub-account.js';
  appendFileSync(join(clean, source(hub)), '\n// isolated rebuild probe\n');
  const changed = build('hub-change');
  assert.deepEqual(paths.filter(p => changed[p] !== first[p]), [hub], 'hub edit must affect only the hub');
  const changedMain = 'src/main.js';
  appendFileSync(join(clean, changedMain), '\n// isolated campus revision probe\n');
  const campus = build('campus-change');
  assert.deepEqual(paths.filter(p => campus[p] !== changed[p]), ['campus/index.html', changedMain]);
  const html = readFileSync(join(scratch, 'campus-change/campus/index.html'), 'utf8');
  assert.ok(html.includes('/src/main.js?v=' + campus[changedMain].slice(0, 12)));
  const geometry = 'data/reality/campus-buildings.json';
  const input = join(clean, source(geometry));
  const data = JSON.parse(readFileSync(input, 'utf8'));
  data.buildVerification = true;
  writeFileSync(input, JSON.stringify(data));
  const updated = build('geometry-change');
  assert.deepEqual(paths.filter(p => updated[p] !== campus[p]), ['campus/index.html', geometry, 'src/basic-campus.js']);
  const mustRejectBuild = (name, pattern) => {
    const out = join(scratch, name);
    assert.throws(() => execFileSync(process.execPath, [join(clean, buildScript), out], { stdio: 'pipe' }), pattern);
    assert.ok(!readdirSync(scratch).includes(name), 'Rejected build created a release');
  };
  const patch = join(clean, release, 'campus.patch');
  const savedPatch = readFileSync(patch, 'utf8');
  writeFileSync(patch, savedPatch.replace(/(\+ *"playcanvas": ")\/vendor\//, '$1https://cdn.invalid/vendor/'));
  mustRejectBuild('external-engine', /Campus engine must load from the site itself/);
  writeFileSync(patch, savedPatch);
  appendFileSync(join(clean, source('src/basic-campus.js')), '\nawait Promise.resolve();\n');
  mustRejectBuild('async-geometry', /ERR_REQUIRE_ASYNC_MODULE/);
  console.log('PASS: exact reference, identical rebuild, isolated changes, versioned geometry, external-engine and async-geometry rejection');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
