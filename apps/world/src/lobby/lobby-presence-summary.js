import { Relationship } from "../social/social-client.js";
import { ConnectionState } from "../network/connection-state.js";
import { RemotePresence } from "../network/remote-player-manager.js";

export const LOBBY_PRESENCE_SCOPE = "WORLD";

const connectionStates = new Set(Object.values(ConnectionState));
const isCount = value => Number.isSafeInteger(value) && value >= 0;

export function createLobbyPresenceSummary({
  zoneElement,
  friendsButton,
  getOnline = () => null,
  getPopulation = () => null,
  social = null,
  friendPanel = null
} = {}) {
  let friendIds = new Set();
  let friendsKnown = false;
  let lastView = null;
  let degraded = false;

  const setFriends = (friends) => {
    friendsKnown = Array.isArray(friends);
    friendIds = new Set((friends ?? []).map(friend => friend?.userId).filter(Boolean));
    return update();
  };

  const applyRelationship = (userId, state) => {
    if (!userId) return false;
    if (state === Relationship.FRIENDS) friendIds.add(userId);
    else friendIds.delete(userId);
    // A relationship event is not a complete list; reset notifications invalidate it.
    if (state === null) friendsKnown = false;
    update();
    return true;
  };

  const view = () => {
    let online = null;
    let onlineStatus = { signedIn: false, state: "UNKNOWN", count: null };
    let populationStatus = null;
    let readDegraded = false;
    let presenceReadFailed = false;

    try {
      online = getOnline?.() ?? null;
      onlineStatus = online?.status?.() ?? onlineStatus;
    } catch {
      readDegraded = true;
      presenceReadFailed = true;
    }
    try {
      populationStatus = getPopulation?.()?.status?.() ?? getPopulation?.() ?? null;
    } catch {
      readDegraded = true;
    }

    const signedIn = onlineStatus.signedIn === true && social?.available === true;
    const networkState = connectionStates.has(onlineStatus.state) ? onlineStatus.state : "UNKNOWN";
    // world-online reports ONLINE only after the Place Zone has synced. Cached remotes while
    // connecting/reconnecting are not a confirmed zero (or a confirmed previous count).
    const zoneCount = networkState === ConnectionState.ONLINE && isCount(onlineStatus.count)
      ? onlineStatus.count : null;
    let sameZoneFriends = null;
    if (signedIn && friendsKnown && zoneCount !== null) {
      sameZoneFriends = 0;
      for (const userId of friendIds) {
        try {
          if (typeof online?.remoteByUser !== "function") throw new Error("presence unavailable");
          const remote = online?.remoteByUser?.(userId);
          // remoteByUser returns last-frame samples, which can still be suspect after reconnect.
          if (remote && remote.presence !== RemotePresence.PRESENT) {
            sameZoneFriends = null;
            break;
          }
          if (remote) sameZoneFriends++;
        } catch {
          readDegraded = true;
          sameZoneFriends = null;
          break;
        }
      }
    }

    const populationReady = populationStatus?.state === "READY" && populationStatus?.snapshot;
    const worldCount = populationReady && isCount(populationStatus.snapshot.online)
      ? populationStatus.snapshot.online : null;
    let worldText = "전체 접속 —";
    if (populationStatus?.state === "LOADING") worldText = "전체 접속 집계 중…";
    else if (worldCount !== null) worldText = `전체 접속 ${worldCount}명`;

    let friendsText = "로그인하면 친구 상태 확인";
    if (presenceReadFailed) friendsText = "친구 상태 알 수 없음";
    else if (signedIn) {
      if (networkState === ConnectionState.CONNECTING) friendsText = "친구 상태 연결 중…";
      else if (networkState === ConnectionState.RECONNECTING) friendsText = "친구 상태 재연결 중…";
      else if (networkState === ConnectionState.OFFLINE) friendsText = "친구 상태 오프라인";
      else if (networkState !== ConnectionState.ONLINE || zoneCount === null) friendsText = "친구 상태 알 수 없음";
      else if (!friendsKnown) friendsText = "친구 상태 불러오는 중…";
      else if (sameZoneFriends === null) friendsText = "친구 상태 알 수 없음";
      else friendsText = `같은 구역 ${sameZoneFriends}명 · 친구 ${friendIds.size}명`;
    }

    degraded = readDegraded || populationStatus?.state === "UNAVAILABLE";

    return {
      scope: LOBBY_PRESENCE_SCOPE,
      signedIn,
      networkState,
      worldCount,
      zoneCount,
      sameZoneFriends,
      totalFriends: friendsKnown ? friendIds.size : null,
      worldText,
      friendsText,
      degraded
    };
  };

  const update = () => {
    const next = view();
    const key = JSON.stringify(next);
    if (key === lastView) return next;
    lastView = key;
    if (zoneElement) zoneElement.textContent = next.worldText;
    if (friendsButton) {
      friendsButton.textContent = next.friendsText;
      friendsButton.disabled = !next.signedIn;
      friendsButton.setAttribute?.("aria-expanded", String(friendPanel?.open === true));
    }
    return next;
  };

  const openFriends = () => {
    if (!social?.available || !friendPanel?.setOpen) return false;
    void friendPanel.setOpen(true);
    update();
    return true;
  };

  friendsButton?.addEventListener?.("click", openFriends);
  update();

  return {
    update,
    setFriends,
    applyRelationship,
    openFriends,
    status: view
  };
}
