// PA-G2 · standalone DOM surface. It never mounts in main World, Phone, HUD or a Room.
import { createPuzzleRuntime } from '../core/puzzle-runtime.js';
import { createWaterPathDefinition, waterPathMask, validateWaterPath } from './water-path.js';

const GLYPHS = Object.freeze({
  0:'·',1:'╵',2:'╶',3:'└',4:'╷',5:'│',6:'┌',7:'├',
  8:'╴',9:'┘',10:'─',11:'┴',12:'┐',13:'┤',14:'┬',15:'┼'
});
export function mountWaterPathPanel(container, options = {}) {
  if (!container || typeof container.append !== 'function' ||
      !container.ownerDocument?.createElement) throw new TypeError('Expected a DOM mount container');
  const doc = container.ownerDocument;
  const runtime = createPuzzleRuntime(createWaterPathDefinition(options));
  const root = doc.createElement('section');
  root.className = 'water-path-t0';
  root.setAttribute('aria-label', '인경호 물길 퍼즐 연습');
  container.append(root);
  let destroyed = false;

  function makeButton(text, label, action) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.setAttribute('aria-label', label);
    button.style.minWidth = '44px';
    button.style.minHeight = '44px';
    button.addEventListener('click', action);
    return button;
  }
  function render() {
    if (destroyed) return;
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
      controls.append(makeButton('시작', '퍼즐 시작', () => {runtime.start(); render();}));
    }
    if (snapshot.status === 'PLAYING') {
      const undo = makeButton('되돌리기', '이전 회전 되돌리기', () => {runtime.undo();render();});
      undo.disabled = !snapshot.canUndo;
      controls.append(undo, makeButton('일시정지', '퍼즐 일시정지', () => {runtime.pause();render();}));
    }
    if (snapshot.status === 'PAUSED') {
      controls.append(makeButton('계속', '퍼즐 재개', () => {runtime.resume();render();}));
    }
    if (snapshot.status === 'PLAYING' || snapshot.status === 'PAUSED') {
      controls.append(makeButton('종료', '퍼즐 연습 종료', () => {runtime.cancel();render();}));
    }
    controls.append(makeButton('처음부터', '같은 문제 다시 시작', () => {runtime.restart();render();}));
    root.replaceChildren(status, board, controls);
  }
  render();
  return Object.freeze({
    snapshot: () => runtime.snapshot(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.remove();
      runtime.destroy();
    }
  });
}
