(() => {
  "use strict";

  const RPC = Object.freeze({
    LIST: "get_my_hub_conversations_v1",
    THREAD: "get_hub_messages_v1",
    SEND: "send_hub_message_v1",
    READ: "mark_hub_conversation_read_v1",
    UNREAD: "get_my_hub_unread_count_v1",
    ARCHIVE: "archive_hub_conversation_v1",
    REPORT: "report_hub_message_v1",
    BLOCK: "block_world_user",
    PROFILE: "get_world_public_profile"
  });

  const KNOWN_ERRORS = new Set([
    "PERMANENT_ACCOUNT_REQUIRED", "ACCOUNT_UNAVAILABLE", "SOCIAL_RESTRICTED",
    "TARGET_UNAVAILABLE", "INHA_VERIFICATION_REQUIRED", "INVALID_MESSAGE",
    "NOT_ALLOWED", "RATE_LIMITED", "CONVERSATION_UNAVAILABLE",
    "MESSAGE_UNAVAILABLE", "CANNOT_REPORT_SELF", "INVALID_CATEGORY"
  ]);

  const isText = (value, max = 200) =>
    typeof value === "string" && value.length > 0 && value.length <= max;
  const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
  const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isUserId = (value) => typeof value === "string" && USER_ID.test(value);
  const RELATIONSHIPS = new Set(["none", "outgoing", "incoming", "friends", "blocked_by_me", "unavailable"]);

  function messageErrorCode(error) {
    const message = typeof error?.message === "string" ? error.message.trim() : "";
    return KNOWN_ERRORS.has(message) ? message : "FAILED";
  }

  function parseCard(raw) {
    if (!raw || typeof raw !== "object" || !isText(raw.userId, 80)) return null;
    if (raw.available === false) {
      return Object.freeze({ userId: raw.userId, available: false, nickname: "이용할 수 없는 사용자",
        title: null, avatar: null, inhaVerified: false });
    }
    if (!isText(raw.nickname, 60)) return null;
    return Object.freeze({
      userId: raw.userId,
      available: true,
      nickname: raw.nickname,
      title: typeof raw.title === "string" && raw.title.length <= 80 ? raw.title : null,
      avatar: typeof raw.avatar === "string" && raw.avatar.length <= 80 ? raw.avatar : null,
      inhaVerified: raw.inhaVerified === true
    });
  }

  function parseRecipient(raw) {
    if (!isUserId(raw?.userId) || !RELATIONSHIPS.has(raw?.relationship)) return null;
    const card = parseCard(raw);
    if (!card) return null;
    return Object.freeze({ ...card, relationship: raw.relationship });
  }

  function parseMessage(raw) {
    if (!raw || typeof raw !== "object" || !isText(raw.id, 80) ||
        !isText(raw.senderId, 80) || !isText(raw.createdAt, 80) ||
        typeof raw.deleted !== "boolean") return null;
    if (!raw.deleted && (typeof raw.body !== "string" || raw.body.length < 1 || raw.body.length > 1000)) return null;
    return Object.freeze({
      id: raw.id,
      senderId: raw.senderId,
      body: raw.deleted ? null : raw.body,
      deleted: raw.deleted,
      createdAt: raw.createdAt
    });
  }

  function parseConversation(raw) {
    if (!raw || typeof raw !== "object" || !isText(raw.conversationId, 80) ||
        !isText(raw.updatedAt, 80) || !isCount(raw.unreadCount)) return null;
    const other = parseCard(raw.other);
    if (!other) return null;
    const lastMessage = raw.lastMessage == null ? null : parseMessage(raw.lastMessage);
    if (raw.lastMessage != null && !lastMessage) return null;
    return Object.freeze({
      conversationId: raw.conversationId,
      other,
      updatedAt: raw.updatedAt,
      unreadCount: raw.unreadCount,
      blockedByMe: raw.blockedByMe === true,
      lastMessage
    });
  }

  function parseConversationList(raw) {
    if (!Array.isArray(raw)) return null;
    const parsed = raw.map(parseConversation);
    return parsed.every(Boolean) ? Object.freeze(parsed) : null;
  }

  function parseThread(raw, conversationId) {
    if (!raw || typeof raw !== "object" || raw.conversationId !== conversationId ||
        !Array.isArray(raw.messages)) return null;
    const messages = raw.messages.map(parseMessage);
    return messages.every(Boolean) ? Object.freeze({ conversationId, messages: Object.freeze(messages) }) : null;
  }

  function createHubMessagesClient({ rpc } = {}) {
    if (typeof rpc !== "function") throw new Error("Hub messages client requires rpc");

    let accountId = null;
    let generation = 0;
    let conversations = Object.freeze([]);
    let unreadCount = 0;

    const call = async (name, args) => {
      const result = await rpc(name, args);
      if (result?.error) throw result.error;
      return result?.data;
    };

    function setAccount(nextAccountId) {
      const next = isText(nextAccountId, 80) ? nextAccountId : null;
      if (next === accountId) return false;
      accountId = next;
      generation += 1;
      conversations = Object.freeze([]);
      unreadCount = 0;
      return true;
    }

    async function list(limit = 50) {
      if (!accountId) return { outcome: "SIGNED_OUT", conversations: [], unreadCount: 0 };
      const gen = generation;
      try {
        const data = await call(RPC.LIST, { p_limit: Math.max(1, Math.min(Number(limit) || 50, 100)) });
        const parsed = parseConversationList(data);
        if (!parsed) throw new Error("INVALID_RESPONSE");
        if (gen !== generation) return { outcome: "STALE" };
        conversations = parsed;
        unreadCount = parsed.reduce((sum, item) => sum + item.unreadCount, 0);
        return { outcome: "READY", conversations, unreadCount };
      } catch (error) {
        if (gen !== generation) return { outcome: "STALE" };
        return { outcome: "FAILED", code: messageErrorCode(error), conversations: [], unreadCount };
      }
    }

    async function refreshUnread() {
      if (!accountId) return { outcome: "SIGNED_OUT", unreadCount: 0 };
      const gen = generation;
      try {
        const data = await call(RPC.UNREAD, {});
        const next = Number(data);
        if (!isCount(next)) throw new Error("INVALID_RESPONSE");
        if (gen !== generation) return { outcome: "STALE" };
        unreadCount = next;
        return { outcome: "READY", unreadCount };
      } catch (error) {
        if (gen !== generation) return { outcome: "STALE" };
        return { outcome: "FAILED", code: messageErrorCode(error), unreadCount };
      }
    }

    async function recipient(userId) {
      if (!accountId) return { outcome: "SIGNED_OUT" };
      if (!isUserId(userId) || userId === accountId) return { outcome: "FAILED", code: "TARGET_UNAVAILABLE" };
      const gen = generation;
      try {
        const data = await call(RPC.PROFILE, { p_target: userId });
        const parsed = parseRecipient(data);
        if (!parsed || parsed.userId !== userId) throw new Error("INVALID_RESPONSE");
        if (gen !== generation) return { outcome: "STALE" };
        return { outcome: "READY", recipient: parsed };
      } catch (error) {
        if (gen !== generation) return { outcome: "STALE" };
        return { outcome: "FAILED", code: messageErrorCode(error) };
      }
    }

    async function thread(conversationId, limit = 50, before = null) {
      if (!accountId) return { outcome: "SIGNED_OUT" };
      if (!isText(conversationId, 80)) return { outcome: "FAILED", code: "INVALID" };
      const gen = generation;
      try {
        const data = await call(RPC.THREAD, {
          p_conversation: conversationId,
          p_limit: Math.max(1, Math.min(Number(limit) || 50, 100)),
          p_before: typeof before === "string" ? before : null
        });
        const parsed = parseThread(data, conversationId);
        if (!parsed) throw new Error("INVALID_RESPONSE");
        if (gen !== generation) return { outcome: "STALE" };
        return { outcome: "READY", thread: parsed };
      } catch (error) {
        if (gen !== generation) return { outcome: "STALE" };
        return { outcome: "FAILED", code: messageErrorCode(error) };
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
        return { outcome: "FAILED", code: messageErrorCode(error) };
      }
    }

    async function send(recipientId, body) {
      const trimmed = typeof body === "string" ? body.trim() : "";
      if (!isText(recipientId, 80) || trimmed.length < 1 || trimmed.length > 1000) {
        return { outcome: "FAILED", code: "INVALID_MESSAGE" };
      }
      return mutate(RPC.SEND, { p_recipient: recipientId, p_body: trimmed });
    }

    async function markRead(conversationId) {
      const result = await mutate(RPC.READ, { p_conversation: conversationId });
      if (result.outcome === "SUCCESS") {
        conversations = Object.freeze(conversations.map((item) =>
          item.conversationId === conversationId
            ? Object.freeze({ ...item, unreadCount: 0 })
            : item));
        unreadCount = conversations.reduce((sum, item) => sum + item.unreadCount, 0);
      }
      return result;
    }

    async function archive(conversationId) {
      return mutate(RPC.ARCHIVE, { p_conversation: conversationId, p_archived: true });
    }

    async function block(userId) {
      return mutate(RPC.BLOCK, { p_target: userId });
    }

    async function report(messageId, category) {
      if (!["spam", "harassment", "inappropriate_content", "impersonation", "other"].includes(category)) {
        return { outcome: "FAILED", code: "INVALID_CATEGORY" };
      }
      return mutate(RPC.REPORT, { p_message: messageId, p_category: category });
    }

    return Object.freeze({
      setAccount, list, refreshUnread, recipient, thread, send, markRead, archive, block, report,
      get accountId() { return accountId; },
      get conversations() { return conversations; },
      get unreadCount() { return unreadCount; }
    });
  }

  window.InhaHubMessagesClient = Object.freeze({
    RPC, isUserId, parseCard, parseRecipient, parseMessage, parseConversation, parseConversationList, parseThread,
    messageErrorCode, createHubMessagesClient
  });
})();
