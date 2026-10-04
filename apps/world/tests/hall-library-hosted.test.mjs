import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {HALL_FRONT} from '../src/basic-campus.js';
import {fillMainHallCandidate} from '../src/main-hall-candidate-geometry.js';
import {fillPhotoMainHallFacade} from '../src/photo-hall-library-geometry.js';

const capture = (fill, tier) => {
  const faces = [];
  fill({quad: (color, ...points) => faces.push({color, points}), box() {}}, tier);
  return faces;
};
const local = ([x, y, z]) => {
  const dx = x - (HALL_FRONT.a.x + HALL_FRONT.b.x) / 2;
  const dz = z - (HALL_FRONT.a.z + HALL_FRONT.b.z) / 2;
  return [dx * HALL_FRONT.along.x + dz * HALL_FRONT.along.z, y,
    dx * HALL_FRONT.inward.x + dz * HALL_FRONT.inward.z];
};
const normal = face => {
  const [a, b, c] = face.points.map(local);
  const u = b.map((n, i) => n - a[i]), v = c.map((n, i) => n - a[i]);
  return [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
};

test('candidate coplanar intersections stay at the four reviewed same-color cross-tier crossings', () => {
  // Any additional overlap (including a whole duplicate face) fails. The four
  // known sill/mullion intersections stay visible in the report and closeups.
  const planes = new Map(), overlaps = [];
  for (const tier of ['NEAR', 'DETAIL']) for (const [index, face] of capture(fillMainHallCandidate, tier).entries()) {
    const points = face.points.map(local);
    assert.ok(points.flat().every(Number.isFinite));
    const axis = [0, 1, 2].find(i => points.every(p => Math.abs(p[i] - points[0][i]) < 1e-7));
    assert.notEqual(axis, undefined, 'candidate facade faces remain axis-aligned in facade coordinates');
    const uv = [0, 1, 2].filter(i => i !== axis);
    const rect = uv.map(i => [Math.min(...points.map(p => p[i])), Math.max(...points.map(p => p[i]))]);
    assert.ok(rect.every(([a, b]) => b - a > 1e-7), 'non-degenerate quad');
    const key = `${axis}:${points[0][axis].toFixed(6)}`;
    for (const other of planes.get(key) || []) {
      const overlap = rect.map(([a, b], i) => Math.min(b, other.rect[i][1]) - Math.max(a, other.rect[i][0]));
      if (overlap.every(n => n > 1e-7)) {
        overlaps.push(`${other.tier}:${other.index}/${tier}:${index}`);
        assert.equal(face.color, '#eeece2'); assert.equal(other.color, face.color);
        assert.equal(key, '2:-0.230000');
        assert.ok(Math.abs(overlap[0]-.06)<1e-7 && Math.abs(overlap[1]-.055)<1e-7);
      }
    }
    if (!planes.has(key)) planes.set(key, []);
    planes.get(key).push({rect, tier, index, color:face.color});
  }
  assert.deepEqual(overlaps.sort(), ['NEAR:5/DETAIL:512', 'NEAR:8/DETAIL:512', 'NEAR:11/DETAIL:532', 'NEAR:14/DETAIL:532'].sort(),
    'no additional positive-area coplanar overlaps, and no hidden removal from the frozen snapshot');
});

test('all 26 window recesses and the entrance face inward consistently', () => {
  const inherited = capture(fillPhotoMainHallFacade, 'DETAIL').length;
  const detail = capture(fillMainHallCandidate, 'DETAIL').slice(inherited);
  const recesses = Array.from({length: 24}, (_, i) => detail.slice(i*5, i*5+4));
  for (let i = 0; i < 2; i++) recesses.push(detail.slice(120+i*44, 124+i*44));
  recesses.push(capture(fillMainHallCandidate, 'NEAR').slice(1, 5));
  for (const [index, faces] of recesses.entries()) {
    assert.equal(faces.length, 4);
    for (const [i, axis, sign] of [[0,0,1], [1,0,-1], [2,1,1], [3,1,-1]]) {
      assert.ok(normal(faces[i])[axis]*sign > 0, `recess ${index} face ${i} points into cavity`);
    }
  }
});

test('hosted fixture uses actual engine pixels and a literal pinned baseline', () => {
  const url = new URL('./browser/hall-library-hosted-harness.html', import.meta.url);
  assert.ok(existsSync(url), 'hosted fixture must exist');
  const html = readFileSync(url, 'utf8');
  for (const token of ['selectCampusLandmark', '/__hall_library_baseline__/src/main-hall-blockout.js',
    'pc.createGraphicsDevice', 'gl.readPixels', 'webglcontextlost', 'NOT a measured floor count']) assert.ok(html.includes(token), token);
  assert.doesNotMatch(html, /NullGraphicsDevice|data:image|fetch\(/);
  const runner = readFileSync(new URL('./browser/hall-library-hosted-smoke.mjs', import.meta.url), 'utf8');
  for (const token of ['316c8ff95f7a12618ec8db61342d153f3cbb29ea', 'startSmoke', 'withDeadline',
    '1280', '720', '390', '844', 'unexpectedRequests', 'exactChanged', 'report.json']) assert.ok(runner.includes(token), token);
});

test('reviewed candidate snapshot is exact, including all 17 delivered files', () => {
  const url = new URL('./fixtures/hall-library-candidate-source-manifest.json', import.meta.url);
  assert.ok(existsSync(url), 'reviewed source manifest must exist');
  const manifest = JSON.parse(readFileSync(url, 'utf8'));
  const entries = Array.isArray(manifest.files) ? manifest.files : Object.entries(manifest.files).map(([path, sha256]) => ({path, sha256}));
  assert.equal(entries.length, 17);
  assert.equal(new Set(entries.map(e => e.path)).size, 17);
  for (const entry of entries) {
    assert.ok(/^(apps\/world\/|docs\/implementation\/)/.test(entry.path));
    assert.ok(!entry.path.includes('..'));
    const bytes = readFileSync(new URL(`../../../${entry.path}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.path);
  }
});


test('baseline route allows its ten pinned JSON dependencies and rejects scope expansion', () => {
  const runner = readFileSync(new URL('./browser/hall-library-hosted-smoke.mjs', import.meta.url), 'utf8');
  const source = runner.match(/function isBaselinePath\(relative\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source, 'route scope must be a directly testable pure predicate');
  const allowed = runInNewContext(`(${source})`, {}, {timeout:1000});
  // Full transitive JSON closure of the pinned #108 main-hall-blockout renderer.
  const dependencies = [
    'data/reality/campus-buildings.json', 'data/reality/campus-site.json',
    'data/reality/campus-landmarks.json', 'data/reality/campus-facilities.json',
    'data/reality/evidence/roads/source.json', 'data/reality/evidence/roads/back-gate.json',
    'data/reality/evidence/roads/library-garden.json', 'data/reality/evidence/roads/back-approaches.json',
    'data/reality/evidence/roads/back-west-buildings.json', 'data/editor/main-gate.world.json'
  ];
  for (const dependency of dependencies) assert.equal(allowed(dependency), true, dependency);
  for (const module of ['src/main-hall-blockout.js', 'src/editor/main-gate-production.js']) assert.equal(allowed(module), true);
  for (const rejected of [
    'data/editor/other.world.json', 'data/editor/main-gate.world.json.bak', 'data/editor/main-gate.world.js',
    'data/reality/../editor/main-gate.world.json', 'src/../private.js', 'src/./main-hall-blockout.js',
    '../src/main-hall-blockout.js', '/src/main-hall-blockout.js', 'data/private.json',
    '.git/config', 'src/secrets.txt', 'https://example.com/src/main-hall-blockout.js'
  ]) assert.equal(allowed(rejected), false, rejected);
  assert.match(runner, /baseline route \$\{pathname\}/, 'a failed baseline route identifies its exact pathname');
});
