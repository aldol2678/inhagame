import test from 'node:test';
import assert from 'node:assert/strict';
import { createConvenienceAuthorityRequest, createConvenienceAuthorityClient } from '../src/income/convenience-authority-client.mjs';

// Synthetic transport/registry only: no real HTTP listener, Auth server, or DB proof.
const connectionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sessionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const requestId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const authorization = 'Bearer synthetic.local.bearer.with.no.real.account';
const clone = value => JSON.parse(JSON.stringify(value));
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const snapshot = (sequence = 0, moveX = 0, moveZ = 0, extra = {}) => ({ sessionId, fence: 7, spawnId: 'MAIN_GATE', active: true,
  eligible: false, closedCandidate: true, state: { version: 'durable-campus-walk-v1', sequence, revision: sequence + 1,
    position: { x: sequence * .15, y: 1.15, z: 0 }, observedAt: 1000 + sequence * 50, simulatedAt: 1000 + sequence * 50,
    intentReceivedAt: sequence ? 1000 + sequence * 50 : null, geometryRevision: 'a'.repeat(64),
    lastCommand: sequence ? { sequence, moveX, moveZ } : null }, ...extra });
function fixture(options = {}) {
  const calls = [], published = [], stops = [];
  const client = createConvenienceAuthorityClient({ connectionId, request: async body => {
    calls.push(clone(body)); if (options.request) return options.request(body);
    if (body.op === 'open') return snapshot();
    if (body.op === 'move') return snapshot(body.command.sequence, body.command.moveX, body.command.moveZ);
    if (body.op === 'revoke') return { active: false };
    return { enabled: false, synthetic: true };
  }, onSnapshot: value => { published.push(clone(value)); options.onSnapshot?.(value); }, onStop: reason => stops.push(reason) });
  return { client, calls, published, stops };
}
const start = { op: 'start', questId: 'quest.side.convenience_help', requestId };

test('HTTP transport exists only on exact localhost or 127.0.0.1', () => {
  for (const hostname of ['example.com', 'localhost.evil.test', '127.0.0.1.evil.test', '::1', '', undefined]) {
    assert.throws(() => createConvenienceAuthorityRequest({ location: { hostname } }), /CONVENIENCE_LOCAL_ONLY/);
  }
  for (const hostname of ['localhost', '127.0.0.1']) assert.equal(typeof createConvenienceAuthorityRequest({ location: { hostname } }), 'function');
});

test('HTTP uses fresh bearer, no-store, same-origin and exact body with no automatic replay', async () => {
  const calls = []; let token = authorization;
  const request = createConvenienceAuthorityRequest({ location: { hostname: 'localhost' }, getAuthorization: async () => token,
    fetcher: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ ok: true }) }; } });
  const body = { op: 'open', connectionId }; await request(body); token = 'Bearer another.synthetic.local.auth.token'; await request(body);
  assert.equal(calls.length, 2); assert.equal(calls[0].url, '/api/world-convenience-authority');
  assert.deepEqual(JSON.parse(calls[0].init.body), body); assert.equal(calls[0].init.headers.Authorization, authorization);
  assert.equal(calls[1].init.headers.Authorization, token);
  assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.cache, 'no-store'); assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(calls[0].init.method, 'POST'); assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  let attempts = 0;
  const lost = createConvenienceAuthorityRequest({ location: { hostname: 'localhost' }, getAuthorization: async () => authorization,
    fetcher: async () => { attempts++; throw Error('lost response'); } });
  await assert.rejects(lost(body), /lost response/); assert.equal(attempts, 1);
});

test('missing or malformed bearer never sends a request', async () => {
  for (const value of [undefined, '', 'Basic secret', 'Bearer short', 'bearer synthetic.long.enough.token']) {
    const request = createConvenienceAuthorityRequest({ location: { hostname: 'localhost' }, getAuthorization: async () => value,
      fetcher: () => assert.fail('invalid bearer cannot fetch') });
    await assert.rejects(request({ op: 'open', connectionId }), /AUTH_REQUIRED/);
  }
});

test('account epoch change during Auth lookup prevents old-owner HTTP dispatch', async () => {
  const auth = defer(); let epoch = 1;
  const request = createConvenienceAuthorityRequest({ location: { hostname: 'localhost' }, getEpoch: () => epoch,
    getAuthorization: () => auth.promise, fetcher: () => assert.fail('stale authorization cannot dispatch') });
  const pending = request({ op: 'open', connectionId }); epoch = 2; auth.resolve(authorization);
  await assert.rejects(pending, /AUTH_CHANGED/);
});

test('account epoch change during delayed response or body parsing rejects stale success', async () => {
  for (const delayBody of [false, true]) {
    const delayed = defer(), entered = defer(); let epoch = 1;
    const request = createConvenienceAuthorityRequest({ location: { hostname: 'localhost' }, getEpoch: () => epoch,
      getAuthorization: async () => authorization, fetcher: async () => {
        entered.resolve(); return delayBody ? { ok: true, json: () => delayed.promise } : delayed.promise;
      } });
    const pending = request({ op: 'open', connectionId }); await entered.promise; epoch = 2;
    delayed.resolve(delayBody ? snapshot() : { ok: true, json: async () => snapshot() });
    await assert.rejects(pending, /AUTH_CHANGED/);
  }
});

test('server rejection code is preserved for session invalidation', async () => {
  const request = createConvenienceAuthorityRequest({ location: { hostname: 'localhost' }, getAuthorization: async () => authorization,
    fetcher: async () => ({ ok: false, json: async () => ({ error: 'CONVENIENCE_AUTH_REVOKED' }) }) });
  await assert.rejects(request({ op: 'move' }), { code: 'CONVENIENCE_AUTH_REVOKED' });
});

test('open sends only a stable connection UUID, and repeat open reuses the accepted snapshot', async () => {
  const h = fixture(); assert.equal(h.client.active, false); await assert.rejects(h.client.move(), /SESSION_REQUIRED/);
  const result = await h.client.open(); assert.equal(h.client.active, true); assert.equal(await h.client.open(), result);
  assert.deepEqual(h.calls, [{ op: 'open', connectionId }]); assert.equal(h.published.length, 1);
});

test('lost open response recovers the same synthetic registry row and never invents a new connection', async () => {
  let row, opens = 0, creations = 0;
  const h = fixture({ request: async body => {
    assert.equal(body.op, 'open'); opens++;
    if (!row) { row = snapshot(3, 0, 1); creations++; }
    if (opens === 1) throw Error('lost open acknowledgement');
    return clone(row);
  } });
  await assert.rejects(h.client.open(), /lost open/); assert.equal(h.client.active, false);
  const recovered = await h.client.open(); assert.equal(recovered.state.sequence, 3); assert.equal(creations, 1);
  assert.deepEqual(h.calls, [{ op: 'open', connectionId }, { op: 'open', connectionId }]);
});

test('movement sends only exact directional sequence and server authority scope', async () => {
  const h = fixture(); await h.client.open(); await h.client.move(.5, -1);
  assert.deepEqual(h.calls.at(-1), { op: 'move', connectionId, authoritySessionId: sessionId, fence: 7,
    command: { sequence: 1, moveX: .5, moveZ: -1 } });
  assert.equal(h.client.snapshot.state.sequence, 1);
});

test('concurrent movement is single-flight and a lost response retries the identical command', async () => {
  const response = defer(); let attempts = 0;
  const h = fixture({ request: async body => {
    if (body.op === 'open') return snapshot();
    attempts++; if (attempts === 1) return response.promise;
    return snapshot(body.command.sequence, body.command.moveX, body.command.moveZ);
  } });
  await h.client.open(); const first = h.client.move(1, 0), overlapping = h.client.move(0, 1);
  assert.equal(first, overlapping); response.reject(Error('lost movement acknowledgement'));
  await assert.rejects(first, /lost movement/); assert.equal(h.client.snapshot.state.sequence, 0);
  await h.client.move(-1, -1);
  assert.deepEqual(h.calls[1], h.calls[2]); assert.equal(h.calls[2].command.sequence, 1); assert.equal(h.calls[2].command.moveX, 1);
  await h.client.move(0, 1); assert.deepEqual(h.calls.at(-1).command, { sequence: 2, moveX: 0, moveZ: 1 });
});

test('CAS conflict does not auto-replay, open, or advance the accepted snapshot', async () => {
  const h = fixture({ request: async body => {
    if (body.op === 'open') return snapshot(); throw Object.assign(Error('CONVENIENCE_CAS_CONFLICT'), { code: 'CONVENIENCE_CAS_CONFLICT' });
  } });
  await h.client.open(); await assert.rejects(h.client.move(1, 0), { code: 'CONVENIENCE_CAS_CONFLICT' });
  assert.deepEqual(h.calls.map(c => c.op), ['open', 'move']); assert.equal(h.client.snapshot.state.sequence, 0);
});

test('mixed delivery or another quest is refused before movement or income dispatch', async () => {
  const h = fixture(); await h.client.open();
  for (const questId of ['quest.side.delivery', 'quest.side.taerin_carp', 'quest.side.mixed_delivery']) {
    await assert.rejects(h.client.income({ ...start, questId }), /CONVENIENCE_ONLY/);
  }
  assert.deepEqual(h.calls.map(c => c.op), ['open']);
});

test('status is read-only without opening, moving, or fabricating authority fields', async () => {
  const h = fixture(); await h.client.income({ op: 'status', questId: 'quest.side.convenience_help' });
  assert.deepEqual(h.calls, [{ op: 'status', connectionId }]); assert.equal(h.client.active, false);
});

test('work action waits for explicit zero-direction acknowledgement and strips quest selector', async () => {
  const response = defer(), entered = defer();
  const h = fixture({ request: async body => {
    if (body.op === 'open') return snapshot();
    if (body.op === 'move') { entered.resolve(); return response.promise; }
    return { enabled: false };
  } });
  await h.client.open(); const pending = h.client.income(start); await entered.promise;
  assert.deepEqual(h.calls.map(c => c.op), ['open', 'move']);
  assert.deepEqual(h.calls.at(-1).command, { sequence: 1, moveX: 0, moveZ: 0 });
  response.resolve(snapshot(1)); await pending;
  assert.deepEqual(h.calls.at(-1), { op: 'start', requestId, connectionId, authoritySessionId: sessionId, fence: 7 });
});

test('work action drains a preexisting nonzero inflight move then obtains a separate zero acknowledgement', async () => {
  const firstAck = defer(); let moves = 0;
  const h = fixture({ request: async body => {
    if (body.op === 'open') return snapshot();
    if (body.op === 'move') { moves++; return moves === 1 ? firstAck.promise : snapshot(body.command.sequence, body.command.moveX, body.command.moveZ); }
    return { enabled: false };
  } });
  await h.client.open(); const moving = h.client.move(1, 0), working = h.client.income(start);
  firstAck.resolve(snapshot(1, 1, 0)); await Promise.all([moving, working]);
  assert.deepEqual(h.calls.map(c => c.op), ['open', 'move', 'move', 'start']);
  assert.deepEqual(h.calls[2].command, { sequence: 2, moveX: 0, moveZ: 0 });
});

test('work action retries an uncertain nonzero command exactly before sending zero intent', async () => {
  let moves = 0;
  const h = fixture({ request: async body => {
    if (body.op === 'open') return snapshot();
    if (body.op === 'move') { if (++moves === 1) throw Error('lost'); return snapshot(body.command.sequence, body.command.moveX, body.command.moveZ); }
    return { enabled: false };
  } });
  await h.client.open(); await assert.rejects(h.client.move(0, 1), /lost/); await h.client.income(start);
  assert.deepEqual(h.calls.map(c => c.op), ['open', 'move', 'move', 'move', 'start']);
  assert.deepEqual(h.calls[1], h.calls[2]); assert.deepEqual(h.calls[3].command, { sequence: 2, moveX: 0, moveZ: 0 });
});

test('failed or unconfirmed stop snapshot blocks the work action', async () => {
  for (const dishonestAck of [false, true]) {
    const h = fixture({ request: async body => {
      if (body.op === 'open') return snapshot();
      if (body.op === 'move') { if (dishonestAck) return snapshot(body.command.sequence, 1, 0); throw Error('lost stop acknowledgement'); }
      assert.fail('work action must not dispatch without zero acknowledgement');
    } });
    await h.client.open(); await assert.rejects(h.client.income(start), dishonestAck ? /STOP_UNCONFIRMED|INVALID_ACK/ : /lost stop/);
    assert.ok(h.calls.every(c => c.op === 'open' || c.op === 'move'));
  }
});

test('stop during zero acknowledgement invalidates the work action before dispatch', async () => {
  let client; const h = fixture({ onSnapshot: value => { if (value.state.sequence === 1) void client.stop('ACCOUNT_CHANGED'); } });
  client = h.client; await client.open(); await assert.rejects(client.income(start), /AUTH_CHANGED/);
  assert.equal(client.active, false); assert.ok(!h.calls.some(c => c.op === 'start'));
  assert.deepEqual(h.stops, ['ACCOUNT_CHANGED']);
});

test('stop immediately clears local authority, sends exact revoke, and discards late movement', async () => {
  const ack = defer(), entered = defer();
  const h = fixture({ request: async body => {
    if (body.op === 'open') return snapshot(); if (body.op === 'move') { entered.resolve(); return ack.promise; } return { active: false };
  } });
  await h.client.open(); const moving = h.client.move(1, 0); await entered.promise; await h.client.stop('ACCOUNT_CHANGED');
  assert.equal(h.client.active, false); assert.equal(h.client.snapshot, null);
  assert.deepEqual(h.calls.at(-1), { op: 'revoke', connectionId, authoritySessionId: sessionId, fence: 7 });
  ack.resolve(snapshot(1, 1, 0)); await assert.rejects(moving, /AUTH_CHANGED/);
  assert.equal(h.published.length, 1); assert.equal(h.client.active, false); assert.deepEqual(h.stops, ['ACCOUNT_CHANGED']);
});

test('a late open after stop cannot reactivate the client', async () => {
  const ack = defer(); const h = fixture({ request: async () => ack.promise });
  const opening = h.client.open(); await h.client.stop(); ack.resolve(snapshot()); await assert.rejects(opening, /AUTH_CHANGED/);
  assert.equal(h.client.active, false); assert.equal(h.published.length, 0);
});

test('failed revoke remains locally stopped; dispose prevents any future open or movement', async () => {
  const h = fixture({ request: async body => { if (body.op === 'open') return snapshot(); throw Error('revoke not acknowledged'); } });
  await h.client.open(); await h.client.dispose(); assert.equal(h.client.active, false);
  await assert.rejects(h.client.open(), /DISPOSED/); await assert.rejects(h.client.move(), /SESSION_REQUIRED/);
  assert.deepEqual(h.calls.map(c => c.op), ['open', 'revoke']); assert.deepEqual(h.stops, ['DISPOSED']);
});

test('revoked, expired, replaced or version-changed authority stops without retrying movement', async () => {
  for (const code of ['CONVENIENCE_SESSION_CHANGED', 'CONVENIENCE_SESSION_EXPIRED', 'CONVENIENCE_AUTH_REVOKED', 'CONVENIENCE_VERSION_CHANGED']) {
    const h = fixture({ request: async body => {
      if (body.op === 'open') return snapshot(); if (body.op === 'revoke') return { active: false };
      throw Object.assign(Error(code), { code });
    } });
    await h.client.open(); await assert.rejects(h.client.move(1, 0), { code });
    assert.equal(h.client.active, false); assert.deepEqual(h.stops, [code]); assert.deepEqual(h.calls.map(c => c.op), ['open', 'move', 'revoke']);
  }
});

test('inactive, nonfinite and incomplete snapshots cannot activate the client', async () => {
  const valid = snapshot();
  for (const invalid of [null, {}, { ...valid, active: false }, { ...valid, state: null },
    { ...valid, state: { ...valid.state, sequence: 1.5 } }, { ...valid, state: { ...valid.state, revision: NaN } },
    { ...valid, state: { ...valid.state, position: { x: Infinity, y: 1.15, z: 0 } } }]) {
    const h = fixture({ request: async () => invalid }); await assert.rejects(h.client.open(), /INVALID_SNAPSHOT/);
    assert.equal(h.client.active, false); assert.equal(h.published.length, 0);
  }
});

test('authority identity and nonnegative sequence/revision are required before activation', async () => {
  const valid = snapshot();
  for (const invalid of [{ ...valid, sessionId: undefined }, { ...valid, sessionId: 'forged' }, { ...valid, fence: undefined },
    { ...valid, fence: 0 }, { ...valid, fence: 1.5 }, { ...valid, state: { ...valid.state, sequence: -1 } },
    { ...valid, state: { ...valid.state, revision: 0 } }]) {
    const h = fixture({ request: async () => invalid }); await assert.rejects(h.client.open(), /INVALID_SNAPSHOT/);
    assert.equal(h.client.active, false); assert.equal(h.published.length, 0);
  }
});

test('changed session/fence or revision regression cannot overwrite accepted authority', async () => {
  for (const replacement of [snapshot(2, 0, 0, { sessionId: requestId }), snapshot(2, 0, 0, { fence: 8 }), snapshot(0)]) {
    const h = fixture({ request: async body => body.op === 'open' ? snapshot(1) : replacement });
    const before = await h.client.open(); await assert.rejects(h.client.move(), /STALE_SNAPSHOT|INVALID_ACK/);
    assert.equal(h.client.snapshot, before); assert.equal(h.published.length, 1);
  }
});

test('sequence regression at unchanged revision cannot overwrite accepted authority', async () => {
  const accepted = snapshot(3), older = snapshot(2); older.state.revision = accepted.state.revision;
  const h = fixture({ request: async body => body.op === 'open' ? accepted : older });
  await h.client.open(); await assert.rejects(h.client.move(), /STALE_SNAPSHOT|INVALID_ACK/);
  assert.equal(h.client.snapshot, accepted); assert.equal(h.published.length, 1);
});

test('equal-revision acknowledgement cannot rewrite a previously accepted pose or time', async () => {
  const accepted = snapshot(1);
  for (const change of [{ position: { x: 99, y: 1.15, z: 0 } }, { observedAt: 9999 }, { simulatedAt: 9999 }]) {
    const changed = { ...clone(accepted), state: { ...clone(accepted.state), ...change } };
    const h = fixture({ request: async body => body.op === 'open' ? accepted : changed });
    await h.client.open(); await assert.rejects(h.client.move(0, 0), /CONVENIENCE_(STALE_SNAPSHOT|INVALID_SNAPSHOT|INVALID_ACK)/);
    assert.equal(h.client.snapshot, accepted); assert.equal(h.published.length, 1);
  }
});

test('movement acknowledgement must match the exact sequence and direction that was sent', async () => {
  for (const result of [snapshot(0), snapshot(2, 1, 0), snapshot(1, 0, 1),
    { ...snapshot(1, 1, 0), state: { ...snapshot(1, 1, 0).state, lastCommand: null } },
    { ...snapshot(1, 1, 0), state: { ...snapshot(1, 1, 0).state, lastCommand: { sequence: 99, moveX: 1, moveZ: 0 } } }]) {
    const h = fixture({ request: async body => body.op === 'open' ? snapshot() : result });
    const accepted = await h.client.open(); await assert.rejects(h.client.move(1, 0), /CONVENIENCE_(STALE_SNAPSHOT|INVALID_SNAPSHOT|INVALID_ACK)/);
    assert.equal(h.client.snapshot, accepted); assert.equal(h.published.length, 1);
  }
});

test('synchronous request failure preserves its error and permits the same exact movement retry', async () => {
  let attempts = 0; const calls = [];
  const client = createConvenienceAuthorityClient({ connectionId, request: body => {
    calls.push(clone(body)); if (body.op === 'open') return snapshot();
    if (++attempts === 1) throw Error('synchronous offline');
    return snapshot(body.command.sequence, body.command.moveX, body.command.moveZ);
  } });
  await client.open(); await assert.rejects(client.move(1, 0), /synchronous offline/);
  await client.move(0, 1); assert.deepEqual(calls[1], calls[2]); assert.equal(client.snapshot.state.sequence, 1);
});

test('queued movement canceled before dispatch cannot send under a new connection or missing authority', async () => {
  const h = fixture(); await h.client.open(); const moving = h.client.move(1, 0);
  const rejected = assert.rejects(moving, /AUTH_CHANGED/); await h.client.stop(); await rejected;
  assert.deepEqual(h.calls.map(c => c.op), ['open', 'revoke']); assert.equal(h.client.active, false);
});

test('concurrent open is single-flight; stop rotates the connection only for a new session', async () => {
  const ack = defer(), entered = defer(); let opens = 0;
  const h = fixture({ request: async body => {
    if (body.op === 'open') { opens++; entered.resolve(); return opens === 1 ? ack.promise : snapshot(); }
    return { active: false };
  } });
  const first = h.client.open(), second = h.client.open(); assert.equal(first, second); await entered.promise;
  assert.deepEqual(h.calls, [{ op: 'open', connectionId }]); ack.resolve(snapshot()); await first;
  await h.client.stop(); await h.client.open();
  assert.equal(h.calls[1].op, 'revoke'); assert.equal(h.calls[1].connectionId, connectionId);
  assert.equal(h.calls[2].op, 'open'); assert.notEqual(h.calls[2].connectionId, connectionId);
  assert.match(h.calls[2].connectionId, /^[0-9a-f-]{36}$/);
});

test('late open cleans up its known old session only while the same Auth epoch remains', async () => {
  for (const switchAccount of [false, true]) {
    const ack = defer(), entered = defer(), calls = []; let epoch = 1;
    const client = createConvenienceAuthorityClient({ connectionId, getEpoch: () => epoch, request: async body => {
      calls.push(clone(body)); if (body.op === 'open') { entered.resolve(); return ack.promise; } return { active: false };
    } });
    const opening = client.open(); await entered.promise; if (switchAccount) epoch++;
    await client.stop(switchAccount ? 'ACCOUNT_CHANGED' : 'CANCELLED'); ack.resolve(snapshot()); await assert.rejects(opening, /AUTH_CHANGED/);
    assert.equal(client.active, false);
    assert.deepEqual(calls.map(c => c.op), switchAccount ? ['open'] : ['open', 'revoke']);
    if (!switchAccount) assert.deepEqual(calls[1], { op: 'revoke', connectionId, authoritySessionId: sessionId, fence: 7 });
  }
});
