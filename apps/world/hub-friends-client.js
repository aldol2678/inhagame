(() => {
  "use strict";

  const RPC = Object.freeze({
    LIST: "get_my_world_social",
    PROFILE: "get_world_public_profile",
    ACCEPT: "respond_world_friend_request",
    CANCEL: "cancel_world_friend_request",
    REMOVE: "remove_world_friend",
    BLOCK: "block_world_user",
    UNBLOCK: "unblock_world_user"
  });

  const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const AVATARS = new Set(["classic", "scholar", "explorer", "star"]);
  const RELATIONSHIPS = new Set(["none", "outgoing", "incoming", "friends", "blocked_by_me", "unavailable"]);
  const KNOWN_ERRORS = new Set([
    "NOT_ALLOWED", "TARGET_UNAVAILABLE", "PERMANENT_ACCOUNT_REQUIRED",
    "ACCOUNT_UNAVAILABLE", "SOCIAL_RESTRICTED"
  ]);

  const isUserId = (value) => typeof value === "string" && USER_ID.test(value);
  const clip = (value, max) => typeof value === "string" ? value.slice(0, max) : null;

  function friendErrorCode(error) {
    const message = typeof error?.message === "string" ? error.message.trim() : "";
    return KNOWN_ERRORS.has(message) ? message : "FAILED";
  }

  function parsePerson(raw) {
    if (!raw || typeof raw !== "object" || !isUserId(raw.userId)) return null;
    return Object.freeze({
      userId: raw.userId,
      nickname: clip(raw.nickname, 12) || "INHAGAME 사용자",
      title: clip(raw.title, 40),
      avatar: AVATARS.has(raw.avatar) ? raw.avatar : "classic",
      inhaVerified: raw.inhaVerified === true
    });
  }

  function parseProfile(raw) {
    if (!raw || typeof raw !== "object" || !isUserId(raw.userId) || !RELATIONSHIPS.has(raw.relationship)) return null;
    if (raw.available === false || raw.relationship === "unavailable") {
      return Object.freeze({
        userId: raw.userId,
        available: false,
        nickname: "이용할 수 없는 사용자",
        title: null,
        avatar: "classic",
        inhaVerified: false,
        relationship: "unavailable"
      });
    }
    const person = parsePerson(raw);
    if (!person) return null;
    return Object.freeze({ ...person, available: true, relationship: raw.relationship });
  }

  function parseList(raw) {
    if (!Array.isArray(raw)) return null;
    const list = raw.map(parsePerson);
    return list.every(Boolean) ? Object.freeze(list) : null;
  }

  function parseSocial(raw) {
    if (!raw || typeof raw !== "object") return null;
    const friends = parseList(raw.friends);
    const incoming = parseList(raw.incoming);
    const outgoing = parseList(raw.outgoing);
    const blocked = parseList(raw.blocked);
    if (!friends || !incoming || !outgoing || !blocked) return null;
    return Object.freeze({ friends, incoming, outgoing, blocked });
  }

  function createHubFriendsClient({ rpc } = {}) {
    if (typeof rpc !== "function") throw new Error("Hub friends client requires rpc");

    let accountId = null;
    let generation = 0;
    let snapshot = Object.freeze({ friends: [], incoming: [], outgoing: [], blocked: [] });

    const call = async (name, args) => {
      const result = await rpc(name, args);
      if (result?.error) throw result.error;
      return result?.data;
    };

    function setAccount(nextAccountId) {
      const next = isUserId(nextAccountId) ? nextAccountId : null;
      if (next === accountId) return false;
      accountId = next;
      generation += 1;
      snapshot = Object.freeze({ friends: [], incoming: [], outgoing: [], blocked: [] });
      return true;
    }

    async function profile(userId) {
      if (!accountId) return { outcome: "SIGNED_OUT" };
      if (!isUserId(userId) || userId === accountId) return { outcome: "FAILED", code: "TARGET_UNAVAILABLE" };
      const gen = generation;
      try {
        const parsed = parseProfile(await call(RPC.PROFILE, { p_target: userId }));
        if (!parsed || parsed.userId !== userId) throw new Error("INVALID_RESPONSE");
        if (gen !== generation) return { outcome: "STALE" };
        return { outcome: "READY", profile: parsed };
      } catch (error) {
        if (gen !== generation) return { outcome: "STALE" };
        return { outcome: "FAILED", code: friendErrorCode(error) };
      }
    }

    async function list() {
      if (!accountId) return { outcome: "SIGNED_OUT", snapshot };
      const gen = generation;
      try {
        const parsed = parseSocial(await call(RPC.LIST, {}));
        if (!parsed) throw new Error("INVALID_RESPONSE");
        if (gen !== generation) return { outcome: "STALE" };
        snapshot = parsed;
        return { outcome: "READY", snapshot };
      } catch (error) {
        if (gen !== generation) return { outcome: "STALE" };
        return { outcome: "FAILED", code: friendErrorCode(error), snapshot };
      }
    }

    async function mutate(name, args) {
      if (!accountId) return { outcome: "SIGNED_OUT", code: "PERMANENT_ACCOUNT_REQUIRED" };
      const gen = generation;
      try {
        const data = await call(name, args);
        if (gen !== generation) return { outcome: "STALE" };
        return { outcome: "SUCCESS", data };
      } catch (error) {
        if (gen !== generation) return { outcome: "STALE" };
        return { outcome: "FAILED", code: friendErrorCode(error) };
      }
    }

    function accept(userId, acceptRequest = true) {
      if (!isUserId(userId) || userId === accountId) return Promise.resolve({ outcome: "FAILED", code: "TARGET_UNAVAILABLE" });
      return mutate(RPC.ACCEPT, { p_target: userId, p_accept: acceptRequest === true });
    }

    function cancel(userId) {
      if (!isUserId(userId) || userId === accountId) return Promise.resolve({ outcome: "FAILED", code: "TARGET_UNAVAILABLE" });
      return mutate(RPC.CANCEL, { p_target: userId });
    }

    function remove(userId) {
      if (!isUserId(userId) || userId === accountId) return Promise.resolve({ outcome: "FAILED", code: "TARGET_UNAVAILABLE" });
      return mutate(RPC.REMOVE, { p_target: userId });
    }

    function block(userId) {
      if (!isUserId(userId) || userId === accountId) return Promise.resolve({ outcome: "FAILED", code: "TARGET_UNAVAILABLE" });
      return mutate(RPC.BLOCK, { p_target: userId });
    }

    function unblock(userId) {
      if (!isUserId(userId) || userId === accountId) return Promise.resolve({ outcome: "FAILED", code: "TARGET_UNAVAILABLE" });
      return mutate(RPC.UNBLOCK, { p_target: userId });
    }

    return Object.freeze({
      setAccount, list, profile, accept, reject: (userId) => accept(userId, false), cancel, remove, block, unblock,
      get accountId() { return accountId; },
      get snapshot() { return snapshot; }
    });
  }

  window.InhaHubFriendsClient = Object.freeze({
    RPC, isUserId, parsePerson, parseProfile, parseSocial, friendErrorCode, createHubFriendsClient
  });
})();
