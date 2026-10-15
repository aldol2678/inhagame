import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { FURNITURE_VISUALS } from '../src/rooms/furniture-visual-assets.js';
import { createSofaCancellationTracker, installFurnitureCancellationEvidence } from './browser/housing-sofa-cancellation-policy.mjs';

const origin = 'http://127.0.0.1:8123';
const active = FURNITURE_VISUALS.filter(visual => visual.enabled).map(visual => `${origin}${visual.url}`);
const id = (sequence, document = '11111111-1111-4111-8111-111111111111') => `${document}:${sequence}`;
const trackerFor = errors => createSofaCancellationTracker(errors, { origin });

test('each of the six enabled furniture URLs needs its own observed signal before cancellation is ignored', () => {
  assert.equal(active.length, 6);
  const errors = [], page = {}, tracker = trackerFor(errors);
  for (const [index, url] of active.entries()) {
    assert.equal(tracker.failed(page, url, 'net::ERR_ABORTED', id(index + 1)), true);
    assert.equal(errors.length, 1, 'an abort without signal evidence remains an error');
    tracker.signalled(page, url, id(index + 1));
    assert.equal(errors.length, 0);
  }
  assert.equal(tracker.records.length, 6);
});

test('unrelated, altered-query, off-origin and retired URLs never qualify for cancellation evidence', () => {
  const errors = [], page = {}, tracker = trackerFor(errors);
  const rug = active.find(url => url.includes('official-rug'));
  const invalid = [
    `${origin}/assets/unrelated.glb`, `${origin}/api/hub-event`, `${origin}/api/brand-asset`,
    `${active[0]}?extra=1`, `${rug}&extra=1`, `${rug}&asset=other.glb`, `${rug}#fragment`,
    rug.replace('?asset=', '?%61sset='), rug.replace('official-rug-replacement-r1', 'unknown-rug'),
    rug.replace(origin, 'https://production.example'), rug.replace(origin, `${origin}.evil`),
    ...FURNITURE_VISUALS.filter(visual => !visual.enabled).map(visual => `${origin}${visual.url}`)
  ];
  for (const url of invalid) {
    assert.equal(tracker.signalled(page, url, id(1)), false, url);
    assert.equal(tracker.failed(page, url, 'net::ERR_ABORTED', id(1)), false, url);
  }
  assert.deepEqual(tracker.records, []);
  assert.deepEqual(errors, [], 'unqualified failures remain the harness caller’s responsibility');
});

test('same request ID from another URL, page or document cannot clear a failed request', () => {
  const errors = [], page = {}, tracker = trackerFor(errors);
  tracker.failed(page, active[0], 'net::ERR_ABORTED', id(1));
  tracker.signalled({}, active[0], id(1));
  tracker.signalled(page, active[1], id(1));
  tracker.signalled(page, active[0], id(2));
  tracker.signalled(page, active[0], id(1, '22222222-2222-4222-8222-222222222222'));
  assert.equal(errors.length, 1);
  tracker.signalled(page, active[0], id(1));
  assert.equal(errors.length, 0);
});

test('reversed and duplicate events reconcile only their one exact failure', () => {
  const errors = ['unrelated request failure'], page = {}, tracker = trackerFor(errors);
  tracker.failed(page, active[1], 'net::ERR_ABORTED', id(1));
  tracker.failed(page, active[1], 'net::ERR_ABORTED', id(1));
  assert.equal(errors.length, 2, 'a repeated event must not add an uncleared duplicate');
  tracker.signalled(page, active[1], id(1));
  tracker.signalled(page, active[1], id(1));
  assert.deepEqual(errors, ['unrelated request failure']);
  assert.equal(tracker.records.length, 1);
  tracker.signalled(page, active[2], id(2));
  assert.equal(tracker.failed(page, active[2], 'net::ERR_ABORTED', id(2)), true);
  assert.deepEqual(errors, ['unrelated request failure']);
});

test('other network errors, missing identities and never-signalled aborts remain strict', () => {
  const errors = [], page = {}, tracker = trackerFor(errors);
  tracker.signalled(page, active[1], id(1));
  for (const error of ['net::ERR_FAILED', 'net::ERR_CONNECTION_RESET', 'HTTP 503', undefined]) {
    assert.equal(tracker.failed(page, active[1], error, id(1)), false);
  }
  for (const requestId of [null, undefined, '', '1', 'unknown:1', id(0), id(-1)]) {
    assert.equal(tracker.signalled(page, active[1], requestId), false);
    assert.equal(tracker.failed(page, active[1], 'net::ERR_ABORTED', requestId), false);
  }
  tracker.failed(page, active[1], 'net::ERR_ABORTED', id(2));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /net::ERR_ABORTED/);
});

async function instrument({ page = {}, tracker = trackerFor([]), document = '11111111-1111-4111-8111-111111111111', pageOrigin = origin } = {}) {
  let binding, script, initArgs;
  await installFurnitureCancellationEvidence({
    exposeBinding: async (name, fn) => { assert.equal(name, '__worldSmokeFurnitureAbort'); binding = fn; },
    addInitScript: async (fn, args) => { script = fn; initArgs = args; }
  }, { origin, tracker });
  const calls = [], sandbox = { URL, Headers, Request, initArgs,
    location: { origin: pageOrigin, href: `${pageOrigin}/campus/` }, crypto: { randomUUID: () => document },
    fetch: async (input, options) => { calls.push({ input, options }); return 'offline transport stub'; },
    __worldSmokeFurnitureAbort: async payload => binding({ page }, payload)
  };
  const original = sandbox.fetch;
  runInNewContext(`(${script.toString()})(initArgs)`, sandbox);
  return { sandbox, calls, original };
}
const requestIdFrom = call => call.options?.headers?.get?.('x-world-smoke-furniture-request');

test('serialized fetch instrumentation correlates actual AbortSignals for all six exact URLs', async () => {
  const errors = [], page = {}, tracker = trackerFor(errors), { sandbox, calls } = await instrument({ page, tracker });
  for (const url of active) {
    const controller = new AbortController();
    assert.equal(await sandbox.fetch(url, { signal: controller.signal, headers: { 'x-existing': 'retained' }, credentials: 'same-origin' }), 'offline transport stub');
    const call = calls.at(-1), requestId = requestIdFrom(call);
    assert.equal(call.options.headers.get('x-existing'), 'retained');
    assert.equal(call.options.signal, controller.signal);
    assert.equal(call.options.credentials, 'same-origin');
    tracker.failed(page, url, 'net::ERR_ABORTED', requestId);
    assert.equal(errors.length, 1, 'a tagged mocked-204 abort still fails without an actual signal');
    controller.abort();
    assert.equal(errors.length, 0);
  }
  assert.equal(new Set(calls.map(requestIdFrom)).size, 6);
  assert.equal(tracker.records.length, 6);
});

test('instrumentation leaves untrusted URLs, signal-less requests and remote documents unchanged', async () => {
  const tracker = trackerFor([]), { sandbox, calls } = await instrument({ tracker });
  const rug = active.find(url => url.includes('official-rug'));
  const untrusted = [ `${rug}&unexpected=1`, `${rug}#fragment`, rug.replace('?asset=', '?%61sset='),
    rug.replace(origin, 'https://production.example'), `${origin}/api/brand-asset`, `${active[0]}?x=1`,
    ...FURNITURE_VISUALS.filter(visual => !visual.enabled).map(visual => `${origin}${visual.url}`) ];
  for (const url of untrusted) {
    const controller = new AbortController(), options = { signal: controller.signal };
    await sandbox.fetch(url, options); controller.abort();
    assert.equal(calls.at(-1).options, options, url);
    assert.equal(requestIdFrom(calls.at(-1)), undefined, url);
  }
  const options = { credentials: 'same-origin' };
  await sandbox.fetch(rug, options);assert.equal(calls.at(-1).options, options);
  assert.equal(requestIdFrom(calls.at(-1)), undefined);
  assert.deepEqual(tracker.records, []);
  const remote = await instrument({ pageOrigin: 'https://production.example' });
  assert.equal(remote.sandbox.fetch, remote.original, 'remote pages are not instrumented');
});

test('Request inputs preserve inherited headers/signals, explicit overrides and pre-aborted evidence', async () => {
  const tracker = trackerFor([]), { sandbox, calls } = await instrument({ tracker });
  const controller = new AbortController();
  const request = new Request(active[1], { signal: controller.signal, headers: { 'x-inherited': 'preserved' } });
  await sandbox.fetch(request);
  assert.equal(calls.at(-1).input, request);
  assert.equal(calls.at(-1).options.headers.get('x-inherited'), 'preserved');
  assert.equal(request.headers.has('x-world-smoke-furniture-request'), false, 'the caller’s Request is unchanged');
  controller.abort();assert.equal(tracker.records.length, 1);
  const overridden = new AbortController(), override = { signal: null };
  await sandbox.fetch(new Request(active[2], { signal: overridden.signal }), override);
  overridden.abort();assert.equal(tracker.records.length, 1);
  assert.equal(calls.at(-1).options, override);
  const preAborted = new AbortController();preAborted.abort();
  await sandbox.fetch(active[3], { signal: preAborted.signal });
  assert.equal(tracker.records.length, 2);
});

test('a new document cannot reuse a prior document’s cancellation authority', async () => {
  const errors = [], page = {}, tracker = trackerFor(errors);
  const first = await instrument({ page, tracker }), controller = new AbortController();
  await first.sandbox.fetch(active[1], { signal: controller.signal });controller.abort();
  const next = await instrument({ page, tracker, document: '22222222-2222-4222-8222-222222222222' });
  await next.sandbox.fetch(active[1], { signal: new AbortController().signal });
  assert.notEqual(requestIdFrom(first.calls[0]), requestIdFrom(next.calls[0]));
  tracker.failed(page, active[1], 'net::ERR_ABORTED', requestIdFrom(next.calls[0]));
  assert.equal(errors.length, 1);
});

test('harness routes failure evidence narrowly and retains HTTP error reporting', async () => {
  const source = await readFile(new URL('./browser/harness.mjs', import.meta.url), 'utf8');
  assert.match(source, /installFurnitureCancellationEvidence\(context, \{ origin: server\.origin, tracker: furnitureCancellations \}\)/);
  assert.match(source, /furnitureCancellations\.failed\(page, request\.url\(\), errorText, request\.headers\(\)\["x-world-smoke-furniture-request"\]\)/);
  assert.match(source, /problems\.push\(`request failed: \$\{request\.url\(\)\} \$\{errorText\}`\)/);
  assert.match(source, /response\.status\(\) >= 400/);
  assert.match(source, /problems\.push\(`HTTP \$\{response\.status\(\)\}: \$\{response\.url\(\)\}`\)/);
  assert.doesNotMatch(source, /url\.pathname === "\/api\/brand-asset".*ERR_ABORTED/);
});
