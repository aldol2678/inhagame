import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeDiagnostics, createBugReport, formatBugReport, sanitizeReportText,
  MAX_RUNTIME_ERRORS, normalizeBuildId } from '../src/diagnostics/runtime-diagnostics.js';
import { resolveRuntimeBuildId, writeRuntimeBuildId } from '../scripts/write-runtime-build-id.mjs';

const base = { renderer: 'WebGPU', quality: 'high', qualityPreference: 'auto',
  worldId: 'CAMPUS', zoneId: 'AREA_MAIN_GATE', network: 'ONLINE' };
const make = options => createRuntimeDiagnostics({ readState: () => base,
  publicZoneIds: ['AREA_MAIN_GATE'], buildId: 'a'.repeat(40), ...options });

test('normal runtime uses fixed fields, public zone and render-frame timing independent of FPS HUD', () => {
  let time = 0;
  const diagnostics = make({ now: () => time });
  diagnostics.frame();
  for (let i = 1; i <= 50; i++) { time = i * 20; diagnostics.frame(); }
  assert.deepEqual(diagnostics.snapshot(), { buildId: 'a'.repeat(40), renderer: 'WebGPU', rendererState: 'AVAILABLE',
    quality: 'high', qualityPreference: 'auto', worldId: 'CAMPUS', zoneId: 'AREA_MAIN_GATE', network: 'ONLINE',
    fps: 50, frameTimeMs: 20, recentErrors: [] });
  time += 3000; assert.equal(diagnostics.snapshot().fps, null, 'stopped frames cannot look live');
  diagnostics.resetFrames(); assert.equal(diagnostics.snapshot().frameTimeMs, null);
});
test('renderer errors and network transitions are visible and recovery does not block sampling', () => {
  let state = { ...base };
  const d = make({ readState: () => state }); d.snapshot();
  state.network = 'RECONNECTING'; d.snapshot(); state.network = 'OFFLINE';
  d.rendererLost(); assert.equal(d.snapshot().rendererState, 'LOST');
  assert.ok(d.snapshot().recentErrors.some(e => e.code === 'NETWORK_OFFLINE'));
  d.rendererRestored(); state.network = 'ONLINE';
  assert.equal(d.snapshot().rendererState, 'AVAILABLE'); assert.equal(d.snapshot().network, 'ONLINE');
});
test('unknown codes and objects are rejected; repeated errors use bounded code-only storage', () => {
  const d = make();
  const trap = { toString() { throw new Error('must not stringify errors'); } };
  assert.equal(d.record(trap), false); assert.equal(d.record('user@example.test'), false);
  for (let i = 0; i < 100; i++) d.record(i % 2 ? 'RUNTIME_SCRIPT_ERROR' : 'RUNTIME_PROMISE_REJECTION');
  const view = d.snapshot(); assert.equal(view.recentErrors.length, MAX_RUNTIME_ERRORS);
  view.recentErrors[0].code = 'LEAK';
  assert.notEqual(d.snapshot().recentErrors[0].code, 'LEAK');
  d.reset(); assert.deepEqual(d.snapshot().recentErrors, []); assert.equal(d.snapshot().fps, null);
});
test('read failures become fixed codes without leaking messages and later reads still work', () => {
  let bad = true;
  const d = make({ readState() { if (bad) throw new Error('private-token email@private.test'); return base; } });
  const text = JSON.stringify(d.snapshot()); assert.doesNotMatch(text, /private/);
  assert.match(text, /DIAGNOSTICS_READ_FAILED/);
  bad = false; assert.equal(d.snapshot().renderer, 'WebGPU');
});
test('account, auth, chat, coordinates and private room data are never read or serialized', () => {
  const state = { ...base };
  for (const field of ['email', 'accountId', 'session', 'token', 'cookie', 'chat', 'friends', 'position', 'stack', 'error']) {
    Object.defineProperty(state, field, { get() { throw new Error(`forbidden field: ${field}`); } });
  }
  const d = make({ readState: () => state });
  assert.deepEqual(d.snapshot().recentErrors, []);
  assert.doesNotMatch(formatBugReport(createBugReport(d, { description: '화면이 멈춰요' })), /accountId|session|token|cookie|chat|friends|position|stack/);
  state.worldId = 'INTERIOR'; state.zoneId = 'private-room-user-123'; assert.equal(d.snapshot().zoneId, null);
  state.worldId = 'EDITOR'; assert.equal(d.snapshot().zoneId, null);
  state.worldId = 'CAMPUS'; assert.equal(d.snapshot().zoneId, null);
  state.renderer = 'email@example.test'; state.quality = 'private'; state.network = 'secret';
  const view = d.snapshot(); assert.equal(view.renderer, 'UNKNOWN'); assert.equal(view.quality, 'UNKNOWN'); assert.equal(view.network, 'UNKNOWN');
});
test('zone projection reads a getter once so a changing source cannot smuggle identifiers', () => {
  let reads = 0;
  const d = make({ readState: () => ({ ...base, get zoneId() { return ++reads === 1 ? 'AREA_MAIN_GATE' : 'private-user'; } }) });
  assert.equal(d.snapshot().zoneId, 'AREA_MAIN_GATE'); assert.equal(reads, 1);
});
test('player text is limited, common credentials redacted, extra fields dropped and valid JSON exported', () => {
  const d = make();
  const report = createBugReport(d, { description: '문제 player@example.test 12345678-1234-1234-1234-123456789abc',
    reproduction: 'Bearer highly-secret\ncookie: secret=do-not-copy\naccess_token=secret\nhttps://host/?secret=token',
    context: 'eyJabc.def.ghi\n' + 'X'.repeat(2000), email: 'private@example.test', stack: 'raw stack' });
  const text = formatBugReport(report);
  assert.deepEqual(Object.keys(report), ['schema', 'description', 'reproduction', 'context', 'diagnostics']);
  assert.doesNotMatch(text, /player@|12345678-1234|highly-secret|do-not-copy|secret=|eyJabc|raw stack|private@/);
  assert.deepEqual(JSON.parse(text), report);
  assert.ok(report.context.length <= 1000);
  assert.equal(sanitizeReportText({ toString() { throw 1; } }), '');
  assert.equal(sanitizeReportText(' \u0000test\nsteps '), 'test\nsteps');
});
test('build IDs are source-build SHA only; absent/invalid runtime values are explicitly development', () => {
  assert.equal(normalizeBuildId('x@example.test'), 'development');
  assert.equal(resolveRuntimeBuildId({ deploymentSha: 'b'.repeat(40), readGit() { throw 1; } }), 'b'.repeat(40));
  assert.equal(resolveRuntimeBuildId({ deploymentSha: '', readGit: () => 'c'.repeat(40) }), 'c'.repeat(40));
  assert.throws(() => resolveRuntimeBuildId({ deploymentSha: 'secret' }), /Invalid/);
});
test('existing build pipeline stamps the executable build module without a server request', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-build-'));
  try {
    const path = join(dir, 'build.mjs');
    await writeRuntimeBuildId(path, { deploymentSha: 'd'.repeat(40) });
    assert.equal((await import(path)).WORLD_BUILD_ID, 'd'.repeat(40));
    assert.match(await readFile(new URL('../build-recast-shadow.sh', import.meta.url), 'utf8'), /node scripts\/write-runtime-build-id.mjs/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('production composition uses narrow readers and existing settings/input/identity lifecycle', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const composition = main.slice(main.indexOf('const runtimeDiagnostics = installRuntimeDiagnostics('), main.indexOf('\nboot().catch'));
  assert.match(composition, /app, device, online, inputFocus/);
  assert.match(composition, /graphics\.tier/); assert.match(composition, /online\?\.network\?\.state/);
  assert.doesNotMatch(composition, /getStatus\(|online\??\.status\(|\.userId|\.identity|\.metadata/);
  const runtime = await readFile(new URL('../src/diagnostics/runtime-diagnostics-runtime.js', import.meta.url), 'utf8');
  assert.match(runtime, /onIdentity\?\.\(reset\)/);
  assert.doesNotMatch(runtime, /\.message|\.stack|fetch\(|sendBeacon|localStorage|sessionStorage|\.cookie/);
  const html = await readFile(new URL('../campus/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="view-settings"[\s\S]*id="open-runtime-diagnostics"[\s\S]*id="view-settings-status"/);
});
