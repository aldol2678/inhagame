// INHA WORLD · Life Skill Book client (P0).
// The server owns every Life Skill outcome: visible skills, levels, XP, the per-skill SP pool, node
// ranks, unlockability, costs and the free reset with its cooldown. This module only reads the
// caller's own views and, when the player presses a button, sends a node id / skill id with a request
// id. It never computes a cost, a level gate or whether a node can be unlocked: it renders the
// server's canUnlock / lockReason / canReset.
//
// A request id is reused when the previous attempt for the same action died in transport, so a lost
// response replays the committed result instead of spending twice. Account-scoped like the other
// member clients: every account change bumps a generation and drops responses from an older one.

export const LIFE_SKILL_BOOK_RPC = Object.freeze({
  LIST: "get_my_world_life_skills_v1",
  TREE: "get_my_world_life_skill_tree_v1",
  UNLOCK: "unlock_my_world_life_node_v1",
  RESET: "reset_my_world_life_tree_v1"
});

export const LIFE_SKILL_BOOK_STATE = Object.freeze({
  SIGNED_OUT: "SIGNED_OUT",
  LOADING: "LOADING",
  READY: "READY",
  UNAVAILABLE: "UNAVAILABLE"
});

export const LIFE_LOCK_REASONS = Object.freeze(["MAX_RANK", "PREREQUISITE", "LIFE_LEVEL", "SKILL_LEVEL", "SP"]);
export const LIFE_RESET_BLOCKERS = Object.freeze(["EMPTY", "COOLDOWN"]);

const SKILL_ID = /^life\.[a-z][a-z0-9_]*$/;
const NODE_ID = /^life\.node\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isLevel = (value) => Number.isSafeInteger(value) && value >= 1;
const isTime = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));

/** Server skill view → frozen view, or null when it is not the documented contract. */
export function parseLifeSkillView(raw) {
  if (!raw || typeof raw !== "object" || !SKILL_ID.test(raw.skillId ?? "")) return null;
  if (!isLevel(raw.level) || !isCount(raw.totalXp) || !isCount(raw.currentLevelStartXp)) return null;
  if (raw.nextLevelXp !== null && !(isCount(raw.nextLevelXp) && raw.nextLevelXp > raw.currentLevelStartXp)) return null;
  if (!isLevel(raw.maxDefinedLevel) || typeof raw.isMaxLevel !== "boolean" || raw.isMaxLevel !== (raw.nextLevelXp === null)) return null;
  if (raw.totalXp < raw.currentLevelStartXp) return null;
  const sp = raw.sp;
  if (!sp || !isCount(sp.earned) || !isCount(sp.spent) || !isCount(sp.available) || sp.available !== sp.earned - sp.spent) return null;
  if (sp.nextLevelEarned !== null && !isCount(sp.nextLevelEarned)) return null;
  return Object.freeze({
    skillId: raw.skillId,
    level: raw.level,
    totalXp: raw.totalXp,
    currentLevelStartXp: raw.currentLevelStartXp,
    nextLevelXp: raw.nextLevelXp,
    maxDefinedLevel: raw.maxDefinedLevel,
    isMaxLevel: raw.isMaxLevel,
    sp: Object.freeze({ earned: sp.earned, spent: sp.spent, available: sp.available, nextLevelEarned: sp.nextLevelEarned })
  });
}

export function parseLifeSkillList(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.skills)) return null;
  const life = raw.lifeLevel;
  if (!life || !isLevel(life.level) || !isCount(life.totalSkillXp)) return null;
  const skills = [];
  for (const entry of raw.skills) {
    const skill = parseLifeSkillView(entry);
    if (!skill || skills.some(s => s.skillId === skill.skillId)) return null;
    skills.push(skill);
  }
  return Object.freeze({
    lifeLevel: Object.freeze({ level: life.level, totalSkillXp: life.totalSkillXp }),
    skills: Object.freeze(skills)
  });
}

function parseNode(raw) {
  if (!raw || typeof raw !== "object" || !NODE_ID.test(raw.nodeId ?? "")) return null;
  if (!isCount(raw.rank) || !isLevel(raw.maxRank) || raw.rank > raw.maxRank || !isLevel(raw.requiredSkillLevel)) return null;
  if (raw.rank >= raw.maxRank ? raw.nextRankCost !== null : !isLevel(raw.nextRankCost)) return null;
  if (typeof raw.canUnlock !== "boolean") return null;
  if (raw.canUnlock ? raw.lockReason !== null : !LIFE_LOCK_REASONS.includes(raw.lockReason)) return null;
  if (!Array.isArray(raw.prerequisites)) return null;
  const prerequisites = [];
  for (const p of raw.prerequisites) {
    if (!p || !NODE_ID.test(p.nodeId ?? "") || !isLevel(p.requiredRank) ||
        typeof p.visible !== "boolean" || typeof p.met !== "boolean") return null;
    prerequisites.push(Object.freeze({ nodeId: p.nodeId, requiredRank: p.requiredRank, visible: p.visible, met: p.met }));
  }
  return Object.freeze({
    nodeId: raw.nodeId,
    rank: raw.rank,
    maxRank: raw.maxRank,
    nextRankCost: raw.nextRankCost,
    requiredSkillLevel: raw.requiredSkillLevel,
    prerequisites: Object.freeze(prerequisites),
    canUnlock: raw.canUnlock,
    lockReason: raw.lockReason
  });
}

/** Server tree view → frozen view, or null. */
export function parseLifeSkillTree(raw) {
  if (!raw || typeof raw !== "object") return null;
  const skill = parseLifeSkillView(raw.skill);
  const reset = raw.reset;
  if (!skill || !reset || reset.cost !== 0 || !isCount(reset.cooldownSeconds)) return null;
  if (reset.lastResetAt !== null && !isTime(reset.lastResetAt)) return null;
  if (reset.nextResetAt !== null && !isTime(reset.nextResetAt)) return null;
  if (typeof reset.canReset !== "boolean") return null;
  if (reset.canReset ? reset.resetBlockedBy !== null : !LIFE_RESET_BLOCKERS.includes(reset.resetBlockedBy)) return null;
  if (!Array.isArray(raw.nodes)) return null;
  const nodes = [];
  for (const entry of raw.nodes) {
    const node = parseNode(entry);
    if (!node || nodes.some(n => n.nodeId === node.nodeId)) return null;
    nodes.push(node);
  }
  return Object.freeze({
    skill,
    reset: Object.freeze({
      cost: 0,
      cooldownSeconds: reset.cooldownSeconds,
      lastResetAt: reset.lastResetAt,
      nextResetAt: reset.nextResetAt,
      canReset: reset.canReset,
      resetBlockedBy: reset.resetBlockedBy
    }),
    nodes: Object.freeze(nodes)
  });
}

const KNOWN_CODES = [
  "LIFE_NODE_MAX_RANK", "LIFE_NODE_PREREQUISITE_LOCKED", "LIFE_LEVEL_REQUIRED", "LIFE_SKILL_LEVEL_REQUIRED",
  "LIFE_SP_INSUFFICIENT", "LIFE_TREE_RESET_EMPTY", "LIFE_TREE_RESET_COOLDOWN", "LIFE_SKILL_NOT_FOUND",
  "LIFE_NODE_NOT_FOUND", "IDEMPOTENCY_CONFLICT", "PERMANENT_ACCOUNT_REQUIRED", "ACCOUNT_UNAVAILABLE"
];
/** A server refusal code, or null for a transport / unknown failure (the request may have committed). */
export function lifeSkillBookErrorCode(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""}`;
  return KNOWN_CODES.find(code => text.includes(code)) ?? null;
}

/**
 * @param {{ getClient: () => ({ rpc: Function } | null), requestIdFactory?: () => string | null }} options
 */
export function createLifeSkillBookClient({
  getClient,
  requestIdFactory = () => globalThis.crypto?.randomUUID?.() ?? null
} = {}) {
  if (typeof getClient !== "function") throw new Error("Life Skill Book client requires getClient");

  let accountId = null;
  let generation = 0;
  let state = LIFE_SKILL_BOOK_STATE.SIGNED_OUT;
  let book = null;
  let tree = null;
  let treeState = null;
  let treeReading = null;
  let selectedSkillId = null;
  let pending = null;
  // { kind, target, requestId } of an attempt whose outcome is unknown (transport failure).
  let unsettled = null;
  let reading = null;
  const listeners = new Set();

  function emit(reason) {
    const change = { state, book, tree, treeState, selectedSkillId, accountId, reason, pending: pending !== null };
    for (const listener of listeners) {
      try { listener(change); } catch (error) { console.warn("Life Skill Book listener failed:", error); }
    }
  }

  async function call(rpc, args) {
    const client = getClient();
    if (!client?.rpc) return { error: { message: "SIGNED_OUT" } };
    try {
      return args === undefined ? await client.rpc(rpc) : await client.rpc(rpc, args);
    } catch (error) {
      return { error };
    }
  }

  function dropTree() {
    treeReading = null;
    tree = null;
    treeState = null;
  }

  function loadTree(skillId, gen, reason, fresh = false) {
    if (!fresh && treeReading?.skillId === skillId) return treeReading.run;
    const token = { skillId, run: null };
    treeReading = token;
    tree = null;
    treeState = LIFE_SKILL_BOOK_STATE.LOADING;
    token.run = (async () => {
      const { data, error } = await call(LIFE_SKILL_BOOK_RPC.TREE, { p_skill_id: skillId });
      // The token also rejects an old response after leaving and returning to the same skill.
      if (gen !== generation || selectedSkillId !== skillId || treeReading !== token) return false;
      const next = error ? null : parseLifeSkillTree(data);
      tree = next?.skill.skillId === skillId ? next : null;
      treeState = tree ? LIFE_SKILL_BOOK_STATE.READY : LIFE_SKILL_BOOK_STATE.UNAVAILABLE;
      treeReading = null;
      emit(reason);
      return tree !== null;
    })();
    emit(reason);
    return token.run;
  }

  /** Re-reads the list (and the selected tree, if it is still visible). */
  function refresh(reason = "refresh") {
    if (!accountId) return Promise.resolve(false);
    if (reading) return reading;
    const gen = generation;
    const run = (async () => {
      try {
        const { data, error } = await call(LIFE_SKILL_BOOK_RPC.LIST);
        if (gen !== generation) return false;
        const next = error ? null : parseLifeSkillList(data);
        if (error) console.warn("Life Skill Book unavailable:", error?.message ?? error);
        if (!next) {
          state = LIFE_SKILL_BOOK_STATE.UNAVAILABLE;
          book = null;
          dropTree();
          emit(reason);
          return false;
        }
        state = LIFE_SKILL_BOOK_STATE.READY;
        book = next;
        if (selectedSkillId && !next.skills.some(s => s.skillId === selectedSkillId)) {
          selectedSkillId = null;
          dropTree();
        }
        // A recovery refresh must observe after the action, not reuse a pre-action tree read.
        if (selectedSkillId) await loadTree(selectedSkillId, gen, reason, true);
        if (gen !== generation) return false;
        emit(reason);
        return true;
      } finally {
        if (reading === run) reading = null;
      }
    })();
    reading = run;
    return run;
  }

  /** Opens one visible skill's tree. Only skills the server listed can be selected. */
  function selectSkill(skillId) {
    if (!book || !book.skills.some(s => s.skillId === skillId)) return Promise.resolve(false);
    selectedSkillId = skillId;
    return loadTree(skillId, generation, "select");
  }

  function clearSelection() {
    selectedSkillId = null;
    dropTree();
    emit("select");
  }

  function requestIdFor(kind, target) {
    if (unsettled && unsettled.kind === kind && unsettled.target === target) return unsettled.requestId;
    const id = requestIdFactory();
    return typeof id === "string" && UUID.test(id) ? id : null;
  }

  async function act(kind, target, rpc, args) {
    if (!accountId || !getClient()?.rpc) return { outcome: "SIGNED_OUT" };
    if (pending) return { outcome: "BUSY" };
    const requestId = requestIdFor(kind, target);
    if (!requestId) return { outcome: "FAILED", code: "REQUEST_ID_UNAVAILABLE" };
    const gen = generation;
    const token = {};
    pending = token;
    emit(kind);
    try {
      const { data, error } = await call(rpc, { ...args, p_request_id: requestId });
      if (gen !== generation) return { outcome: "STALE" };
      if (error) {
        const code = lifeSkillBookErrorCode(error);
        // Unknown outcome: keep the request id so a retry replays instead of acting twice.
        unsettled = code ? null : { kind, target, requestId };
        pending = null;
        void refresh(kind);
        return { outcome: code ? "REFUSED" : "FAILED", code: code ?? "FAILED" };
      }
      unsettled = null;
      const next = parseLifeSkillTree(data?.tree);
      const status = data?.status;
      if (!next || (status !== "SUCCESS" && status !== "ALREADY_PROCESSED")) {
        pending = null;
        void refresh(kind);
        return { outcome: "FAILED", code: "MALFORMED_RESPONSE" };
      }
      pending = null;
      if (selectedSkillId === next.skill.skillId) {
        treeReading = null;
        tree = next;
        treeState = LIFE_SKILL_BOOK_STATE.READY;
      }
      if (book) {
        book = Object.freeze({
          ...book,
          skills: Object.freeze(book.skills.map(s => (s.skillId === next.skill.skillId ? next.skill : s)))
        });
      }
      emit(kind);
      return { outcome: status === "SUCCESS" ? "DONE" : "REPLAYED", tree: next, data };
    } finally {
      if (pending === token) {
        pending = null;
        if (gen === generation) emit(kind);
      }
    }
  }

  /** "익히기 / 랭크 업": the server picks the next rank, cost and gates. */
  function unlockNode(nodeId) {
    if (!NODE_ID.test(nodeId ?? "")) return Promise.resolve({ outcome: "FAILED", code: "INVALID_NODE" });
    return act("unlock", nodeId, LIFE_SKILL_BOOK_RPC.UNLOCK, { p_node_id: nodeId });
  }

  /** "트리 초기화 (무료)": the server checks the cooldown and refunds exactly. */
  function resetTree(skillId) {
    if (!SKILL_ID.test(skillId ?? "")) return Promise.resolve({ outcome: "FAILED", code: "INVALID_SKILL" });
    return act("reset", skillId, LIFE_SKILL_BOOK_RPC.RESET, { p_skill_id: skillId });
  }

  /** Account boundary. Same id is a no-op; any change drops the old views and in-flight responses. */
  function setAccount(nextAccountId) {
    const next = typeof nextAccountId === "string" && nextAccountId ? nextAccountId : null;
    if (next === accountId) return Promise.resolve(state === LIFE_SKILL_BOOK_STATE.READY);
    generation += 1;
    accountId = next;
    pending = null;
    unsettled = null;
    reading = null;
    book = null;
    dropTree();
    selectedSkillId = null;
    if (!next) {
      state = LIFE_SKILL_BOOK_STATE.SIGNED_OUT;
      emit("account");
      return Promise.resolve(false);
    }
    state = LIFE_SKILL_BOOK_STATE.LOADING;
    emit("account");
    return refresh("account");
  }

  return {
    setAccount,
    refresh,
    selectSkill,
    clearSelection,
    unlockNode,
    resetTree,
    get state() { return state; },
    get book() { return book; },
    get tree() { return tree; },
    get treeState() { return treeState; },
    get selectedSkillId() { return selectedSkillId; },
    get accountId() { return accountId; },
    get pending() { return pending !== null; },
    /** True only when the server lists at least one visible (ACTIVE) skill for this account. */
    get hasVisibleSkills() { return (book?.skills.length ?? 0) > 0; },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status() {
      return { state, accountBound: accountId !== null, visibleSkills: book?.skills.length ?? 0,
        selectedSkillId, treeState, pending: pending !== null };
    }
  };
}
