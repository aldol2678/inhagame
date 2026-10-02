import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveInventoryMutationChildKey,
  normalizeInventoryMutationPlan,
  validateInventoryMutationRequest
} from '../src/collection/inventory-mutation-contract.js';

test('mutation plan is deterministic, sorted and duplicate-free', () => {
  const plan = normalizeInventoryMutationPlan({
    consumes: [
      { itemId: 'material.fish_carp', quantity: 2 },
      { itemId: 'material.campus_leaf', quantity: 1 }
    ],
    grants: [{ itemId: 'material.artifact_fragment_01', quantity: 1 }]
  });
  assert.deepEqual(plan, {
    consumes: [
      { itemId: 'material.campus_leaf', quantity: 1 },
      { itemId: 'material.fish_carp', quantity: 2 }
    ],
    grants: [{ itemId: 'material.artifact_fragment_01', quantity: 1 }]
  });
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.consumes));
  assert.throws(() => normalizeInventoryMutationPlan({
    consumes: [
      { itemId: 'material.campus_leaf', quantity: 1 },
      { itemId: 'material.campus_leaf', quantity: 2 }
    ]
  }), /Duplicate consumes itemId/);
  assert.throws(() => normalizeInventoryMutationPlan({
    consumes: [{ itemId: 'material.campus_leaf', quantity: 1 }],
    grants: [{ itemId: 'material.campus_leaf', quantity: 1 }]
  }), /cannot consume and grant the same item/);
});

test('mutation request separates server settlement identity from domain rules', () => {
  const request = validateInventoryMutationRequest({
    mutationType: 'CRAFT',
    sourceType: 'CRAFTING',
    sourceRef: 'recipe.test_leaf_to_artifact',
    idempotencyKey: 'craft:test:001',
    plan: {
      consumes: [{ itemId: 'material.campus_leaf', quantity: 2 }],
      grants: [{ itemId: 'material.artifact_fragment_01', quantity: 1 }]
    }
  });
  assert.equal(request.mutationType, 'CRAFT');
  assert.equal(request.sourceType, 'CRAFTING');
  assert.equal(request.plan.consumes[0].quantity, 2);
  assert.equal('recipeUnlocked' in request, false);
  assert.equal('successChance' in request, false);

  assert.throws(() => validateInventoryMutationRequest({
    mutationType: 'CONSUME',
    sourceType: 'ACTIVITY',
    sourceRef: 'activity.fishing.inkyung',
    idempotencyKey: 'consume:bait:001',
    plan: {
      consumes: [{ itemId: 'material.campus_leaf', quantity: 1 }],
      grants: [{ itemId: 'material.fish_carp', quantity: 1 }]
    }
  }), /CONSUME mutation cannot grant outputs/);

  assert.throws(() => validateInventoryMutationRequest({
    mutationType: 'CRAFT',
    sourceType: 'CRAFTING',
    sourceRef: 'recipe.bad',
    idempotencyKey: 'craft:bad:001',
    plan: { consumes: [{ itemId: 'material.campus_leaf', quantity: 1 }] }
  }), /requires at least one grant/);
});

test('plan rejects malformed ids, quantities and unknown authority fields', () => {
  assert.throws(() => normalizeInventoryMutationPlan({
    consumes: [{ itemId: 'material.fish.carp', quantity: 1 }]
  }), /Invalid consumes/);
  assert.throws(() => normalizeInventoryMutationPlan({
    consumes: [{ itemId: 'material.campus_leaf', quantity: 0 }]
  }), /Invalid consumes/);
  assert.throws(() => normalizeInventoryMutationPlan({
    consumes: [{ itemId: 'material.campus_leaf', quantity: 1, price: 100 }]
  }), /unknown field/);
  assert.throws(() => validateInventoryMutationRequest({
    mutationType: 'CRAFT',
    sourceType: 'CRAFTING',
    sourceRef: 'recipe.x',
    idempotencyKey: 'x',
    plan: {
      consumes: [{ itemId: 'material.campus_leaf', quantity: 1 }],
      grants: [{ itemId: 'material.fish_carp', quantity: 1 }]
    },
    outputRarity: 'RARE'
  }), /unknown field/);
});

test('child idempotency keys are deterministic and fit the existing grant key contract', () => {
  const parent = 'inventory-mutation:craft:campus:001';
  assert.equal(deriveInventoryMutationChildKey(parent, 'consume', 0),
    'inventory-mutation:craft:campus:001/consume/0');
  assert.equal(deriveInventoryMutationChildKey(parent, 'grant', 2),
    'inventory-mutation:craft:campus:001/grant/2');
  assert.throws(() => deriveInventoryMutationChildKey(parent, 'refund', 0), /Invalid child direction/);
  assert.throws(() => deriveInventoryMutationChildKey(parent, 'grant', 16), /Invalid child position/);
});
