// INHA WORLD — Firebase 공개 웹 앱 설정 (Firebase + Neon 계정 재구축, 2026-11-23).
//
// 이 파일은 공개 클라이언트 설정이다. Firebase 웹 apiKey는 비밀값이 아니라
// 웹 앱의 공개 식별자라서 클라이언트 번들에 평문으로 들어간다. 실제 보호는
// 다음 세 가지가 한다:
//   1. Firebase 콘솔의 HTTP 리퍼러 제한 — inhaworld-portal 웹 앱 설정에서
//      허용 도메인을 inhagame.app(및 프리뷰 도메인)으로 제한할 것.
//   2. Tier 4 Worker의 ID 토큰 검증 (Google JWKS, RS256).
//   3. Neon의 세션/409 가드 (IDENTITY_ALREADY_LINKED).
// apiKey만으로는 계정을 만들 수 없지만, 리퍼러 제한 없이 두면 다른 사이트에서
// 남용할 수 있으니 콘솔 제한은 필수다.
//
// ⚠ apiKey 값은 들어 있다 (2026-11-23 브라우저로 콘솔 확인, 이 파일에만 둠).
// 값은 채팅·MEMORY.md·보고서에 적지 않는다.
// apiKey가 비어 있으면 getFirebasePublicConfig()가 에러를 던지고 허브 계정 UI가
// 그 사유를 그대로 보여준다 (조용히 죽지 않는다).

export const FIREBASE_PUBLIC_CONFIG = Object.freeze({
  // Firebase 콘솔 inhaworld-portal 웹 앱 설정값 (2026-11-23 브라우저로 확인).
  apiKey: "AIzaSyCbbDDAD6OmsTBpJlauD_QofEmpuh5df7E",
  authDomain: "inhaworld-auth.firebaseapp.com",
  projectId: "inhaworld-auth",
});

export function getFirebasePublicConfig() {
  const config = FIREBASE_PUBLIC_CONFIG;
  if (typeof config.apiKey !== "string" || config.apiKey.length === 0) {
    throw new Error(
      "FIREBASE_API_KEY_MISSING: Firebase 웹 앱 설정(apiKey)이 아직 입력되지 않았습니다. " +
      "Firebase 콘솔 → inhaworld-auth → inhaworld-portal 웹 앱 설정에서 복사해 " +
      "src/config/firebase-public-config.js에 넣어 주세요."
    );
  }
  return config;
}
