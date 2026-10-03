// INHA WORLD Life Progression / Skill Tree client v1.
// Server-authoritative read + mutation adapter. The browser never derives eligibility, SP cost,
// refund value or target rank. It renders server snapshots and forwards self-only mutations.

export const LIFE_PROGRESSION_RPC = "get_my_world_life_progression_v1";
export const LIFE_TREE_RPC = "get_my_world_life_skill_tree_v1";
export const LIFE_RANK_UP_RPC = "rank_up_my_world_life_skill_node_v1";
export const LIFE_RESET_RPC = "reset_my_world_life_skill_tree_v1";

export const LIFE_PROGRESSION_STATE = Object.freeze({
  SIGNED_OUT: "SIGNED_OUT",
  LOADING: "LOADING",
  READY: "READY",
  UNAVAILABLE: "UNAVAILABLE"
});

export const LIFE_ERROR_CODES = Object.freeze([
  "PERMANENT_ACCOUNT_REQUIRED", "ACCOUNT_UNAVAILABLE",
  "INVALID_LIFE_SKILL_NODE", "INVALID_LIFE_SKILL_TREE", "INVALID_IDEMPOTENCY_KEY",
  "LIFE_SKILL_NODE_NOT_FOUND", "LIFE_SKILL_TREE_NOT_FOUND", "LIFE_SKILL_NODE_INACTIVE",
  "LIFE_LEVEL_REQUIRED", "LIFE_SKILL_LEVEL_REQUIRED", "LIFE_SKILL_PREREQUISITE_REQUIRED",
  "INSUFFICIENT_LIFE_SKILL_POINTS", "LIFE_SKILL_NODE_MAX_RANK", "IDEMPOTENCY_CONFLICT"
]);
const KNOWN_ERRORS = new Set(LIFE_ERROR_CODES);

const isInt = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const isText = (value, max = 180) => typeof value === "string" && value.length > 0 && value.length <= max;
const optionalText = (value, max) => value === null || value === undefined || isText(value, max);

export function lifeErrorCode(error) {
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  return KNOWN_ERRORS.has(message) ? message : "FAILED";
}

export function parseLifeTreeSummary(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { treeId, skillId, status, definitionVersion, nodeCount, spentPoints } = raw;
  if (!isText(treeId, 100) || !treeId.startsWith("life_tree.") || !isText(status, 32)) return null;
  if (!optionalText(skillId, 80) || !isInt(definitionVersion, 1) || !isInt(nodeCount) || !isInt(spentPoints)) return null;
  return Object.freeze({ treeId, skillId: skillId ?? null, status, definitionVersion, nodeCount, spentPoints });
}

export function parseLifeProgressionSnapshot(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.trees)) return null;
  const {
    curveId,totalXp,level,version,currentLevelStartXp,nextLevelXp,progressXp,progressRequired,
    maxDefinedLevel,isMaxLevel,skillPointsEarned,skillPointsSpent,skillPointsBalance
  } = raw;
  if (!isText(curveId, 80) || !isInt(totalXp) || !isInt(level,1) || !isInt(version)) return null;
  if (!isInt(currentLevelStartXp) || !isInt(progressXp) || !isInt(maxDefinedLevel,1) || typeof isMaxLevel !== "boolean") return null;
  if (!isInt(skillPointsEarned) || !isInt(skillPointsSpent) || !isInt(skillPointsBalance)) return null;
  if (isMaxLevel) {
    if (nextLevelXp !== null || progressRequired !== null) return null;
  } else if (!isInt(nextLevelXp) || !isInt(progressRequired,1)) return null;
  const trees = raw.trees.map(parseLifeTreeSummary);
  if (trees.some((tree) => !tree) || new Set(trees.map((tree) => tree.treeId)).size !== trees.length) return null;
  return Object.freeze({
    curveId,totalXp,level,version,currentLevelStartXp,nextLevelXp,progressXp,progressRequired,
    maxDefinedLevel,isMaxLevel,skillPointsEarned,skillPointsSpent,skillPointsBalance,
    trees:Object.freeze(trees)
  });
}

export function parseLifePrerequisite(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { nodeId, requiredRank, currentRank } = raw;
  if (!isText(nodeId,140) || !isInt(requiredRank,1) || !isInt(currentRank)) return null;
  return Object.freeze({ nodeId, requiredRank, currentRank });
}

export function parseLifeTreeNode(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.prerequisites)) return null;
  const {
    nodeId,treeId,maxRank,pointCost,requiredLifeLevel,requiredSkillId,requiredSkillLevel,
    effectKey,status,definitionVersion,rank,canRankUp,unavailableReason
  } = raw;
  if (!isText(nodeId,140) || !isText(treeId,100) || !isInt(maxRank,1) || !isInt(pointCost,1)) return null;
  if (!isInt(requiredLifeLevel,1) || !optionalText(requiredSkillId,80)) return null;
  if (!(requiredSkillLevel === null || requiredSkillLevel === undefined || isInt(requiredSkillLevel,1))) return null;
  if (!isText(effectKey,160) || !isText(status,32) || !isInt(definitionVersion,1) || !isInt(rank)) return null;
  if (rank > maxRank || typeof canRankUp !== "boolean" || !optionalText(unavailableReason,80)) return null;
  const prerequisites = raw.prerequisites.map(parseLifePrerequisite);
  if (prerequisites.some((entry) => !entry)) return null;
  return Object.freeze({
    nodeId,treeId,maxRank,pointCost,requiredLifeLevel,
    requiredSkillId:requiredSkillId ?? null,requiredSkillLevel:requiredSkillLevel ?? null,
    effectKey,status,definitionVersion,rank,canRankUp,
    unavailableReason:unavailableReason ?? null,prerequisites:Object.freeze(prerequisites)
  });
}

export function parseLifeTreeSnapshot(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.nodes)) return null;
  const { treeId,skillId,status,definitionVersion,spentPoints,nodeCount,canReset } = raw;
  if (!isText(treeId,100) || !optionalText(skillId,80) || !isText(status,32)) return null;
  if (!isInt(definitionVersion,1) || !isInt(spentPoints) || !isInt(nodeCount) || typeof canReset !== "boolean") return null;
  const nodes = raw.nodes.map(parseLifeTreeNode);
  if (nodes.some((node) => !node) || nodes.length !== nodeCount) return null;
  if (nodes.some((node) => node.treeId !== treeId) || new Set(nodes.map((node) => node.nodeId)).size !== nodes.length) return null;
  return Object.freeze({
    treeId,skillId:skillId ?? null,status,definitionVersion,spentPoints,nodeCount,canReset,
    nodes:Object.freeze(nodes)
  });
}

const defaultKey = (kind) => `life:${kind}:${globalThis.crypto.randomUUID()}`;

export function createLifeProgressionClient({ getClient, createKey = defaultKey } = {}) {
  if (typeof getClient !== "function") throw new Error("Life progression client requires getClient");

  let accountId = null;
  let generation = 0;
  let state = LIFE_PROGRESSION_STATE.SIGNED_OUT;
  let progression = null;
  let tree = null;
  let selectedTreeId = null;
  let inFlight = null;
  let rerun = false;
  const listeners = new Set();
  const pending = new Set();
  const unresolvedKeys = new Map();

  function publish(reason) {
    const change = { state, progression, tree, selectedTreeId, accountId, reason, pending:new Set(pending) };
    for (const listener of listeners) {
      try { listener(change); } catch (error) { console.warn("Life progression listener failed:", error); }
    }
  }
  function set(nextState, nextProgression, nextTree, reason) {
    state = nextState;
    progression = nextProgression;
    tree = nextTree;
    publish(reason);
  }
  function chooseTree(snapshot) {
    if (!snapshot?.trees.length) return null;
    if (selectedTreeId && snapshot.trees.some((entry) => entry.treeId === selectedTreeId)) return selectedTreeId;
    return snapshot.trees.find((entry) => entry.status === "ACTIVE")?.treeId ?? snapshot.trees[0].treeId;
  }

  async function fetchOnce(reason) {
    const gen = generation;
    const account = accountId;
    const client = getClient();
    if (!account || !client?.rpc) {
      if (gen === generation) {
        selectedTreeId = null;
        set(LIFE_PROGRESSION_STATE.SIGNED_OUT,null,null,reason);
      }
      return;
    }
    try {
      const read = await client.rpc(LIFE_PROGRESSION_RPC);
      if (read.error) throw read.error;
      const nextProgression = parseLifeProgressionSnapshot(read.data);
      if (!nextProgression) throw new Error("MALFORMED_LIFE_PROGRESSION");
      const nextTreeId = chooseTree(nextProgression);
      let nextTree = null;
      if (nextTreeId) {
        const detail = await client.rpc(LIFE_TREE_RPC,{ p_tree_id:nextTreeId });
        if (detail.error) throw detail.error;
        nextTree = parseLifeTreeSnapshot(detail.data);
        if (!nextTree || nextTree.treeId !== nextTreeId) throw new Error("MALFORMED_LIFE_TREE");
      }
      if (gen !== generation || account !== accountId) return;
      selectedTreeId = nextTreeId;
      set(LIFE_PROGRESSION_STATE.READY,nextProgression,nextTree,reason);
    } catch (error) {
      console.warn("World Life progression unavailable:", lifeErrorCode(error));
      if (gen !== generation || account !== accountId) return;
      set(LIFE_PROGRESSION_STATE.UNAVAILABLE,null,null,reason);
    }
  }

  function refresh(reason="refresh") {
    if (!accountId) return Promise.resolve(false);
    if (inFlight) { rerun = true; return inFlight; }
    const gen = generation;
    const run = (async () => {
      try {
        do {
          rerun = false;
          await fetchOnce(reason);
        } while (rerun && gen === generation);
      } finally {
        if (inFlight === run) inFlight = null;
      }
      return gen === generation && state === LIFE_PROGRESSION_STATE.READY;
    })();
    inFlight = run;
    return run;
  }

  async function selectTree(treeId) {
    if (!isText(treeId,100)) return false;
    selectedTreeId = treeId;
    if (!accountId) return false;
    return refresh("select-tree");
  }

  function setAccount(nextAccountId) {
    const next = typeof nextAccountId === "string" && nextAccountId ? nextAccountId : null;
    if (next === accountId) return Promise.resolve(state === LIFE_PROGRESSION_STATE.READY);
    generation += 1;
    accountId = next;
    progression = null;
    tree = null;
    selectedTreeId = null;
    pending.clear();
    unresolvedKeys.clear();
    inFlight = null;
    rerun = false;
    if (!next) {
      set(LIFE_PROGRESSION_STATE.SIGNED_OUT,null,null,"account");
      return Promise.resolve(false);
    }
    set(LIFE_PROGRESSION_STATE.LOADING,null,null,"account");
    return refresh("account");
  }

  async function mutate(kind,targetId,rpc,args) {
    const gen = generation;
    const account = accountId;
    const client = getClient();
    if (!account || !client?.rpc) return { outcome:"SIGNED_OUT",code:"PERMANENT_ACCOUNT_REQUIRED" };
    const op = `${kind}:${targetId}`;
    if (pending.has(op)) return { outcome:"FAILED",code:"BUSY" };
    const key = unresolvedKeys.get(op) ?? createKey(kind);
    unresolvedKeys.set(op,key);
    pending.add(op);
    publish(kind);
    let response;
    try {
      const { data,error } = await client.rpc(rpc,{ ...args,p_idempotency_key:key });
      if (error) {
        const code = lifeErrorCode(error);
        if (code !== "FAILED") unresolvedKeys.delete(op);
        response = { outcome:code === "FAILED" ? "FAILED" : "REFUSED",code };
      } else if (data?.status === "SUCCESS" || data?.status === "ALREADY_PROCESSED") {
        unresolvedKeys.delete(op);
        response = { outcome:"SUCCESS",code:null,result:data };
      } else {
        response = { outcome:"FAILED",code:"FAILED" };
      }
    } catch (error) {
      response = { outcome:"FAILED",code:lifeErrorCode(error) };
    }
    if (gen !== generation || account !== accountId) return { outcome:"STALE",code:null };
    pending.delete(op);
    publish(kind);
    if (response.outcome === "SUCCESS" || response.outcome === "REFUSED") await refresh(kind);
    return response;
  }

  return {
    setAccount,refresh,selectTree,
    rankUp:(nodeId) => mutate("rank-up",nodeId,LIFE_RANK_UP_RPC,{ p_node_id:nodeId }),
    resetTree:(treeId) => mutate("reset",treeId,LIFE_RESET_RPC,{ p_tree_id:treeId }),
    get state(){ return state; },
    get progression(){ return progression; },
    get tree(){ return tree; },
    get selectedTreeId(){ return selectedTreeId; },
    get accountId(){ return accountId; },
    isPending:(kind,targetId) => pending.has(`${kind}:${targetId}`),
    onChange(listener){ listeners.add(listener); return () => listeners.delete(listener); },
    status(){ return { state,accountBound:accountId!==null,selectedTreeId,treeStatus:tree?.status ?? null }; }
  };
}
