import { createInputFocusOwner } from '../input/input-focus-owner.js';
import { INPUT_FOCUS_POLICY } from '../input/input-focus-manager.js';
import { PHOTO_ENTRY_BLOCK_MESSAGES } from '../photo/photo-mode-panel.js';

export const ROOM_PHOTO_STORY_OWNER = 'room-photo-story';
const MOODS = Object.freeze({ study: '공부하는 방', relax: '쉬어 가는 방' });
const TITLES = Object.freeze({ mood: '1 · 오늘의 분위기', layout: '2 · 가진 가구로 꾸미기',
  light: '3 · 빛과 커튼', compose: '4 · 자리를 잡고 한 장', album: '5 · 내 앨범에서 확인', done: '방의 한 장면을 남겼어요' });

// A session-local guide to existing features, not a quest/progression or storage authority.
// Only an actual, read-back-verified local album record can advance the last step.
export function createRoomPhotoStory({ getContext, inputFocus, photoMode, openEditor,
  openAlbum, getEnvironment = () => ({}), onStatus = () => {}, fallbackFocus = null,
  doc = globalThis.document, win = globalThis.window } = {}) {
  const owner = createInputFocusOwner({ manager: inputFocus, ownerId: ROOM_PHOTO_STORY_OWNER, policy: INPUT_FOCUS_POLICY.BLOCKING_UI });
  const node = (tag, text) => { const el = doc.createElement(tag); if (text) el.textContent = text; return el; };
  const root = node('section'); root.className = 'room-photo-story'; root.id = 'room-photo-story'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', '방의 한 장면'); root.tabIndex = -1;
  doc.body.append(root);
  let key = null, generation = 0, shot = 0, editorRun = 0, ownPhoto = false, destroyed = false, previousFocus = null;
  let stage = 'mood', mood = null, record = null, message = '', buttons = [], renderKey = '';
  const context = () => getContext?.() ?? {};
  const sessionKey = c => c.active && !c.busy && ownsRoom(c) ? JSON.stringify([c.accountId ?? null, c.roomId ?? null, c.ownerUserId ?? null, c.role ?? null]) : null;
  const ownsRoom = c => !!c.accountId && c.role === 'owner' && c.ownerUserId === c.accountId;
  const canEdit = c => ownsRoom(c) && c.ready === true && !c.editing && !c.pending && !c.reading && !c.error;
  const snapshot = () => Object.freeze({ active: key !== null, open: !root.hidden, stage, mood, savedPhotoId: record?.id ?? null, generation, ownPhoto });
  function close({ restoreFocus = true } = {}) {
    const wasOpen = !root.hidden; root.hidden = true; owner.release(); renderKey = '';
    if (wasOpen && restoreFocus) {
      const target = previousFocus?.isConnected && !previousFocus.hidden && !previousFocus.disabled ? previousFocus : fallbackFocus;
      target?.focus?.({ preventScroll: true });
    }
    previousFocus = null; return wasOpen;
  }
  function reset() {
    close({ restoreFocus: false }); generation++; shot++; editorRun++; ownPhoto = false; key = null;
    stage = 'mood'; mood = null; record = null; message = '';
  }
  function sync() {
    const c = context(), next = sessionKey(c);
    if (next !== key) { reset(); key = next; }
    return key !== null;
  }
  function usable() { return !destroyed && sync() && !context().blocked; }
  function show() {
    if (!usable() || (!owner.active && !inputFocus.can('WORLD_ACTION'))) return false;
    if (!root.hidden) { render(); return true; }
    previousFocus = doc.activeElement; root.hidden = false; owner.acquire(); render(); buttons[0]?.focus?.({ preventScroll: true }); return true;
  }
  function step(next) { if (!usable()) return false; stage = next; message = ''; render(); return true; }
  function edit() {
    if (!usable() || !canEdit(context())) return false;
    const mine = generation, at = key, attempt = ++editorRun; let finished = false;
    // Restore the live Room HUD/canvas before the next UI snapshots its return focus.
    close();
    const started = openEditor?.({ recommendationStyle: mood, onDone: () => {
      if (finished || !usable() || mine !== generation || at !== key || attempt !== editorRun) return;
      finished = true; stage = 'light'; message = ''; show();
    } });
    if (started !== true) { message = '저장된 배치를 확인한 뒤 다시 눌러 주세요.'; show(); return false; }
    return true;
  }
  function photograph() {
    if (!usable()) return false;
    close(); shot++;
    const started = photoMode.open({ origin: 'ROOM_PHOTO_STORY' });
    if (!started) {
      ownPhoto = false;
      message = PHOTO_ENTRY_BLOCK_MESSAGES[photoMode.blockedReason()] ?? '지금은 사진 모드를 열 수 없어요.';
      show(); return false;
    }
    return true;
  }
  // Called by getCaptureContext once per shutter request. A newer attempt must not
  // inherit the previous shot's successful album state if it fails or is cancelled.
  function ticket() {
    if (!usable() || !ownPhoto || !photoMode.active) return null;
    shot++; record = null; stage = 'compose'; message = '';
    return Object.freeze({ generation, shot, key });
  }
  function captured(saved, token) {
    if (!token || !usable() || !ownPhoto || !photoMode.active || token.generation !== generation || token.shot !== shot || token.key !== key) return false;
    if (!saved?.id) { record = null; stage = 'compose'; message = '앨범에 저장되지 않았어요. 사진 모드에서 원본 PNG를 직접 저장하거나 다시 촬영해 주세요.'; return false; }
    record = saved; stage = 'album'; message = ''; return true;
  }
  function albumViewed(saved) {
    if (!usable() || !record?.id || saved?.id !== record.id || stage !== 'album') return false;
    stage = 'done'; message = ''; return true;
  }
  function album() {
    if (!usable() || !record) return false;
    const saved = record; close();
    if (openAlbum?.(saved) === true) return true;
    message = '앨범을 열지 못했어요. 다른 창을 닫고 다시 눌러 주세요.'; show(); return false;
  }
  function action(text, id, fn, disabled = false) {
    const button = node('button', text); button.type = 'button'; button.dataset.roomStory = id; button.disabled = disabled;
    // Reject a retained DOM callback after a new room/account/guide session.
    const mine = generation;
    button.addEventListener('click', () => { if (!button.disabled && usable() && mine === generation && !root.hidden && buttons.includes(button)) fn(); });
    buttons.push(button); return button;
  }
  function render() {
    if (root.hidden) return;
    const c = context(), env = getEnvironment(), signature = JSON.stringify([stage, mood, message, canEdit(c), env.lightsOn, env.curtainsOpen]);
    if (signature === renderKey) return; renderKey = signature;
    const focus = buttons.find(button => button === doc.activeElement)?.dataset.roomStory;
    buttons = [];
    const card = node('div'); card.className = 'room-photo-story-card';
    const header = node('header'); header.append(node('h2', '방의 한 장면'), action('닫기', 'close', () => close()));
    card.append(header, node('p', '약 10분 · 이번 입실 중에는 닫았다가 이어갈 수 있어요.'), node('h3', TITLES[stage]));
    const actions = node('div'); actions.className = 'room-photo-story-actions';
    if (stage === 'mood') {
      card.append(node('p', '오늘 이 방에서 보내고 싶은 시간을 골라요.'));
      for (const [id, label] of Object.entries(MOODS)) actions.append(action(label, id, () => { mood = id; step('layout'); }));
    } else if (stage === 'layout') {
      card.append(node('p', `${MOODS[mood] ?? '나만의 방'} · 가진 가구만 미리 배치해요. 가구를 한두 개 옮기거나 돌려 보세요. 저장을 눌러야 다음 방문에도 남아요.`));
      if (!canEdit(c)) card.append(node('p', '방 배치 확인이 끝나면 미리볼 수 있어요. 보유 가구가 없어도 현재 배치로 계속할 수 있어요.'));
      actions.append(action('보유 가구로 미리보기', 'edit', edit, !canEdit(c)), action('지금 배치로 다음', 'keep-layout', () => step('light')),
        action('분위기 다시 고르기', 'mood', () => step('mood')));
    } else if (stage === 'light') {
      card.append(node('p', '출입문 옆 스위치에서 천장 조명을, 창문 앞에서 커튼을 조절해요. 가까이 가서 F 또는 화면의 행동 버튼을 눌러요.'),
        node('p', `천장 조명 ${env.lightsOn === false ? '꺼짐' : '켜짐'} · 커튼 ${env.curtainsOpen === false ? '닫힘' : '열림'}. 빛과 커튼은 이번 입실 동안만 유지돼요.`));
      actions.append(action('방에서 빛과 자리 맞추기', 'adjust-light', () => {
        step('compose'); close(); onStatus('출입문 옆은 조명, 창문 앞은 커튼이에요. 준비되면 내 방의 ‘방의 한 장면’을 다시 눌러 주세요.');
      }), action('현재 빛으로 사진 준비', 'keep-light', () => step('compose')));
    } else if (stage === 'compose') {
      card.append(node('p', '마음에 드는 자리에 서거나 앉아 보세요. 사진 모드에서 시점·높이·화각을 조절하고 촬영해요. 사진 모드를 닫아도 여기서 다시 시작할 수 있어요.'));
      actions.append(action('사진 모드 열기', 'photo', photograph), action('빛과 커튼 안내', 'light', () => step('light')));
      if (ownsRoom(c)) actions.append(action('가구 다시 꾸미기', 'layout', () => step('layout')));
    } else if (stage === 'album') {
      card.append(node('p', '이 기기의 내 앨범에 저장했어요. 실제 사진을 열어 한 장면을 확인해 보세요.'));
      actions.append(action('내 앨범에서 사진 확인', 'album', album), action('다시 찍기', 'retake', () => { step('compose'); photograph(); }));
    } else {
      card.append(node('p', '내 앨범에서 다시 꺼내 볼 수 있어요. 가구는 직접 저장한 배치가 남고, 빛과 커튼은 다음 입실 때 초기화돼요.'));
      actions.append(action('사진 다시 보기', 'album', album), action('다른 한 장면 만들기', 'restart', () => {
        generation++; shot++; ownPhoto = false; record = null; mood = null; step('mood');
      }));
    }
    card.append(actions);
    const status = node('p', message); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); card.append(status);
    const privacy = node('p', '사진은 이 기기·이 브라우저의 앨범에만 저장돼요. 자동 업로드나 친구 공유는 없으며, 브라우저 데이터를 지우면 사라질 수 있어요.'); privacy.className = 'room-photo-story-privacy'; card.append(privacy);
    root.replaceChildren(card);
    if (focus) (buttons.find(button => button.dataset.roomStory === focus && !button.disabled) ?? buttons[0])?.focus?.({ preventScroll: true });
  }
  root.addEventListener('keydown', event => {
    if (root.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const available = buttons.filter(button => !button.disabled), at = available.indexOf(doc.activeElement);
      if (at < 0 || (!event.shiftKey && at === available.length - 1) || (event.shiftKey && at === 0)) {
        event.preventDefault(); (event.shiftKey ? available.at(-1) : available[0])?.focus?.();
      }
    }
    event.stopPropagation();
  });
  root.addEventListener('pointerdown', event => event.stopPropagation());
  root.addEventListener('click', event => event.stopPropagation());
  const offPhoto = photoMode.subscribe(({ active, origin }) => {
    if (origin !== 'ROOM_PHOTO_STORY') return;
    ownPhoto = active;
    if (!active) { shot++; if (stage === 'compose') message = message || '촬영을 마치지 않았어요. 원하는 자리에서 다시 열 수 있어요.'; }
  });
  const offFocus = inputFocus.subscribe(s => {
    if (!root.hidden && s.topOwners.some(id => id !== ROOM_PHOTO_STORY_OWNER)) close({ restoreFocus: false });
  });
  const pagehide = () => reset(); win?.addEventListener('pagehide', pagehide);
  return Object.freeze({ root, open: show, close, reset, ticket, captured, albumViewed, status: snapshot,
    update() { if (destroyed) return false; sync(); if (!root.hidden && context().blocked) close({ restoreFocus: false }); render(); },
    destroy() { if (destroyed) return; reset(); destroyed = true; offPhoto(); offFocus(); win?.removeEventListener('pagehide', pagehide); root.remove(); }
  });
}
