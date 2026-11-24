// INHA WORLD — 허브 계정 UI (Firebase Auth + Neon, 2026-11-23 재구축).
//
// 기존 계정 백엔드 전량을 걷어내고 Firebase JS SDK + Tier 4 Worker + Neon으로
// 교체한 버전이다. 신원은 Firebase Auth가, 게임 데이터(프로필·세션)는
// Tier 4 Worker(`/api/auth/firebase/*`, `/api/world-profile`)와 Neon이 맡는다.
//
// 흐름 (ACCOUNT-DESIGN.md §5.1 / §5.3):
//   가입: createUserWithEmailAndPassword → sendEmailVerification → 로그인 흐름
//   로그인: signInWithEmailAndPassword → getIdToken() → authClient.login(idToken)
//     → authClient.me() → guest:true면 프로필 설정 폼 표시
//   프로필 설정: POST /api/world-profile {nickname, departmentId:null,
//     avatarKey:'classic'} (X-Session-Id: 디바이스 세션 id)
//     → 201/200 뒤 authClient.link(idToken) 명시 호출 → refresh()
//   Google: signInWithPopup(new GoogleAuthProvider()) 뒤 동일 흐름.
//     IDENTITY_ALREADY_LINKED 409를 받으면 재시도하지 않고 안내만 띄운다.
//   로그아웃: Firebase signOut + authClient.logout() + refresh().
//
// Firebase SDK는 정적 import가 아니라 동적 import()로 불러온다. 정적 import는
// gstatic CDN에 닿지 않을 때 모듈 전체가 로드 실패해 apiKey 미입력 안내조차
// 뜨지 않기 때문이다. SDK 로드 전에 공개 설정을 먼저 확인하므로, apiKey가
// 비어 있으면 SDK를 불러오지 않고 안내 문구만 보여준다.
// 구 전역 클라이언트는 Firebase 재구축 때 빠졌다가 2026-11-24 브릿지로 복원했다
// (hub-messages.js·hub-friends.js가 Supabase 시절 window.InhaHubAccountClient를
// 기대해 허브 쪽지·친구 화면이 안 떴음). window.InhaHubAccount =
// {authClient, getFirebaseUser, refresh}와 함께 window.InhaHubAccountClient =
// {auth: {getUser, onAuthStateChange}, rpc}를 노출한다.
// 인하 메일 OTP는 Resend 6자리 코드로 구현돼 있다
// (inhaworld-tier04-firebase/INHA-OTP.md, 알돌 "Resend 연동해줘" 2026-11-24).
// 계정 삭제는 Worker 삭제 엔드포인트 + Firebase deleteUser로 구현돼 있다
// (inhaworld-tier04-firebase/DELETE-ACCOUNT.md §2).

import { getFirebasePublicConfig } from './src/config/firebase-public-config.js';
import { createFirebaseAuthClient } from './src/auth/firebase-auth-client.js';

const FIREBASE_APP_URL = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
const FIREBASE_AUTH_URL = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
const API_KEY_MISSING_MESSAGE = 'Firebase 설정(apiKey)이 아직 입력되지 않았습니다';
const ALREADY_LINKED_MESSAGE = '이미 다른 프로필에 연결된 Google 계정입니다';

const status = document.getElementById('hub-account-status');
const loginForm = document.getElementById('hub-login-form');
const signupForm = document.getElementById('hub-signup-form');
const socialAuth = document.getElementById('hub-social-auth');
const googleButton = document.getElementById('hub-google-auth');
const signupAgeConfirm = document.getElementById('hub-signup-age-confirm');
const googleAgeConfirm = document.getElementById('hub-google-age-confirm');
const profileSetup = document.getElementById('hub-profile-setup');
const tabs = document.getElementById('hub-auth-tabs');
const actions = document.getElementById('hub-account-actions');
const inhaCard = document.getElementById('hub-inha-verification-card');
const inhaBadge = document.getElementById('hub-inha-verification-badge');
const inhaStatus = document.getElementById('hub-inha-verification-status');
const inhaControls = document.getElementById('hub-inha-verification-controls');
const inhaEmail = document.getElementById('hub-inha-email');
const inhaCode = document.getElementById('hub-inha-code');
const inhaRequest = document.getElementById('hub-inha-request');
const inhaConfirm = document.getElementById('hub-inha-confirm');
const deleteOpen = document.getElementById('hub-delete-account-open');
const deletePanel = document.getElementById('hub-delete-account-panel');
const deleteInput = document.getElementById('hub-delete-account-confirmation');
const deleteCancel = document.getElementById('hub-delete-account-cancel');
const deleteConfirm = document.getElementById('hub-delete-account-confirm');
const deleteStatus = document.getElementById('hub-delete-account-status');
const linkedIdentities = document.getElementById('hub-linked-identities');
const googleLinkButton = document.getElementById('hub-link-google');
const googleLinkBadge = document.getElementById('hub-google-link-badge');
const googleLinkStatus = document.getElementById('hub-google-link-status');
const signOutButton = document.getElementById('hub-sign-out');
const homeAccountCta = document.getElementById('hub-home-account-cta');
const modeButtons = Array.from(document.querySelectorAll('[data-auth-mode]'));

// UI-only self-declaration, not age verification or a server eligibility gate.
// Never persist this checkbox state or transfer it between accounts.
function resetAgeConfirmations() {
  for (const input of [signupAgeConfirm, googleAgeConfirm]) {
    if (input) input.checked = false;
  }
}

function requireAgeConfirmation(input) {
  if (input?.checked === true) return true;
  if (status) status.textContent = '만 14세 이상인 경우에만 확인란을 선택하고 계속해 주세요.';
  input?.focus();
  input?.reportValidity();
  return false;
}

resetAgeConfirmations();
window.addEventListener('pageshow', () => {
  resetAgeConfirmations();
  if (googleButton) googleButton.disabled = firebaseReady !== true;
});

// 인하대 이메일 OTP는 Resend로 6자리 코드를 발송한다 (INHA-OTP.md).
// 발신 noreply@inhagame.app, 유효 10분, 입력 실패 5회면 잠금.
const inhaEmailPattern = /^[^@\s]+@(inha\.edu|inha\.ac\.kr)$/i;

// ---------------------------------------------------------------------------
// Firebase 초기화 (apiKey 미입력 시 SDK를 불러오지 않고 안내만 보여준다)
// ---------------------------------------------------------------------------

// storage를 안 넘기면 인메모리 Map이 쓰여 세션 id가 localStorage에 안 남는다.
// 그러면 /profile/·캠퍼스·폰 메시지함(localStorage를 직접 읽음)이 로그인을
// 못 알아본다 (2026-11-24 실측: #account만 로그인 표시, 나머지는 전부
// "로그인이 필요합니다"). 설계상 키의 원천은 portal localStorage다.
const authClient = createFirebaseAuthClient({ baseUrl: location.origin, storage: window.localStorage });

let firebaseApp = null;
let firebaseAuth = null;
let firebaseFns = null;
let firebaseReady = false;
let firebaseInitError = null;

async function initFirebase() {
  if (firebaseReady) return true;
  if (firebaseInitError) return false;
  let config;
  try {
    config = getFirebasePublicConfig();
  } catch (error) {
    // apiKey가 비어 있다. 조용히 죽지 않고 안내 문구를 보여준다.
    firebaseInitError = error;
    if (status) status.textContent = API_KEY_MISSING_MESSAGE;
    return false;
  }
  try {
    const appModule = await import(FIREBASE_APP_URL);
    const authModule = await import(FIREBASE_AUTH_URL);
    firebaseFns = authModule;
    firebaseApp = appModule.initializeApp(config);
    firebaseAuth = authModule.getAuth(firebaseApp);
    firebaseReady = true;
    return true;
  } catch (error) {
    console.warn('Hub Firebase SDK load failed', error);
    firebaseInitError = error;
    if (status) status.textContent = 'Firebase SDK를 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.';
    return false;
  }
}

function getFirebaseUser() {
  return firebaseAuth?.currentUser ?? null;
}

function dispatchAuthChanged() {
  window.dispatchEvent(new CustomEvent('inhaworld-auth-changed'));
}

// ---------------------------------------------------------------------------
// 구 전역 클라이언트 브릿지 (Firebase 이관 누락 복원, 2026-11-24)
// ---------------------------------------------------------------------------
// hub-messages.js·hub-friends.js는 Supabase 시절 전역 클라이언트
// window.InhaHubAccountClient(auth.getUser / auth.onAuthStateChange / rpc)를
// 기대하는데, Firebase 재구축 때 이 전역이 사라져 허브 쪽지·친구 화면이
// 초기화부터 "쪽지 서비스를 불러올 수 없습니다."로 멈췄다. 이 브릿지가 같은
// 이름으로 Firebase 기반 구현을 제공한다. rpc 매핑은 게임 폰 어댑터
// (src/phone/phone-messages.js)와 같은 Worker 엔드포인트를 쓰고, 친구 RPC는
// hub-friends-client.js의 RPC 표를 따른다. 모듈 평가 중에 동기적으로
// 설정되므로 뒤에 오는 defer 스크립트(hub-messages.js 등)가 바로 쓴다.
const HUB_BRIDGE_ROUTES = Object.freeze({
  // 쪽지 (hub-messages-client.js)
  get_my_hub_conversations_v1: (args) => ({ method: 'GET',
    path: '/api/hub-messages?limit=' + encodeURIComponent(Math.max(1, Math.min(Number(args?.p_limit) || 50, 100))) }),
  get_my_hub_unread_count_v1: () => ({ method: 'GET', path: '/api/hub-messages/unread' }),
  get_hub_messages_v1: (args) => {
    const params = new URLSearchParams({ conversation: args?.p_conversation || '',
      limit: String(Math.max(1, Math.min(Number(args?.p_limit) || 50, 100))) });
    if (typeof args?.p_before === 'string' && args.p_before) params.set('before', args.p_before);
    return { method: 'GET', path: '/api/hub-messages/thread?' + params.toString() };
  },
  send_hub_message_v1: (args) => ({ method: 'POST', path: '/api/hub-messages/send',
    body: { recipient: args?.p_recipient, body: args?.p_body } }),
  mark_hub_conversation_read_v1: (args) => ({ method: 'POST', path: '/api/hub-messages/read',
    body: { conversation: args?.p_conversation } }),
  archive_hub_conversation_v1: (args) => ({ method: 'POST', path: '/api/hub-messages/archive',
    body: { conversation: args?.p_conversation, archived: args?.p_archived } }),
  report_hub_message_v1: (args) => ({ method: 'POST', path: '/api/hub-messages/report',
    body: { message: args?.p_message, category: args?.p_category } }),
  // 공개 프로필 (쪽지·친구 공통)
  get_world_public_profile: (args) => ({ method: 'GET',
    path: '/api/world-public-profile?target=' + encodeURIComponent(args?.p_target || '') }),
  // 친구 (hub-friends-client.js)
  get_my_world_social: () => ({ method: 'GET', path: '/api/world-social' }),
  respond_world_friend_request: (args) => ({ method: 'POST', path: '/api/world-friend-request',
    body: { action: 'respond', target: args?.p_target, accept: args?.p_accept === true } }),
  cancel_world_friend_request: (args) => ({ method: 'POST', path: '/api/world-friend-request',
    body: { action: 'cancel', target: args?.p_target } }),
  remove_world_friend: (args) => ({ method: 'POST', path: '/api/world-friend-request',
    body: { action: 'remove', target: args?.p_target } }),
  block_world_user: (args) => ({ method: 'POST', path: '/api/world-block-user',
    body: { action: 'block', target: args?.p_target } }),
  unblock_world_user: (args) => ({ method: 'POST', path: '/api/world-block-user',
    body: { action: 'unblock', target: args?.p_target } }),
});

async function hubBridgeRpc(name, args) {
  const route = HUB_BRIDGE_ROUTES[name]?.(args);
  if (!route) return { error: { message: 'FAILED' } };
  const sessionId = authClient.getSessionId();
  if (!sessionId) return { error: { message: 'ACCOUNT_UNAVAILABLE' } };
  try {
    const response = await fetch(route.path, {
      method: route.method,
      headers: route.method === 'POST'
        ? { 'Content-Type': 'application/json', 'X-Session-Id': sessionId }
        : { 'X-Session-Id': sessionId },
      body: route.body ? JSON.stringify(route.body) : undefined,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const code = typeof data?.error === 'string' && data.error ? data.error : 'FAILED';
      return { error: { message: code } };
    }
    return { data };
  } catch {
    return { error: { message: 'FAILED' } };
  }
}

async function hubBridgeGetUser() {
  const firebaseUser = getFirebaseUser();
  const sessionId = authClient.getSessionId();
  if (!firebaseUser || !sessionId) {
    return { data: { user: null }, error: { name: 'AuthSessionMissingError' } };
  }
  let me;
  try {
    me = await authClient.me();
  } catch (error) {
    return { data: { user: null }, error };
  }
  if (!me || me.guest === true || !me.profileUserId) {
    return { data: { user: null }, error: { name: 'AuthSessionMissingError' } };
  }
  return { data: { user: {
    id: me.profileUserId,
    email: firebaseUser.email || null,
    is_anonymous: false,
  } } };
}

function hubBridgeOnAuthStateChange(callback) {
  const handler = () => {
    try { callback('SIGNED_IN', null); } catch { /* 콜백 실패는 무시 */ }
  };
  window.addEventListener('inhaworld-auth-changed', handler);
  return { data: { subscription: { unsubscribe() {
    window.removeEventListener('inhaworld-auth-changed', handler);
  } } } };
}

window.InhaHubAccountClient = Object.freeze({
  auth: Object.freeze({
    getUser: hubBridgeGetUser,
    onAuthStateChange: hubBridgeOnAuthStateChange,
  }),
  rpc: hubBridgeRpc,
});

// 브릿지가 준비됐음을 알린다. hub-messages.js·hub-friends.js는 모듈 로딩
// 순서가 어긋나면 이 전역이 아직 없을 수 있어, 없으면 이 이벤트를 기다린다
// (2026-11-24 QA 새 프로파일에서 로그인 성공 뒤에도 "쪽지 서비스를
// 불러올 수 없습니다."만 뜬 적 있음).
window.dispatchEvent(new CustomEvent('inhaworld-account-client-ready'));

let epoch = 0;
let loginAttempt = 0;
let mode = 'signup';
let pendingNickname = '';
let workerLinkBlocked = false;
const nicknamePattern = /^[0-9A-Za-z가-힣_ -]{2,12}$/u;

function isAlreadyLinkedError(error) {
  return error?.code === 'IDENTITY_ALREADY_LINKED' || error?.status === 409 ||
    /IDENTITY_ALREADY_LINKED/.test(String(error?.message || ''));
}

function isAuthRequiredError(error) {
  return error?.code === 'AUTH_REQUIRED' || error?.status === 401;
}

function setMode(next) {
  mode = next === 'login' ? 'login' : 'signup';
  for (const button of modeButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.authMode === mode));
  }
  if (signupForm) signupForm.hidden = mode !== 'signup';
  if (loginForm) loginForm.hidden = mode !== 'login';
}

function renderInhaVerification(signedIn, verified = false) {
  if (!inhaCard) return;
  inhaCard.hidden = !signedIn;
  if (!signedIn) return;
  if (inhaBadge) inhaBadge.textContent = verified ? '🎓 인증 완료' : '미인증';
  if (inhaStatus) {
    inhaStatus.textContent = verified
      ? '인하대 이메일 소유 확인이 완료됐습니다.'
      : '인하대 이메일 인증은 준비 중입니다';
  }
  // 미인증이어도 OTP 동작은 막는다. 인증이 완료된 상태면 입력 칸을 숨긴다.
  if (inhaControls) inhaControls.hidden = verified;
}

function renderLinkedIdentities(signedIn, firebaseUser) {
  if (!linkedIdentities || !googleLinkButton || !googleLinkBadge || !googleLinkStatus) return;
  linkedIdentities.hidden = !signedIn;
  if (!signedIn) {
    googleLinkStatus.textContent = '';
    return;
  }
  const googleLinked = Array.isArray(firebaseUser?.providerData) &&
    firebaseUser.providerData.some((info) => info?.providerId === 'google.com');
  googleLinkBadge.textContent = googleLinked ? 'Google 연동됨' : '미연동';
  googleLinkButton.textContent = googleLinked ? 'Google 계정 연동됨' : 'Google 계정 연동';
  googleLinkButton.disabled = googleLinked;
  if (!googleLinked && googleLinkStatus.textContent !== 'Google 계정 연결이 완료됐습니다.') {
    googleLinkStatus.textContent = '';
  }
}

function showSignedOutUI(message) {
  if (socialAuth) socialAuth.hidden = false;
  if (tabs) tabs.hidden = false;
  if (actions) actions.hidden = true;
  if (profileSetup) profileSetup.hidden = true;
  if (linkedIdentities) linkedIdentities.hidden = true;
  if (deletePanel) deletePanel.hidden = true;
  if (deleteInput) deleteInput.value = '';
  if (deleteConfirm) deleteConfirm.disabled = true;
  if (deleteStatus) deleteStatus.textContent = '';
  renderInhaVerification(false, false);
  renderLinkedIdentities(false, null);
  if (homeAccountCta) homeAccountCta.hidden = false;
  // 계정 삭제 직후 리다이렉트되면 삭제 완료 문구를 한 번만 보여준다.
  const deleted = sessionStorage.getItem('inhagame-account-deleted-v1') === '1';
  if (deleted) sessionStorage.removeItem('inhagame-account-deleted-v1');
  if (status) {
    status.textContent = deleted
      ? '계정 탈퇴가 완료됐습니다. 서버 계정과 연결 정보가 삭제됐습니다.'
      : message;
  }
  setMode(mode);
}

function showProfileSetupUI(firebaseUser, source) {
  if (tabs) tabs.hidden = true;
  if (socialAuth) socialAuth.hidden = true;
  if (actions) actions.hidden = true;
  if (profileSetup) {
    profileSetup.hidden = false;
    const note = profileSetup.querySelector('p');
    if (note) {
      note.textContent = source === 'google'
        ? 'Google 로그인은 완료됐습니다. INHAGAME에서 사용할 닉네임을 정해 주세요.'
        : 'INHAGAME에서 사용할 닉네임을 정해 주세요.';
    }
    const nicknameInput = profileSetup.elements?.nickname;
    if (nicknameInput && pendingNickname) nicknameInput.value = pendingNickname;
  }
  renderInhaVerification(false, false);
  if (homeAccountCta) homeAccountCta.hidden = true;
  if (status) status.textContent = 'INHAGAME에서 사용할 닉네임을 정해 주세요.';
}

// Firebase 로그인 → Worker 로그인 → /me. guest:true면 프로필 설정이 필요하다.
async function completeFirebaseLogin(firebaseUser) {
  const idToken = await firebaseUser.getIdToken();
  await authClient.login(idToken);
  return authClient.me();
}

async function fetchWorldProfile() {
  const sessionId = authClient.getSessionId();
  if (!sessionId) return null;
  const response = await fetch(`${location.origin}/api/world-profile`, {
    headers: { 'X-Session-Id': sessionId },
  });
  if (response.status === 409) return { noProfile: true };
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  return data?.profile && typeof data.profile === 'object' ? data.profile : null;
}

async function refresh() {
  const current = ++epoch;
  if (!firebaseReady) {
    if (status) {
      status.textContent = firebaseInitError?.message?.startsWith('FIREBASE_API_KEY_MISSING')
        ? API_KEY_MISSING_MESSAGE
        : 'Firebase를 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.';
    }
    if (socialAuth) socialAuth.hidden = false;
    if (tabs) tabs.hidden = false;
    setMode(mode);
    return;
  }
  const firebaseUser = getFirebaseUser();
  if (!firebaseUser) {
    if (current !== epoch) return;
    showSignedOutUI('회원가입하거나 기존 계정으로 로그인하세요.');
    return;
  }

  if (signupForm) signupForm.hidden = true;
  if (loginForm) loginForm.hidden = true;
  // Firebase 사용자가 있으면 가입/로그인 UI는 전부 숨긴다. 폼만 숨기고
  // socialAuth(Google 버튼)·tabs(가입하기/로그인하기 탭)를 남겨두면
  // 로그인 상태에서도 로그인 버튼이 계속 보여서 혼란을 준다 (2026-11-24 실측).
  if (socialAuth) socialAuth.hidden = true;
  if (tabs) tabs.hidden = true;

  // 409로 막힌 연결은 재시도하지 않는다. 로그아웃하면 해제된다.
  if (workerLinkBlocked) {
    if (current !== epoch) return;
    if (status) status.textContent = ALREADY_LINKED_MESSAGE;
    return;
  }

  let me = null;
  try {
    if (authClient.getSessionId()) {
      me = await authClient.me();
    } else {
      me = await completeFirebaseLogin(firebaseUser);
    }
  } catch (error) {
    if (current !== epoch) return;
    if (isAlreadyLinkedError(error)) {
      workerLinkBlocked = true;
      if (status) status.textContent = ALREADY_LINKED_MESSAGE;
      return;
    }
    // 디바이스 세션이 만료됐으면 새 ID 토큰으로 Worker 로그인을 한 번 다시 시도한다.
    if (isAuthRequiredError(error)) {
      try {
        me = await completeFirebaseLogin(firebaseUser);
      } catch (retryError) {
        if (current !== epoch) return;
        if (isAlreadyLinkedError(retryError)) {
          workerLinkBlocked = true;
          if (status) status.textContent = ALREADY_LINKED_MESSAGE;
          return;
        }
        console.warn('Hub Worker login failed', retryError);
        if (status) status.textContent = '계정 상태를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.';
        return;
      }
    } else {
      console.warn('Hub Worker session check failed', error);
      if (status) status.textContent = '계정 상태를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.';
      return;
    }
  }
  if (current !== epoch || !me) return;

  const source = Array.isArray(firebaseUser.providerData) &&
    firebaseUser.providerData.some((info) => info?.providerId === 'google.com')
    ? 'google' : 'email';
  if (me.guest === true) {
    showProfileSetupUI(firebaseUser, source);
    return;
  }

  // guest:false — 닉네임 + 인하 인증 배지는 /api/world-profile에서 읽는다.
  let nickname = typeof me?.nickname === 'string' && me.nickname ? me.nickname : '';
  let inhaVerified = false;
  try {
    const profile = await fetchWorldProfile();
    if (current !== epoch) return;
    if (profile?.noProfile) {
      showProfileSetupUI(firebaseUser, source);
      return;
    }
    if (profile) {
      if (typeof profile.nickname === 'string' && profile.nickname) nickname = profile.nickname;
      inhaVerified = profile.inhaVerified === true;
    }
  } catch (error) {
    // 프로필 읽기에 실패하면 미인증으로 두고 닉네임은 대체값으로 표시한다.
    console.warn('Hub world profile read failed', error);
    inhaVerified = false;
  }
  if (!nickname) {
    nickname = (firebaseUser.email || '').split('@')[0] || 'INHAGAME 사용자';
  }
  if (actions) actions.hidden = false;
  if (profileSetup) profileSetup.hidden = true;
  if (homeAccountCta) homeAccountCta.hidden = true;
  renderInhaVerification(true, inhaVerified);
  renderLinkedIdentities(true, firebaseUser);
  if (status) {
    status.textContent = nickname + (inhaVerified ? ' · 인하대 인증 완료' : ' · 로그인됨');
  }
  // 세션이 (재)확립됐음을 알린다. 부팅 시 refresh()가 세션을 새로 만들면
  // hub-messages.js·hub-friends.js의 syncIdentity가 이 이벤트로 다시 돌아
  // 로그인 상태를 잡는다 (안 그러면 먼저 돈 syncIdentity가 로그인 필요
  // 화면에 머무른다 — 2026-11-24 QA 실측).
  dispatchAuthChanged();
}

for (const button of modeButtons) {
  button.addEventListener('click', () => setMode(button.dataset.authMode));
}

googleButton?.addEventListener('click', async () => {
  if (googleButton.disabled || !requireAgeConfirmation(googleAgeConfirm)) return;
  if (!firebaseReady) {
    if (status) status.textContent = API_KEY_MISSING_MESSAGE;
    return;
  }
  googleButton.disabled = true;
  googleAgeConfirm.checked = false;
  if (status) status.textContent = 'Google 로그인으로 이동하는 중…';
  try {
    const provider = new firebaseFns.GoogleAuthProvider();
    const result = await firebaseFns.signInWithPopup(firebaseAuth, provider);
    await completeFirebaseLogin(result.user);
    dispatchAuthChanged();
    await refresh();
  } catch (googleError) {
    console.warn('Hub Google sign in failed', googleError);
    if (isAlreadyLinkedError(googleError)) {
      workerLinkBlocked = true;
      if (status) status.textContent = ALREADY_LINKED_MESSAGE;
    } else if (String(googleError?.code || '') === 'auth/popup-closed-by-user') {
      if (status) status.textContent = 'Google 로그인을 취소했습니다.';
    } else {
      if (status) status.textContent = 'Google 로그인을 시작하지 못했습니다. 기존 이메일 로그인도 계속 사용할 수 있습니다.';
    }
    googleButton.disabled = false;
  }
});

googleLinkButton?.addEventListener('click', async () => {
  const firebaseUser = getFirebaseUser();
  if (!firebaseReady || !firebaseUser) {
    if (googleLinkStatus) googleLinkStatus.textContent = '로그인한 뒤에 Google 계정을 연결할 수 있습니다.';
    return;
  }
  googleLinkButton.disabled = true;
  if (googleLinkStatus) googleLinkStatus.textContent = 'Google 계정 연결로 이동하는 중…';
  try {
    const provider = new firebaseFns.GoogleAuthProvider();
    const result = await firebaseFns.signInWithPopup(firebaseAuth, provider);
    const credential = firebaseFns.GoogleAuthProvider.credentialFromResult(result);
    if (!credential) throw new Error('GOOGLE_CREDENTIAL_MISSING');
    // 팝업으로 받은 Google 자격 증명을 기존 Firebase 계정에 연결한다.
    await firebaseFns.linkWithCredential(firebaseUser, credential);
    const idToken = await firebaseUser.getIdToken(true);
    await authClient.link(idToken);
    if (googleLinkStatus) googleLinkStatus.textContent = 'Google 계정 연결이 완료됐습니다.';
    dispatchAuthChanged();
    await refresh();
  } catch (error) {
    console.warn('Hub Google identity linking failed', error);
    const code = String(error?.code || '');
    if (isAlreadyLinkedError(error) || code === 'auth/credential-already-in-use') {
      if (googleLinkStatus) googleLinkStatus.textContent = ALREADY_LINKED_MESSAGE;
    } else if (code === 'auth/popup-closed-by-user') {
      if (googleLinkStatus) googleLinkStatus.textContent = 'Google 계정 연결을 취소했습니다.';
    } else {
      if (googleLinkStatus) googleLinkStatus.textContent = 'Google 계정 연동을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }
    googleLinkButton.disabled = false;
  }
});

profileSetup?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!profileSetup.reportValidity()) return;
  const button = profileSetup.querySelector('button[type="submit"]');
  const nickname = profileSetup.elements.nickname.value.trim();
  if (!nicknamePattern.test(nickname)) {
    if (status) status.textContent = '닉네임은 한글·영문·숫자·공백·_·- 조합 2~12자로 입력해 주세요.';
    return;
  }
  const firebaseUser = getFirebaseUser();
  const sessionId = authClient.getSessionId();
  if (!firebaseUser || !sessionId) {
    if (status) status.textContent = '로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.';
    return;
  }
  if (button) button.disabled = true;
  if (status) status.textContent = 'INHAGAME 프로필을 준비하는 중…';
  try {
    const response = await fetch(`${location.origin}/api/world-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
      body: JSON.stringify({ nickname, departmentId: null, avatarKey: 'classic' }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const code = String(data?.error || '');
      if (status) {
        status.textContent = code === 'NICKNAME_TAKEN'
          ? '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.'
          : code === 'INVALID_NICKNAME'
            ? '닉네임은 한글·영문·숫자·공백·_·- 조합 2~12자로 입력해 주세요.'
            : '프로필을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.';
      }
      return;
    }
    // 프로필 생성만으로는 연결되지 않는다. /link를 명시 호출해야 한다.
    pendingNickname = '';
    profileSetup.elements.nickname.value = '';
    const idToken = await firebaseUser.getIdToken();
    try {
      await authClient.link(idToken);
    } catch (linkError) {
      if (isAlreadyLinkedError(linkError)) {
        // 409는 재시도하지 않는다.
        if (status) status.textContent = ALREADY_LINKED_MESSAGE;
        return;
      }
      throw linkError;
    }
    dispatchAuthChanged();
    await refresh();
  } catch (profileError) {
    console.warn('Hub profile completion failed', profileError);
    if (status) status.textContent = '프로필을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.';
  } finally {
    if (button) button.disabled = false;
  }
});

signupForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = signupForm.querySelector('button[type="submit"]');
  if (button?.disabled || !requireAgeConfirmation(signupAgeConfirm)) return;
  if (!signupForm.reportValidity()) return;
  const nickname = signupForm.elements.nickname.value.trim();
  const email = signupForm.elements.email.value.trim().toLowerCase();
  const password = signupForm.elements.password.value;
  const confirmation = signupForm.elements.passwordConfirm.value;

  if (!nicknamePattern.test(nickname)) {
    if (status) status.textContent = '닉네임은 한글·영문·숫자·공백·_·- 조합 2~12자로 입력해 주세요.';
    return;
  }
  if (password.length < 8) {
    if (status) status.textContent = '비밀번호는 8자 이상 입력해 주세요.';
    return;
  }
  if (password !== confirmation) {
    if (status) status.textContent = '비밀번호 확인이 일치하지 않습니다.';
    return;
  }
  if (!firebaseReady) {
    if (status) status.textContent = API_KEY_MISSING_MESSAGE;
    return;
  }

  if (button) button.disabled = true;
  if (status) status.textContent = '회원가입을 처리하는 중…';
  try {
    const credential = await firebaseFns.createUserWithEmailAndPassword(firebaseAuth, email, password);
    pendingNickname = nickname;
    let verificationSent = false;
    try {
      await firebaseFns.sendEmailVerification(credential.user);
      verificationSent = true;
    } catch (verificationError) {
      console.warn('Hub email verification send failed', verificationError);
    }
    signupAgeConfirm.checked = false;
    signupForm.elements.password.value = '';
    signupForm.elements.passwordConfirm.value = '';
    await completeFirebaseLogin(credential.user);
    dispatchAuthChanged();
    await refresh();
    if (verificationSent && status) {
      status.textContent = '인증 메일을 보냈습니다. 메일함에서 이메일 인증을 완료하면 가입이 완료됩니다.';
    }
  } catch (signupError) {
    console.warn('Hub signup failed', signupError);
    const code = String(signupError?.code || '');
    const message = String(signupError?.message || '');
    if (isAlreadyLinkedError(signupError)) {
      workerLinkBlocked = true;
      if (status) status.textContent = ALREADY_LINKED_MESSAGE;
    } else if (status) {
      status.textContent = code === 'auth/email-already-in-use'
        ? '이미 가입된 이메일입니다. 기존 계정으로 로그인해 주세요.'
        : code === 'auth/weak-password'
          ? '사용하기 어려운 비밀번호예요. 8자 이상으로 더 안전하게 입력해 주세요.'
          : code === 'auth/invalid-email'
            ? '이메일 형식을 확인해 주세요.'
            : /too-many-requests/i.test(code + message)
              ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.'
              : '회원가입을 완료하지 못했습니다. 입력 정보를 확인하거나 기존 계정으로 로그인해 주세요.';
    }
  } finally {
    if (button) button.disabled = false;
  }
});

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector('button[type="submit"]');
  if (button?.disabled) return;
  if (!firebaseReady) {
    if (status) status.textContent = API_KEY_MISSING_MESSAGE;
    return;
  }
  const attempt = ++loginAttempt;
  const currentEpoch = epoch;
  if (button) button.disabled = true;
  if (status) status.textContent = '로그인하는 중…';
  try {
    const credential = await firebaseFns.signInWithEmailAndPassword(
      firebaseAuth,
      loginForm.elements.email.value.trim().toLowerCase(),
      loginForm.elements.password.value,
    );
    if (attempt !== loginAttempt || currentEpoch !== epoch) return;
    await completeFirebaseLogin(credential.user);
    dispatchAuthChanged();
    await refresh();
  } catch (loginError) {
    if (attempt !== loginAttempt || currentEpoch !== epoch) return;
    console.warn('Hub login failed', loginError);
    if (isAlreadyLinkedError(loginError)) {
      workerLinkBlocked = true;
      if (status) status.textContent = ALREADY_LINKED_MESSAGE;
    } else if (status) {
      const code = String(loginError?.code || '');
      status.textContent = code === 'auth/invalid-credential' || code === 'auth/wrong-password' ||
        code === 'auth/user-not-found' || code === 'auth/invalid-email'
        ? '로그인에 실패했습니다. 계정 정보를 확인해 주세요.'
        : code === 'auth/too-many-requests'
          ? '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.'
          : '로그인 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.';
    }
  } finally {
    loginForm.elements.password.value = '';
    if (button) button.disabled = false;
  }
});

// 인하대 이메일 인증 (Resend 6자리 OTP): 메일 요청 → 코드 입력·확인.
// 코드는 서버에 해시만 저장되고, 인증이 완료되면 「인하대 인증」 업적이
// 부여되고 배지가 갱신된다 (INHA-OTP.md).
inhaRequest?.addEventListener('click', async () => {
  const email = inhaEmail.value.trim().toLowerCase();
  if (!inhaEmailPattern.test(email)) {
    if (inhaStatus) inhaStatus.textContent = '인하대 이메일(@inha.edu 또는 @inha.ac.kr)을 입력해 주세요.';
    inhaEmail.focus();
    return;
  }
  inhaRequest.disabled = true;
  if (inhaStatus) inhaStatus.textContent = '인증 메일을 보내는 중…';
  try {
    await authClient.requestInhaOtp(email);
    if (inhaStatus) inhaStatus.textContent = '인증 메일을 보냈습니다. 메일의 6자리 코드를 아래에 입력해 주세요.';
    inhaCode?.focus();
  } catch (error) {
    console.warn('Hub inha OTP request failed', error);
    const code = String(error?.code || error?.message || '');
    if (inhaStatus) {
      inhaStatus.textContent = /INVALID_EMAIL/.test(code)
        ? '인하대 이메일(@inha.edu 또는 @inha.ac.kr)을 입력해 주세요.'
        : /RATE_LIMITED/.test(code)
          ? '인증 메일 요청이 많습니다. 잠시 후 다시 시도해 주세요.'
          : /MAIL_SEND_FAILED/.test(code)
            ? '인증 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.'
            : /RESEND_NOT_CONFIGURED/.test(code)
              ? '인증 메일 발송 준비 중입니다. 잠시 후 다시 시도해 주세요.'
              : /PERMANENT_ACCOUNT_REQUIRED/.test(code)
                ? '프로필을 먼저 만들어 주세요.'
                : '인증 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }
  } finally {
    inhaRequest.disabled = false;
  }
});

inhaConfirm?.addEventListener('click', async () => {
  const email = inhaEmail.value.trim().toLowerCase();
  const otpCode = inhaCode.value.trim();
  if (!inhaEmailPattern.test(email)) {
    if (inhaStatus) inhaStatus.textContent = '인하대 이메일(@inha.edu 또는 @inha.ac.kr)을 입력해 주세요.';
    inhaEmail.focus();
    return;
  }
  if (!/^\d{6}$/.test(otpCode)) {
    if (inhaStatus) inhaStatus.textContent = '메일로 받은 6자리 코드를 입력해 주세요.';
    inhaCode?.focus();
    return;
  }
  inhaConfirm.disabled = true;
  if (inhaStatus) inhaStatus.textContent = '인증 코드를 확인하는 중…';
  try {
    const result = await authClient.verifyInhaOtp(email, otpCode);
    if (result?.verified !== true) throw new Error('INHA_VERIFY_FAILED');
    if (inhaCode) inhaCode.value = '';
    if (inhaStatus) inhaStatus.textContent = '🎓 인하대 인증 완료 · 「인하대 인증」 업적을 획득했습니다.';
    await refresh();
  } catch (error) {
    console.warn('Hub inha OTP verify failed', error);
    const code = String(error?.code || error?.message || '');
    if (inhaStatus) {
      inhaStatus.textContent = /INVALID_CODE/.test(code)
        ? '인증 코드가 만료됐거나 올바르지 않습니다. 새 인증 메일을 요청해 주세요.'
        : /CODE_LOCKED/.test(code)
          ? '인증 코드 입력 횟수를 초과했습니다. 새 인증 메일을 요청해 주세요.'
          : '인증 코드를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }
  } finally {
    inhaConfirm.disabled = false;
  }
});

// 계정 삭제 (전에 쓰던 방식 그대로): "탈퇴" 입력 → Worker Neon 삭제
// (POST /api/auth/firebase/delete-account) → Firebase deleteUser() → 로컬
// 정리 → /?panel=account 로 이동해 완료 문구 표시. 서버는 디바이스 세션
// 15분 이내 + 스태프 차단을 RPC 안에서 다시 검사한다.
deleteOpen?.addEventListener('click', () => {
  if (deletePanel) deletePanel.hidden = false;
  if (deleteInput) deleteInput.value = '';
  if (deleteConfirm) deleteConfirm.disabled = true;
  if (deleteStatus) deleteStatus.textContent = '';
  deleteInput?.focus();
});

deleteCancel?.addEventListener('click', () => {
  if (deletePanel) deletePanel.hidden = true;
  if (deleteInput) deleteInput.value = '';
  if (deleteConfirm) deleteConfirm.disabled = true;
  if (deleteStatus) deleteStatus.textContent = '';
});

deleteInput?.addEventListener('input', () => {
  if (deleteConfirm) deleteConfirm.disabled = deleteInput.value.trim() !== '탈퇴';
});

deleteConfirm?.addEventListener('click', async () => {
  if (deleteInput.value.trim() !== '탈퇴') return;
  const firebaseUser = getFirebaseUser();
  if (!firebaseReady || !firebaseUser) {
    if (deleteStatus) deleteStatus.textContent = '로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.';
    return;
  }
  // Firebase deleteUser도 최근 로그인을 요구하고, 서버도 디바이스 세션
  // 15분 이내를 검사한다. 오래된 로그인이면 Neon 삭제를 시도하지 않는다.
  const lastSignIn = Date.parse(firebaseUser.metadata?.lastSignInTime || '');
  if (!Number.isFinite(lastSignIn) || Date.now() - lastSignIn > 15 * 60 * 1000) {
    if (deleteStatus) deleteStatus.textContent = '보안을 위해 로그아웃한 뒤 다시 로그인하고 15분 안에 탈퇴를 다시 시도해 주세요.';
    return;
  }
  deleteConfirm.disabled = true;
  deleteCancel.disabled = true;
  if (deleteStatus) deleteStatus.textContent = '계정을 삭제하는 중…';
  try {
    const result = await authClient.deleteAccount();
    if (result?.deleted !== true) throw new Error('ACCOUNT_DELETE_FAILED');
    // 이 시점에 Neon 데이터는 이미 지워졌다. Firebase 계정 자체를 지운다.
    try {
      await firebaseFns.deleteUser(firebaseUser);
    } catch (firebaseDeleteError) {
      console.warn('Hub Firebase user deletion failed after Neon wipe', firebaseDeleteError);
      if (deleteStatus) {
        deleteStatus.textContent = '서버 기록은 삭제됐지만 Firebase 계정 삭제에 실패했습니다. aldol@inha.edu로 문의해 주세요.';
      }
      deleteCancel.disabled = false;
      return;
    }
    sessionStorage.setItem('inhagame-account-deleted-v1', '1');
    try { localStorage.removeItem('sb-oosshdsthgpqabjmbkjo-auth-token'); } catch {}
    pendingNickname = '';
    workerLinkBlocked = false;
    epoch++;
    loginAttempt++;
    setMode('signup');
    dispatchAuthChanged();
    location.replace('/?panel=account');
  } catch (error) {
    console.warn('Hub account deletion failed', error);
    const code = String(error?.code || error?.message || '');
    if (deleteStatus) {
      deleteStatus.textContent = /ACCOUNT_REAUTH_REQUIRED/.test(code)
        ? '보안을 위해 로그아웃한 뒤 다시 로그인하고 15분 안에 탈퇴를 다시 시도해 주세요.'
        : /STAFF_ACCOUNT_DELETION_BLOCKED/.test(code)
          ? '운영자·GM 계정은 권한을 다른 계정으로 이전한 뒤 탈퇴할 수 있습니다.'
          : '계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }
    deleteConfirm.disabled = deleteInput.value.trim() !== '탈퇴';
    deleteCancel.disabled = false;
  }
});

signOutButton?.addEventListener('click', async () => {
  if (!firebaseReady) {
    if (status) status.textContent = API_KEY_MISSING_MESSAGE;
    return;
  }
  try {
    await firebaseFns.signOut(firebaseAuth);
  } catch (error) {
    console.warn('Hub Firebase sign out failed', error);
    if (status) status.textContent = '로그아웃하지 못했습니다. 다시 시도해 주세요.';
    return;
  }
  try {
    await authClient.logout();
  } catch (error) {
    console.warn('Hub Worker logout failed', error);
  }
  pendingNickname = '';
  workerLinkBlocked = false;
  epoch++;
  loginAttempt++;
  setMode('signup');
  dispatchAuthChanged();
  await refresh();
});

window.InhaHubAccount = Object.freeze({
  authClient,
  getFirebaseUser,
  refresh,
});

// 부팅: apiKey가 비어 있으면 initFirebase() 안에서 안내 문구를 보여주고
// SDK 로드 없이 여기서 끝낸다. Firebase 세션 복원은 onAuthStateChanged가 맡는다.
setMode('signup');
if (await initFirebase()) {
  if (googleButton) googleButton.disabled = false;
  firebaseFns.onAuthStateChanged(firebaseAuth, () => {
    epoch++;
    loginAttempt++;
    resetAgeConfirmations();
    setTimeout(() => void refresh(), 0);
  });
  await refresh();
} else if (firebaseInitError) {
  if (googleButton) googleButton.disabled = true;
  if (socialAuth) socialAuth.hidden = false;
  if (tabs) tabs.hidden = false;
  setMode(mode);
}
