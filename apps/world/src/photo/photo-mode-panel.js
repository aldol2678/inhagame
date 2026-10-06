import { PHOTO_FRAME_LIMITS } from './photo-mode.js';

export function createPhotoModePanel({ mode, doc = globalThis.document, win = globalThis.window, fallbackFocus = null } = {}) {
  const el = (tag, cls, text) => { const n = doc.createElement(tag); n.className = cls; if (text) n.textContent = text; return n; };
  const root = el('section', 'photo-mode'); root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '인경호 사진 모드');
  const header = el('div', 'photo-mode-header');
  const title = el('strong', 'photo-mode-title', '📸 인경호 사진 모드');
  const close = el('button', 'photo-mode-close', '사진 모드 나가기'); close.type = 'button'; close.dataset.photoControl = 'close';
  close.setAttribute('aria-keyshortcuts', 'Escape');
  const controlsToggle = el('button', 'photo-mode-controls-toggle', '조작 숨기기');
  controlsToggle.type = 'button'; controlsToggle.dataset.photoControl = 'controls';
  controlsToggle.setAttribute('aria-controls', 'photo-mode-controls');
  controlsToggle.setAttribute('aria-expanded', 'true');
  const actions = el('div', 'photo-mode-actions'); actions.append(close, controlsToggle);
  header.append(title, actions);
  const dock = el('div', 'photo-mode-dock'), ranges = []; dock.id = 'photo-mode-controls';
  for (const [name, label, min, max, step, initial] of [
    ['yaw', '좌우 구도', -PHOTO_FRAME_LIMITS.yaw, PHOTO_FRAME_LIMITS.yaw, .01, 0],
    ['pitch', '카메라 높이', PHOTO_FRAME_LIMITS.pitch.min, PHOTO_FRAME_LIMITS.pitch.max, .01, .25],
    ['distance', '카메라 거리', PHOTO_FRAME_LIMITS.distance.min, PHOTO_FRAME_LIMITS.distance.max, .1, 4]
  ]) {
    const row = el('label', 'photo-mode-range'); row.append(el('span', '', label));
    const input = el('input', ''); input.type = 'range'; input.min = String(min); input.max = String(max);
    input.step = String(step); input.value = String(initial); input.dataset.photoControl = name;
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => mode.frame({ [name]: Number(input.value) }));
    row.append(input); dock.append(row); ranges.push({ input, initial });
  }
  const pose = el('button', 'photo-mode-pose', '📸 사진 포즈'); pose.type = 'button'; pose.dataset.photoControl = 'pose';
  const status = el('p', 'photo-mode-status', '기기의 화면 캡처로 남겨 보세요 · Esc로 나가기');
  status.dataset.photoControl = 'status'; status.setAttribute('role', 'status');
  const note = el('p', 'photo-mode-note', '사진은 자동으로 저장되거나 업로드되지 않아요');
  dock.append(pose, status, note); root.append(header, dock); doc.body.append(root);
  let savedHud, savedFocus = null, destroyed = false;
  const controls = () => dock.hidden ? [close, controlsToggle] : [close, controlsToggle, ...ranges.map(r => r.input), pose];
  function showControls(visible) {
    const ownedFocus = dock.contains(doc.activeElement);
    dock.hidden = !visible;
    controlsToggle.textContent = visible ? '조작 숨기기' : '조작 보이기';
    controlsToggle.setAttribute('aria-expanded', String(visible));
    if (!visible && ownedFocus) controlsToggle.focus?.({ preventScroll: true });
  }
  controlsToggle.addEventListener('click', () => showControls(dock.hidden));
  const unsubscribe = mode.subscribe(({ active, reason }) => {
    if (active) {
      savedHud = doc.body.dataset.photoMode; savedFocus = doc.activeElement;
      doc.body.dataset.photoMode = 'active'; root.hidden = false; showControls(true);
      for (const { input, initial } of ranges) input.value = String(initial);
      status.textContent = '기기의 화면 캡처로 남겨 보세요 · Esc로 나가기';
      close.focus?.({ preventScroll: true });
    } else {
      const ownedFocus = root.contains(doc.activeElement);
      root.hidden = true;
      if (savedHud === undefined) delete doc.body.dataset.photoMode;
      else doc.body.dataset.photoMode = savedHud;
      if ((reason === 'close' || reason === 'escape') && ownedFocus) {
        const target = savedFocus?.isConnected && !savedFocus.hidden && !savedFocus.disabled ? savedFocus : fallbackFocus;
        target?.focus?.({ preventScroll: true });
      }
      savedFocus = null;
    }
  });
  close.addEventListener('click', () => mode.close());
  pose.addEventListener('click', () => {
    const result = mode.pose();
    if (result === 'started') status.textContent = '사진 포즈! 잠시 후 다시 포즈를 취할 수 있어요';
    else if (result === 'cooldown') status.textContent = '잠깐 기다린 뒤 다시 포즈를 취해 주세요';
  });
  const keydown = event => {
    if (!mode.active) return;
    if (event.code === 'Escape' && !event.isComposing) {
      event.preventDefault(); event.stopImmediatePropagation?.(); event.stopPropagation?.(); mode.close('escape'); return;
    }
    if (event.code === 'Tab') {
      const available = controls(), at = available.indexOf(doc.activeElement);
      if (at < 0 || (!event.shiftKey && at === available.length - 1) || (event.shiftKey && at === 0)) {
        event.preventDefault(); available[event.shiftKey ? available.length - 1 : 0].focus?.();
      }
    }
    // Let native sliders/Tab operate, but never forward a framing key to gameplay shortcuts.
    event.stopPropagation?.();
  };
  const leave = () => mode.close('lifecycle');
  const visibility = () => { if (doc.hidden) leave(); };
  const stop = event => event.stopPropagation();
  root.addEventListener('pointerdown', stop);
  doc.addEventListener('keydown', keydown);
  doc.addEventListener('visibilitychange', visibility);
  win?.addEventListener('blur', leave); win?.addEventListener('pagehide', leave);
  return Object.freeze({ root,
    destroy() {
      if (destroyed) return; destroyed = true; mode.close('destroy'); unsubscribe();
      doc.removeEventListener('keydown', keydown); doc.removeEventListener('visibilitychange', visibility);
      win?.removeEventListener('blur', leave); win?.removeEventListener('pagehide', leave);
      root.removeEventListener('pointerdown', stop); root.remove();
    }
  });
}
