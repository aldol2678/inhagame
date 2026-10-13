// JSL-C1: public-lobby book-search tutorial. No client award, real lending claim or real staff likeness.
import { createInputFocusOwner } from '../input/input-focus-owner.js';
import { INPUT_FOCUS_POLICY } from '../input/input-focus-manager.js';
import { getQuestDefinition, QUEST_STATE } from '../quest/quest-registry.js';
import { JEONGSEOK_LOBBY_ROOM_ID } from './lobby-layout.js';

export const JSL_BOOK_QUEST_ID = 'quest.side.jeongseok_first_book';
export const JSL_BOOK_RPC = 'advance_jeongseok_book_quest_v1';
export const JSL_BOOKS = Object.freeze([
  Object.freeze({ id: 'pride_prejudice', title: '오만과 편견', author: '제인 오스틴', subject: '문학' }),
  Object.freeze({ id: 'origin_species', title: '종의 기원', author: '찰스 다윈', subject: '자연과학' }),
  Object.freeze({ id: 'brief_history_time', title: '시간의 역사', author: '스티븐 호킹', subject: '자연과학' })
]);
// Fictional sample records: titles/authors only, not current Jeongseok holdings or shelf locations.
export const JSL_BOOK_ANCHORS = Object.freeze({
  librarian: Object.freeze({ x: -1.9, z: -5.8, radius: 1.1 }),
  kiosk: Object.freeze({ x: 4.5, z: -5.8, radius: 1.2 })
});
export function jslBookNear(context, target) {
  if (context?.space !== JEONGSEOK_LOBBY_ROOM_ID || !context.grounded || context.mounted || context.busy ||
      !context.position || !Number.isFinite(context.position.x) || !Number.isFinite(context.position.z)) return null;
  const distance = Math.hypot(context.position.x - target.x, context.position.z - target.z);
  return distance <= target.radius ? distance : null;
}
export function jslBookQuestPresentation(stage) {
  if (!Number.isInteger(stage) || stage < 0 || stage > 4) return null;
  const definition = getQuestDefinition(JSL_BOOK_QUEST_ID);
  if (!definition) return null;
  const state = stage === 4 ? QUEST_STATE.COMPLETED : stage === 0 ? QUEST_STATE.AVAILABLE : QUEST_STATE.ACTIVE;
  return Object.freeze({
    ...definition, state, stage, tracked: false,
    progress: Object.freeze({ completed: stage, total: 4 }),
    currentObjective: stage === 4 ? null : definition.objectives[stage]
  });
}

export function createJeongseokBookQuest({ getClient, getContext, inputFocus, onProgress = () => {},
  doc = globalThis.document } = {}) {
  if (typeof getClient !== 'function' || typeof getContext !== 'function' || !inputFocus || !doc?.body)
    throw new TypeError('JSL-C1 requires client, world context, focus and document');
  const owner = createInputFocusOwner({ manager: inputFocus, ownerId: 'jsl-c1-book-quest',
    policy: INPUT_FOCUS_POLICY.BLOCKING_UI });
  const panel = doc.createElement('section');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', '정석 도서 탐색');
  panel.hidden = true;
  panel.style.cssText = 'position:fixed;z-index:1500;left:50%;top:50%;transform:translate(-50%,-50%);width:min(92vw,430px);max-height:78vh;overflow:auto;background:#182430;color:#fff;border:1px solid #70849a;border-radius:16px;padding:20px;box-sizing:border-box;box-shadow:0 14px 50px #0009;font:15px/1.5 sans-serif';
  doc.body.append(panel);
  let accountId = null, epoch = 0, stage = null, open = false, busy = false, status = 'SIGNED_OUT';
  let origin = 'librarian', opener = null;
  const el = (tag, text) => { const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
  function button(text, callback, disabled = false) {
    const b = el('button', text); b.type = 'button'; b.disabled = disabled;
    b.style.cssText = 'padding:8px 12px;margin:4px;background:#344b62;color:#fff;border:1px solid #8ea3b3;border-radius:8px;cursor:pointer';
    b.addEventListener('click', callback); return b;
  }
  function publish() { onProgress(status === 'READY' ? jslBookQuestPresentation(stage) : null); }
  function close() {
    if (!open) return false;
    open = false; panel.hidden = true; owner.release();
    const target = opener; opener = null;
    if (target?.isConnected && typeof target.focus === 'function') target.focus();
    return true;
  }
  function render() {
    if (!open) return;
    panel.replaceChildren();
    const heading = el('h2', origin === 'kiosk' ? '🔎 정석 도서 검색' : '📖 정석 사서 도우미');
    heading.style.margin = '0 0 10px';
    const closeButton = button('닫기', close);
    panel.append(heading, closeButton);
    panel.append(el('p', 'INHA WORLD 게임용 가상 도서관 체험입니다. 실제 대출·소장·좌석 정보가 아닙니다.'));
    if (!accountId) panel.append(el('p', '로그인하면 도서 탐색 퀘스트 진행을 계정에 저장할 수 있어요.'));
    else if (status !== 'READY') {
      panel.append(el('p', status === 'LOADING' ? '퀘스트 기록 확인 중…' :
        '서버 퀘스트가 아직 준비되지 않았어요. 아래 책 목록은 체험할 수 있어요.'));
      panel.append(button('기록 다시 확인', () => void refresh(), busy));
    } else {
      const objective = ['사서에게 첫 의뢰 받기', '공개 검색 단말로 이동하기',
        '제인 오스틴의 책 찾기', '사서에게 조사 결과 알리기', '첫 도서 탐색 완료!'][stage];
      panel.append(el('p', '진행 ' + stage + '/4 · ' + objective));
      if (origin === 'librarian' && stage === 0)
        panel.append(button('첫 도서 찾기 시작', () => void advance('start'), busy));
      if (origin === 'kiosk' && stage === 1)
        panel.append(button('검색 단말 사용하기', () => void advance('search'), busy));
      if (origin === 'librarian' && stage === 3)
        panel.append(button('책 찾은 결과 보고', () => void advance('report'), busy));
      if (stage === 4) panel.append(el('p', '완료 기록이 서버에 저장됐어요. 인덕코인·XP 지급은 없습니다.'));
    }
    if (origin === 'kiosk') {
      panel.append(el('p', '연습용 도서 목록 · 실시간 정석 소장 정보가 아닙니다.'));
      for (const book of JSL_BOOKS) {
        const line = el('div');
        line.append(button(book.title + ' · ' + book.author + ' (' + book.subject + ')',
          () => void advance('select:' + book.id), busy || !accountId || status !== 'READY' || stage !== 2));
        panel.append(line);
      }
      const link = el('a', '현실 도서 검색은 정석 공식 홈페이지에서 확인');
      link.href = 'https://lib.inha.ac.kr/'; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.style.color = '#b5dcff'; panel.append(link);
    }
  }
  async function request(event, ticket) {
    const client = getClient();
    if (!client?.rpc || !accountId) return null;
    const { data, error } = await client.rpc(JSL_BOOK_RPC, { p_event: event });
    if (error || data?.quest_id !== 'jsl_first_book_search_v1' ||
        !Number.isInteger(data.stage) || data.stage < 0 || data.stage > 4) return null;
    return ticket === epoch ? data.stage : null;
  }
  async function refresh() {
    const ticket = ++epoch;
    if (!accountId) { status = 'SIGNED_OUT'; stage = null; publish(); render(); return false; }
    busy = true; status = 'LOADING'; publish(); render();
    try {
      const next = await request('status', ticket);
      if (ticket !== epoch) return false;
      stage = next; status = next === null ? 'UNAVAILABLE' : 'READY'; publish(); return next !== null;
    } catch {
      if (ticket !== epoch) return false;
      stage = null; status = 'UNAVAILABLE'; publish(); return false;
    } finally { if (ticket === epoch) { busy = false; render(); } }
  }
  async function advance(event) {
    if (!accountId || status !== 'READY' || busy ||
        !((event === 'start' && stage === 0 && origin === 'librarian') ||
          (event === 'search' && stage === 1 && origin === 'kiosk') ||
          (event === 'select:pride_prejudice' && stage === 2 && origin === 'kiosk') ||
          (event === 'report' && stage === 3 && origin === 'librarian'))) return false;
    const ticket = ++epoch;
    busy = true; render();
    try {
      const next = await request(event, ticket);
      if (ticket !== epoch) return false;
      if (next === null) { status = 'UNAVAILABLE'; stage = null; }
      else stage = next;
      publish(); return next !== null;
    } catch {
      if (ticket !== epoch) return false;
      status = 'UNAVAILABLE'; stage = null; publish(); return false;
    } finally { if (ticket === epoch) { busy = false; render(); } }
  }
  function openAt(which) {
    if (!['librarian', 'kiosk'].includes(which) || jslBookNear(getContext(), JSL_BOOK_ANCHORS[which]) === null) return false;
    if (!open) { opener = doc.activeElement; owner.acquire(); open = true; panel.hidden = false; }
    origin = which; render();
    panel.querySelector('button')?.focus();
    if (accountId && status === 'UNAVAILABLE') void refresh();
    return true;
  }
  function observe(which) {
    if (open && getContext()?.space !== JEONGSEOK_LOBBY_ROOM_ID) close();
    const distance = jslBookNear(getContext(), JSL_BOOK_ANCHORS[which]);
    if (distance === null) return null;
    return { id: 'jsl-c1-' + which, icon: which === 'librarian' ? '📖' : '🔎',
      label: which === 'librarian' ? '가상 사서와 대화' : '도서 검색 체험',
      priority: 270, distance, pressed: false, trigger: () => openAt(which) };
  }
  function onKey(event) { if (event.key === 'Escape' && open) { event.preventDefault(); close(); } }
  doc.addEventListener('keydown', onKey);
  return {
    observe, close, refresh,
    setAccount(id) {
      if (id === accountId) return Promise.resolve(false);
      ++epoch; close(); accountId = id || null; stage = null; busy = false;
      status = accountId ? 'UNAVAILABLE' : 'SIGNED_OUT'; publish();
      return accountId ? refresh() : Promise.resolve(false);
    },
    status: () => ({ accountId, stage, state: status, open, busy }),
    destroy() { ++epoch; close(); owner.release(); doc.removeEventListener('keydown', onKey); panel.remove(); publish(); }
  };
}
