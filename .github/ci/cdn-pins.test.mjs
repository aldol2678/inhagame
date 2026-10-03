// Every jsDelivr npm reference shipped by an app names an exact version (x.y.z). A floating
// selector (@2, @^2.1.0, @latest) lets a CDN release change runtime code without a commit here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CDN = /cdn\.jsdelivr\.net\/npm\/((?:@[^/@\s"'`]+\/)?[^/@\s"'`]+)@([^/\s"'`]+)/g;
const EXACT = /^\d+\.\d+\.\d+$/;

function floatingPins(source) {
  // A template substitution (`@${pinned}`) is a test computing the pin from its own lockfile.
  return [...source.matchAll(CDN)].filter((m) => !m[2].startsWith('${') && !EXACT.test(m[2]))
    .map((m) => `${m[1]}@${m[2]}`);
}

test('the pattern flags floating selectors and accepts exact versions', () => {
  assert.deepEqual(floatingPins('src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"'), ['@supabase/supabase-js@2']);
  assert.deepEqual(floatingPins('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js'), ['@supabase/supabase-js@2']);
  assert.deepEqual(floatingPins('https://cdn.jsdelivr.net/npm/three@latest/build/three.min.js'), ['three@latest']);
  assert.deepEqual(floatingPins('https://cdn.jsdelivr.net/npm/x@^1.2.3'), ['x@^1.2.3']);
  assert.deepEqual(floatingPins('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.min.js'), []);
  assert.deepEqual(floatingPins('https://cdn.jsdelivr.net/npm/playcanvas@2.22.4/build/playcanvas.mjs'), []);
  assert.deepEqual(floatingPins('`https://cdn.jsdelivr.net/npm/three@${pinned}/build/three.min.js`'), []);
});

test('app CDN references use exact versions', () => {
  const files = execFileSync('git', ['ls-files', 'apps'], { encoding: 'utf8' }).split('\n')
    .filter((file) => /\.(html|js|mjs|cjs|ts|tsx)$/.test(file) && !file.includes('/node_modules/'));
  const floating = files.flatMap((file) => floatingPins(readFileSync(file, 'utf8')).map((pin) => `${file}: ${pin}`));
  assert.deepEqual(floating, []);
});
