import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GATHERING_CONTEXT_PRIORITY,
  GATHERING_SPOTS,
  GATHERING_TRUST_RADIUS,
  findNearbyGatheringSpot,
  gatheringContextAction,
  getGatheringSpot
} from '../src/activity/gathering-spots.js';

test('Gathering P1 places one finite leaf source at Heidegger Forest', () => {
  assert.equal(GATHERING_SPOTS.length, 1);
  const spot = getGatheringSpot('gathering.campus.leaf_pile_01');
  assert.ok(spot);
  assert.equal(spot.label, '하이데거 숲 낙엽 더미');
  assert.equal(spot.placeZoneId, 'AREA_AGORA_6_9');
  assert.ok(Number.isFinite(spot.position.x));
  assert.ok(Number.isFinite(spot.position.z));
  assert.equal(spot.interactionRadius, GATHERING_TRUST_RADIUS);
  assert.equal(GATHERING_TRUST_RADIUS, 2);
});

test('Gathering P1 shared F action respects availability, blocking and busy state', () => {
  const spot = GATHERING_SPOTS[0], hits = [];
  assert.equal(gatheringContextAction(spot.position, { available: false }), null);
  assert.equal(gatheringContextAction(spot.position, { available: true, blocked: true }), null);
  assert.equal(findNearbyGatheringSpot({ x: spot.position.x + 3, z: spot.position.z }), null);

  const action = gatheringContextAction(spot.position, {
    available: true, onHarvest: value => hits.push(value.sourceRef)
  });
  assert.equal(action.icon, '🍂');
  assert.equal(action.label, '낙엽 줍기');
  assert.equal(action.shortcut, 'F');
  assert.equal(action.priority, GATHERING_CONTEXT_PRIORITY);
  assert.equal(action.disabled, false);
  assert.equal(action.trigger(), true);
  assert.deepEqual(hits, ['gathering.campus.leaf_pile_01']);

  const busy = gatheringContextAction(spot.position, { available: true, busy: true });
  assert.equal(busy.label, '채집 중…');
  assert.equal(busy.disabled, true);
  assert.equal(busy.trigger(), false);
});
