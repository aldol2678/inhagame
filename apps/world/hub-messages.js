(() => {
  "use strict";

  const client = window.InhaHubAccountClient;
  const factory = window.InhaHubMessagesClient?.createHubMessagesClient;
  const isUserId = window.InhaHubMessagesClient?.isUserId;
  const DRAFT_KEY = "inhagame-hub-message-draft-v1";
  const DRAFT_MAX_AGE_MS = 10 * 60 * 1000;
  const signedOut = document.getElementById("hub-messages-signed-out");
  const shell = document.getElementById("hub-messages-shell");
  const status = document.getElementById("hub-messages-status");
  const inbox = document.getElementById("hub-message-inbox-list");
  const empty = document.getElementById("hub-message-inbox-empty");
  const refreshButton = document.getElementById("hub-message-refresh");
  const threadEmpty = document.getElementById("hub-message-thread-empty");
  const threadView = document.getElementById("hub-message-thread");
  const threadTitle = document.getElementById("hub-message-thread-title");
  const threadMeta = document.getElementById("hub-message-thread-meta");
  const threadList = document.getElementById("hub-message-thread-list");
  const composer = document.getElementById("hub-message-composer");
  const composerInput = document.getElementById("hub-message-input");
  const composerButton = document.getElementById("hub-message-send");
  const archiveButton = document.getElementById("hub-message-archive");
  const blockButton = document.getElementById("hub-message-block");
  const badges = Array.from(document.querySelectorAll("[data-message-unread]"));

  if (!client || typeof factory !== "function" || typeof isUserId !== "function" || !signedOut || !shell || !status) {
    if (status) status.textContent = "쪽지 서비스를 불러올 수 없습니다.";
    return;
  }

  const messages = factory({ rpc: (name, args) => client.rpc(name, args) });
  let current = null;
  let loadEpoch = 0;

  const reportCategories = Object.freeze([
    ["spam", "스팸"],
    ["harassment", "욕설·괴롭힘"],
    ["inappropriate_content", "부적절한 콘텐츠"],
    ["impersonation", "사칭"],
    ["other", "기타"]
  ]);

  function formatTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(date);
  }

  function errorText(code, action = "요청") {
    if (code === "PERMANENT_ACCOUNT_REQUIRED") return "로그인한 INHAGAME 계정이 필요합니다.";
    if (code === "ACCOUNT_UNAVAILABLE" || code === "SOCIAL_RESTRICTED") return "현재 이 계정으로 쪽지 기능을 이용할 수 없습니다.";
    if (code === "NOT_ALLOWED") return "상대방과 쪽지를 주고받을 수 없습니다.";
    if (code === "INHA_VERIFICATION_REQUIRED") return "새 대화는 인하대 인증 회원만 시작할 수 있습니다.";
    if (code === "TARGET_UNAVAILABLE") return "이 사용자에게 새 쪽지를 보낼 수 없습니다.";
    if (code === "RATE_LIMITED") return "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
    if (code === "CONVERSATION_UNAVAILABLE" || code === "MESSAGE_UNAVAILABLE") return "이 대화를 이용할 수 없습니다.";
    if (code === "INVALID_MESSAGE") return "쪽지는 1~1000자로 입력해 주세요.";
    if (code === "INVALID_CATEGORY") return "신고 유형을 확인해 주세요.";
    return `${action}을 완료하지 못했습니다. 다시 시도해 주세요.`;
  }

  function readDraftTarget() {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const fresh = Number.isFinite(parsed?.createdAt) && Date.now() - parsed.createdAt >= 0 &&
        Date.now() - parsed.createdAt <= DRAFT_MAX_AGE_MS;
      if (!fresh || !isUserId(parsed?.userId)) {
        sessionStorage.removeItem(DRAFT_KEY);
        return null;
      }
      return parsed.userId;
    } catch {
      return null;
    }
  }

  function clearDraftTarget() {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* storage is optional */ }
  }

  function renderBadge(count = messages.unreadCount) {
    const safe = Math.max(0, Number(count) || 0);
    for (const badge of badges) {
      badge.hidden = safe === 0;
      badge.textContent = safe > 99 ? "99+" : String(safe);
      badge.setAttribute("aria-label", `읽지 않은 쪽지 ${safe}개`);
    }
  }

  function setSignedIn(signedIn) {
    signedOut.hidden = signedIn;
    shell.hidden = !signedIn;
    if (!signedIn) {
      current = null;
      inbox.replaceChildren();
      threadList.replaceChildren();
      threadView.hidden = true;
      threadEmpty.hidden = false;
      renderBadge(0);
      status.textContent = "로그인하면 쪽지를 확인할 수 있습니다.";
    }
  }

  function createInboxItem(conversation) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "message-inbox-item";
    button.dataset.conversationId = conversation.conversationId;
    if (current?.conversationId === conversation.conversationId) button.setAttribute("aria-current", "true");

    const top = document.createElement("span");
    top.className = "message-inbox-top";
    const name = document.createElement("strong");
    name.textContent = (conversation.other.inhaVerified ? "🎓 " : "") + conversation.other.nickname;
    const time = document.createElement("time");
    time.dateTime = conversation.updatedAt;
    time.textContent = formatTime(conversation.updatedAt);
    top.append(name, time);

    const bottom = document.createElement("span");
    bottom.className = "message-inbox-bottom";
    const preview = document.createElement("span");
    preview.className = "message-preview";
    preview.textContent = conversation.lastMessage?.deleted
      ? "삭제된 쪽지"
      : conversation.lastMessage?.body || "대화를 시작했습니다.";
    bottom.append(preview);
    if (conversation.unreadCount > 0) {
      const unread = document.createElement("span");
      unread.className = "message-unread-count";
      unread.textContent = conversation.unreadCount > 99 ? "99+" : String(conversation.unreadCount);
      unread.setAttribute("aria-label", `읽지 않은 쪽지 ${conversation.unreadCount}개`);
      bottom.append(unread);
    }

    button.append(top, bottom);
    button.addEventListener("click", () => void openConversation(conversation));
    return button;
  }

  function renderInbox(list = messages.conversations) {
    inbox.replaceChildren(...list.map(createInboxItem));
    empty.hidden = list.length !== 0;
  }

  function reportControl(message) {
    const details = document.createElement("details");
    details.className = "message-report";
    const summary = document.createElement("summary");
    summary.textContent = "신고";
    const row = document.createElement("div");
    row.className = "message-report-row";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "신고 유형");
    for (const [value, label] of reportCategories) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    }
    const send = document.createElement("button");
    send.type = "button";
    send.className = "message-mini-button";
    send.textContent = "접수";
    send.addEventListener("click", async () => {
      send.disabled = true;
      const result = await messages.report(message.id, select.value);
      send.disabled = false;
      if (result.outcome === "SUCCESS") {
        details.open = false;
        status.textContent = result.data?.status === "duplicate" ? "이미 접수된 신고입니다." : "신고를 접수했습니다.";
      } else if (result.outcome !== "STALE") {
        status.textContent = errorText(result.code, "신고");
      }
    });
    row.append(select, send);
    details.append(summary, row);
    return details;
  }

  function renderThread(thread) {
    const nodes = [];
    for (const message of [...thread.messages].reverse()) {
      const mine = message.senderId === messages.accountId;
      const item = document.createElement("article");
      item.className = "hub-message-bubble";
      item.dataset.mine = String(mine);

      const body = document.createElement("p");
      body.textContent = message.deleted ? "삭제된 쪽지입니다." : message.body;
      const meta = document.createElement("div");
      meta.className = "hub-message-meta";
      const time = document.createElement("time");
      time.dateTime = message.createdAt;
      time.textContent = formatTime(message.createdAt);
      meta.append(time);
      if (!mine && !message.deleted) meta.append(reportControl(message));

      item.append(body, meta);
      nodes.push(item);
    }
    threadList.replaceChildren(...nodes);
    requestAnimationFrame(() => { threadList.scrollTop = threadList.scrollHeight; });
  }

  function updateThreadHeader() {
    if (!current) return;
    threadTitle.textContent = (current.other.inhaVerified ? "🎓 " : "") + current.other.nickname;
    threadMeta.textContent = (current.other.title || "INHAGAME 사용자") + (current.conversationId ? "" : " · 새 대화");
    const disabled = current.blockedByMe || current.other.available === false;
    composer.hidden = disabled;
    archiveButton.hidden = !current.conversationId;
    blockButton.hidden = current.blockedByMe || current.other.available === false;
    if (disabled) status.textContent = current.blockedByMe
      ? "차단한 사용자입니다. 새 쪽지를 보낼 수 없습니다."
      : "이 사용자는 현재 쪽지를 받을 수 없습니다.";
  }

  async function openDraftRecipient(userId) {
    if (!isUserId(userId) || userId === messages.accountId) {
      clearDraftTarget();
      status.textContent = "자기 자신에게는 쪽지를 보낼 수 없습니다.";
      return false;
    }
    const existing = messages.conversations.find((item) => item.other.userId === userId);
    if (existing) {
      clearDraftTarget();
      await openConversation(existing);
      return true;
    }
    const epoch = ++loadEpoch;
    status.textContent = "새 쪽지 대상을 확인하는 중…";
    const result = await messages.recipient(userId);
    if (epoch !== loadEpoch || result.outcome === "STALE") return false;
    if (result.outcome !== "READY") {
      clearDraftTarget();
      status.textContent = errorText(result.code, "사용자 확인");
      return false;
    }
    current = Object.freeze({
      conversationId: null,
      other: result.recipient,
      blockedByMe: result.recipient.relationship === "blocked_by_me",
      draft: true
    });
    threadEmpty.hidden = true;
    threadView.hidden = false;
    threadList.replaceChildren();
    const intro = document.createElement("div");
    intro.className = "message-draft-intro";
    intro.textContent = result.recipient.available === false
      ? "이 사용자와는 새 대화를 시작할 수 없습니다."
      : "프로필에서 시작한 새 대화입니다. 첫 쪽지는 인하대 인증 회원만 보낼 수 있습니다.";
    threadList.append(intro);
    updateThreadHeader();
    renderInbox(messages.conversations);
    if (!current.blockedByMe && result.recipient.available !== false) {
      status.textContent = "쪽지를 작성해 새 대화를 시작하세요.";
      composerInput.focus();
    }
    return true;
  }

  async function loadInbox({ keepSelection = true } = {}) {
    if (!messages.accountId) return;
    const epoch = ++loadEpoch;
    refreshButton.disabled = true;
    status.textContent = "쪽지함을 불러오는 중…";
    const result = await messages.list(50);
    refreshButton.disabled = false;
    if (epoch !== loadEpoch || result.outcome === "STALE") return;
    if (result.outcome !== "READY") {
      status.textContent = errorText(result.code, "쪽지함 조회");
      return;
    }
    renderBadge(result.unreadCount);
    renderInbox(result.conversations);
    status.textContent = result.conversations.length ? "쪽지함을 불러왔습니다." : "아직 받은 쪽지가 없습니다.";
    const draftTarget = location.hash === "#messages" ? readDraftTarget() : null;
    if (draftTarget) {
      await openDraftRecipient(draftTarget);
      return;
    }
    if (keepSelection && current) {
      const refreshed = result.conversations.find((item) => item.conversationId === current.conversationId);
      if (refreshed) {
        current = refreshed;
        updateThreadHeader();
        renderInbox(result.conversations);
      } else {
        current = null;
        threadView.hidden = true;
        threadEmpty.hidden = false;
      }
    }
  }

  async function loadThread() {
    if (!current?.conversationId) return;
    const conversationId = current.conversationId;
    const epoch = ++loadEpoch;
    threadList.replaceChildren();
    status.textContent = "대화를 불러오는 중…";
    const result = await messages.thread(conversationId, 100, null);
    if (epoch !== loadEpoch || result.outcome === "STALE" || current?.conversationId !== conversationId) return;
    if (result.outcome !== "READY") {
      status.textContent = errorText(result.code, "대화 조회");
      return;
    }
    renderThread(result.thread);
    const read = await messages.markRead(conversationId);
    if (read.outcome === "SUCCESS") {
      renderBadge(messages.unreadCount);
      renderInbox(messages.conversations);
    }
    status.textContent = "";
  }

  async function openConversation(conversation) {
    current = conversation;
    threadEmpty.hidden = true;
    threadView.hidden = false;
    updateThreadHeader();
    renderInbox(messages.conversations);
    await loadThread();
  }

  async function syncIdentity() {
    try {
      const { data, error } = await client.auth.getUser();
      if (error && error.name !== "AuthSessionMissingError") throw error;
      const user = data?.user;
      const accountId = user?.id && user.is_anonymous !== true && user.email ? user.id : null;
      const changed = messages.setAccount(accountId);
      setSignedIn(!!accountId);
      if (!accountId) return;
      const unread = await messages.refreshUnread();
      if (unread.outcome === "READY") renderBadge(unread.unreadCount);
      if (location.hash === "#messages") await loadInbox({ keepSelection: !changed });
    } catch (error) {
      console.warn("Hub messages identity unavailable", error);
      messages.setAccount(null);
      setSignedIn(false);
      status.textContent = "계정 상태를 확인할 수 없습니다.";
    }
  }

  refreshButton.addEventListener("click", () => void loadInbox());
  window.addEventListener("hashchange", () => {
    if (location.hash === "#messages" && messages.accountId) void loadInbox();
  });
  window.addEventListener("pageshow", () => {
    if (messages.accountId) void messages.refreshUnread().then((result) => {
      if (result.outcome === "READY") renderBadge(result.unreadCount);
    });
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && messages.accountId) void messages.refreshUnread().then((result) => {
      if (result.outcome === "READY") renderBadge(result.unreadCount);
    });
  });

  composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!current || composerButton.disabled) return;
    const body = composerInput.value.trim();
    if (!body) {
      status.textContent = "쪽지 내용을 입력해 주세요.";
      return;
    }
    composerButton.disabled = true;
    const result = await messages.send(current.other.userId, body);
    composerButton.disabled = false;
    if (result.outcome === "SUCCESS") {
      const targetUserId = current.other.userId;
      const wasDraft = !current.conversationId;
      composerInput.value = "";
      if (wasDraft) {
        clearDraftTarget();
        current = null;
        await loadInbox({ keepSelection: false });
        const created = messages.conversations.find((item) => item.other.userId === targetUserId);
        if (created) await openConversation(created);
        else status.textContent = "쪽지를 보냈습니다. 받은 쪽지함을 새로고침해 주세요.";
      } else {
        await loadInbox();
        if (current?.conversationId) await loadThread();
      }
    } else if (result.outcome !== "STALE") {
      status.textContent = errorText(result.code, "쪽지 전송");
    }
  });

  archiveButton.addEventListener("click", async () => {
    if (!current?.conversationId) return;
    archiveButton.disabled = true;
    const result = await messages.archive(current.conversationId);
    archiveButton.disabled = false;
    if (result.outcome === "SUCCESS") {
      current = null;
      threadView.hidden = true;
      threadEmpty.hidden = false;
      status.textContent = "대화를 보관했습니다. 새 쪽지가 오면 다시 받은 쪽지함에 표시됩니다.";
      await loadInbox({ keepSelection: false });
    } else if (result.outcome !== "STALE") {
      status.textContent = errorText(result.code, "대화 보관");
    }
  });

  blockButton.addEventListener("click", async () => {
    if (!current || !window.confirm(`${current.other.nickname}님을 차단할까요? 월드 친구·쪽지 상호작용도 함께 제한됩니다.`)) return;
    blockButton.disabled = true;
    const result = await messages.block(current.other.userId);
    blockButton.disabled = false;
    if (result.outcome === "SUCCESS") {
      if (!current.conversationId) clearDraftTarget();
      current = Object.freeze({ ...current, blockedByMe: true });
      updateThreadHeader();
      renderInbox(messages.conversations);
      status.textContent = "사용자를 차단했습니다.";
    } else if (result.outcome !== "STALE") {
      status.textContent = errorText(result.code, "차단");
    }
  });

  client.auth.onAuthStateChange(() => { setTimeout(() => void syncIdentity(), 0); });
  void syncIdentity();
})();
