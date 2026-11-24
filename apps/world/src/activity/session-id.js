// INHA WORLD — 스냅샷 세션 id 공급자 (Firebase + Neon 계정 재구축, 2026-11-23).
//
// Tier 4 클라이언트들이 X-Session-Id로 쓰는 세션 id를 스냅샷 기준으로 읽는다.
// Tier 4 원본이 전제하는 v0.1 키('inha-v01:sync-session' / 'inha-v01:server-session',
// fishing-reporter-wiring.js)는 스냅샷에 없어서, 그 모듈을 import하지 않고
// 스냅샷의 키를 직접 읽는다. 읽는 순서와 규칙:
//
//   1. `inhaworld-firebase-session-v1` — Firebase 로그인 뒤 발급된 디바이스 세션 id.
//      로그인 흐름(게스트 프로필 생성 → /link)을 제대로 밟으면 이 세션의 액터는
//      연결된 프로필 user id와 같다. /link 전에는 새 액터라 게임 데이터가 비어
//      보일 수 있다 — 그 경우의 복구는 프로필 생성 뒤 /link 명시 호출이다.
//   2. `inhaworld-guest-session-v1` — world-online 게스트 세션 id.
//      world-online가 게스트 세션을 열 때 이 키에 쓴다. 게스트가 프로필을 만들면
//      서버는 이 id를 프로필 user id로 쓰므로, 로그인 때 guestSessionId로 보내면
//      identity에 연결된다 (ACCOUNT-DESIGN.md §4 규칙 3).
//   3. 없으면 null — id를 절대 만들어내지 않는다. null이면 클라이언트는
//      SIGNED_OUT / UNAVAILABLE로 떨어진다.
//
// firebase-auth-client.js가 쓰는 스토리지 키와 같은 키를 공유한다
// (키 이름이 유일한 진실의 원천이다). 키가 바뀌면 양쪽을 함께 바꿀 것.

export const SNAPSHOT_FIREBASE_SESSION_KEY = "inhaworld-firebase-session-v1";
export const SNAPSHOT_PROFILE_USER_KEY = "inhaworld-profile-user-v1";
export const SNAPSHOT_GUEST_SESSION_KEY = "inhaworld-guest-session-v1";

export function readSnapshotSessionId(storage = globalThis.localStorage) {
  for (const key of [SNAPSHOT_FIREBASE_SESSION_KEY, SNAPSHOT_GUEST_SESSION_KEY]) {
    try {
      const value = storage?.getItem?.(key);
      if (typeof value === "string" && value.length > 0) return value;
    } catch {
      // storage blocked: treat as no session.
    }
  }
  return null;
}

// Tier 4 이관 클라이언트들이 import하는 이름과 맞춘 별칭이다.
// 이관본을 스냅샷에 복사할 때는 import 경로만
// `../activity/fishing-reporter-wiring.js` → `../activity/session-id.js` 로
// 바꾸면 된다. 함수 이름은 바꾸지 않는다.
export const readGuestSessionId = readSnapshotSessionId;
