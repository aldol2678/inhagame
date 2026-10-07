// Photo Mode overlay: the frame stays clear and every control sits on an edge. DOM only, so
// the HUD, composition grid and flash are never in the saved canvas PNG.
export const PHOTO_GRID_MODES = Object.freeze(['off', 'thirds']);
export const PHOTO_ENTRY_BLOCK_MESSAGES = Object.freeze({
  lobby: '로비에서는 열 수 없어요', transition: '이동이 끝난 뒤 열 수 있어요', combat: '전투 중에는 열 수 없어요',
  cinematic: '연출이 끝난 뒤 열 수 있어요', region: '이 지역은 아직 지원하지 않아요', mounted: '탈것에서 내리면 열 수 있어요',
  airborne: '착지한 뒤 열 수 있어요', focus: '열린 창을 닫은 뒤 열 수 있어요', position: '지금은 열 수 없어요'
});
const STATUS_MS = 5000;

// The always-available HUD entry (📷). It stays focusable when blocked and says why.
export function bindPhotoModeEntry({ button, mode, messages = PHOTO_ENTRY_BLOCK_MESSAGES } = {}) {
  if (!button || !mode) return Object.freeze({ refresh() {}, destroy() {} });
  let last;
  function refresh() {
    const reason = mode.blockedReason();
    if (reason === last) return;
    last = reason;
    const blocked = reason !== null && reason !== 'active';
    const label = blocked ? `사진 모드 · ${messages[reason] ?? '지금은 열 수 없어요'}` : '사진 모드 열기 (P)';
    button.setAttribute('aria-disabled', String(blocked));
    button.setAttribute('aria-label', label);
    button.title = label;
  }
  const click = () => { if (!mode.active) mode.open(); refresh(); };
  button.addEventListener('click', click);
  refresh();
  return Object.freeze({ refresh, destroy() { button.removeEventListener?.('click', click); } });
}

export function createPhotoModePanel({ mode, rig, input, doc = globalThis.document, win = globalThis.window,
  fallbackFocus = null, capture = null, urlApi = globalThis.URL,
  coarsePointer = () => win?.matchMedia?.('(pointer: coarse)')?.matches === true,
  setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout,
  getCaptureContext = () => ({}), onCaptured = null, getAlbumLatest = null, onOpenAlbum = null } = {}) {
  const el = (tag, cls, text) => { const n = doc.createElement(tag); n.className = cls; if (text) n.textContent = text; return n; };
  const button = (cls, name, text, label) => {
    const n = el('button', cls, text); n.type = 'button'; n.dataset.photoControl = name;
    if (label) n.setAttribute('aria-label', label);
    return n;
  };
  const root = el('section', 'photo-mode'); root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', '사진 모드');
  root.dataset.ui = 'visible'; root.dataset.grid = 'off';

  const grid = el('div', 'photo-mode-grid'); grid.setAttribute('aria-hidden', 'true');
  const flash = el('div', 'photo-mode-flash'); flash.setAttribute('aria-hidden', 'true');

  const top = el('div', 'photo-mode-top');
  const badge = el('div', 'photo-mode-badge');
  const precisionBadge = el('span', 'photo-mode-precision', '정밀'); precisionBadge.hidden = true;
  precisionBadge.dataset.photoControl = 'precision-badge';
  badge.append(el('strong', '', '📷 PHOTO'), precisionBadge);
  const uiToggle = button('photo-mode-icon', 'ui', '👁', '사진 UI 숨기기 (H)');
  uiToggle.setAttribute('aria-pressed', 'false'); uiToggle.setAttribute('aria-keyshortcuts', 'H');
  const settingsToggle = button('photo-mode-icon', 'settings', '⚙', '카메라 설정');
  settingsToggle.setAttribute('aria-expanded', 'false'); settingsToggle.setAttribute('aria-controls', 'photo-mode-settings');
  const close = button('photo-mode-icon', 'close', '✕', '사진 모드 나가기 (Esc)');
  close.setAttribute('aria-keyshortcuts', 'Escape');
  const topActions = el('div', 'photo-mode-top-actions'); topActions.append(uiToggle, settingsToggle, close);
  top.append(badge, topActions);

  // CAMERA settings: secondary, collapsed by default, never over the centre of the frame.
  const settings = el('aside', 'photo-mode-settings'); settings.id = 'photo-mode-settings'; settings.hidden = true;
  settings.dataset.photoControl = 'settings-panel'; settings.setAttribute('aria-label', '카메라 설정');
  const row = (label, ...nodes) => { const r = el('label', 'photo-mode-setting'); r.append(el('span', '', label), ...nodes); return r; };
  const fov = el('input', ''); fov.type = 'range'; fov.step = '1'; fov.dataset.photoControl = 'fov';
  fov.setAttribute('aria-label', '화각 (FOV)');
  const fovValue = el('output', 'photo-mode-setting-value'); fovValue.dataset.photoControl = 'fov-value';
  const check = name => { const n = el('input', ''); n.type = 'checkbox'; n.dataset.photoControl = name; return n; };
  const precision = check('precision'), collision = check('collision');
  const gridSelect = el('select', ''); gridSelect.dataset.photoControl = 'grid'; gridSelect.setAttribute('aria-label', '구도선');
  for (const [value, text] of [['off', '끄기'], ['thirds', '3×3 삼분할']]) {
    const option = el('option', '', text); option.value = value; gridSelect.append(option);
  }
  const reset = button('photo-mode-reset', 'reset', '↺ 카메라 초기화 (R)');
  const help = el('p', 'photo-mode-help');
  help.append(el('span', 'photo-mode-help-fine', '드래그 시점 · WASD 이동 · Q/E 높이 · 휠 줌 · Shift 정밀 · H UI 숨김 · Space 촬영'),
    el('span', 'photo-mode-help-coarse', '한 손가락 드래그 시점 · 두 손가락 핀치 줌 · 패드 이동 · ▲▼ 높이'));
  const note = el('p', 'photo-mode-note', '사진은 이 기기에서만 처리되며 업로드되지 않아요');
  settings.append(el('h2', 'photo-mode-settings-title', 'CAMERA'),
    row('화각', fov, fovValue), row('정밀 이동 (Shift)', precision), row('카메라 충돌', collision),
    row('구도선', gridSelect), reset, help, note);

  const bottom = el('div', 'photo-mode-bottom');
  const pad = el('div', 'photo-mode-pad'); pad.dataset.photoControl = 'pad';
  pad.setAttribute('role', 'group'); pad.setAttribute('aria-label', '카메라 이동 패드');
  const knob = el('div', 'photo-mode-pad-knob'); pad.append(knob);
  const up = button('photo-mode-lift', 'up', '▲', '카메라 올리기 (E)');
  const down = button('photo-mode-lift', 'down', '▼', '카메라 내리기 (Q)');
  const lift = el('div', 'photo-mode-vertical'); lift.append(up, down);
  const pose = button('photo-mode-side', 'pose', '🤳', '사진 포즈');
  const shutter = button('photo-mode-shutter', 'capture', '', '사진 촬영 (Space)');
  shutter.setAttribute('aria-keyshortcuts', 'Space');
  const preview = button('photo-mode-side photo-mode-thumb', 'preview', '', '찍은 사진 보기');
  preview.hidden = true; preview.setAttribute('aria-expanded', 'false'); preview.setAttribute('aria-controls', 'photo-mode-preview');
  const thumb = el('img', ''); thumb.alt = ''; preview.append(thumb);
  const shutterRow = el('div', 'photo-mode-shutter-row'); shutterRow.append(pose, shutter, preview);
  const status = el('p', 'photo-mode-status'); status.dataset.photoControl = 'status'; status.setAttribute('role', 'status');
  bottom.append(pad, status, shutterRow, lift);

  const imageBox = el('div', 'photo-mode-preview'); imageBox.hidden = true; imageBox.id = 'photo-mode-preview';
  const image = el('img', ''); image.alt = 'HUD 없는 INHA WORLD 사진'; image.dataset.photoControl = 'image'; imageBox.append(image);
  const restore = button('photo-mode-restore', 'restore', '👁', '사진 UI 보이기 (H)'); restore.hidden = true;
  root.append(grid, flash, top, settings, imageBox, bottom, restore); doc.body.append(root);
  input?.bindMovePad(pad, knob);
  input?.bindHoldButton(up, 1);
  input?.bindHoldButton(down, -1);

  let savedHud, savedFocus = null, destroyed = false, session = 0, busy = false, imageUrl = null, statusTimer = null;
  let albumUrl = null, albumRecord = null, previewEpoch = 0;
  const initialStatus = () => !capture ? '기기의 화면 캡처로 남겨 보세요 · Esc로 나가기'
    : coarsePointer() ? '촬영 버튼을 누르면 HUD 없는 PNG를 저장해요' : '촬영 버튼이나 Space로 HUD 없는 PNG를 저장해요';
  const visible = node => !node.hidden && !node.disabled && (node.getClientRects ? node.getClientRects().length > 0 : true);
  function controls() {
    if (root.dataset.ui === 'hidden') return [restore];
    return [uiToggle, settingsToggle, close, ...(settings.hidden ? [] : [fov, precision, collision, gridSelect, reset]),
      up, down, pose, shutter, preview].filter(visible);
  }
  function say(text, { sticky = false } = {}) {
    status.textContent = text;
    if (statusTimer !== null) clearTimer(statusTimer);
    statusTimer = sticky || !text ? null : setTimer(() => { statusTimer = null; status.textContent = ''; }, STATUS_MS);
  }
  function setBusy(value) {
    busy = value; pose.disabled = value; shutter.disabled = !capture;
    // aria-disabled keeps keyboard focus on the shutter while a frame encodes.
    shutter.setAttribute('aria-disabled', String(value || !capture));
    root.setAttribute('aria-busy', String(value));
  }
  function hidePreview() {
    imageBox.hidden = true; preview.setAttribute('aria-expanded', 'false');
  }
  function clearImage() {
    // A new shot owns its preview, even while the entry Album lookup is still pending.
    previewEpoch++;
    image.removeAttribute('src'); thumb.removeAttribute('src'); hidePreview(); preview.hidden = true;
    if (imageUrl) urlApi.revokeObjectURL(imageUrl);
    imageUrl = null;
    if (albumUrl) urlApi.revokeObjectURL(albumUrl);
    albumUrl = null; albumRecord = null;
  }
  async function refreshAlbumLatest() {
    if (!getAlbumLatest) return;
    const current = session, previewAt = previewEpoch;
    try {
      const latest = await getAlbumLatest();
      if (destroyed || current !== session || previewAt !== previewEpoch || !mode.active || !latest?.blob) return;
      if (albumUrl) urlApi.revokeObjectURL(albumUrl);
      albumUrl = urlApi.createObjectURL(latest.blob); albumRecord = latest.record;
      thumb.src = albumUrl; preview.hidden = false;
    } catch { /* Album errors are reported by the Album surface, never block photography. */ }
  }
  function resetCapture() { session++; capture?.cancel(); setBusy(false); clearImage(); }
  function syncLens() {
    const camera = rig?.snapshot();
    if (!camera) return;
    fov.min = String(Math.floor(camera.fovLimits.min)); fov.max = String(Math.ceil(camera.fovLimits.max));
    fov.value = String(Math.round(camera.fov)); fovValue.textContent = `${Math.round(camera.fov)}°`;
  }
  function syncSettings() {
    syncLens();
    const camera = rig?.snapshot();
    precision.checked = input?.latched === true;
    collision.checked = camera?.collision !== false;
    gridSelect.value = root.dataset.grid;
  }
  function setSettings(open, { focus = true } = {}) {
    const owned = settings.contains(doc.activeElement);
    settings.hidden = !open;
    settingsToggle.setAttribute('aria-expanded', String(open));
    if (open) { syncSettings(); if (focus) fov.focus?.({ preventScroll: true }); }
    else if (focus || owned) settingsToggle.focus?.({ preventScroll: true });
  }
  function setUiHidden(hidden, { focus = true } = {}) {
    const owned = root.contains(doc.activeElement) && doc.activeElement !== restore;
    root.dataset.ui = hidden ? 'hidden' : 'visible';
    restore.hidden = !hidden;
    uiToggle.setAttribute('aria-pressed', String(hidden));
    if (hidden) {
      setSettings(false, { focus: false }); hidePreview();
      if (owned || focus) restore.focus?.({ preventScroll: true });
    } else if (doc.activeElement === restore || (focus && !root.contains(doc.activeElement))) {
      uiToggle.focus?.({ preventScroll: true });
    }
  }
  function setGrid(value) {
    root.dataset.grid = PHOTO_GRID_MODES.includes(value) ? value : 'off';
    gridSelect.value = root.dataset.grid;
  }
  function flashShutter() {
    flash.classList.remove('is-on'); void flash.offsetWidth; flash.classList.add('is-on');
  }
  async function shoot() {
    if (!capture || busy || destroyed || !mode.update()) return;
    const current = session;
    let context = {}; try { context = getCaptureContext(); } catch { /* Location metadata is optional; PNG capture remains available. */ }
    clearImage(); setBusy(true); say('HUD 없는 PNG를 만들고 있어요…', { sticky: true });
    try {
      const result = await capture.request();
      if (destroyed || current !== session || !mode.update()) return;
      flashShutter();
      imageUrl = urlApi.createObjectURL(result.blob); image.src = imageUrl; thumb.src = imageUrl; preview.hidden = false;
      const link = el('a', '');
      if (!('download' in link)) {
        say('이 브라우저는 PNG 다운로드를 지원하지 않아요. 찍은 사진을 눌러 직접 저장해 주세요', { sticky: true });
      } else {
        link.href = imageUrl; link.download = `inha-world-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        link.hidden = true; root.append(link);
        try {
          link.click();
          say(`PNG 다운로드를 요청했어요 (${result.width} × ${result.height}). 파일이 없으면 찍은 사진을 눌러 주세요`);
        } catch {
          say('PNG 다운로드가 막혔어요. 찍은 사진을 눌러 직접 저장해 주세요', { sticky: true });
        } finally { link.remove(); }
      }
      if (onCaptured) {
        const stored = await onCaptured(result, context);
        if (destroyed || current !== session || !mode.active) return;
        if (!stored) say('앨범 저장은 실패했어요. 찍은 사진을 눌러 원본 PNG를 직접 저장해 주세요', { sticky: true });
        else { say('앨범에 저장했어요 · 최근 사진을 눌러 앨범 열기'); await refreshAlbumLatest(); }
      }
    } catch (error) {
      if (current === session && !destroyed && mode.active && error?.name !== 'AbortError')
        say('PNG를 만들지 못했어요. 다시 시도하거나 UI를 숨기고 기기의 화면 캡처를 이용해 주세요', { sticky: true });
    } finally { if (current === session && !destroyed) setBusy(false); }
  }
  function escape() {
    if (!imageBox.hidden) { hidePreview(); preview.focus?.({ preventScroll: true }); return true; }
    if (!settings.hidden) { setSettings(false); return true; }
    return false;
  }
  function tab(event) {
    const available = controls(), at = available.indexOf(doc.activeElement);
    if (!available.length) return;
    if (at < 0 || (!event.shiftKey && at === available.length - 1) || (event.shiftKey && at === 0)) {
      event.preventDefault?.(); available[event.shiftKey ? available.length - 1 : 0].focus?.({ preventScroll: true });
    }
  }
  input?.setCommands({
    capture: () => { void shoot(); }, escape, tab,
    toggleUi: () => setUiHidden(root.dataset.ui !== 'hidden', { focus: false }),
    reset: () => { syncLens(); say('카메라를 처음 구도로 되돌렸어요'); },
    lens: () => { if (!settings.hidden) syncLens(); },
    precision: active => { precisionBadge.hidden = !active; precision.checked = input.latched; }
  });

  shutter.addEventListener('click', () => { void shoot(); });
  preview.addEventListener('click', () => {
    if (albumRecord && onOpenAlbum) { onOpenAlbum(albumRecord); return; }
    if (!imageUrl || !mode.update()) return;
    imageBox.hidden = !imageBox.hidden;
    preview.setAttribute('aria-expanded', String(!imageBox.hidden));
    if (!imageBox.hidden) say('이미지를 길게 눌러 사진에 저장하거나, 우클릭으로 저장해 주세요. 기기마다 메뉴가 달라요', { sticky: true });
  });
  imageBox.addEventListener('click', () => { hidePreview(); preview.focus?.({ preventScroll: true }); });
  pose.addEventListener('click', () => {
    if (busy) return;
    const result = mode.pose();
    if (result === 'started') say('사진 포즈! 잠시 후 다시 포즈를 취할 수 있어요');
    else if (result === 'cooldown') say('잠깐 기다린 뒤 다시 포즈를 취해 주세요');
    else if (result === 'seated') say('앉아 있는 동안에는 포즈 대신 그대로 찍어 보세요');
    else if (result === 'mounted') say('탑승 자세를 유지한 채 탈것과 함께 찍어 보세요');
  });
  close.addEventListener('click', () => mode.close());
  settingsToggle.addEventListener('click', () => setSettings(settings.hidden));
  uiToggle.addEventListener('click', () => setUiHidden(true));
  restore.addEventListener('click', () => setUiHidden(false));
  reset.addEventListener('click', () => { if (rig?.reset()) { syncLens(); say('카메라를 처음 구도로 되돌렸어요'); } });
  fov.addEventListener('input', () => { if (rig?.setFov(Number(fov.value))) syncLens(); });
  precision.addEventListener('change', () => { input?.setPrecisionLatch(precision.checked); });
  collision.addEventListener('change', () => {
    rig?.setCollision(collision.checked);
    say(collision.checked ? '카메라가 벽과 건물을 통과하지 않아요' : '카메라 충돌을 껐어요. 이동 범위는 그대로 제한돼요');
  });
  gridSelect.addEventListener('change', () => setGrid(gridSelect.value));

  const offClosing = mode.subscribeClosing?.(() => { resetCapture(); root.hidden = true; }, { priority: 10 });
  const unsubscribe = mode.subscribe(({ active, reason }) => {
    resetCapture();
    if (active) {
      savedHud = doc.body.dataset.photoMode; savedFocus = doc.activeElement;
      doc.body.dataset.photoMode = 'active'; root.hidden = false;
      // Each session starts clean: settings closed, UI shown, no grid.
      setGrid('off'); setSettings(false, { focus: false }); setUiHidden(false, { focus: false });
      precisionBadge.hidden = true;
      say(initialStatus());
      void refreshAlbumLatest();
      (capture ? shutter : close).focus?.({ preventScroll: true });
    } else {
      const ownedFocus = root.contains(doc.activeElement);
      root.hidden = true; say('', { sticky: true });
      if (savedHud === undefined) delete doc.body.dataset.photoMode;
      else doc.body.dataset.photoMode = savedHud;
      if ((reason === 'close' || reason === 'escape') && ownedFocus) {
        const target = savedFocus?.isConnected && !savedFocus.hidden && !savedFocus.disabled ? savedFocus : fallbackFocus;
        target?.focus?.({ preventScroll: true });
      }
      savedFocus = null;
    }
  });
  const leave = () => mode.close('lifecycle');
  const visibility = () => { if (doc.hidden) leave(); };
  // Photo controls never reach document-level "click outside" handlers of the hidden HUD.
  const stop = event => event.stopPropagation();
  root.addEventListener('pointerdown', stop);
  doc.addEventListener('visibilitychange', visibility);
  win?.addEventListener('pagehide', leave);
  return Object.freeze({ root, setUiHidden, setGrid,
    status() {
      return Object.freeze({ ui: root.dataset.ui, grid: root.dataset.grid, settings: !settings.hidden, busy,
        preview: !imageBox.hidden, status: status.textContent });
    },
    destroy() {
      if (destroyed) return; destroyed = true; mode.close('destroy'); resetCapture(); capture?.destroy(); unsubscribe(); offClosing?.();
      if (statusTimer !== null) clearTimer(statusTimer);
      doc.removeEventListener('visibilitychange', visibility); win?.removeEventListener('pagehide', leave);
      root.removeEventListener('pointerdown', stop); root.remove();
    }
  });
}
