import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFakeDocument } from './support/fake-dom.mjs';
import { PlayerController } from '../src/player-controller.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '../src/input/input-focus-manager.js';
import { createInputFocusOwner } from '../src/input/input-focus-owner.js';
import { mountConvenienceAuthorityRuntime } from '../src/income/convenience-authority-runtime.mjs';

// These are actual runtime/controller/HTTP-adapter tests with a deterministic fake HTTP server.
// They prove neither browser pixels nor PostgreSQL persistence/authority integration.
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const status = () => ({ enabled: true, questId: 'quest.side.convenience_help', coin: 30,
  sessionId: null, state: null, receipt: null,
  budget: { remainingCoin: 60, remainingShifts: 1, budgetDate: '2026-10-12' } });
const snapshot = (patch = {}) => ({ active: true, sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', fence: 1, eligible: false,
  state: { sequence: 0, revision: 1, position: { x: 120, y: 1.15, z: 45 }, lastCommand: { sequence: 0, moveX: 0, moveZ: 0 } }, ...patch });
function eventTarget(target = {}) {
  const listeners = new Map();
  return Object.assign(target, {
    listeners,
    addEventListener(type, fn) { const list = listeners.get(type) ?? new Set(); list.add(fn); listeners.set(type, list); },
    removeEventListener(type, fn) { const list = listeners.get(type); list?.delete(fn); if (!list?.size) listeners.delete(type); },
    dispatch(type, event = {}) { for (const fn of [...listeners.get(type) ?? []]) fn({ type, ...event }); }
  });
}
function fixture(t, { actualController = false, hostname = 'localhost', accountId = 'account-a' } = {}) {
  const doc = eventTarget(createFakeDocument()); doc.hidden = false; doc.body = doc.createElement('body'); doc.getElementById = () => null;
  const create = doc.createElement.bind(doc);
  doc.createElement = tag => {
    const node = create(tag);
    node.remove = () => { if (node.parent) node.parent.children = node.parent.children.filter(other => other !== node); node.parent = null; };
    return node;
  };
  const navigation = eventTarget({ location: { hostname } });
  let timer, cleared = 0, position = { x: 1, y: 1.15, z: 2 }, angle = null, locks = 0, acquired = 0, released = 0, unsubscribe = 0;
  const requests = [], transforms = [], pending = new Map(); let server = snapshot(), accountListener;
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  globalThis.window = navigation; globalThis.document = doc;
  const intervalMock = t.mock.method(globalThis, 'setInterval', (fn, milliseconds) => { assert.equal(milliseconds, 200); timer = fn; return 17; });
  const clearMock = t.mock.method(globalThis, 'clearInterval', id => { assert.equal(id, 17); cleared++; timer = null; });
  const entity = { getLocalPosition: () => ({ ...position }), setLocalPosition(x, y, z) { position = { x, y, z }; transforms.push(position); },
    setLocalEulerAngles(x, y, z) { angle = { x, y, z }; } };
  const controller = actualController ? new PlayerController(entity) : {
    entity, allowMountHere: true, keys: new Set(), touchVector: { x: 0, y: 0 }, inputEnabled: true,
    space: { id: 'campus' }, mounted: false, velocityY: 0, grounded: true, jumpQueued: false, moving: false,
    transportLocks: new Set(), setTransportLock(id, locked) { if (locked) this.transportLocks.add(id); else this.transportLocks.delete(id); },
    update(dt, yaw = 0) { return this.authoritativeWalk?.updatePlayer(this, dt, yaw); }
  };
  const scene = { accountId, sceneId: 'campus', blocked: false, mounted: false, seated: false, inside: false };
  const host = { convenienceAuthority: true, accountId, getAuthorization: async () => 'Bearer synthetic.local.authority.test.only',
    subscribe(fn) { accountListener = fn; return () => { unsubscribe++; accountListener = null; }; } };
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body); requests.push({ url, init, body });
    const special = pending.get(body.op)?.shift(); if (special) return special(body, init);
    if (body.op === 'open') server = snapshot();
    else if (body.op === 'move') server = snapshot({ ...server, state: { ...server.state, sequence: body.command.sequence,
      revision: server.state.revision + 1, position: { ...server.state.position, x: server.state.position.x + body.command.moveX,
        z: server.state.position.z + body.command.moveZ }, lastCommand: { ...body.command } } });
    return { ok: true, json: async () => body.op === 'status' ? status() : body.op === 'revoke' ? { revoked: true } : server };
  };
  const runtime = mountConvenienceAuthorityRuntime({ controller, host, doc, navigation, readScene: () => scene, fetcher,
    acquireInput() { acquired++; locks++; controller.inputEnabled = false; let active = true; return () => {
      if (!active) throw Error('INPUT_LEASE_RELEASED_TWICE'); active = false; released++; locks--; controller.inputEnabled = locks === 0;
    }; } });
  const section = doc.body.children.find(node => node.className === 'convenience-authority-candidate');
  const [note, begin, work, cancel] = section.children;
  t.after(async () => {
    runtime.dispose(); await flush(); intervalMock.mock.restore(); clearMock.mock.restore();
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  });
  return { runtime, controller, host, doc, navigation, scene, section, note, begin, work, cancel, requests, transforms,
    get position() { return position; }, get angle() { return angle; }, get locks() { return locks; }, get acquired() { return acquired; },
    get released() { return released; }, get cleared() { return cleared; }, get unsubscribe() { return unsubscribe; },
    operations: op => requests.filter(request => request.body.op === op),
    queue(op, handler) { const list = pending.get(op) ?? []; list.push(handler); pending.set(op, list); },
    async start() { begin.click(); await flush(); }, async tick() { await timer?.(); await flush(); },
    account(id) { host.accountId = id; scene.accountId = id; accountListener?.(id); }
  };
}

test('runtime gate rejects hosted, missing opt-in and missing authentication before touching the DOM', () => {
  for (const hostname of ['game.example', 'localhost.evil.example', '0.0.0.0', '::1', ''])
    assert.throws(() => mountConvenienceAuthorityRuntime({ navigation: { location: { hostname } }, host: { convenienceAuthority: true, getAuthorization() {} } }), /CONVENIENCE_LOCAL_ONLY/);
  for (const host of [{}, { convenienceAuthority: false, getAuthorization() {} }, { convenienceAuthority: true }])
    assert.throws(() => mountConvenienceAuthorityRuntime({ navigation: { location: { hostname: 'localhost' } }, host }), /CONVENIENCE_LOCAL_ONLY/);
});

test('mount is opt-in and idle, and actual PlayerController accepts authority ownership without assigning its getter', async t => {
  const h = fixture(t, { actualController: true }); await flush();
  assert.equal(h.runtime.authority.active, false); assert.equal(h.transforms.length, 0); assert.equal(h.operations('open').length, 0);
  assert.equal(typeof Object.getOwnPropertyDescriptor(PlayerController.prototype, 'allowMountHere').get, 'function');
  await h.start();
  assert.equal(h.runtime.authority.active, true); assert.ok(h.controller.authoritativeWalk, h.note.textContent);
  assert.ok(h.controller.transportLocks.size > 0, 'authority must use the existing transport lock API');
  h.controller.keys.add('KeyW'); h.controller.jumpQueued = true; h.controller.velocityY = 100;
  const confirmed = { ...h.position }; h.controller.update(10, 0);
  assert.deepEqual(h.position, confirmed, 'actual PlayerController must skip independent movement/gravity');
  assert.equal(h.controller.jumpQueued, false); assert.equal(h.controller.velocityY, 0);
  await h.runtime.authority.stop(); assert.equal(h.controller.authoritativeWalk, null); assert.equal(h.controller.transportLocks.size, 0);
});

test('player transform follows server snapshots only; HTTP sends bounded direction and sequence, never pose/time/actor', async t => {
  const h = fixture(t); await h.start();
  h.controller.keys = new Set(['KeyW', 'KeyD', 'ShiftLeft', 'Space']); h.controller.touchVector = { x: 4, y: -3 };
  h.controller.jumpQueued = true; h.controller.velocityY = 99; const confirmed = { ...h.position };
  h.controller.update(1000, Math.PI / 2); assert.deepEqual(h.position, confirmed);
  assert.equal(h.controller.jumpQueued, false); assert.equal(h.controller.velocityY, 0); assert.equal(h.controller.grounded, true);
  await h.tick(); const command = h.operations('move')[0].body.command;
  assert.deepEqual(Object.keys(command).sort(), ['moveX', 'moveZ', 'sequence']);
  assert.ok(Math.hypot(command.moveX, command.moveZ) <= 1 + Number.EPSILON);
  assert.ok(command.moveX < 0 && command.moveZ > 0); assert.equal(command.sequence, 1);
  assert.deepEqual(h.position, h.runtime.authority.snapshot.state.position); assert.notDeepEqual(h.position, confirmed);
  for (const { url, init, body } of h.requests) {
    assert.equal(url, '/api/world-convenience-authority'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    assert.equal(init.credentials, 'same-origin'); assert.match(init.headers.Authorization, /^Bearer /);
    for (const key of ['actor', 'userId', 'accountId', 'position', 'pose', 'dt', 'now', 'timestamp']) assert.equal(key in body, false, key);
  }
});

test('disabled controller input produces zero direction despite held keyboard and touch', async t => {
  const h = fixture(t); await h.start(); h.controller.keys.add('KeyW'); h.controller.touchVector = { x: 1, y: -1 };
  h.controller.inputEnabled = false; h.controller.update(1 / 60, 0); await h.tick();
  assert.deepEqual(h.operations('move').at(-1).body.command, { sequence: 1, moveX: 0, moveZ: 0 });
});

test('work panel owns one input lease and stops prior movement before another player frame; Escape releases once', async t => {
  const h = fixture(t); await h.start(); h.controller.keys.add('KeyW'); h.controller.update(1 / 60, 0); await h.tick();
  h.work.click(); await flush(); assert.equal(h.runtime.panel.open, true); assert.equal(h.locks, 1);
  h.work.click(); await flush(); assert.equal(h.acquired, 1);
  await h.tick(); assert.equal(h.operations('move').at(-1).body.command.moveZ, 0, 'opening panel must clear retained direction synchronously');
  h.runtime.panel.panel.dispatch('keydown', { key: 'Escape' }); assert.equal(h.locks, 0); assert.equal(h.released, 1);
  h.runtime.panel.close(); assert.equal(h.released, 1);
});

test('repeated Begin and cancel are idempotent and preserve unrelated controller locks', async t => {
  const h = fixture(t); h.controller.setTransportLock('other-feature', true); await h.start(); await h.start();
  assert.equal(h.operations('open').length, 1); await h.runtime.authority.stop(); await h.runtime.authority.stop();
  assert.equal(h.operations('revoke').length, 1); assert.equal(h.controller.allowMountHere, true);
  assert.deepEqual([...h.controller.transportLocks], ['other-feature']);
});

test('cancel then reopen resets retained movement even if no intervening controller frame runs', async t => {
  const h = fixture(t); await h.start(); h.controller.keys.add('KeyW'); h.controller.update(1 / 60, 0); await h.tick();
  await h.runtime.authority.stop(); h.controller.keys.clear(); await h.start(); await h.tick();
  assert.equal(h.operations('move').at(-1).body.command.moveZ, 0);
});

for (const [label, patch] of [['scene', { sceneId: 'biryong' }], ['room', { inside: true }], ['mount', { mounted: true }],
  ['seat', { seated: true }], ['blocking UI', { blocked: true }], ['game account', { accountId: 'other-account' }]]) {
  test(`${label} transition cancels authority, closes panel and releases input`, async t => {
    const h = fixture(t); await h.start(); h.work.click(); await flush(); assert.equal(h.locks, 1);
    Object.assign(h.scene, patch); h.runtime.update(); await flush();
    assert.equal(h.runtime.authority.active, false); assert.equal(h.controller.authoritativeWalk, null);
    assert.equal(h.runtime.panel.open, false); assert.equal(h.locks, 0); assert.equal(h.operations('revoke').length, 1);
  });
  test(`Begin is refused when ${label} already invalidates the scene`, async t => {
    const h = fixture(t); Object.assign(h.scene, patch); await h.start(); assert.equal(h.operations('open').length, 0); assert.equal(h.transforms.length, 0);
  });
}

test('signed-out game cannot begin an authenticated authority session', async t => {
  const h = fixture(t, { accountId: null }); await h.start();
  assert.equal(h.operations('open').length, 0); assert.equal(h.runtime.authority.active, false); assert.equal(h.transforms.length, 0);
});

test('record-only panel closes on invalid scene even when no authority walk has started', async t => {
  const h = fixture(t); await flush(); h.work.click(); await flush();
  assert.equal(h.runtime.panel.open, true); assert.equal(h.runtime.authority.active, false); assert.equal(h.locks, 1);
  h.scene.sceneId = 'room'; h.runtime.update(); await flush();
  assert.equal(h.runtime.panel.open, false); assert.equal(h.locks, 0);
});

test('scene-invalid delayed move does not teleport and cancels immediately on acknowledgement', async t => {
  const h = fixture(t), gate = deferred(); await h.start(); const confirmed = { ...h.position };
  h.queue('move', async body => { await gate.promise; return { ok: true, json: async () => snapshot({
    state: { sequence: body.command.sequence, revision: 2, position: { x: 999, y: 1.15, z: 999 }, lastCommand: body.command } }) }; });
  const moving = h.tick(); await flush(); h.scene.sceneId = 'room'; gate.resolve(); await moving;
  assert.deepEqual(h.position, confirmed); assert.equal(h.runtime.authority.active, false); assert.equal(h.controller.authoritativeWalk, null);
});

test('account switch while authorization is pending cannot transmit the stale open', async t => {
  const h = fixture(t), gate = deferred(); await flush(); h.host.getAuthorization = () => gate.promise;
  h.begin.click(); await flush(); h.account('account-b'); gate.resolve('Bearer synthetic.local.authority.test.only'); await flush();
  assert.equal(h.operations('open').length, 0); assert.equal(h.runtime.authority.active, false); assert.equal(h.transforms.length, 0);
});

for (const departure of ['movement-space', 'mounted-player']) {
  test(`actual walker stops on ${departure} departure before applying a snapshot`, async t => {
    const h = fixture(t); await h.start(); const count = h.transforms.length;
    if (departure === 'movement-space') h.controller.space.id = 'room'; else h.controller.mounted = true;
    h.controller.update(1 / 60, 0); await flush();
    assert.equal(h.runtime.authority.active, false); assert.equal(h.transforms.length, count);
  });
}

test('polling tick notices scene invalidation without an intervening player or app update', async t => {
  const h = fixture(t); await h.start(); h.scene.blocked = true; await h.tick();
  assert.equal(h.runtime.authority.active, false); assert.equal(h.operations('move').length, 0); assert.equal(h.operations('revoke').length, 1);
});

for (const reason of ['cancel', 'account', 'dispose']) {
  test(`late move response after ${reason} never restores a walker or applies an old transform`, async t => {
    const h = fixture(t), gate = deferred(); await h.start(); const count = h.transforms.length;
    h.queue('move', async body => { await gate.promise; return { ok: true, json: async () => snapshot({
      state: { sequence: body.command.sequence, revision: 2, position: { x: 999, y: 1.15, z: 999 }, lastCommand: body.command } }) }; });
    const moving = h.tick(); await flush();
    if (reason === 'cancel') h.cancel.click(); else if (reason === 'account') h.account('account-b'); else h.runtime.dispose();
    gate.resolve(); await moving;
    assert.equal(h.runtime.authority.active, false); assert.ok(!h.controller.authoritativeWalk); assert.equal(h.transforms.length, count);
    assert.equal(h.runtime.panel.open, false); assert.equal(h.locks, 0);
  });
}

for (const kind of ['pagehide', 'visibilitychange']) {
  test(`${kind} cancels, releases the panel lease and does not automatically restart`, async t => {
    const h = fixture(t); await h.start(); h.work.click(); await flush();
    if (kind === 'visibilitychange') { h.doc.hidden = true; h.doc.dispatch(kind); } else h.navigation.dispatch(kind, { persisted: true });
    await flush(); assert.equal(h.runtime.authority.active, false); assert.equal(h.locks, 0);
    h.doc.hidden = false; h.doc.dispatch('visibilitychange'); h.navigation.dispatch('pageshow', { persisted: true }); await h.tick();
    assert.equal(h.operations('open').length, 1); assert.equal(h.runtime.authority.active, false);
  });
}

test('account change closes authority and panel, clears prior job ownership and ignores duplicate notifications', async t => {
  const h = fixture(t); await h.start(); h.work.click(); await flush(); h.account('account-b'); await flush();
  assert.equal(h.runtime.authority.active, false); assert.equal(h.runtime.panel.open, false); assert.equal(h.locks, 0);
  assert.equal(h.runtime.job.state().accountId, 'account-b'); const count = h.requests.length; h.account('account-b'); await flush(); assert.equal(h.requests.length, count);
});

for (const reason of ['cancel', 'account', 'scene', 'pagehide', 'dispose']) {
  test(`delayed open response after ${reason} never teleports, installs a walker, or retains a server session`, async t => {
    const h = fixture(t), gate = deferred(); await flush();
    h.queue('open', async () => { await gate.promise; return { ok: true, json: async () => snapshot() }; });
    h.begin.click(); h.begin.click(); await flush(); assert.equal(h.operations('open').length, 1); assert.equal(h.begin.disabled, true);
    if (reason === 'cancel') h.cancel.click();
    else if (reason === 'account') h.account('account-b');
    else if (reason === 'scene') { h.scene.sceneId = 'room'; h.runtime.update(); }
    else if (reason === 'pagehide') h.navigation.dispatch('pagehide');
    else h.runtime.dispose();
    gate.resolve(); await flush();
    assert.equal(h.runtime.authority.active, false); assert.ok(!h.controller.authoritativeWalk); assert.equal(h.transforms.length, 0);
    if (reason !== 'account' && reason !== 'dispose') assert.equal(h.operations('revoke').length, 1, 'known late-created server session must be revoked');
  });
}

for (const reason of ['cancel', 'account', 'scene', 'pagehide', 'dispose']) {
  test(`pending work-panel refresh cannot reopen or acquire input after ${reason}`, async t => {
    const h = fixture(t), gate = deferred(); await h.start();
    h.queue('status', async () => { await gate.promise; return { ok: true, json: async () => status() }; });
    h.work.click(); await flush();
    if (reason === 'cancel') h.cancel.click();
    else if (reason === 'account') h.account('account-b');
    else if (reason === 'scene') { h.scene.sceneId = 'room'; h.runtime.update(); }
    else if (reason === 'pagehide') h.navigation.dispatch('pagehide');
    else h.runtime.dispose();
    gate.resolve(); await flush(); assert.equal(h.runtime.panel.open, false); assert.equal(h.locks, 0); assert.equal(h.acquired, 0);
  });
}

test('dispose is idempotent and removes DOM, timer, account subscription and lifecycle listeners', async t => {
  const h = fixture(t); await h.start(); h.work.click(); await flush(); assert.equal(h.locks, 1);
  h.runtime.dispose(); h.runtime.dispose(); await flush();
  assert.equal(h.locks, 0); assert.equal(h.released, 1); assert.equal(h.cleared, 1); assert.equal(h.unsubscribe, 1);
  assert.equal(h.doc.body.children.length, 0); assert.equal(h.navigation.listeners.size, 0); assert.equal(h.doc.listeners.size, 0);
  const count = h.requests.length; h.begin.click(); h.work.click(); h.cancel.click(); await flush();
  assert.equal(h.requests.length, count, 'detached controls must not send HTTP after disposal');
  assert.equal(h.runtime.job.state().accountId, null, 'disposal must invalidate retained account-bound job state');
});

test('main opt-in mount and PlayerController early-return keep hosted discovery CLOSED', () => {
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const controller = fs.readFileSync(new URL('../src/player-controller.js', import.meta.url), 'utf8');
  assert.match(main, /\['localhost', '127\.0\.0\.1'\]\.includes\(location\.hostname\)\s*&&\s*convenienceHost\?\.convenienceAuthority === true/);
  assert.match(main, /mountConvenienceAuthorityRuntime\(\{ controller, host: convenienceHost/);
  assert.ok(controller.indexOf('if (this.authoritativeWalk?.updatePlayer(this, dt, cameraYaw)) return;') < controller.indexOf('this.shuttle.update(dt);'));
});


// Execute the actual main.js mount block with its import replaced by a capture stub.
// The rest of main.js needs a WebGL browser and is deliberately not claimed here.
async function mainMount(hostname = 'localhost', optedIn = true) {
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('    const convenienceHost = globalThis.INCOME_CANDIDATE_LOCAL_AUTH;');
  const end = main.indexOf("  }).catch(error => console.warn('Income local candidate unavailable:'", start);
  assert.ok(start >= 0 && end > start, 'normal main must retain an explicit local authority mount block');
  const block = main.slice(start, end).replace("import('./income/convenience-authority-runtime.mjs')", 'Promise.resolve({ mountConvenienceAuthorityRuntime })');
  let options, conversationOpen = false;
  const calls = [], inputFocus = createInputFocusManager(), window = eventTarget();
  const controller = { mounted: false }, rooms = { insideRoom: false, status: () => ({ busy: false }) };
  const incomeGameCandidate = { update() { calls.push('discovery-update'); }, suspend() { calls.push('discovery-suspend'); } };
  const localRuntime = { update() { calls.push('authority-update'); }, dispose() { calls.push('authority-dispose'); } };
  const env = { globalThis: { INCOME_CANDIDATE_LOCAL_AUTH: { accountId: 'account-a', convenienceAuthority: optedIn } },
    location: { hostname }, window, controller, online: { userId: 'account-a' }, rooms, seats: { isSeated: false },
    biryongRealm: {}, combatRuntime: {}, lobbyWorld: {}, lobbyTransition: {}, npcTest: { isConversationOpen: () => conversationOpen },
    inputFocus, createInputFocusOwner, INPUT_FOCUS_POLICY, incomeGameCandidate, wallet: { refresh(reason) { calls.push(`wallet-${reason}`); } },
    mountConvenienceAuthorityRuntime(value) { options = value; calls.push('mount'); return localRuntime; }
  };
  new Function(...Object.keys(env), block)(...Object.values(env)); await flush();
  return { options, calls, inputFocus, window, controller, rooms, incomeGameCandidate, env,
    conversation(value) { conversationOpen = value; } };
}

test('actual main mount wiring excludes hosted and non-opted-in execution', async () => {
  for (const [hostname, enabled] of [['game.example', true], ['localhost.evil.example', true], ['localhost', false]]) {
    const h = await mainMount(hostname, enabled); assert.equal(h.options, undefined); assert.deepEqual(h.calls, []);
  }
  for (const hostname of ['localhost', '127.0.0.1']) {
    const h = await mainMount(hostname); assert.equal(h.options.controller, h.controller);
    assert.equal(h.options.host, h.env.globalThis.INCOME_CANDIDATE_LOCAL_AUTH); assert.deepEqual(h.calls, ['mount']);
  }
});

test('actual main uses an independent authority input owner, excluding only its own panel lease', async () => {
  const h = await mainMount(), options = h.options;
  assert.equal(options.readScene().blocked, false);
  const releaseAuthority = options.acquireInput();
  assert.equal(options.readScene().blocked, true); assert.equal(options.readScene({ ownsInput: true }).blocked, false);
  const otherLease = h.inputFocus.claim('income-scene-candidate', INPUT_FOCUS_POLICY.BLOCKING_UI);
  assert.equal(options.readScene({ ownsInput: true }).blocked, true, 'normal discovery owns a separate lease');
  releaseAuthority(); assert.equal(h.inputFocus.can('WORLD_ACTION'), false, 'authority close must not release discovery input');
  h.inputFocus.release(otherLease); assert.equal(h.inputFocus.can('WORLD_ACTION'), true);
  h.conversation(true); assert.equal(options.readScene({ ownsInput: true }).blocked, true); h.conversation(false);
  h.rooms.insideRoom = true; assert.equal(options.readScene().inside, true); assert.notEqual(options.readScene().sceneId, 'campus');
});

test('actual main calls runtime scene validation each discovery frame and disposes on terminal pagehide', async () => {
  const h = await mainMount(); h.incomeGameCandidate.update();
  assert.deepEqual(h.calls, ['mount', 'discovery-update', 'authority-update']);
  h.window.dispatch('pagehide', { persisted: true }); assert.equal(h.calls.includes('authority-dispose'), false);
  h.window.dispatch('pagehide', { persisted: false }); assert.equal(h.calls.at(-1), 'authority-dispose');
});

test('actual main stylesheet exposes local authority controls above the campus canvas', () => {
  const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const toolbar = css.match(/\.convenience-authority-candidate\s*\{([^}]+)\}/)?.[1] ?? '';
  assert.match(toolbar, /position:\s*fixed/);
  assert.match(toolbar, /z-index:\s*1000/);
  assert.match(toolbar, /pointer-events:\s*auto/);
  assert.match(toolbar, /100vw\s*-\s*24px/);
  assert.match(css, /\.convenience-authority-candidate button\s*\{[^}]*min-height:\s*44px/);
});


test('actual main refreshes the existing wallet readback after a confirmed convenience receipt', async () => {
  const h = await mainMount();
  assert.equal(typeof h.options.onCommitted, 'function');
  h.options.onCommitted({ committed: true });
  assert.equal(h.calls.at(-1), 'wallet-reward');
});
