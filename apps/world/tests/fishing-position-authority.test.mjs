import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPositionAuthorityPrototype } from '../prototypes/fishing-position-authority.mjs';
import { FISHING_SPOTS, findNearbyFishingSpot } from '../src/activity/fishing-spots.js';
import { canOccupy } from '../src/world-collision.js';
import { overPondWater } from '../src/landmark-detail-layout.js';
import { verifyNpcAiUser } from '../npc-factory/npc-ai-auth.mjs';

function fixture(options = {}) {
  let now = 0, wall = Date.parse('2026-10-05T00:00:00Z');
  const actor = randomUUID(), calls = [];
  const authority = createPositionAuthorityPrototype({ verifyUser: () => actor,
    rpc: async (name, args) => { calls.push({ name, args }); return { status: 'OBSERVED' }; },
    monotonicNow: () => now, wallNow: () => wall, ...options });
  return { authority, actor, calls, add: ms => { now += ms; wall += ms; }, setNow: value => { now = value; } };
}

test('authentication uses the existing permanent-account verifier; connection owns actor/session/spawn', async () => {
  const actor = randomUUID(); let observedHeader;
  const f = fixture({ verifyUser: authorization => verifyNpcAiUser(authorization, async (_, init) => {
    observedHeader = init.headers.Authorization;
    return { ok: true, status: 200, json: async () => ({ id: actor, is_anonymous: false }) };
  }) });
  await assert.rejects(f.authority.connect('forged'), /AUTH_REQUIRED/);
  const connection = await f.authority.connect('Bearer abcdefghijklmnopqrstuvwxyz');
  assert.equal(observedHeader, 'Bearer abcdefghijklmnopqrstuvwxyz');
  assert.equal(findNearbyFishingSpot(connection.snapshot()), null, 'server spawn is outside fishing radius');
  connection.advance(); await connection.flush();
  assert.equal(f.calls[0].args.p_user, actor);
  assert.equal(f.calls[0].args.p_session_id, connection.snapshot().sessionId);
  await assert.rejects(f.authority.connect('Bearer abcdefghijklmnopqrstuvwxyz'), /OWNERSHIP_UNAVAILABLE/);
  const denied = fixture({ verifyUser: () => null });
  await assert.rejects(denied.authority.connect('Bearer anonymous'), /AUTH_REQUIRED/);
});

test('pose/time/actor/session/mode/dt and malformed directions cannot change authority state', async () => {
  const f = fixture(), c = await f.authority.connect('test'), initial = c.snapshot();
  for (const field of ['p_user','actor','x','y','z','position','sessionId','revision','observedAt','space','mode','speed','dt','bank']) {
    assert.throws(() => c.input({ seq: 1, moveX: 0, moveZ: 1, [field]: 0 }), /INVALID_COMMAND/);
  }
  for (const body of [null, [], {}, { seq: 0, moveX: 0, moveZ: 0 },
    { seq: 1, moveX: NaN, moveZ: 0 }, { seq: 1, moveX: Infinity, moveZ: 0 },
    { seq: 1, moveX: 2, moveZ: 0 }, { seq: 1, moveX: '1', moveZ: 0 }]) {
    assert.throws(() => c.input(body), /INVALID_COMMAND/);
  }
  assert.deepEqual(c.snapshot(), initial);
});

test('normalized direction and server elapsed time bound movement; message flooding buys no steps', async () => {
  const f = fixture(), c = await f.authority.connect('test'), start = c.snapshot();
  for (let seq = 1; seq <= 100; seq++) { c.input({ seq, moveX: 1, moveZ: 1 }); c.advance(); }
  assert.deepEqual(c.snapshot().x, start.x); assert.deepEqual(c.snapshot().z, start.z);
  f.add(50); c.advance();
  assert.ok(Math.abs(Math.hypot(c.snapshot().x-start.x, c.snapshot().z-start.z)-.35) < 1e-9);
});

test('input retries/order gaps cannot renew movement input and late input cannot move retroactively', async () => {
  const f = fixture(), c = await f.authority.connect('test');
  const input = { seq: 1, moveX: 0, moveZ: -1 }; c.input(input);
  f.add(200); c.advance();
  assert.equal(c.input(input), 'ALREADY_PROCESSED');
  assert.throws(() => c.input({ ...input, moveX: 1 }), /INPUT_CONFLICT/);
  assert.throws(() => c.input({ ...input, seq: 3 }), /INPUT_SEQUENCE_GAP/);
  c.input({ seq: 2, moveX: 0, moveZ: -1 });
  assert.equal(c.input(input), 'STALE');
  f.add(250); c.advance(); const expired = c.snapshot();
  assert.equal(c.input({ seq: 2, moveX: 0, moveZ: -1 }), 'ALREADY_PROCESSED');
  f.add(50); c.advance(); assert.equal(c.snapshot().z, expired.z);
  f.add(200); const beforeLate = c.snapshot();
  c.input({ seq: 3, moveX: 0, moveZ: -1 }); c.advance();
  assert.equal(c.snapshot().z, beforeLate.z);
});

test('both canonical banks are reachable from trusted spawn and pond/enclave/colliders constrain movement', async () => {
  for (const [index, spot] of FISHING_SPOTS.entries()) {
    const f = fixture({ bank: spot.sourceRef }), c = await f.authority.connect('test');
    let reached = false;
    for (let seq = 1; seq <= 200; seq++) {
      c.input({ seq, moveX: 0, moveZ: index === 0 ? -1 : 1 }); f.add(50); c.advance();
      const p = c.snapshot(); reached ||= findNearbyFishingSpot(p)?.spot.sourceRef === spot.sourceRef;
      assert.ok(!overPondWater(p.x, p.z)); assert.ok(canOccupy(p));
      assert.ok(Math.hypot(p.x-spot.position.x, p.z-spot.position.z) <= 8);
    }
    assert.ok(reached, spot.sourceRef);
    assert.ok(findNearbyFishingSpot(c.snapshot()), 'water boundary stops actor at reachable bank');
    for (let seq = 201; seq <= 400; seq++) {
      c.input({ seq, moveX: 0, moveZ: index === 0 ? 1 : -1 }); f.add(50); c.advance();
    }
    assert.equal(findNearbyFishingSpot(c.snapshot()), null);
    assert.ok(Math.hypot(c.snapshot().x-spot.position.x, c.snapshot().z-spot.position.z) <= 8);
  }
});

test('scheduler stall/clock reversal/disconnect revoke eligibility and require a new connection', async () => {
  for (const change of [f => f.add(251), f => f.setNow(-1), (_, c) => c.disconnect()]) {
    const f = fixture(), c = await f.authority.connect('test');
    c.advance(); await c.flush(); change(f, c); c.advance(); await c.flush();
    assert.equal(c.snapshot().mode, 'INELIGIBLE');
    assert.throws(() => c.input({ seq: 1, moveX: 1, moveZ: 0 }), /SESSION_CLOSED/);
    assert.equal(f.calls.at(-1).args.p_mode, 'INELIGIBLE');
  }
});

test('observation retries are byte-identical, single-flight and do not renew evidence timestamp', async () => {
  const calls = []; let fail = true;
  const f = fixture({ rpc: async (name, args) => { calls.push({ name, args });
    if (fail) throw Error('NETWORK_UNKNOWN'); return { status: 'ALREADY_PROCESSED' }; } });
  const c = await f.authority.connect('test'); c.advance();
  await assert.rejects(c.flush(), /NETWORK_UNKNOWN/);
  f.add(200); c.advance(); fail = false;
  await Promise.all([c.flush(), c.flush()]);
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
  assert.ok(Object.isFrozen(calls[1].args));
  f.add(50); c.advance(); await c.flush();
  assert.equal(calls[2].args.p_revision, calls[1].args.p_revision+1);
  assert.notEqual(calls[2].args.p_observed_at, calls[1].args.p_observed_at);
});

test('reconnect increments account revision, changes session and retires old capability', async () => {
  const f = fixture(), old = await f.authority.connect('test');
  old.advance(); await old.flush(); old.disconnect(); old.advance(); await old.flush();
  const c = await f.authority.connect('test'); c.advance(); await c.flush();
  assert.notEqual(old.snapshot().sessionId, c.snapshot().sessionId);
  assert.deepEqual(f.calls.map(call => call.args.p_revision), [1,2,3]);
  assert.throws(() => old.advance(), /ISSUER_FENCED/); await assert.rejects(old.flush(), /ISSUER_FENCED/);
});

test('lost DB revision ownership fences issuer rather than overriding another producer', async () => {
  const f = fixture({ rpc: async () => ({ status: 'STALE' }) }), c = await f.authority.connect('test');
  c.advance(); await assert.rejects(c.flush(), /ISSUER_FENCED/);
  assert.equal(c.snapshot().mode, 'INELIGIBLE');
  await assert.rejects(f.authority.connect('test'), /OWNERSHIP_UNAVAILABLE/);
});
