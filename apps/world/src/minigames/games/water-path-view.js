// PA-G2 · standalone DOM surface. It never mounts itself in main World, Phone, HUD or a Room.
// PA-G2B-R1: when the World adapter passes `onExit`, the panel also owns keyboard focus (focus is kept
// across re-renders, Tab stays inside, arrows move between tiles) and reports how the session ended.
import { createPuzzleRuntime } from '../core/puzzle-runtime.js';
import { createWaterPathDefinition, waterPathMask, validateWaterPath } from './water-path.js';

const GLYPHS = Object.freeze({
  0:'·',1:'╵',2:'╶',3:'└',4:'╷',5:'│',6:'┌',7:'├',
  8:'╴',9:'┘',10:'─',11:'┴',12:'┐',13:'┤',14:'┬',15:'┼'
});
const ARROWS = Object.freeze({
  ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowDown: [1, 0], ArrowLeft: [0, -1]
});
export const WATER_PATH_EXIT = Object.freeze({
  CLOSE: 'CLOSE', ESC: 'ESC', CANCEL: 'CANCEL', ERROR: 'ERROR'
});
export function mountWaterPathPanel(container, options = {}) {
  if (!container || typeof container.append !== 'function' ||
      !container.ownerDocument?.createElement) throw new TypeError('Expected a DOM mount container');
  const {onExit = null, onResult = null, onError = null} = options;
  if ((onExit && typeof onExit !== 'function') || (onResult && typeof onResult !== 'function') ||
      (onError && typeof onError !== 'function')) throw new TypeError('Water path callbacks must be functions');
  const modal = typeof onExit === 'function';
  const doc = container.ownerDocument;
  const runtime = createPuzzleRuntime(createWaterPathDefinition(options));
  const root = doc.createElement('section');
  root.className = 'water-path-t0';
  root.setAttribute('aria-label', '인경호 물길 퍼즐 연습');
  container.append(root);
  let destroyed = false, exiting = false, reportedResult = null, lastFocusKey = null;

  function makeButton(text, label, key, action) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.setAttribute('aria-label', label);
    button.setAttribute('data-focus-key', key);
    button.style.minWidth = '44px';
    button.style.minHeight = '44px';
    button.addEventListener('click', () => guard(action));
    return button;
  }
  // A failing action ends a World session through onError; standalone callers keep the thrown error.
  function guard(action) {
    if (destroyed || exiting) return;
    try { action(); } catch (error) {
      if (!onError) throw error;
      exiting = true;
      onError(error);
    }
  }
  function exit(reason) {
    if (destroyed || exiting || !modal) return;
    exiting = true;
    onExit({reason});
  }
  const buttons = () => Array.from(root.querySelectorAll?.('button') ?? []);
  const enabledButtons = () => buttons().filter(button => !button.disabled);
  const keyOf = node => node?.getAttribute?.('data-focus-key') ?? null;
  function focusByKey(key) {
    const list = enabledButtons();
    const target = list.find(button => keyOf(button) === key) ??
      list.find(button => keyOf(button)?.startsWith('tile-')) ?? list[0];
    if (!target) return false;
    target.focus?.();
    lastFocusKey = keyOf(target);
    return true;
  }
  function render() {
    if (destroyed || exiting) return;
    const active = doc.activeElement;
    const hadFocus = modal && active && root.contains?.(active);
    if (hadFocus) lastFocusKey = keyOf(active) ?? lastFocusKey;
    const snapshot = runtime.snapshot();
    const status = doc.createElement('p');
    status.setAttribute('role', 'status');
    const assessment = validateWaterPath(snapshot.state);
    status.textContent = snapshot.status === 'CLEARED' ?
      '물길 연결 성공! ' + snapshot.moves + '회 회전' :
      snapshot.status === 'CANCELLED' ? '연습을 종료했습니다.' :
      '상태: ' + snapshot.status + ' · 회전: ' + snapshot.moves +
      ' · 연결된 칸: ' + assessment.activeTiles +
      ' · 누수: ' + assessment.leaks;

    const board = doc.createElement('div');
    board.setAttribute('role', 'group');
    board.setAttribute('aria-label', '물길 타일 판');
    board.style.display = 'grid';
    board.style.gridTemplateColumns = 'repeat(' + snapshot.state.size + ', minmax(44px, 1fr))';
    board.style.gap = '6px';
    for (let index = 0; index < snapshot.state.tiles.length; index++) {
      const tile = snapshot.state.tiles[index];
      const row = Math.floor(index / snapshot.state.size);
      const col = index % snapshot.state.size;
      const mask = waterPathMask(tile.kind, tile.rotation);
      const tag = tile.kind === 'START' ? '출발 ' : tile.kind === 'END' ? '도착 ' : '';
      const button = makeButton(tag + GLYPHS[mask],
        (row + 1) + '행 ' + (col + 1) + '열 ' + tag + tile.kind + ' 회전',
        'tile-' + row + '-' + col,
        () => {
          runtime.dispatch({type: 'ROTATE_TILE', row, col});
          render();
        });
      button.disabled = snapshot.status !== 'PLAYING' || tile.kind === 'BLOCK';
      board.append(button);
    }

    const controls = doc.createElement('div');
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', '퍼즐 조작');
    controls.style.display = 'flex';
    controls.style.flexWrap = 'wrap';
    controls.style.gap = '8px';
    if (snapshot.status === 'READY') {
      controls.append(makeButton('시작', '퍼즐 시작', 'ctl-start', () => {runtime.start(); render();}));
    }
    if (snapshot.status === 'PLAYING') {
      const undo = makeButton('되돌리기', '이전 회전 되돌리기', 'ctl-undo', () => {runtime.undo();render();});
      undo.disabled = !snapshot.canUndo;
      controls.append(undo, makeButton('일시정지', '퍼즐 일시정지', 'ctl-pause', () => {runtime.pause();render();}));
    }
    if (snapshot.status === 'PAUSED') {
      controls.append(makeButton('계속', '퍼즐 재개', 'ctl-resume', () => {runtime.resume();render();}));
    }
    if (snapshot.status === 'PLAYING' || snapshot.status === 'PAUSED') {
      controls.append(makeButton('종료', '퍼즐 연습 종료', 'ctl-cancel', () => {
        runtime.cancel();
        report(runtime.snapshot().status);
        if (modal) exit(WATER_PATH_EXIT.CANCEL); else render();
      }));
    }
    controls.append(makeButton('처음부터', '같은 문제 다시 시작', 'ctl-restart', () => {
      runtime.restart();
      reportedResult = null;
      render();
    }));
    if (modal) controls.append(makeButton('닫기', '물길 퍼즐 닫기', 'ctl-close', () => exit(WATER_PATH_EXIT.CLOSE)));
    root.replaceChildren(status, board, controls);
    report(snapshot.status);
    // The first render and any render that replaced the focused control keep keyboard focus inside.
    if (modal && (hadFocus || lastFocusKey === null)) focusByKey(lastFocusKey);
  }
  // Local result only (CLEARED / CANCELLED): once per run, nothing is stored or granted.
  function report(status) {
    if ((status !== 'CLEARED' && status !== 'CANCELLED') || reportedResult === status) return;
    reportedResult = status;
    try { onResult?.({status, moves: runtime.snapshot().moves}); } catch { /* observers never break the panel */ }
  }
  function onKeydown(event) {
    if (!modal || destroyed || exiting || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Escape') {
      event.preventDefault?.();
      event.stopPropagation?.();
      exit(WATER_PATH_EXIT.ESC);
      return;
    }
    if (event.code === 'Tab') {
      const list = enabledButtons();
      if (!list.length) return;
      const at = list.indexOf(doc.activeElement);
      const next = list[(at + (event.shiftKey ? list.length - 1 : 1)) % list.length];
      event.preventDefault?.();
      next.focus?.();
      lastFocusKey = keyOf(next);
      return;
    }
    const step = ARROWS[event.code];
    const current = keyOf(doc.activeElement);
    if (!step || !current?.startsWith('tile-')) return;
    const size = runtime.snapshot().state.size;
    const [row, col] = current.slice(5).split('-').map(Number);
    for (let r = row + step[0], c = col + step[1]; r >= 0 && c >= 0 && r < size && c < size;
      r += step[0], c += step[1]) {
      const target = buttons().find(button => keyOf(button) === 'tile-' + r + '-' + c);
      if (target && !target.disabled) {
        event.preventDefault?.();
        target.focus?.();
        lastFocusKey = keyOf(target);
        return;
      }
    }
  }
  if (modal) root.addEventListener('keydown', event => guard(() => onKeydown(event)));
  render();
  return Object.freeze({
    snapshot: () => runtime.snapshot(),
    // Brings focus back inside after the browser dropped it (rotation, resize, blur).
    restoreFocus() {
      if (!modal || destroyed || exiting) return false;
      const active = doc.activeElement;
      if (active && root.contains?.(active)) return true;
      return focusByKey(lastFocusKey);
    },
    get focusKey() { return lastFocusKey; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.remove();
      runtime.destroy();
    }
  });
}
