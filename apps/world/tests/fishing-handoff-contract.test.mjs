import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFishingHandoffReference, fishingTransferPoint, FISHING_HANDOFF_PROTOCOL } from '../prototypes/fishing-handoff-contract.mjs';
import { createPositionAuthorityPrototype } from '../prototypes/fishing-position-authority.mjs';
import { FISHING_SPOTS } from '../src/activity/fishing-spots.js';

async function fixture(sourceRef = FISHING_SPOTS[0].sourceRef) {
  const context = { accountId: randomUUID(), mapVersion: 'fixture-campus-geometry-v1', sourceRef,
    requestId: randomUUID(), generation: 1 };
  const authority = createPositionAuthorityPrototype({ bank: sourceRef, verifyUser: () => context.accountId,
    rpc: async () => ({ status: 'OBSERVED' }) });
  const connection = await authority.connect('verified fixture');
  const identity = { protocol: FISHING_HANDOFF_PROTOCOL, ...context, admissionId: randomUUID(), sessionId: connection.snapshot().sessionId };
  const pose = { ...fishingTransferPoint(sourceRef), snapshotSeq: 1, simulationTick: 0, lastAcceptedInputSeq: 0, mode: 'INELIGIBLE' };
  const model = createFishingHandoffReference(context);
  const message = (status, changes = {}) => ({ ...identity, status, snapshot: { ...pose, ...changes } });
  const offer = () => model.receiveOffer(message('OFFERED'));
  const activate = () => { offer(); return model.receiveActive(message('ACTIVE', { snapshotSeq: 2, mode: 'ON_FOOT' })); };
  return { context, identity, pose, model, message, offer, activate, connection };
}

test('both banks explicitly transfer to the real server spawn; READY gates direction input and cast', async () => {
  for (const spot of FISHING_SPOTS) {
    const f = await fixture(spot.sourceRef), { model } = f;
    const actual = f.connection.snapshot();
    for (const key of ['x','y','z']) assert.equal(actual[key], fishingTransferPoint(spot.sourceRef)[key]);
    assert.equal(model.state().localWriterAllowed, false);
    assert.throws(() => model.noteInputSent(1), /INPUT_NOT_ALLOWED/);
    f.offer(); assert.equal(model.state().phase, 'READY_PENDING');
    assert.equal(model.state().fishingCommandAllowed, false);
    model.receiveActive(f.message('ACTIVE', { snapshotSeq: 2, mode: 'ON_FOOT' }));
    assert.equal(model.state().directionInputAllowed, true); assert.equal(model.state().localWriterAllowed, false);
  }
});

test('late replies from another account/request/generation/session/map cannot overwrite the player root', async () => {
  const f = await fixture(); f.activate(); const initial = f.model.state();
  for (const [key, value] of [['accountId',randomUUID()],['requestId',randomUUID()],['generation',2],
    ['sessionId',randomUUID()],['admissionId',randomUUID()],['mapVersion','other-map'],['sourceRef',FISHING_SPOTS[1].sourceRef],['protocol','v0']]) {
    assert.equal(f.model.receiveSnapshot({ ...f.message('SNAPSHOT', { snapshotSeq: 3 }), [key]: value }), false);
    assert.deepEqual(f.model.state(), initial);
  }
});

test('snapshot sequence/tick/input acknowledgement cannot regress; acknowledgement never replays input', async () => {
  const f = await fixture(); f.activate(); f.model.noteInputSent(1); f.model.noteInputSent(2);
  assert.equal(f.model.receiveSnapshot(f.message('SNAPSHOT', { snapshotSeq: 5, simulationTick: 10, lastAcceptedInputSeq: 2, mode: 'ON_FOOT', z: f.pose.z-.35 })), true);
  const accepted = f.model.state();
  for (const change of [{ snapshotSeq: 4, simulationTick: 11, lastAcceptedInputSeq: 2 },
    { snapshotSeq: 6, simulationTick: 9, lastAcceptedInputSeq: 2 },
    { snapshotSeq: 6, simulationTick: 11, lastAcceptedInputSeq: 1 }]) {
    assert.equal(f.model.receiveSnapshot(f.message('SNAPSHOT', change)), false);
  }
  assert.deepEqual(f.model.state(), accepted);
  assert.equal(accepted.sentSeq, 2); assert.equal(accepted.pose.lastAcceptedInputSeq, 2);
});

test('invalid coordinates/future input acknowledgement never mutate accepted state', async () => {
  const f = await fixture(); f.activate(); const initial = f.model.state();
  for (const changes of [{ x: NaN },{ z: Infinity },{ y: 5 },{ x: f.pose.x+20 },{ lastAcceptedInputSeq: 1 },
    { snapshotSeq: 1.5 },{ simulationTick: -1 },{ mode: 'MOUNTED' }]) {
    assert.throws(() => f.model.receiveSnapshot(f.message('SNAPSHOT', { snapshotSeq: 3, ...changes })), /INVALID_SERVER_SNAPSHOT/);
    assert.deepEqual(f.model.state(), initial);
  }
  assert.ok(Object.isFrozen(initial.pose));
});

test('entry cannot activate before offer or teleport to a client-selected point', async () => {
  const f = await fixture();
  assert.equal(f.model.receiveActive(f.message('ACTIVE', { snapshotSeq: 2, mode: 'ON_FOOT' })), false);
  assert.throws(() => f.model.receiveOffer(f.message('OFFERED', { z: f.pose.z-1 })), /INVALID_SERVER_OFFER/);
  assert.equal(f.model.state().phase, 'ENTERING');
});

test('lost connection keeps local movement/cast locked; delayed ACTIVE/snapshot cannot recover authority', async () => {
  const f = await fixture(); f.activate(); f.model.connectionLost();
  assert.equal(f.model.state().phase, 'RECOVERING');
  assert.equal(f.model.state().localWriterAllowed, false); assert.equal(f.model.state().fishingCommandAllowed, false);
  assert.equal(f.model.receiveActive(f.message('ACTIVE', { snapshotSeq: 3, mode: 'ON_FOOT' })), false);
  assert.equal(f.model.receiveSnapshot(f.message('SNAPSHOT', { snapshotSeq: 3, mode: 'ON_FOOT' })), false);
  assert.throws(() => f.model.noteInputSent(1), /INPUT_NOT_ALLOWED/);
});

test('exit retry preserves identity; only the matching terminal receipt permits fixed-point local handoff', async () => {
  const f = await fixture(); f.activate(); const exitId = randomUUID();
  assert.equal(f.model.beginExit(exitId), exitId); assert.equal(f.model.beginExit(exitId), exitId);
  assert.throws(() => f.model.beginExit(randomUUID()), /EXIT_REQUEST_CONFLICT/);
  assert.equal(f.model.state().localWriterAllowed, false);
  const receipt = { ...f.message('EXITED', { snapshotSeq: 3, simulationTick: 1 }), exitRequestId: exitId };
  assert.equal(f.model.receiveExited({ ...receipt, exitRequestId: randomUUID() }), false);
  assert.throws(() => f.model.receiveExited({ ...receipt, snapshot: { ...receipt.snapshot, z: f.pose.z-1 } }), /INVALID_SERVER_EXIT/);
  assert.equal(f.model.receiveExited(receipt), true); assert.equal(f.model.state().localWriterAllowed, true);
  assert.equal(f.model.state().fishingCommandAllowed, false);
  assert.equal(f.model.receiveSnapshot(f.message('SNAPSHOT', { snapshotSeq: 4, mode: 'ON_FOOT' })), false);
});

test('ineligible server snapshot freezes the session without enabling fallback local physics', async () => {
  const f = await fixture(); f.activate();
  assert.equal(f.model.receiveSnapshot(f.message('SNAPSHOT', { snapshotSeq: 3, simulationTick: 1 })), true);
  assert.equal(f.model.state().phase, 'RECOVERING'); assert.equal(f.model.state().localWriterAllowed, false);
});
