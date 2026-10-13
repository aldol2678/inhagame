// PA-G2 · standalone DOM surface. It never mounts itself in main World, Phone, HUD or a Room.
// PA-G2B-R1: when the World adapter passes `onExit`, the panel also owns keyboard focus (focus is kept
// across re-renders, Tab stays inside, arrows move between tiles) and reports how the session ended.
import { createPuzzleRuntime } from '../core/puzzle-runtime.js';
import { createWaterPathDefinition, waterPathMask, validateWaterPath } from './water-path.js';

const DIR = Object.freeze([[-1, 0], [0, 1], [1, 0], [0, -1]]); // N, E, S, W (same bit order as waterPathMask)
const ARM = Object.freeze(['n', 'e', 's', 'w']);
const PIPE_CSS = `
.water-path-t0{display:grid;gap:12px;justify-items:center}
.water-path-t0 [role=status]{margin:0;font-size:14px;font-weight:800;text-align:center;color:#cfeaf7;transition:color .2s}
.water-path-t0[data-state=CLEARED] [role=status]{color:#9ff0d6}
.wp-board{position:relative;overflow:hidden;padding:10px;border-radius:18px;width:100%;box-sizing:border-box;
  background:radial-gradient(circle at 30% 20%,#14566f,#0a2a3c);box-shadow:inset 0 0 0 1px #4a9bb9,0 6px 20px #0006}
/* Pond surface: two slow ripples drift behind the tiles. */
.wp-board::before,.wp-board::after{content:'';position:absolute;width:46%;aspect-ratio:1;border-radius:50%;
  border:2px solid #9be7ff44;pointer-events:none;opacity:0;animation:wp-ripple 6s ease-out infinite}
.wp-tile{z-index:1}
.wp-board::before,.wp-board::after{z-index:0}
.wp-board::before{left:-8%;top:-12%}
.wp-board::after{right:-10%;bottom:-14%;animation-delay:3s}
.wp-drop{position:absolute;bottom:6%;width:9px;height:13px;margin-left:-4px;border-radius:50% 50% 50% 50%/62% 62% 38% 38%;
  background:linear-gradient(#d9f6ff,#49c4ff);box-shadow:0 0 8px #7fe1ffcc;opacity:0;pointer-events:none;z-index:2;
  animation:wp-rise 1.4s ease-out infinite}
.wp-board[data-cleared=true]{animation:wp-glow 1.1s ease-in-out infinite alternate}
.wp-tile{position:relative;aspect-ratio:1;padding:0;border:0;border-radius:12px;overflow:hidden;cursor:pointer;
  background:linear-gradient(145deg,#1d4f66ee,#143b4fee);box-shadow:inset 0 0 0 1px #2c6a85;
  transition:transform .12s,box-shadow .12s}
.wp-tile:disabled{cursor:default}
.wp-tile:hover:not(:disabled){transform:translateY(-2px);box-shadow:inset 0 0 0 1px #7fd3f0,0 4px 10px #0007}
.wp-tile:focus-visible{outline:3px solid #ffde86;outline-offset:2px}
.wp-block{background:repeating-linear-gradient(45deg,#3b4b53 0 7px,#323f46 7px 14px);box-shadow:inset 0 0 0 1px #566873}
.wp-pipe{position:absolute;inset:0}
.wp-turn .wp-pipe{animation:wp-turn .2s ease-out}
.wp-arm,.wp-hub{position:absolute;background:#7f98a8;box-shadow:inset 0 -2px 0 #0003}
.wp-n,.wp-s{left:36%;width:28%}.wp-e,.wp-w{top:36%;height:28%}
.wp-n{top:0;height:50%}.wp-s{bottom:0;height:50%}.wp-e{right:0;width:50%}.wp-w{left:0;width:50%}
.wp-hub{left:36%;top:36%;width:28%;height:28%;border-radius:50%}
.wp-on .wp-arm,.wp-on .wp-hub{background:linear-gradient(110deg,#49c4ff 0%,#a8ecff 45%,#49c4ff 90%);
  background-size:220% 100%;animation:wp-flow 1.6s linear infinite;box-shadow:0 0 10px #4ccbff99}
.wp-leak{background:#ff7676!important;animation:wp-leak .5s ease-in-out infinite alternate!important;box-shadow:0 0 8px #ff767699!important}
.wp-badge{position:absolute;inset:auto 0 3px 0;text-align:center;font-size:15px;line-height:1;pointer-events:none;
  filter:drop-shadow(0 1px 2px #000a)}
.wp-board[data-cleared=true] .wp-end .wp-badge{animation:wp-bob .6s ease-in-out infinite alternate}
.wp-btn{min-height:44px;min-width:44px;padding:0 14px;border:0;border-radius:12px;font-weight:800;font-size:14px;cursor:pointer;
  color:#eef8ff;background:#2a5f78;box-shadow:inset 0 0 0 1px #4a9bb9}
.wp-btn:hover:not(:disabled){background:#347a99}
.wp-btn:disabled{opacity:.5;cursor:default}
.wp-btn[aria-pressed=true]{background:#e9fbff;color:#06324a;box-shadow:inset 0 0 0 2px #49c4ff}
.wp-btn:focus-visible{outline:3px solid #ffde86;outline-offset:2px}
.wp-primary{background:linear-gradient(#35b6f0,#1f86c4);color:#04202f}
@keyframes wp-flow{to{background-position:-220% 0}}
@keyframes wp-turn{from{transform:rotate(-90deg) scale(.92)}to{transform:none}}
@keyframes wp-leak{from{opacity:.55}to{opacity:1}}
@keyframes wp-glow{from{box-shadow:inset 0 0 0 1px #4a9bb9,0 0 8px #49c4ff55}to{box-shadow:inset 0 0 0 1px #9ff0d6,0 0 24px #9ff0d6aa}}
@keyframes wp-bob{to{transform:translateY(-3px)}}
@keyframes wp-ripple{0%{transform:scale(.4);opacity:.9}100%{transform:scale(1.5);opacity:0}}
@keyframes wp-rise{0%{transform:translateY(0) scale(.6);opacity:0}20%{opacity:1}100%{transform:translateY(-130px) scale(1);opacity:0}}
/* Font-independent endpoint markers: a spring cap on START, a drain ring on END. */
.wp-start .wp-hub{left:28%;top:28%;width:44%;height:44%;background:#e9fbff;box-shadow:0 0 0 3px #49c4ff,0 0 14px #49c4ffcc}
.wp-end .wp-hub{left:28%;top:28%;width:44%;height:44%;background:#0a2a3c;box-shadow:0 0 0 4px #9aa9b3}
.wp-end.wp-on .wp-hub{box-shadow:0 0 0 4px #49c4ff,0 0 14px #49c4ffcc}
.water-path-t0[data-state=CLEARED] .wp-end .wp-hub{box-shadow:0 0 0 4px #9ff0d6,0 0 18px #9ff0d6}
@media (max-height:460px) and (orientation:landscape){
  .water-path-t0{grid-template-columns:auto 1fr;grid-template-areas:'board status' 'board controls';align-items:center;column-gap:16px}
  .water-path-t0>[role=status]{grid-area:status}
  .water-path-t0>.wp-board{grid-area:board;width:auto;max-width:200px!important;padding:8px}
  .water-path-t0>.wp-board[data-size="4"]{max-width:236px!important}
  .water-path-t0>[role=group]:last-child{grid-area:controls;justify-content:center}
}
@media (prefers-reduced-motion:reduce){.water-path-t0 *{animation:none!important;transition:none!important}}
`;
// Display-only flow trace: which tiles carry water and which open ports leak. The rules stay in
// validateWaterPath(); the unit tests assert this trace agrees with it for many boards.
export function waterPathFlow(state) {
  const {size, tiles} = state;
  const active = new Set([0]), queue = [0], leaks = new Set();
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head], row = Math.floor(index / size), col = index % size;
    const ports = waterPathMask(tiles[index].kind, tiles[index].rotation);
    for (let dir = 0; dir < 4; dir++) {
      if (!(ports & (1 << dir))) continue;
      const r = row + DIR[dir][0], c = col + DIR[dir][1];
      const next = r * size + c;
      if (r < 0 || c < 0 || r >= size || c >= size ||
          !(waterPathMask(tiles[next].kind, tiles[next].rotation) & (1 << ((dir + 2) & 3)))) {
        leaks.add(index + ':' + dir);
        continue;
      }
      if (!active.has(next)) { active.add(next); queue.push(next); }
    }
  }
  return Object.freeze({active, leaks});
}
const ARROWS = Object.freeze({
  ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowDown: [1, 0], ArrowLeft: [0, -1]
});
export const WATER_PATH_EXIT = Object.freeze({
  CLOSE: 'CLOSE', ESC: 'ESC', CANCEL: 'CANCEL', ERROR: 'ERROR'
});
export function mountWaterPathPanel(container, options = {}) {
  if (!container || typeof container.append !== 'function' ||
      !container.ownerDocument?.createElement) throw new TypeError('Expected a DOM mount container');
  const {onExit = null, onResult = null, onError = null, onCue = null, sizes = null} = options;
  if ((onExit && typeof onExit !== 'function') || (onResult && typeof onResult !== 'function') ||
      (onError && typeof onError !== 'function') || (onCue && typeof onCue !== 'function')) {
    throw new TypeError('Water path callbacks must be functions');
  }
  const choices = Array.isArray(sizes) ? [...new Set(sizes)].filter(n => n === 3 || n === 4) : [];
  const modal = typeof onExit === 'function';
  const doc = container.ownerDocument;
  const makeRuntime = size => createPuzzleRuntime(createWaterPathDefinition({...options, size}));
  let runtime = makeRuntime(options.size ?? 3);
  const root = doc.createElement('section');
  root.className = 'water-path-t0';
  root.setAttribute('aria-label', '인경호 물길 퍼즐 연습');
  container.append(root);
  const style = doc.createElement('style');
  style.textContent = PIPE_CSS;
  container.append(style);        // after the root: root stays the container's first child
  // Sound is optional feedback: a failing cue never breaks the puzzle.
  const cue = name => { try { onCue?.(name); } catch { /* optional feedback */ } };
  let destroyed = false, exiting = false, reportedResult = null, lastFocusKey = null, turned = -1;

  function makeButton(text, label, key, action, className = 'wp-btn') {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = className;
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
      list.find(button => keyOf(button) === 'ctl-start') ??
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
    root.setAttribute('data-state', snapshot.status);
    const assessment = validateWaterPath(snapshot.state);
    status.textContent = snapshot.status === 'CLEARED' ?
      '물길 연결 성공! ' + snapshot.moves + '회 회전' :
      snapshot.status === 'CANCELLED' ? '연습을 종료했습니다.' :
      '상태: ' + snapshot.status + ' · 회전: ' + snapshot.moves +
      ' · 연결된 칸: ' + assessment.activeTiles +
      ' · 누수: ' + assessment.leaks;

    const board = doc.createElement('div');
    board.className = 'wp-board';
    board.setAttribute('role', 'group');
    board.setAttribute('aria-label', '물길 타일 판');
    board.setAttribute('data-cleared', String(snapshot.status === 'CLEARED'));
    board.setAttribute('data-size', String(snapshot.state.size));
    board.style.display = 'grid';
    board.style.gridTemplateColumns = 'repeat(' + snapshot.state.size + ', minmax(44px, 1fr))';
    board.style.gap = '6px';
    board.style.maxWidth = snapshot.state.size * 72 + 'px';
    const flow = waterPathFlow(snapshot.state);
    for (let index = 0; index < snapshot.state.tiles.length; index++) {
      const tile = snapshot.state.tiles[index];
      const row = Math.floor(index / snapshot.state.size);
      const col = index % snapshot.state.size;
      const mask = waterPathMask(tile.kind, tile.rotation);
      const tag = tile.kind === 'START' ? '출발 ' : tile.kind === 'END' ? '도착 ' : '';
      const wet = flow.active.has(index);
      const leaking = ARM.some((_, dir) => flow.leaks.has(index + ':' + dir));
      const button = makeButton('',
        (row + 1) + '행 ' + (col + 1) + '열 ' + tag + tile.kind + ' 회전' +
          (tile.kind === 'BLOCK' ? '' : wet ? ' · 물이 흐름' : '') + (leaking ? ' · 누수' : ''),
        'tile-' + row + '-' + col,
        () => {
          turned = index;
          const before = waterPathFlow(runtime.snapshot().state).active.size;
          const after = runtime.dispatch({type: 'ROTATE_TILE', row, col});
          cue(after.status === 'CLEARED' ? 'clear'
            : waterPathFlow(after.state).active.size > before ? 'flow' : 'rotate');
          render();
        },
        'wp-tile' + (tile.kind === 'BLOCK' ? ' wp-block' : '') + (tile.kind === 'END' ? ' wp-end' : '') + (tile.kind === 'START' ? ' wp-start' : '') +
          (wet ? ' wp-on' : '') + (turned === index ? ' wp-turn' : ''));
      const pipe = doc.createElement('span');
      pipe.className = 'wp-pipe';
      if (tile.kind !== 'BLOCK') {
        ARM.forEach((name, dir) => {
          if (!(mask & (1 << dir))) return;
          const arm = doc.createElement('span');
          arm.className = 'wp-arm wp-' + name + (flow.leaks.has(index + ':' + dir) ? ' wp-leak' : '');
          pipe.append(arm);
        });
        const hub = doc.createElement('span');
        hub.className = 'wp-hub';
        pipe.append(hub);
      }
      button.append(pipe);
      if (tile.kind === 'START' || tile.kind === 'END') {
        const badge = doc.createElement('span');
        badge.className = 'wp-badge';
        badge.setAttribute('aria-hidden', 'true');
        badge.textContent = tile.kind === 'START' ? '💧' : '⛲';
        button.append(badge);
      }
      button.disabled = snapshot.status !== 'PLAYING' || tile.kind === 'BLOCK';
      board.append(button);
    }
    if (snapshot.status === 'CLEARED') {
      // Celebration droplets: fixed positions, pure CSS motion (disabled by prefers-reduced-motion).
      for (let i = 0; i < 8; i++) {
        const drop = doc.createElement('span');
        drop.className = 'wp-drop';
        drop.setAttribute('aria-hidden', 'true');
        drop.style.left = (8 + i * 12) + '%';
        drop.style.animationDelay = (i % 4) * 0.12 + 's';
        board.append(drop);
      }
    }
    turned = -1;

    const controls = doc.createElement('div');
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', '퍼즐 조작');
    controls.style.display = 'flex';
    controls.style.flexWrap = 'wrap';
    controls.style.gap = '8px';
    if (snapshot.status === 'READY') {
      if (choices.length > 1) {
        for (const n of choices) {
          const pick = makeButton(n + '×' + n, n + '×' + n + ' 난이도', 'size-' + n, () => {
            if (n === snapshot.state.size) return;
            runtime.destroy();
            runtime = makeRuntime(n);
            reportedResult = null;
            cue('rotate');
            render();
          });
          pick.setAttribute('aria-pressed', String(n === snapshot.state.size));
          controls.append(pick);
        }
      }
      controls.append(makeButton('시작', '퍼즐 시작', 'ctl-start', () => {runtime.start(); cue('start'); render();}, 'wp-btn wp-primary'));
    }
    if (snapshot.status === 'PLAYING') {
      const undo = makeButton('되돌리기', '이전 회전 되돌리기', 'ctl-undo', () => {runtime.undo();cue('rotate');render();});
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
      cue('rotate');
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
      style.remove();
      runtime.destroy();
    }
  });
}
