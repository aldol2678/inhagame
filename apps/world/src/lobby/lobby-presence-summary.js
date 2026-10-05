import { Relationship } from "../social/social-client.js";

export const LOBBY_PRESENCE_SCOPE = "WORLD";

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
    friendsKnown = true;
    update();
    return true;
  };

  const view = () => {
    let online = null;
    let onlineStatus = { signedIn: false, state: "OFFLINE", count: 0 };
    let populationStatus = null;
    let readDegraded = false;

    try {
      online = getOnline?.() ?? null;
      onlineStatus = online?.status?.() ?? onlineStatus;
    } catch {
      readDegraded = true;
    }
    try {
      populationStatus = getPopulation?.()?.status?.() ?? getPopulation?.() ?? null;
    } catch {
      readDegraded = true;
    }

    const signedIn = onlineStatus.signedIn === true && social?.available === true;
    let sameZoneFriends = 0;
    if (signedIn) {
      for (const userId of friendIds) {
        try { if (online?.remoteByUser?.(userId)) sameZoneFriends++; }
        catch { readDegraded = true; }
      }
    }

    const populationReady = populationStatus?.state === "READY" && populationStatus?.snapshot;
    const worldCount = populationReady
      ? Math.max(0, Number(populationStatus.snapshot.online) || 0)
      : null;
    let worldText = "전체 접속 —";
    if (populationStatus?.state === "LOADING") worldText = "전체 접속 집계 중…";
    else if (worldCount !== null) worldText = `전체 접속 ${worldCount}명`;

    let friendsText = "로그인하면 친구 상태 확인";
    if (signedIn && !friendsKnown) friendsText = "친구 상태 불러오는 중…";
    else if (signedIn) friendsText = `같은 구역 ${sameZoneFriends}명 · 친구 ${friendIds.size}명`;

    degraded = readDegraded || populationStatus?.state === "UNAVAILABLE";

    return {
      scope: LOBBY_PRESENCE_SCOPE,
      signedIn,
      networkState: onlineStatus.state ?? "OFFLINE",
      worldCount,
      zoneCount: onlineStatus.state === "ONLINE" ? Math.max(0, Number(onlineStatus.count) || 0) : null,
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
