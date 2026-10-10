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
  // true = a block row was removed, false = there was nothing to remove (already restored or expired).
  if (typeof data !== "boolean") throw new Error("RESTORE_UNCONFIRMED");
  return data;
}

// Three different facts, never collapsed into one "done":
//   accepted  - the server returned success for the command (it ran inside one transaction);
//   blockConfirmed - an independent roster read shows the account in the active block list;
//   heartbeatCleared - the same read shows no live heartbeat session for the account.
// Whether an already-open Realtime socket was closed is not observable from here: always "UNKNOWN".
export function classifyKickOutcome(result, roster, userId) {
  const entry = roster?.blocked?.find(row => row.userId === userId) ?? null;
  const promised = Date.parse(result?.blockedUntil ?? "");
  const actual = Date.parse(entry?.blockedUntil ?? "");
  return Object.freeze({
    accepted:true,
    blockConfirmed:!!entry && (!Number.isFinite(promised) || (Number.isFinite(actual) && actual >= promised - 1000)),
    heartbeatCleared:!!roster && !roster.accounts.some(row => row.userId === userId),
    realtimeClosed:"UNKNOWN",
    blockedUntil:entry?.blockedUntil ?? result?.blockedUntil ?? null,
    sessionsRemoved:result?.sessionsRemoved ?? 0
  });
}
export function classifyRestoreOutcome(removed, roster, userId) {
  const stillBlocked = !!roster?.blocked?.some(row => row.userId === userId);
  return Object.freeze({ accepted:true, removed, unblockConfirmed:!!roster && !stillBlocked });
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
  let refreshFailed = false;
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
  function describeKick(name, result) {
    const until = result.blockedUntil ? timeKst(result.blockedUntil) + "까지" : "시간 확인 불가";
    if (!result.blockConfirmed) {
      return name + " 퇴장 명령은 수락됐지만 차단 목록에서 확인되지 않았습니다. 다시 조회해 주세요.";
    }
    const sessions = result.heartbeatCleared
      ? "접속 집계 세션 종료 확인(정리 " + result.sessionsRemoved + "개)"
      : "집계 세션이 아직 남아 있어 종료는 미확인(잠시 후 다시 조회)";
    return name + " 차단 확인됨(" + until + ") · " + sessions +
      ". 이미 열려 있는 실시간(Realtime) 연결이 닫혔는지는 확인할 수 없습니다.";
  }
  function describeRestore(name, result) {
    if (!result.unblockConfirmed) {
      return name + " 차단 해제 명령은 수락됐지만 차단이 아직 목록에 남아 있습니다. 다시 조회해 주세요.";
    }
    return result.removed
      ? name + "님의 월드 접속 차단 해제를 확인했습니다."
      : name + "님은 이미 차단이 해제된 상태로 확인됩니다.";
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
    refreshFailed = false;
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
      const message = typeof outcome === "function" ? outcome(roster) : outcome;
      status.textContent = message || "접속 상태를 확인했습니다. 퇴장은 계정 단위이며 캐릭터 데이터는 유지됩니다.";
      return roster;
    } catch (error) {
      if (requestGeneration !== generation) return false;
      refreshFailed = true;
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
    let outcome;
    try {
      outcome = action === "kick"
        ? await kickWorldAccount(client, userId, minutes, latest.operatorUserId)
        : await restoreWorldAccount(client, userId);
    } catch {
      // The reply may have been lost after the server committed: read the real state back.
      pending = false;
      button.disabled = false;
      refreshButton.disabled = false;
      const failureText = action === "kick"
        ? "퇴장 명령의 수락 여부를 확인하지 못했습니다. 접속 목록을 다시 조회해 확인해 주세요."
        : "차단 해제 명령의 수락 여부를 확인하지 못했습니다. 접속 목록을 다시 조회해 확인해 주세요.";
      const settled = await refresh({ outcome:roster => {
        const blocked = roster.blocked.some(row => row.userId === userId);
        if (action === "kick") {
          return blocked
            ? record.nickname + " 응답은 받지 못했지만 조회 결과 차단이 적용되어 있습니다."
            : record.nickname + " 퇴장 명령이 적용되지 않은 것으로 조회됩니다. 다시 시도해 주세요.";
        }
        return blocked
          ? record.nickname + " 차단이 아직 남아 있습니다. 해제를 다시 시도해 주세요."
          : record.nickname + " 응답은 받지 못했지만 조회 결과 차단이 해제되어 있습니다.";
      } });
      if (!settled && refreshFailed) status.textContent = failureText;
      return;
    }
    pending = false;
    refreshButton.disabled = false;
    const describe = roster => action === "kick"
      ? describeKick(record.nickname, classifyKickOutcome(outcome, roster, userId))
      : describeRestore(record.nickname, classifyRestoreOutcome(outcome, roster, userId));
    const confirmed = await refresh({ outcome:describe });
    // Command accepted but the follow-up read failed: say exactly that, not "done".
    if (!confirmed && refreshFailed) {
      status.textContent = action === "kick"
        ? record.nickname + " 퇴장 명령은 수락됐지만(차단 " + timeKst(outcome.blockedUntil) +
          "까지) 결과 확인에 실패했습니다. 접속 목록을 다시 조회해 주세요."
        : record.nickname + " 차단 해제 명령은 수락됐지만 결과 확인에 실패했습니다. 접속 목록을 다시 조회해 주세요.";
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
