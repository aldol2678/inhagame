// INHA WORLD P0 Inventory Mutation pure contract.
// Validates trusted server mutation plans. It never mutates ownership or decides Recipe/Equipment rules.

export const INVENTORY_MUTATION_TYPES = Object.freeze([
  'CONSUME', 'CRAFT', 'PROCESS', 'COOK', 'DISASSEMBLE', 'ENHANCE', 'RESEARCH', 'SYSTEM_EXCHANGE'
]);

export const INVENTORY_MUTATION_SOURCES = Object.freeze([
  'DEFAULT', 'QUEST', 'EXPLORATION', 'ACHIEVEMENT', 'EVENT', 'MINIGAME', 'SHOP', 'INHAGAME_REWARD',
  'ACTIVITY', 'CRAFTING', 'EQUIPMENT', 'RESEARCH', 'SYSTEM', 'ADMIN'
]);

export const INVENTORY_ITEM_ID_PATTERN = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;
export const INVENTORY_MUTATION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;

const mutationTypes = new Set(INVENTORY_MUTATION_TYPES);
const mutationSources = new Set(INVENTORY_MUTATION_SOURCES);
const PLAN_KEYS = new Set(['consumes', 'grants']);
const OP_KEYS = new Set(['itemId', 'quantity']);

function validateOperation(raw, label) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`${label} operation must be an object`);
  for (const key of Object.keys(raw)) {
    if (!OP_KEYS.has(key)) throw new TypeError(`${label} operation has unknown field: ${key}`);
  }
  if (typeof raw.itemId !== 'string' || !INVENTORY_ITEM_ID_PATTERN.test(raw.itemId) || raw.itemId.length > 80) {
    throw new TypeError(`Invalid ${label} itemId`);
  }
  if (!Number.isSafeInteger(raw.quantity) || raw.quantity < 1 || raw.quantity > 999_999_999) {
    throw new TypeError(`Invalid ${label} quantity`);
  }
  return Object.freeze({ itemId: raw.itemId, quantity: raw.quantity });
}

function normalizeOperations(raw, label) {
  if (raw == null) return Object.freeze([]);
  if (!Array.isArray(raw)) throw new TypeError(`${label} must be an array`);
  if (raw.length > 16) throw new TypeError(`${label} supports at most 16 operations`);
  const items = raw.map((value, index) => validateOperation(value, `${label}[${index}]`));
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.itemId)) throw new TypeError(`Duplicate ${label} itemId: ${item.itemId}`);
    seen.add(item.itemId);
  }
  return Object.freeze(items.slice().sort((a, b) => a.itemId.localeCompare(b.itemId)));
}

export function normalizeInventoryMutationPlan(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Mutation plan must be an object');
  for (const key of Object.keys(raw)) {
    if (!PLAN_KEYS.has(key)) throw new TypeError(`Mutation plan has unknown field: ${key}`);
  }

  const consumes = normalizeOperations(raw.consumes, 'consumes');
  const grants = normalizeOperations(raw.grants, 'grants');
  if (consumes.length === 0) throw new TypeError('Mutation plan requires at least one consume');

  const consumed = new Set(consumes.map(item => item.itemId));
  for (const item of grants) {
    if (consumed.has(item.itemId)) throw new TypeError(`Mutation plan cannot consume and grant the same item: ${item.itemId}`);
  }

  return Object.freeze({ consumes, grants });
}

export function validateInventoryMutationRequest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Mutation request must be an object');
  const allowed = new Set(['mutationType', 'sourceType', 'sourceRef', 'idempotencyKey', 'plan']);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new TypeError(`Mutation request has unknown field: ${key}`);
  }
  if (!mutationTypes.has(raw.mutationType)) throw new TypeError('Invalid mutationType');
  if (!mutationSources.has(raw.sourceType)) throw new TypeError('Invalid sourceType');
  if (typeof raw.sourceRef !== 'string' || raw.sourceRef.length < 1 || raw.sourceRef.length > 200) {
    throw new TypeError('Invalid sourceRef');
  }
  if (typeof raw.idempotencyKey !== 'string' || !INVENTORY_MUTATION_KEY_PATTERN.test(raw.idempotencyKey)) {
    throw new TypeError('Invalid idempotencyKey');
  }

  const plan = normalizeInventoryMutationPlan(raw.plan);
  if (raw.mutationType === 'CONSUME' && plan.grants.length !== 0) {
    throw new TypeError('CONSUME mutation cannot grant outputs');
  }
  if (raw.mutationType !== 'CONSUME' && plan.grants.length === 0) {
    throw new TypeError(`${raw.mutationType} mutation requires at least one grant`);
  }

  return Object.freeze({
    mutationType: raw.mutationType,
    sourceType: raw.sourceType,
    sourceRef: raw.sourceRef,
    idempotencyKey: raw.idempotencyKey,
    plan
  });
}

export function deriveInventoryMutationChildKey(parentKey, direction, position) {
  if (typeof parentKey !== 'string' || !INVENTORY_MUTATION_KEY_PATTERN.test(parentKey)) {
    throw new TypeError('Invalid parent idempotency key');
  }
  if (direction !== 'consume' && direction !== 'grant') throw new TypeError('Invalid child direction');
  if (!Number.isInteger(position) || position < 0 || position > 15) throw new TypeError('Invalid child position');
  return `${parentKey}/${direction}/${position}`;
}
