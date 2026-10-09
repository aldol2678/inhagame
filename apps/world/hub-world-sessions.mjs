// INHA WORLD operator roster. The server owns authorization for every read/write.
// Only a signed-in world_admin can see this panel; never trust a client-side badge.
export const WORLD_SESSION_RPC = Object.freeze({
  LIST: "get_world_session_admin_v1",
  KICK: "kick_world_user_v1",
  RESTORE: "restore_world_user_v1"
});
export const WORLD_KICK_MINUTES = Object.freeze([5, 30, 60, 240]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isCount = n => Number.isSafeInteger(n) && n >= 0;
const isUUID = value => typeof value === "string" && UUID.test(value);

export function parseWorldSessionRoster(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.accounts) ||
      !Array.isArray(raw.blocked) || !isUUID(raw.operatorUserId) ||
      !isCount(raw.onlineSessions) || !isCount(raw.guestSessions)) {
    throw new Error("INVALID_WORLD_SESSION_ROSTER");
  }
  const accounts = raw.accounts.map(row => {
    if (!isUUID(row?.userId) || !isCount(row?.sessionCount) || row.sessionCount < 1 ||
        typeof row.lastSeenAt !== "string") throw new Error("INVALID_WORLD_SESSION_ACCOUNT");
    return Object.freeze({
      userId:row.userId,
      nickname:String(row.nickname || "(닉네임 없음)").slice(0, 40),
      sessionCount:row.sessionCount,
      space:String(row.space || "unknown").slice(0, 40),
      placeZoneId:String(row.placeZoneId || "미지정").slice(0, 70),
      lastSeenAt:row.lastSeenAt
    });
  });
  const blocked = raw.blocked.map(row => {
    if (!isUUID(row?.userId) || typeof row.blockedUntil !== "string") {
      throw new Error("INVALID_WORLD_SESSION_BLOCK");
    }
    return Object.freeze({
      userId:row.userId,
      nickname:String(row.nickname || "(닉네임 없음)").slice(0, 40),
      blockedUntil:row.blockedUntil
    });
  });
  return Object.freeze({
    operatorUserId:raw.operatorUserId,
    onlineSessions:raw.onlineSessions,
    guestSessions:raw.guestSessions,
    accounts:Object.freeze(accounts),
    blocked:Object.freeze(blocked),
    asOf:typeof raw.asOf === "string" ? raw.asOf : null
  });
}

export async function kickWorldAccount(client, userId, minutes, operatorUserId) {
  if (!isUUID(userId) || userId === operatorUserId ||
      !WORLD_KICK_MINUTES.includes(minutes)) throw new Error("INVALID_KICK_REQUEST");
  const { data, error } = await client.rpc(WORLD_SESSION_RPC.KICK, {
    p_user_id:userId, p_minutes:minutes
  });
  if (error) throw error;
  if (data?.userId !== userId || !isCount(data.sessionsRemoved)) {
    throw new Error("KICK_UNCONFIRMED");
  }
  return data;
}

export async function restoreWorldAccount(client, userId) {
  if (!isUUID(userId)) throw new Error("INVALID_RESTORE_REQUEST");
  const { data, error } = await client.rpc(WORLD_SESSION_RPC.RESTORE, { p_user_id:userId });
  if (error) throw error;
  if (data !== true) throw new Error("RESTORE_UNCONFIRMED");
  return true;
}

export function mountWorldSessionAdmin({
  client,
  documentLike = document,
  windowLike = window,
  confirmAction = message => windowLike.confirm(message)
} = {}) {
  const panel = documentLike.getElementById("hub-world-session-admin");
  const summary = documentLike.getElementById("hub-world-session-summary");
  const status = documentLike.getElementById("hub-world-session-status");
  const accountsEl = documentLike.getElementById("hub-world-session-accounts");
  const blockedEl = documentLike.getElementById("hub-world-session-blocks");
  const refreshButton = documentLike.getElementById("hub-world-session-refresh");
  const duration = documentLike.getElementById("hub-world-session-duration");
  if (!client?.rpc || !client.auth?.getUser || !panel || !summary || !status ||
      !accountsEl || !blockedEl || !refreshButton || !duration) return null;

  let generation = 0;
  let latest = null;
  let pending = false;
  const accountVisible = () => windowLike.location?.hash === "#account";

  function el(tag, className, text) {
    const node = documentLike.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function timeKst(value) {
    const stamp = Date.parse(value);
    return Number.isFinite(stamp)
      ? new Date(stamp).toLocaleString("ko-KR", { timeZone:"Asia/Seoul", hour12:false })
      : "시간 확인 불가";
  }
  function hide() {
    generation++;
    latest = null;
    panel.hidden = true;
    accountsEl.replaceChildren();
    blockedEl.replaceChildren();
    status.textContent = "";
  }
  function render(roster) {
    accountsEl.replaceChildren();
    blockedEl.replaceChildren();
    summary.textContent = "전체 " + roster.onlineSessions + "세션 · 로그인 계정 " +
      roster.accounts.length + "명 · 게스트 " + roster.guestSessions + "세션";
    if (!roster.accounts.length) accountsEl.appendChild(el("li","hub-world-session-empty","접속 중인 로그인 계정이 없습니다."));
    for (const account of roster.accounts) {
      const row = el("li", "hub-world-session-row");
      const info = el("div", "hub-world-session-info");
      info.appendChild(el("strong","",account.nickname));
      info.appendChild(el("small","",account.sessionCount + "세션 · " + account.space +
        " · " + account.placeZoneId));
      info.appendChild(el("small","","마지막 활동 " + timeKst(account.lastSeenAt)));
      const button = el("button","hub-world-session-kick","강제 퇴장");
      button.type = "button";
      button.dataset.action = "kick";
      button.dataset.userId = account.userId;
      button.disabled = account.userId === roster.operatorUserId;
      if (button.disabled) button.textContent = "내 계정";
      row.append(info,button);
      accountsEl.appendChild(row);
    }
    if (!roster.blocked.length) blockedEl.appendChild(el("li","hub-world-session-empty","현재 접속 차단된 계정이 없습니다."));
    for (const account of roster.blocked) {
      const row = el("li","hub-world-session-row");
      const info = el("div","hub-world-session-info");
      info.appendChild(el("strong","",account.nickname));
      info.appendChild(el("small","","월드 접속 차단 · " + timeKst(account.blockedUntil) + "까지"));
      const button = el("button","hub-world-session-restore","차단 해제");
      button.type = "button";
      button.dataset.action = "restore";
      button.dataset.userId = account.userId;
      row.append(info,button);
      blockedEl.appendChild(row);
    }
  }

  async function refresh({ quiet = false, outcome = "" } = {}) {
    if (pending || !accountVisible()) return false;
    const requestGeneration = ++generation;
    if (!quiet) status.textContent = "접속자를 확인하는 중…";
    try {
      const { data: account, error: authError } = await client.auth.getUser();
      if (requestGeneration !== generation) return false;
      if (authError || !account?.user?.id || account.user.is_anonymous === true) {
        hide();
        return false;
      }
      const { data, error } = await client.rpc(WORLD_SESSION_RPC.LIST);
      if (requestGeneration !== generation) return false;
      if (error) {
        if (error.code === "42501" || /unauthorized/i.test(String(error.message || ""))) {
          hide();
          return false;
        }
        throw error;
      }
      const roster = parseWorldSessionRoster(data);
      if (roster.operatorUserId !== account.user.id) throw new Error("OPERATOR_IDENTITY_MISMATCH");
      latest = roster;
      render(roster);
      panel.hidden = false;
      status.textContent = outcome || "접속 상태를 확인했습니다. 퇴장은 계정 단위이며 캐릭터 데이터는 유지됩니다.";
      return true;
    } catch (error) {
      if (requestGeneration !== generation) return false;
      if (!latest) panel.hidden = true;
      status.textContent = "접속 현황을 불러오지 못했습니다. 다시 시도해 주세요.";
      return false;
    }
  }

  async function onAction(event) {
    const button = event.target?.closest?.("button[data-action]");
    if (!button || !latest || pending || button.disabled) return;
    const action = button.dataset.action;
    const userId = button.dataset.userId;
    const record = (action === "kick" ? latest.accounts : latest.blocked)
      .find(row => row.userId === userId);
    if (!record || (action !== "kick" && action !== "restore")) return;
    const minutes = Number(duration.value);
    if (action === "kick" && (!WORLD_KICK_MINUTES.includes(minutes) ||
        userId === latest.operatorUserId)) return;
    const question = action === "kick"
      ? record.nickname + "님의 월드 접속을 " + minutes +
        "분 동안 차단할까요? 모든 해당 계정 세션에 적용되며 캐릭터 데이터는 삭제되지 않습니다."
      : record.nickname + "님의 월드 접속 차단을 해제할까요?";
    if (!confirmAction(question)) return;
    // Invalidate an older read before mutating, so it cannot repaint stale buttons.
    generation++;
    pending = true;
    button.disabled = true;
    refreshButton.disabled = true;
    status.textContent = action === "kick" ? "강제 퇴장 처리 중…" : "차단 해제 처리 중…";
    try {
      const outcome = action === "kick"
        ? await kickWorldAccount(client, userId, minutes, latest.operatorUserId)
        : await restoreWorldAccount(client, userId);
      pending = false;
      refreshButton.disabled = false;
      await refresh({ outcome:action === "kick"
        ? record.nickname + " 퇴장 처리 완료 · 집계 세션 " + outcome.sessionsRemoved +
          "개 정리. 기존 구버전 Realtime 연결에는 반영 지연이 있을 수 있습니다."
        : record.nickname + "님의 월드 접속 차단을 해제했습니다." });
    } catch {
      pending = false;
      button.disabled = false;
      refreshButton.disabled = false;
      status.textContent = action === "kick"
        ? "퇴장 처리를 확인하지 못했습니다. 접속 목록을 다시 조회해 주세요."
        : "차단 해제를 확인하지 못했습니다. 접속 목록을 다시 조회해 주세요.";
    }
  }

  accountsEl.addEventListener("click", onAction);
  blockedEl.addEventListener("click", onAction);
  refreshButton.addEventListener("click", () => { void refresh(); });
  windowLike.addEventListener("hashchange", () => {
    if (accountVisible()) void refresh();
  });
  documentLike.addEventListener("visibilitychange", () => {
    if (documentLike.visibilityState === "visible" && accountVisible() && !pending) void refresh({ quiet:true });
  });
  client.auth.onAuthStateChange?.((event) => {
    // Avoid awaiting Supabase client calls inside an auth callback.
    if (event === "SIGNED_OUT") hide();
    else if (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "USER_UPDATED") {
      windowLike.setTimeout(() => { if (accountVisible()) void refresh(); }, 0);
    }
  });
  const timer = windowLike.setInterval(() => {
    if (accountVisible() && !panel.hidden && !pending) void refresh({ quiet:true });
  }, 30_000);
  if (accountVisible()) void refresh();
  return { refresh, hide, stop() { windowLike.clearInterval(timer); hide(); } };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  // DOMContentLoaded runs after the hub's deferred account/auth scripts.
  const bootstrap = () => { mountWorldSessionAdmin({ client:window.InhaHubAccountClient }); };
  if (document.readyState === "complete") bootstrap();
  else document.addEventListener("DOMContentLoaded", bootstrap, { once:true });
}
