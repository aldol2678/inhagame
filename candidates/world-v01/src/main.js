// INHA WORLD rebuild v0.1 — main loop, movement, HUD, rooms, guestbook, quests.
import * as THREE from '../vendor/three.module.js';
import { createCampus } from './campus.js';
import { pickAdapter } from './api.js';
import { store } from './store.js';
import { createFirebaseAuthClient } from './firebase-auth-client.js';

// ---- Firebase Auth (Tier 4) ----
// Web firebaseConfig: Firebase 콘솔 웹 앱(inhaworld-portal) 설정값.
// apiKey는 클라이언트 설정값(공개용)이며 Worker 시크릿이 아니다.
// Worker는 /api/auth/firebase/config로 {projectId, authDomain}만 내놓는다.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCbbDDAD6OmsTBpJlauD_QofEmpuh5df7E',
  authDomain: 'inhaworld-auth.firebaseapp.com',
  projectId: 'inhaworld-auth',
  storageBucket: 'inhaworld-auth.firebasestorage.app',
  messagingSenderId: '511172871683',
  appId: '1:511172871683:web:2be56b2cefee311b20f036',
};
// Same-host /api/* (Cloudflare Worker route -> inha-world-tier04).
const tier4 = createFirebaseAuthClient({ baseUrl: window.location.origin, storage: window.localStorage });

const $ = (id) => document.getElementById(id);
const hudRoom = $('hud-room');
const hudPos = $('hud-pos');
const hudQuest = $('hud-quest');
const hudMode = $('hud-mode');
const statusLine = $('status-line');
const roomListEl = $('room-list');
const questListEl = $('quest-list');
const guestbookEl = $('guestbook-list');
const guestRoomSelect = $('guest-room');
const nicknameInput = $('nickname');
const messageInput = $('guest-message');

let adapter = null;
let mode = 'local';
let rooms = [];
let quests = [];
let progress = {};
let currentRoomId = null;
let progressLoaded = false;
const completing = new Set();

nicknameInput.value = store.nickname() || '';

// ---- 3D setup ----
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = false;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc3e8);
scene.fog = new THREE.Fog(0x9fc3e8, 85, 240);
const camera = new THREE.PerspectiveCamera(70, 1, 0.08, 310);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(20, 30, 10);

scene.add(sun);
scene.add(new THREE.HemisphereLight(0xe9f2ff, 0xb5ac8c, 1.35));
let campus;
try {
  campus = await createCampus(scene);
} catch (error) {
  statusLine.textContent = '캠퍼스 로딩 실패: ' + error.message;
  throw error;
}
const roomCenters = campus.rooms;

// Player state
const player = { ...campus.spawn, yaw: Math.PI, speed: 8 };
const keys = new Set();
let dragging = false;
let lastPointer = null;

// Touch joystick (left half) + look drag (right half)
const joy = { active: false, id: null, dx: 0, dy: 0 };
const joyBase = $('joy-base');
const joyKnob = $('joy-knob');

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || 480;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function updateCamera() {
  camera.position.set(player.x, campus.groundHeight(player.x, player.z) + 2.2, player.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = 0;
}

function nearestRoom() {
  let best = null;
  let bestD = Infinity;
  for (const r of rooms) {
    const c = roomCenters[r.id];
    if (!c) continue;
    const d = Math.hypot(player.x - c.x, player.z - c.z);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best && bestD <= (best.radius || 9) ? best : null;
}

function refreshHud() {
  const room = nearestRoom();
  const newRoom = room ? room.id : null;
  if (newRoom !== currentRoomId) {
    currentRoomId = newRoom;
    if (room && progressLoaded) onEnterRoom(room);
  }
  hudRoom.textContent = room ? room.name : '캠퍼스 길';
  hudPos.textContent = `x ${player.x.toFixed(1)} · z ${player.z.toFixed(1)}`;
  const done = quests.filter((q) => progress[q.id] && progress[q.id].status === 'done').length;
  hudQuest.textContent = `퀘스트 ${done}/${quests.length}`;
  hudMode.textContent = mode === 'sync' ? '온라인 (동기화 연결됨)' : mode === 'online' ? '온라인 (로컬 서버 연결됨)' : '로컬 모드 (서버 없음 · 이 기기에 저장)';
}

async function onEnterRoom(room) {
  const visit = quests.find((q) => q.type === 'visit' && q.roomId === room.id);
  if (!visit || (progress[visit.id] && progress[visit.id].status === 'done')) return;
  await completeQuest(visit, { roomId: room.id }, true);
}

async function completeQuest(quest, evidence, silent) {
  if (!progressLoaded || completing.has(quest.id) || progress[quest.id]?.status === 'done') return false;
  completing.add(quest.id);
  const nickname = store.nickname();
  try {
    if (mode !== 'local') {
      if (!nickname) {
        if (!silent) statusLine.textContent = '진행 저장은 닉네임이 필요합니다. 닉네임을 입력하고 저장 버튼을 눌러주세요.';
        return false;
      }
      await adapter.ensureSession(nickname);
      const done = await adapter.completeQuest(quest.id, evidence);
      progress[quest.id] = { status: done.status, updatedAt: done.updatedAt };
    } else {
      // Local mode: guest visit quests complete locally; guestbook
      // quests still need a guestbook entry (checked in renderQuest).
      progress[quest.id] = { status: 'done', updatedAt: new Date().toISOString() };
      store.setProgress(quest.id, 'done');
    }
    renderQuests();
    refreshHud();
    if (!silent) statusLine.textContent = `퀘스트 완료: ${quest.title}`;
    return true;
  } catch (e) {
    if (!silent) statusLine.textContent = '진행 저장 실패: ' + e.message + ' (로컬에는 저장되지 않았습니다)';
    return false;
  } finally {
    completing.delete(quest.id);
  }
}

function renderRooms() {
  roomListEl.innerHTML = '';
  guestRoomSelect.innerHTML = '';
  for (const r of rooms) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.textContent = `${r.name} — ${r.description}`;
    b.addEventListener('click', () => {
      const c = roomCenters[r.id];
      if (c && campus.canStand(c.x,c.z)) { player.x = c.x; player.z = c.z; player.yaw = c.viewYaw ?? Math.PI; updateCamera(); refreshHud(); }
      guestRoomSelect.value = r.id;
      renderGuestbook();
    });
    li.appendChild(b);
    roomListEl.appendChild(li);
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    guestRoomSelect.appendChild(opt);
  }
  if (rooms.length && !guestRoomSelect.value) guestRoomSelect.value = rooms[0].id;
}

function renderQuests() {
  questListEl.innerHTML = '';
  for (const q of quests) {
    const done = progress[q.id] && progress[q.id].status === 'done';
    const li = document.createElement('li');
    li.textContent = `${done ? '✓' : '○'} ${q.title} — ${q.description}`;
    if (!done && q.type === 'guestbook') {
      const hint = document.createElement('span');
      hint.textContent = ' (방명록을 남기면 완료 버튼이 나옵니다)';
      li.appendChild(hint);
    }
    if (!done) {
      const btn = document.createElement('button');
      btn.textContent = q.type === 'guestbook' ? '방명록 확인하고 완료하기' : '완료하기';
      btn.addEventListener('click', async () => {
        if (q.type === 'guestbook') {
          const entries = await adapter.getGuestbook(q.roomId);
          const mine = entries.some((e) => e.nickname === store.nickname());
          if (!mine) { statusLine.textContent = '먼저 해당 방에 방명록을 남겨주세요.'; return; }
        }
        await completeQuest(q, { roomId: q.roomId }, false);
      });
      li.appendChild(document.createTextNode(' '));
      li.appendChild(btn);
    }
    questListEl.appendChild(li);
  }
}

async function renderGuestbook() {
  const roomId = guestRoomSelect.value || (rooms[0] && rooms[0].id);
  if (!roomId) return;
  guestbookEl.innerHTML = '<li>불러오는 중…</li>';
  try {
    const entries = await adapter.getGuestbook(roomId);
    guestbookEl.innerHTML = '';
    if (!entries.length) guestbookEl.innerHTML = '<li>아직 방명록이 없습니다. 첫 글을 남겨보세요.</li>';
    for (const e of entries.slice(-20).reverse()) {
      const li = document.createElement('li');
      li.textContent = `${e.nickname}: ${e.message}`;
      guestbookEl.appendChild(li);
    }
  } catch (e) {
    guestbookEl.innerHTML = `<li>방명록을 불러오지 못했습니다 (${e.message}). 로컬 모드에서는 이 기기에 저장된 글만 보입니다.</li>`;
  }
}

// ---- Input: keyboard, mouse, touch ----
window.addEventListener('keydown', (e) => { keys.add(e.key.toLowerCase()); });
window.addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); });

canvas.addEventListener('click', () => {
  if (window.matchMedia('(pointer: fine)').matches && canvas.requestPointerLock) {
    canvas.requestPointerLock();
  }
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) {
    player.yaw -= e.movementX * 0.003;
  } else if (dragging && lastPointer) {
    player.yaw -= (e.clientX - lastPointer.x) * 0.005;
    lastPointer = { x: e.clientX, y: e.clientY };
  }
});
canvas.addEventListener('mousedown', (e) => { dragging = true; lastPointer = { x: e.clientX, y: e.clientY }; });
window.addEventListener('mouseup', () => { dragging = false; });

canvas.addEventListener('touchstart', (e) => {
  for (const t of e.changedTouches) {
    if (t.clientX < window.innerWidth / 2 && !joy.active) {
      joy.active = true; joy.id = t.identifier; joy.dx = 0; joy.dy = 0;
      joyBase.style.display = 'block';
      joyBase.style.left = (t.clientX - 60) + 'px';
      joyBase.style.top = (t.clientY - 60) + 'px';
    } else {
      lastPointer = { x: t.clientX, y: t.clientY, id: t.identifier };
    }
  }
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    if (joy.active && t.identifier === joy.id) {
      const dx = Math.max(-50, Math.min(50, t.clientX - (parseFloat(joyBase.style.left) + 60)));
      const dy = Math.max(-50, Math.min(50, t.clientY - (parseFloat(joyBase.style.top) + 60)));
      joy.dx = dx / 50; joy.dy = dy / 50;
      joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (lastPointer && t.identifier === lastPointer.id) {
      player.yaw -= (t.clientX - lastPointer.x) * 0.006;
      lastPointer = { x: t.clientX, y: t.clientY, id: t.identifier };
    }
  }
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
  for (const t of e.changedTouches) {
    if (joy.active && t.identifier === joy.id) {
      joy.active = false; joy.dx = 0; joy.dy = 0;
      joyBase.style.display = 'none';
      joyKnob.style.transform = 'translate(0,0)';
    }
    if (lastPointer && t.identifier === lastPointer.id) lastPointer = null;
  }
});

// ---- Buttons ----
$('save-nickname').addEventListener('click', () => {
  const name = nicknameInput.value.trim();
  if (!name) { statusLine.textContent = '닉네임을 입력해 주세요.'; return; }
  store.setNickname(name);
  statusLine.textContent = `닉네임 저장됨: ${name}`;
});
guestRoomSelect.addEventListener('change', renderGuestbook);
$('guest-submit').addEventListener('click', async () => {
  const roomId = guestRoomSelect.value;
  const nickname = nicknameInput.value.trim();
  const message = messageInput.value.trim();
  if (!nickname) { statusLine.textContent = '닉네임을 먼저 입력해 주세요.'; return; }
  if (!message) { statusLine.textContent = '메시지를 입력해 주세요.'; return; }
  store.setNickname(nickname);
  try {
    await adapter.addGuestbook(roomId, nickname, message);
    messageInput.value = '';
    statusLine.textContent = `방명록 저장됨 (${mode === 'local' ? '이 기기 로컬' : '서버'})`;
    await renderGuestbook();
    renderQuests();
  } catch (e) {
    // Server write failed: fall back to local storage so the note is not lost.
    const { LocalAdapter } = await import('./api.js').catch(() => ({}));
    if (LocalAdapter) {
      const local = new LocalAdapter();
      await local.addGuestbook(roomId, nickname, message);
      statusLine.textContent = '서버 저장 실패 — 로컬에 저장했습니다: ' + e.message;
      await renderGuestbook();
    } else {
      statusLine.textContent = '방명록 저장 실패: ' + e.message;
    }
  }
});
$('refresh-guestbook').addEventListener('click', renderGuestbook);

// ---- Firebase Auth UI ----
// Login is optional: the game keeps working as a guest without it.
// Auth failures never break the game (all handlers catch and report).
const authStatusEl = $('auth-status');
const authEmailInput = $('auth-email');
const authPasswordInput = $('auth-password');
const authProfileRow = $('auth-profile-row');

function setAuthStatus(text) {
  if (authStatusEl) authStatusEl.textContent = text;
}

// The optional SDK must never block parsing or the first world frame.
function loadSdkScript(name) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://www.gstatic.com/firebasejs/10.12.2/' + name + '-compat.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('로그인 SDK를 불러오지 못했습니다.'));
    document.head.appendChild(script);
  });
}
let authReady;
function firebaseAuth() {
  if (!authReady) {
    authReady = (async () => {
      if (!window.firebase?.apps) await loadSdkScript('firebase-app');
      if (!window.firebase?.auth) await loadSdkScript('firebase-auth');
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      return firebase.auth();
    })().catch(error => {
      authReady = undefined;
      throw error;
    });
  }
  return authReady;
}

async function refreshAuthState() {
  try { await firebaseAuth(); } catch {
    setAuthStatus('로그인 SDK를 불러오지 못했습니다. 게임은 게스트로 계속할 수 있습니다.');
    return;
  }
  const sessionId = tier4.getSessionId();
  if (!sessionId) {
    setAuthStatus('로그인하지 않음 — 게스트로 플레이 중입니다.');
    authProfileRow.style.display = 'none';
    return;
  }
  try {
    const me = await tier4.me();
    const who = me.email ? me.email : (me.provider === 'anonymous' ? '익명 게스트' : '로그인됨');
    setAuthStatus(`로그인됨: ${who}`);
    await refreshProfileRow();
  } catch (e) {
    // Dead session (logged out elsewhere, or a pre-revamp session after
    // the epoch bump): drop the stored id locally; the game keeps
    // working as a guest.
    if (e.status !== 401) {
      setAuthStatus('로그인 서버에 연결할 수 없습니다. 게스트로 계속할 수 있습니다.');
      authProfileRow.style.display = 'none';
      return;
    }
    window.localStorage.removeItem(tier4.SESSION_KEY);
    setAuthStatus('이전 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
    authProfileRow.style.display = 'none';
  }
}

async function refreshProfileRow() {
  const sessionId = tier4.getSessionId();
  if (!sessionId) { authProfileRow.style.display = 'none'; return; }
  try {
    const res = await fetch('/api/world-profile', { headers: { 'x-session-id': sessionId } });
    authProfileRow.style.display = res.status === 409 ? 'block' : 'none';
  } catch { authProfileRow.style.display = 'none'; }
}

async function exchangeIdToken(user) {
  const idToken = await user.getIdToken();
  const res = await tier4.login(idToken);
  const who = res.email ? res.email : (res.provider === 'anonymous' ? '익명 게스트' : '로그인됨');
  setAuthStatus(`로그인됨: ${who}`);
  if (!res.userId) {
    authProfileRow.style.display = 'block';
    statusLine.textContent = '로그인 완료 — 프로필을 만들어 주세요.';
  } else {
    authProfileRow.style.display = 'none';
    statusLine.textContent = `로그인 완료: ${who}`;
  }
  return res;
}

async function withAuthError(fn, label) {
  try {
    await fn();
  } catch (e) {
    const code = (e && (e.code || e.message)) || 'unknown';
    statusLine.textContent = `${label} 실패: ${code}`;
    setAuthStatus(`로그인 실패: ${code}`);
  }
}

$('auth-email-login').addEventListener('click', () => withAuthError(async () => {
  const auth = await firebaseAuth();
  if (!auth) return;
  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  if (!email || !password) { statusLine.textContent = '이메일과 비밀번호를 입력해 주세요.'; return; }
  const cred = await auth.signInWithEmailAndPassword(email, password);
  await exchangeIdToken(cred.user);
}, '이메일 로그인'));

$('auth-email-signup').addEventListener('click', () => withAuthError(async () => {
  const auth = await firebaseAuth();
  if (!auth) return;
  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  if (!email || !password) { statusLine.textContent = '이메일과 비밀번호를 입력해 주세요.'; return; }
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  await cred.user.sendEmailVerification().catch(() => {});
  await exchangeIdToken(cred.user);
  statusLine.textContent = '가입 완료 — 인증 메일을 보냈습니다. 메일함에서 인증해 주세요.';
}, '이메일 가입'));

$('auth-google').addEventListener('click', () => withAuthError(async () => {
  const auth = await firebaseAuth();
  if (!auth) return;
  const cred = await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  await exchangeIdToken(cred.user);
}, 'Google 로그인'));

$('auth-anon').addEventListener('click', () => withAuthError(async () => {
  const auth = await firebaseAuth();
  if (!auth) return;
  const cred = await auth.signInAnonymously();
  await exchangeIdToken(cred.user);
}, '게스트 로그인'));

$('auth-logout').addEventListener('click', () => withAuthError(async () => {
  try { await tier4.logout(); } catch { /* server row may already be gone */ }
  const auth = await firebaseAuth();
  if (auth) await auth.signOut().catch(() => {});
  authProfileRow.style.display = 'none';
  setAuthStatus('로그아웃됨 — 게스트로 플레이 중입니다.');
  statusLine.textContent = '로그아웃했습니다.';
}, '로그아웃'));

$('auth-create-profile').addEventListener('click', () => withAuthError(async () => {
  const sessionId = tier4.getSessionId();
  if (!sessionId) { statusLine.textContent = '먼저 로그인해 주세요.'; return; }
  const nickname = nicknameInput.value.trim();
  if (nickname.length < 2 || nickname.length > 12) {
    statusLine.textContent = '프로필 닉네임은 2~12자여야 합니다.';
    return;
  }
  const res = await fetch('/api/world-profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-id': sessionId },
    body: JSON.stringify({ nickname }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('http ' + res.status));
  authProfileRow.style.display = 'none';
  statusLine.textContent = `프로필 생성됨: ${nickname}`;
  setAuthStatus(`로그인됨: ${nickname}`);
}, '프로필 만들기'));

// ---- Movement loop ----
let last = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  let fx = 0;
  let fz = 0;
  if (keys.has('w') || keys.has('arrowup')) fz -= 1;
  if (keys.has('s') || keys.has('arrowdown')) fz += 1;
  if (keys.has('a') || keys.has('arrowleft')) fx -= 1;
  if (keys.has('d') || keys.has('arrowright')) fx += 1;
  if (joy.active) { fx += joy.dx; fz += joy.dy; }
  const len = Math.hypot(fx, fz);
  if (len > 0.01) {
    fx /= Math.max(1, len);
    fz /= Math.max(1, len);
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    const dx = (fx * cos + fz * sin) * player.speed * dt;
    const dz = (-fx * sin + fz * cos) * player.speed * dt;
    const next = campus.move(player.x, player.z, dx, dz);
    player.x = next.x;
    player.z = next.z;
  }
  updateCamera();
  refreshHud();
  campus.updateVisibility(player.x,player.z);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

// ---- Boot ----
async function boot() {
  resize();
  requestAnimationFrame(tick);
  const picked = await pickAdapter();
  adapter = picked.adapter;
  mode = picked.mode;
  try {
    rooms = await adapter.getRooms();
    quests = await adapter.getQuests();
  } catch (e) {
    statusLine.textContent = '방/퀘스트 목록을 불러오지 못했습니다: ' + e.message;
    rooms = [];
    quests = [];
  }
  if (mode !== 'local' && store.nickname()) {
    try {
      await adapter.ensureSession(store.nickname());
      progress = await adapter.getProgress();
      progressLoaded = true;
    } catch { progress = {}; }
  } else if (mode === 'local') {
    progress = store.progress();
    progressLoaded = true;
  } else {
    progressLoaded = true;
  }
  currentRoomId = null;
  renderRooms();
  renderQuests();
  await renderGuestbook();
  // Auth restore is non-blocking: a dead session must never delay the game.
  refreshAuthState().catch(() => {});
  statusLine.textContent = mode === 'sync'
    ? '동기화 서버에 연결되었습니다. 닉네임 세션으로 진행도가 모든 기기에서 공유됩니다.'
    : mode === 'online'
      ? '서버에 연결되었습니다. 닉네임 세션으로 진행도가 저장됩니다.'
      : '로컬 모드입니다. 서버가 꺼져 있어도 이 기기에서 방명록과 퀘스트가 동작합니다.';
}
boot();
