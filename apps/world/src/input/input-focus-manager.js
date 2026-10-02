export const INPUT_FOCUS_CLASS = Object.freeze({
  GAMEPLAY: "GAMEPLAY",
  CHAT: "CHAT",
  BLOCKING_UI: "BLOCKING_UI",
  SYSTEM_LOCK: "SYSTEM_LOCK"
});

export const INPUT_CURSOR = Object.freeze({
  HIDDEN: "HIDDEN",
  VISIBLE: "VISIBLE"
});

export const INPUT_MINIMAP = Object.freeze({
  ACTIVE: "ACTIVE",
  KEEP: "KEEP",
  SUSPEND: "SUSPEND",
  HIDE: "HIDE"
});

const POLICY_KEYS = Object.freeze([
  "focusClass",
  "priority",
  "movement",
  "camera",
  "worldAction",
  "gameplayShortcut",
  "textInput",
  "cursor",
  "pointerLockDesired",
  "miniMap"
]);

const CLASS_POLICY = Object.freeze({
  [INPUT_FOCUS_CLASS.GAMEPLAY]: Object.freeze({
    focusClass: INPUT_FOCUS_CLASS.GAMEPLAY,
    priority: 0,
    movement: true,
    camera: true,
    worldAction: true,
    gameplayShortcut: true,
    textInput: false,
    cursor: INPUT_CURSOR.HIDDEN,
    pointerLockDesired: true,
    miniMap: INPUT_MINIMAP.ACTIVE
  }),
  [INPUT_FOCUS_CLASS.CHAT]: Object.freeze({
    focusClass: INPUT_FOCUS_CLASS.CHAT,
    priority: 60,
    movement: false,
    camera: false,
    worldAction: false,
    gameplayShortcut: false,
    textInput: true,
    cursor: INPUT_CURSOR.VISIBLE,
    pointerLockDesired: false,
    miniMap: INPUT_MINIMAP.KEEP
  }),
  [INPUT_FOCUS_CLASS.BLOCKING_UI]: Object.freeze({
    focusClass: INPUT_FOCUS_CLASS.BLOCKING_UI,
    priority: 80,
    movement: false,
    camera: false,
    worldAction: false,
    gameplayShortcut: false,
    textInput: false,
    cursor: INPUT_CURSOR.VISIBLE,
    pointerLockDesired: false,
    miniMap: INPUT_MINIMAP.SUSPEND
  }),
  [INPUT_FOCUS_CLASS.SYSTEM_LOCK]: Object.freeze({
    focusClass: INPUT_FOCUS_CLASS.SYSTEM_LOCK,
    priority: 100,
    movement: false,
    camera: false,
    worldAction: false,
    gameplayShortcut: false,
    textInput: false,
    cursor: INPUT_CURSOR.VISIBLE,
    pointerLockDesired: false,
    miniMap: INPUT_MINIMAP.HIDE
  })
});

export const INPUT_FOCUS_POLICY = CLASS_POLICY;

const MINI_MAP_SEVERITY = Object.freeze({
  [INPUT_MINIMAP.ACTIVE]: 0,
  [INPUT_MINIMAP.KEEP]: 1,
  [INPUT_MINIMAP.SUSPEND]: 2,
  [INPUT_MINIMAP.HIDE]: 3
});

const CAPABILITY_KEY = Object.freeze({
  MOVE: "movement",
  MOVEMENT: "movement",
  CAMERA: "camera",
  WORLD_ACTION: "worldAction",
  GAMEPLAY_SHORTCUT: "gameplayShortcut",
  TEXT_INPUT: "textInput",
  POINTER_LOCK: "pointerLockDesired"
});

function validateOwnerId(ownerId) {
  if (typeof ownerId !== "string" || ownerId.trim() === "") {
    throw new TypeError("Input focus ownerId must be a non-empty string");
  }
  return ownerId.trim();
}

function validateBoolean(value, key) {
  if (typeof value !== "boolean") throw new TypeError(`Input focus policy.${key} must be boolean`);
}

function validatePolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new TypeError("Input focus policy must be an object");
  }

  for (const key of Object.keys(policy)) {
    if (!POLICY_KEYS.includes(key)) throw new TypeError(`Unknown input focus policy key: ${key}`);
  }

  if (!Object.values(INPUT_FOCUS_CLASS).includes(policy.focusClass)) {
    throw new TypeError(`Unknown input focus class: ${policy.focusClass}`);
  }
  if (!Number.isFinite(policy.priority)) {
    throw new TypeError("Input focus policy.priority must be a finite number");
  }

  for (const key of ["movement", "camera", "worldAction", "gameplayShortcut", "textInput", "pointerLockDesired"]) {
    validateBoolean(policy[key], key);
  }

  if (!Object.values(INPUT_CURSOR).includes(policy.cursor)) {
    throw new TypeError(`Unknown input focus cursor mode: ${policy.cursor}`);
  }
  if (!Object.values(INPUT_MINIMAP).includes(policy.miniMap)) {
    throw new TypeError(`Unknown input focus minimap mode: ${policy.miniMap}`);
  }

  return Object.freeze({ ...policy });
}

export function createInputPolicy(focusClass, overrides = {}) {
  const base = CLASS_POLICY[focusClass];
  if (!base) throw new TypeError(`Unknown input focus class: ${focusClass}`);
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("Input focus policy overrides must be an object");
  }
  if ("focusClass" in overrides && overrides.focusClass !== focusClass) {
    throw new TypeError("Input focus policy override cannot change focusClass");
  }
  return validatePolicy({ ...base, ...overrides, focusClass });
}

function restrictiveMiniMap(a, b) {
  return MINI_MAP_SEVERITY[a] >= MINI_MAP_SEVERITY[b] ? a : b;
}

function mergeSamePriority(a, b) {
  return {
    focusClass: a.focusClass === b.focusClass ? a.focusClass : "MIXED",
    priority: a.priority,
    movement: a.movement && b.movement,
    camera: a.camera && b.camera,
    worldAction: a.worldAction && b.worldAction,
    gameplayShortcut: a.gameplayShortcut && b.gameplayShortcut,
    textInput: a.textInput || b.textInput,
    cursor: a.cursor === INPUT_CURSOR.VISIBLE || b.cursor === INPUT_CURSOR.VISIBLE
      ? INPUT_CURSOR.VISIBLE
      : INPUT_CURSOR.HIDDEN,
    pointerLockDesired: a.pointerLockDesired && b.pointerLockDesired,
    miniMap: restrictiveMiniMap(a.miniMap, b.miniMap)
  };
}

function freezeSnapshot(policy, {
  topOwners = [],
  activeClaimCount = 0,
  version = 0
} = {}) {
  return Object.freeze({
    ...policy,
    topOwners: Object.freeze([...topOwners]),
    activeClaimCount,
    version
  });
}

export function createInputFocusManager({
  baseline = INPUT_FOCUS_POLICY.GAMEPLAY
} = {}) {
  const normalizedBaseline = validatePolicy({ ...baseline });
  const claims = new Map();
  const listeners = new Set();
  let nextTokenId = 1;
  let version = 0;

  function resolvePolicy() {
    if (claims.size === 0) {
      return freezeSnapshot(normalizedBaseline, { version, activeClaimCount: 0 });
    }

    let highestPriority = Number.NEGATIVE_INFINITY;
    for (const claim of claims.values()) highestPriority = Math.max(highestPriority, claim.policy.priority);

    const top = [...claims.values()].filter(claim => claim.policy.priority === highestPriority);
    let effective = top[0].policy;
    for (let i = 1; i < top.length; i += 1) effective = mergeSamePriority(effective, top[i].policy);

    return freezeSnapshot(effective, {
      topOwners: top.map(claim => claim.ownerId).sort(),
      activeClaimCount: claims.size,
      version
    });
  }

  let current = resolvePolicy();

  function publish() {
    version += 1;
    current = resolvePolicy();
    for (const listener of listeners) listener(current);
    return current;
  }

  function claim(ownerId, policy) {
    const normalizedOwnerId = validateOwnerId(ownerId);
    const normalizedPolicy = validatePolicy({ ...policy });
    const token = Object.freeze({ id: nextTokenId++, ownerId: normalizedOwnerId });
    claims.set(token, { ownerId: normalizedOwnerId, policy: normalizedPolicy });
    publish();
    return token;
  }

  function release(token) {
    if (!claims.delete(token)) return false;
    publish();
    return true;
  }

  function releaseOwner(ownerId) {
    const normalizedOwnerId = validateOwnerId(ownerId);
    let removed = 0;
    for (const [token, claim] of claims.entries()) {
      if (claim.ownerId !== normalizedOwnerId) continue;
      claims.delete(token);
      removed += 1;
    }
    if (removed > 0) publish();
    return removed;
  }

  function clear() {
    if (claims.size === 0) return false;
    claims.clear();
    publish();
    return true;
  }

  function snapshot() {
    return current;
  }

  function can(capability) {
    const key = CAPABILITY_KEY[String(capability ?? "").trim().toUpperCase()];
    if (!key) throw new TypeError(`Unknown input capability: ${capability}`);
    return current[key] === true;
  }

  function subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== "function") throw new TypeError("Input focus listener must be a function");
    listeners.add(listener);
    if (emitCurrent) listener(current);
    return () => listeners.delete(listener);
  }

  return Object.freeze({
    claim,
    release,
    releaseOwner,
    clear,
    snapshot,
    can,
    subscribe,
    get size() { return claims.size; }
  });
}
