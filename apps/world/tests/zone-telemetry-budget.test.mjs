import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { legacyTelemetryTarget } from '../src/legacy-zone-compat.js';

const source = readFileSync(new URL('../hub-telemetry.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const sessionKey = 'inhagame-hub-session-v1';
const budgetKey = 'inhagame-hub-zone-budget-v1';
const sessionId = '2b3c4d5e-6f70-4b8c-ad9e-1f2a3b4c5d6e';
const visitorId = '3c4d5e6f-7081-4c9d-be0f-2a3b4c5d6e7f';
const HOUR = 3600000;
const ZONES = ['C01_GATE', 'C02_MAIN_HALL', 'C03_CENTRAL'];

function storage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

function browser({ session = storage({ [sessionKey]: sessionId }),
  local = storage({ 'inhagame-hub-visitor-v1': visitorId }), start = HOUR * 2,
  fetcher = async () => new Response(null, { status: 204 }) } = {}) {
  let now = start;
  let serial = 0;
  const sent = [];
  const context = {
    console, URL, Blob, setTimeout,
    Date: class extends Date { static now() { return now; } },
    crypto: { randomUUID: () => `0b1c2d3e-4f50-4a61-8b72-${String(++serial).padStart(12, '0')}` },
    location: { href: 'https://inhagame.app/campus/', origin: 'https://inhagame.app' },
    document: { referrer: '' },
    history: { state: null, replaceState() {} },
    navigator: {},
    sessionStorage: session, localStorage: local,
    fetch(url, init) {
      sent.push({ url, body: JSON.parse(init.body), at: now });
      return fetcher(url, init);
    }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return {
    session, local, sent, window: context, api: context.InhaHubTelemetry,
    setTime(value) { now = value; },
    zone(target = ZONES[0]) { return context.InhaHubTelemetry.track('campus_zone_enter', 'campus', target); }
  };
}

function fillBudget(page) {
  for (let i = 0; i < 24; i++) {
    page.setTime(HOUR * 2 + i * 10000);
    assert.ok(page.zone(ZONES[i % 2]));
  }
}

test('A/B every second cannot spend more than 24 zone slots in any rolling hour', () => {
  const page = browser();
  for (let second = 0; second < 7200; second++) {
    page.setTime(HOUR * 2 + second * 1000);
    page.zone(ZONES[second % 2]);
  }
  assert.equal(page.sent.length, 48);
  for (const event of page.sent) {
    const inWindow = page.sent.filter(other => other.at <= event.at && other.at > event.at - HOUR);
    assert.ok(inWindow.length <= 24, `rolling count at ${event.at}: ${inWindow.length}`);
  }
  assert.equal(JSON.parse(page.session.getItem(budgetKey)).events.length, 24, 'storage stays bounded');
});

test('zone exhaustion preserves dispatch of the remaining 96 server-cap slots for other events', () => {
  const page = browser();
  fillBudget(page);
  page.setTime(HOUR * 2 + 591000);
  assert.equal(page.zone(ZONES[2]), null, 'old alternation exhausted server cap at this point');
  for (let i = 0; i < 96; i++) assert.ok(page.api.track('first_reward', 'campus', 'first_campus'));
  assert.equal(page.sent.length, 120);
  assert.equal(page.sent.filter(event => event.body.event_type === 'campus_zone_enter').length, 24);
});

test('10-second resend boundary allows exactly at the boundary, including timestamp zero', () => {
  const page = browser({ start: 0 });
  assert.ok(page.zone());
  page.setTime(9999);
  assert.equal(page.zone(), null);
  assert.ok(page.zone(ZONES[1]), 'different zones retain their first sample');
  page.setTime(10000);
  assert.ok(page.zone());
});

test('rolling-hour boundary expires only old slots, with no fixed-hour reset burst', () => {
  const page = browser();
  fillBudget(page);
  page.setTime(HOUR * 3 - 1);
  assert.equal(page.zone(ZONES[2]), null);
  page.setTime(HOUR * 3);
  assert.ok(page.zone(ZONES[2]));
  assert.equal(page.zone(ZONES[1]), null, 'only one slot expired');
  page.setTime(HOUR * 3 + 9999);
  assert.equal(page.zone(ZONES[1]), null);
  page.setTime(HOUR * 3 + 10000);
  assert.ok(page.zone(ZONES[1]));
});

test('invalid zones/surfaces are never dispatched and spend no allowance', () => {
  const page = browser();
  for (const target of [null, undefined, '', 'RC_MAIN_GATE', 'C04_UNKNOWN', 1, {}, '__proto__']) {
    assert.equal(page.api.track('campus_zone_enter', 'campus', target), null);
  }
  assert.equal(page.api.track('campus_zone_enter', 'home', ZONES[0]), null);
  assert.equal(page.sent.length, 0);
  assert.equal(page.session.getItem(budgetKey), null);
  for (const target of ZONES) assert.ok(page.zone(target));
});

test('reload and account switches retain the pseudonymous session budget without account data', () => {
  const first = browser();
  fillBudget(first);
  const accountA = 'synthetic-account-a';
  const accountB = 'synthetic-account-b';
  first.local.setItem('sb-example-auth-token', JSON.stringify({ user: { id: accountA } }));
  const reloaded = browser({ session: first.session, local: first.local, start: HOUR * 2 + 600000 });
  assert.equal(reloaded.zone(ZONES[2]), null);
  reloaded.local.setItem('sb-example-auth-token', JSON.stringify({ user: { id: accountB } }));
  assert.ok(reloaded.api.track('first_session_start', 'campus', 'first_campus'));
  assert.equal(reloaded.zone(ZONES[2]), null, 'account events do not replenish the zone budget');
  const switched = browser({ session: first.session, local: first.local, start: HOUR * 2 + 610000 });
  assert.equal(switched.zone(ZONES[2]), null);
  assert.ok(switched.api.track('first_reward', 'campus', 'first_campus'));
  assert.equal(switched.sent[0].body.session_id, sessionId, 'never rotate ID to evade RPC cap');
  for (const text of [first.session.getItem(budgetKey), JSON.stringify(switched.sent)]) {
    assert.ok(!text.includes(accountA) && !text.includes(accountB));
  }
  const freshSession = storage({ [sessionKey]: '4d5e6f70-8192-4a3b-8c4d-5e6f708192a3',
    [budgetKey]: first.session.getItem(budgetKey) });
  assert.ok(browser({ session: freshSession }).zone(), 'a genuinely separate session owns a separate budget');
});

test('malformed or unavailable storage suppresses only optional zone telemetry', () => {
  for (const value of ['{', 'null', '{}', JSON.stringify({ sessionId, events: Array(25).fill({ target: ZONES[0], at: 1 }) }),
    JSON.stringify({ sessionId, events: [{ target: 'RC_INVALID', at: 1 }] }),
    JSON.stringify({ sessionId, events: [{ target: ZONES[0], at: '1' }] })]) {
    const page = browser({ session: storage({ [sessionKey]: sessionId, [budgetKey]: value }) });
    assert.equal(page.zone(), null);
    assert.ok(page.api.track('campus_boot_ready', 'campus'));
    assert.equal(page.sent.length, 1);
  }
  for (const operation of ['getItem', 'setItem']) {
    const session = storage({ [sessionKey]: sessionId });
    const original = session[operation];
    session[operation] = (key, ...args) => {
      if (key === budgetKey) throw new Error('storage denied');
      return original(key, ...args);
    };
    const page = browser({ session });
    assert.equal(page.zone(), null);
    assert.ok(page.api.track('campus_boot_ready', 'campus'));
  }
});

test('clock rollback/future persisted samples fail closed until the clock catches up', () => {
  const page = browser();
  assert.ok(page.zone());
  page.setTime(HOUR * 2 - 1);
  assert.equal(page.zone(ZONES[1]), null);
  assert.ok(page.api.track('first_reward', 'campus', 'first_campus'));
  const reloaded = browser({ session: page.session, start: HOUR * 2 - 1 });
  assert.equal(reloaded.zone(ZONES[1]), null);
  reloaded.setTime(HOUR * 2);
  assert.ok(reloaded.zone(ZONES[1]));
});

test('confirmed zone retries use one reservation; exhaustion also applies to confirmed dispatch', async () => {
  let attempt = 0;
  const page = browser({ fetcher: async () => new Response(null, { status: ++attempt === 1 ? 503 : 204 }) });
  assert.ok(await page.api.trackConfirmed('campus_zone_enter', 'campus', ZONES[0], { retryDelays: [0] }));
  assert.equal(page.sent.length, 2);
  assert.equal(page.sent[0].body.event_id, page.sent[1].body.event_id);
  assert.equal(JSON.parse(page.session.getItem(budgetKey)).events.length, 1);
  for (let i = 1; i < 24; i++) {
    page.setTime(HOUR * 2 + i * 10000);
    assert.ok(page.zone(ZONES[i % 2]));
  }
  assert.equal(await page.api.trackConfirmed('campus_zone_enter', 'campus', ZONES[2]), null);
  assert.ok(await page.api.trackConfirmed('first_reward', 'campus', 'first_campus'));
});

function mainZoneCallback(page, { npcTestMode = false, active = false } = {}) {
  const declarationsStart = main.indexOf('let lastTrackedZone = null;');
  const declarationsEnd = main.indexOf('\n\nasync function boot()', declarationsStart);
  const start = main.indexOf('places.onPlaceZoneChanged((previous,next)=>{');
  const end = main.indexOf('\n});', start) + 4;
  assert.ok(declarationsStart >= 0 && declarationsEnd > declarationsStart && start >= 0 && end > start);
  const calls = [];
  let callback;
  const context = {
    Date: page.window.Date, window: page.window, npcTestMode, legacyTelemetryTarget,
    places: { onPlaceZoneChanged(fn) { callback = fn; } },
    syncAudio() { calls.push(['audio']); },
    inkyungLivingMoment: { setZone(id) { calls.push(['living', id]); } },
    lobbyWorld: { active }, lobbyTransition: { active: false },
    core15Funnel: { firstZoneArrival() { calls.push(['arrival']); }, firstActivityStart() { calls.push(['activity']); } },
    INKYUNG_LIVING_ZONE_ID: 'AREA_INKYUNG_STUDENT_CENTER',
    zoneEl: { textContent: '' }, app: { fire(...args) { calls.push(args); } }
  };
  vm.runInNewContext(main.slice(declarationsStart, declarationsEnd) + '\n' + main.slice(start, end), context);
  return { calls, context, callback };
}

test('actual main A/B boundary callback stays within the zone budget over an hour', () => {
  const page = browser();
  const wired = mainZoneCallback(page);
  const zones = ZONES.slice(0, 2).map(legacyZoneId => ({ id: `AREA_${legacyZoneId}`, legacyZoneId }));
  for (let second = 0; second < 3600; second++) {
    page.setTime(HOUR * 2 + second * 1000);
    wired.callback(zones[(second + 1) % 2], zones[second % 2]);
  }
  assert.equal(page.sent.length, 24);
  assert.equal(wired.calls.filter(call => call[0] === 'placeZoneChanged').length, 3600);
});

test('actual main callback preserves audio, living moment, funnel, label and app event when samples are refused', () => {
  const page = browser();
  fillBudget(page);
  const wired = mainZoneCallback(page);
  const zones = [
    { id: 'AREA_MAIN_GATE', legacyZoneId: ZONES[0], displayName: 'Gate' },
    { id: 'AREA_INKYUNG_STUDENT_CENTER', legacyZoneId: ZONES[2], displayName: 'Pond' },
    { id: 'RC_UNMAPPED', displayName: 'Unmapped' },
    null
  ];
  for (let i = 0; i < zones.length; i++) wired.callback(zones[i - 1] ?? null, zones[i]);
  assert.equal(page.sent.length, 24, 'saturated telemetry dispatches nothing');
  assert.equal(wired.calls.filter(call => call[0] === 'audio').length, 4);
  assert.deepEqual(wired.calls.filter(call => call[0] === 'living').map(call => call[1]), zones.map(zone => zone?.id ?? null));
  assert.equal(wired.calls.filter(call => call[0] === 'arrival').length, 3);
  assert.equal(wired.calls.filter(call => call[0] === 'activity').length, 1);
  assert.equal(wired.calls.filter(call => call[0] === 'placeZoneChanged').length, 4);
  wired.callback(null, zones[1]);
  assert.equal(wired.context.zoneEl.textContent, 'Pond');
});

test('actual main callback excludes npcTestMode and unmapped zones while preserving gameplay', () => {
  const page = browser();
  const testMode = mainZoneCallback(page, { npcTestMode: true });
  testMode.callback(null, { id: 'AREA_MAIN_GATE', legacyZoneId: ZONES[0], displayName: 'Gate' });
  assert.equal(page.sent.length, 0);
  assert.equal(page.session.getItem(budgetKey), null);
  assert.equal(testMode.calls.filter(call => call[0] === 'placeZoneChanged').length, 1);
  const normal = mainZoneCallback(page);
  normal.callback(null, { id: 'RC_UNMAPPED', displayName: 'Unmapped' });
  assert.equal(page.sent.length, 0);
  const gate = { id: 'AREA_MAIN_GATE', legacyZoneId: ZONES[0], displayName: 'Gate' };
  normal.callback(null, gate);
  page.setTime(HOUR * 2 + 10000);
  normal.callback(gate, gate);
  assert.equal(page.sent.length, 1, 'consecutive same-zone notifications remain deduplicated');
});
