// Social S1-D2 · friend room visit: server resolver client + visit controller.
//
// Player Card / Friends panel → [🏠 방 방문] → resolve_friend_personal_room_v1(owner) (friendship,
// blocks, room existence and visibility are all checked server-side) → the shared
// ROOM_PERSONAL_BASIC scene with visitor metadata. Leaving always lands in the 제1생활관 Dorm
// Lobby, never at an arbitrary campus position. Allowed from the campus and from the Dorm Lobby;
// not from another interior, the main lobby shell, a mount or mid-transition.
//
// Housing H3: a visit is no longer a jump. From the campus the player is guided (route + auto-move)
// to 제1생활관; in the Dorm Lobby the west-corridor door offers "노크". The knock is answered by the
// owner when home (room-knock.js) or admitted at once when the owner is away; only then does the
// player enter the room through the lobby, exactly like their own room door.

import { DORM_1_LOBBY_FRIEND_ROOM, DORM_1_LOBBY_MY_ROOM_RETURN } from "./dorm1-lobby-layout.js";
import { KNOCK_STATUS, RoomKnockError, waitForKnockAnswer } from "./room-knock.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_TYPES = new Set(["DORM_1_BASIC"]);
const VISIBILITY = new Set(["private", "friends"]);
const KNOWN = new Set([
  "PERMANENT_ACCOUNT_REQUIRED", "ACCOUNT_UNAVAILABLE", "TARGET_UNAVAILABLE",
  "NOT_FRIENDS", "ROOM_NOT_FOUND", "ROOM_PRIVATE", "VISIT_DECLINED", "KNOCK_REQUIRED", "SOCIAL_RESTRICTED"
]);
export const PERSONAL_ROOM_ID = "ROOM_PERSONAL_BASIC";
export const DORM_LOBBY_ID = "ROOM_DORM1_LOBBY";

export class FriendRoomVisitError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function parseFriendRoom(raw) {
  if (!raw || typeof raw !== "object" || !UUID.test(raw.roomId ?? "") || !UUID.test(raw.ownerUserId ?? "")) return null;
  if (!ROOM_TYPES.has(raw.roomType) || !VISIBILITY.has(raw.visibility)) return null;
  return Object.freeze({
    roomId: raw.roomId,
    ownerUserId: raw.ownerUserId,
    ownerDisplayName: typeof raw.ownerDisplayName === "string" && raw.ownerDisplayName.trim()
      ? raw.ownerDisplayName.trim().slice(0, 40) : "친구",
    roomType: raw.roomType,
    visibility: raw.visibility
  });
}

export class FriendRoomVisitClient {
  constructor({ getClient, getSelfUserId }) {
    this.getClient = getClient;
    this.getSelfUserId = getSelfUserId;
  }
  get available() { return !!this.getClient?.() && UUID.test(this.getSelfUserId?.() ?? ""); }
  async resolve(ownerUserId) {
    const client = this.getClient?.();
    const self = this.getSelfUserId?.();
    if (!client || !UUID.test(self ?? "")) throw new FriendRoomVisitError("SIGNED_OUT");
    if (!UUID.test(ownerUserId ?? "") || ownerUserId === self) throw new FriendRoomVisitError("TARGET_UNAVAILABLE");
    const { data, error } = await client.rpc("resolve_friend_personal_room_v1", { p_owner: ownerUserId });
    if (this.getSelfUserId?.() !== self) throw new FriendRoomVisitError("SIGNED_OUT");
    if (error) {
      const code = String(error.message ?? "").trim();
      throw new FriendRoomVisitError(KNOWN.has(code) ? code : "FAILED");
    }
    const room = parseFriendRoom(data);
    if (!room || room.ownerUserId !== ownerUserId) throw new FriendRoomVisitError("FAILED");
    return room;
  }
}

export const FRIEND_ROOM_VISIT_TEXT = Object.freeze({
  busy: "잠시 후 다시 시도해 주세요.",
  mounted: "탈것에서 내린 뒤 친구 방을 방문할 수 있어요.",
  lobby_shell: "캠퍼스에 들어간 뒤 친구 방을 방문할 수 있어요.",
  inside_room: "지금 있는 곳에서 나간 뒤 방문할 수 있어요.",
  signed_out: "INHAGAME에 로그인하면 친구 방을 방문할 수 있어요.",
  SIGNED_OUT: "INHAGAME에 로그인하면 친구 방을 방문할 수 있어요.",
  PERMANENT_ACCOUNT_REQUIRED: "INHAGAME에 로그인하면 친구 방을 방문할 수 있어요.",
  ACCOUNT_UNAVAILABLE: "현재 계정으로는 친구 방을 방문할 수 없어요.",
  SOCIAL_RESTRICTED: "지금은 친구 방을 방문할 수 없어요.",
  ROOM_NOT_FOUND: "친구가 아직 제1생활관 방을 열지 않았어요.",
  ROOM_PRIVATE: "친구가 방을 비공개로 해 두었어요.",
  NOT_FRIENDS: "지금은 이 친구의 방을 방문할 수 없어요.",
  TARGET_UNAVAILABLE: "지금은 이 친구의 방을 방문할 수 없어요.",
  VISIT_DECLINED: "지금은 들어올 수 없대요. 10분쯤 뒤에 다시 찾아와 주세요.",
  KNOCK_REQUIRED: "복도 문에서 노크한 뒤 들어갈 수 있어요.",
  KNOCK_EXPIRED: "대답이 없어요. 잠시 후 다시 노크해 보세요.",
  RATE_LIMITED: "노크를 너무 자주 했어요. 잠시 후 다시 해 보세요.",
  KNOCK_NOT_FOUND: "노크 상태를 확인하지 못했어요. 다시 노크해 주세요.",
  FAILED: "친구 방을 불러오지 못했어요."
});

export const FRIEND_ROOM_KNOCK_PRIORITY = 155;
// A visit intent (walking to 제1생활관 to knock) lapses after this long.
export const FRIEND_ROOM_VISIT_INTENT_MS = 10 * 60_000;
// Errors after which knocking again cannot help: the intent is dropped.
const TERMINAL = new Set(["NOT_FRIENDS", "TARGET_UNAVAILABLE", "ROOM_NOT_FOUND", "ROOM_PRIVATE", "VISIT_DECLINED",
  "SIGNED_OUT", "PERMANENT_ACCOUNT_REQUIRED", "ACCOUNT_UNAVAILABLE", "SOCIAL_RESTRICTED"]);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export const friendVisitText = Object.freeze({
  guiding: (name) => `${name}님 방으로 가요 · 제1생활관까지 길을 안내할게요.`,
  walk: (name) => `제1생활관 로비의 왼쪽 복도 문에서 ${name}님 방을 노크하세요.`,
  lobby: (name) => `왼쪽 복도 문에서 ${name}님 방을 노크하세요.`,
  waiting: (name) => `${name}님에게 노크했어요 · 대답을 기다리는 중…`,
  ownerAway: (name) => `${name}님은 지금 방에 없어요 · 들어가 볼게요.`,
  accepted: (name) => `${name}님이 들어오래요!`
});

export function createFriendRoomVisitController({
  client, knockClient = null, rooms, isMounted = () => false, isSeated = () => false, standUp = () => {},
  stopFollow = () => {}, isLobbyShell = () => false, onStatus = () => {},
  guideToDorm = () => false,
  returnAnchor = DORM_1_LOBBY_MY_ROOM_RETURN,
  knockSpot = DORM_1_LOBBY_FRIEND_ROOM,
  now = () => Date.now(),
  waitForAnswer = waitForKnockAnswer,
  intentMs = FRIEND_ROOM_VISIT_INTENT_MS
} = {}) {
  let visiting = false;
  let knocking = false;
  let intent = null; // { ownerUserId, ownerDisplayName, visitorUserId, createdAt }

  const say = (code) => onStatus(FRIEND_ROOM_VISIT_TEXT[code] ?? FRIEND_ROOM_VISIT_TEXT.FAILED);
  const errorCode = (error) => (error instanceof FriendRoomVisitError || error instanceof RoomKnockError) ? error.code : "FAILED";

  function liveIntent() {
    if (!intent) return null;
    if (now() - intent.createdAt > intentMs || client?.getSelfUserId?.() !== intent.visitorUserId) intent = null;
    return intent;
  }

  function canVisit() {
    if (!client?.available) return { ok: false, reason: "signed_out" };
    if (isLobbyShell()) return { ok: false, reason: "lobby_shell" };
    const status = rooms?.status?.() ?? {};
    if (status.busy || visiting) return { ok: false, reason: "busy" };
    const space = rooms?.currentSpace;
    if (space !== "campus" && space !== DORM_LOBBY_ID) return { ok: false, reason: "inside_room" };
    if (isMounted()) return { ok: false, reason: "mounted" };
    return { ok: true, reason: null };
  }

  // Step 1 (Player Card / Friends panel): check the room is reachable, then walk there.
  async function visit(ownerUserId, { displayName = null } = {}) {
    const verdict = canVisit();
    if (!verdict.ok) { say(verdict.reason); return verdict; }
    visiting = true;
    try {
      const visitorUserId = client.getSelfUserId?.();
      let name = typeof displayName === "string" && displayName.trim() ? displayName.trim().slice(0, 40) : null;
      try {
        const authority = await client.resolve(ownerUserId);
        name = authority.ownerDisplayName ?? name;
      } catch (error) {
        // The owner being home only means "knock first": the room itself is reachable.
        if (errorCode(error) !== "KNOCK_REQUIRED") throw error;
      }
      if (client.getSelfUserId?.() !== visitorUserId) { say("signed_out"); return { ok: false, reason: "signed_out" }; }
      name ??= "친구";
      intent = { ownerUserId, ownerDisplayName: name, visitorUserId, createdAt: now() };
      if (rooms.currentSpace === DORM_LOBBY_ID) {
        onStatus(friendVisitText.lobby(name));
        return { ok: true, mode: "lobby" };
      }
      if (isSeated()) standUp();
      stopFollow();
      const guided = guideToDorm() === true;
      onStatus(guided ? friendVisitText.guiding(name) : friendVisitText.walk(name));
      return { ok: true, mode: guided ? "guiding" : "walk" };
    } catch (error) {
      const code = errorCode(error);
      say(code);
      return { ok: false, reason: code };
    } finally {
      visiting = false;
    }
  }

  // Step 3: enter through the lobby, like the own-room door, once the knock admits us.
  async function enter(current) {
    const authority = await client.resolve(current.ownerUserId);
    const again = canVisit();
    if (client.getSelfUserId?.() !== current.visitorUserId || !again.ok || rooms.currentSpace !== DORM_LOBBY_ID) {
      return { ok: false, reason: client.getSelfUserId?.() !== current.visitorUserId ? "signed_out" : (again.reason ?? "busy") };
    }
    if (isSeated()) standUp();
    stopFollow();
    const metadata = {
      personalRoomId: authority.roomId, ownerUserId: authority.ownerUserId,
      ownerDisplayName: authority.ownerDisplayName, visitRole: "visitor"
    };
    const isValid = () => client.available && client.getSelfUserId?.() === current.visitorUserId;
    const ok = rooms.enterNested(PERSONAL_ROOM_ID, {
      returnPosition: returnAnchor.position, returnYaw: returnAnchor.yaw, metadata, isValid, fromRoomId: DORM_LOBBY_ID
    });
    if (!ok) return { ok: false, reason: "busy" };
    intent = null;
    return { ok: true, authority };
  }

  // Step 2 (lobby corridor door): knock and wait for the owner, or walk in when the owner is away.
  async function knock() {
    const current = liveIntent();
    if (!current || knocking) return { ok: false, reason: "busy" };
    if (!knockClient?.available) { say("signed_out"); return { ok: false, reason: "signed_out" }; }
    knocking = true;
    try {
      let answer = await knockClient.knock(current.ownerUserId);
      if (answer.status === KNOCK_STATUS.PENDING) {
        onStatus(friendVisitText.waiting(current.ownerDisplayName));
        const result = await waitForAnswer({
          client: knockClient, knock: answer,
          isCancelled: () => intent !== current || rooms.currentSpace !== DORM_LOBBY_ID ||
            client.getSelfUserId?.() !== current.visitorUserId
        });
        if (result.cancelled) return { ok: false, reason: "cancelled" };
        answer = result.knock;
      }
      if (answer.status === KNOCK_STATUS.DECLINED) { intent = null; say("VISIT_DECLINED"); return { ok: false, reason: "VISIT_DECLINED" }; }
      if (answer.status === KNOCK_STATUS.EXPIRED) { say("KNOCK_EXPIRED"); return { ok: false, reason: "KNOCK_EXPIRED" }; }
      onStatus(answer.status === KNOCK_STATUS.OPEN && !answer.ownerPresent
        ? friendVisitText.ownerAway(current.ownerDisplayName) : friendVisitText.accepted(current.ownerDisplayName));
      const entered = await enter(current);
      if (!entered.ok) say(entered.reason);
      return entered;
    } catch (error) {
      const code = errorCode(error);
      if (TERMINAL.has(code)) intent = null;
      say(code);
      return { ok: false, reason: code };
    } finally {
      knocking = false;
    }
  }

  function contextAction({ position, grounded = true, mounted = false } = {}) {
    const current = liveIntent();
    if (!current || rooms?.currentSpace !== DORM_LOBBY_ID || !position || !grounded || mounted) return null;
    const distance = flat(position, knockSpot.position);
    if (distance > knockSpot.radius) return null;
    return {
      id: "friend-room-knock", icon: "🚪",
      label: knocking ? "대답을 기다리는 중…" : `${current.ownerDisplayName}님 방 노크`,
      priority: FRIEND_ROOM_KNOCK_PRIORITY, distance, pressed: knocking,
      trigger: () => { if (!knocking) void knock(); return true; }
    };
  }

  return {
    canVisit, visit, knock, contextAction,
    cancel() { intent = null; },
    get intent() { const current = liveIntent(); return current ? { ...current } : null; },
    get visiting() { return visiting; },
    get knocking() { return knocking; }
  };
}
