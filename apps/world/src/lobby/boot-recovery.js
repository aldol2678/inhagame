// Classic script: runs before the ES module graph, including lobby-loading.js.
// Recovery state only; performance measurement belongs to BOOT-PROFILE-01.
(function installBootRecovery(target) {
  'use strict';
  const doc = target.document;
  const root = doc.getElementById('world-loading');
  if (!root || target.__INHA_WORLD_BOOT_RECOVERY__) return;
  const message = doc.getElementById('world-loading-message');
  const detail = doc.getElementById('world-loading-detail');
  const retry = doc.getElementById('world-loading-retry');
  if (!message || !detail || !retry) return;
  const delayMs = 15000;
  const controller = new target.AbortController();
  let loading, timer, entered = false, phase = 'BOOT', state = 'LOADING', code = null;
  let retrying = false, destroyed = false;
  const inactive = () => destroyed || retrying || state === 'ERROR' || state === 'READY';
  const delayCode = () => !entered ? 'BOOT_ENTRY_DELAY'
    : phase === 'ASSETS' ? 'ASSET_LOADING_DELAY'
    : phase === 'RENDERING' ? 'INITIAL_RENDER_DELAY'
    : phase === 'RENDERER' ? 'GRAPHICS_INIT_DELAY' : 'BOOT_PROGRESS_DELAY';
  const stop = () => target.clearTimeout(timer);
  const display = () => {
    if (destroyed || retrying || (state !== 'ERROR' && state !== 'DELAYED')) return;
    root.dataset.state = state;
    root.dataset.diagnostic = code;
    retry.hidden = false;
    const timedOut = code?.endsWith('_TIMEOUT');
    message.textContent = timedOut ? '월드 준비 시간이 초과됐어요.' : code === 'GRAPHICS_INIT_FAILED'
      ? '이 환경에서는 INHA WORLD 3D 렌더링을 사용할 수 없습니다.'
      : state === 'ERROR' ? '월드를 시작하지 못했습니다.' : '월드 준비가 지연되고 있어요.';
    const advice = timedOut ? '준비를 완료하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.' : code === 'GRAPHICS_INIT_FAILED'
      ? '브라우저와 그래픽 드라이버를 최신 상태로 업데이트한 뒤 다시 시도해 주세요.'
      : state === 'ERROR' ? '네트워크 연결을 확인한 뒤 다시 시도해 주세요.'
      : '로딩은 계속 진행 중입니다. 기다리거나 다시 시도할 수 있어요.';
    detail.textContent = `${advice} 진단: ${code}`;
  };
  const arm = () => {
    stop();
    if (inactive() || doc.hidden) return;
    timer = target.setTimeout(() => {
      if (inactive() || doc.hidden) return;
      state = 'DELAYED'; code = delayCode(); display();
    }, delayMs);
  };
  const progress = next => {
    if (inactive()) return;
    phase = next || phase;
    state = 'LOADING'; code = null;
    delete root.dataset.diagnostic;
    if (doc.activeElement === retry) root.focus?.({ preventScroll: true });
    retry.hidden = true;
    if (loading) loading.refresh();
    else {
      root.dataset.state = 'LOADING';
      message.textContent = '인하월드를 여는 중…';
      detail.textContent = '캐릭터와 첫 화면 렌더링이 끝나면 접속 화면이 열립니다.';
    }
    arm();
  };
  const fail = (kind = 'BOOT_INIT_FAILED') => {
    if (inactive()) return false;
    state = 'ERROR'; code = kind; stop();
    loading?.fail();
    display();
    return true;
  };
  const onError = event => {
    if (entered) return; // boot().catch owns initialization; runtime errors are separate.
    const source = event.target;
    if (source && source !== target) {
      if (source.matches?.('script[data-world-boot]')) fail('BOOT_MODULE_ERROR');
      return; // unrelated images, optional scripts and styles are not boot failures
    }
    fail('BOOT_SCRIPT_ERROR');
  };
  const onRejection = () => { if (!entered) fail('BOOT_PROMISE_REJECTION'); };
  const onVisibility = () => { if (!doc.hidden) progress(); else stop(); };
  const cleanup = () => {
    stop();
    target.removeEventListener('error', onError, true);
    target.removeEventListener('unhandledrejection', onRejection);
    doc.removeEventListener('visibilitychange', onVisibility);
    retry.removeEventListener('click', onRetry);
  };
  const onRetry = () => {
    if (destroyed || retrying || (state !== 'ERROR' && state !== 'DELAYED')) return;
    retrying = true;
    loading?.cancel();
    controller.abort();
    cleanup();
    retry.disabled = true;
    retry.textContent = '다시 여는 중…';
    // A new document discards failed module promises and partial graphics/app state.
    // Preserve the entry URL; do not clear accounts, caches, or saved game data.
    target.location.reload();
  };
  retry.addEventListener('click', onRetry);
  target.addEventListener('error', onError, true);
  target.addEventListener('unhandledrejection', onRejection);
  doc.addEventListener('visibilitychange', onVisibility);
  target.__INHA_WORLD_BOOT_RECOVERY__ = {
    signal: controller.signal,
    attach(value) {
      loading = value;
      if (destroyed || retrying) loading?.cancel();
      else if (state === 'ERROR') loading?.fail();
      display();
    },
    markBootEntered() { entered = true; progress(); },
    progress,
    fail,
    refresh: display,
    complete() {
      if (inactive() || !loading?.status().finished) return false;
      state = 'READY'; phase = 'READY'; code = null; retry.hidden = true;
      delete root.dataset.diagnostic;
      cleanup();
      return true;
    },
    status: () => ({ state, code, phase, bootEntered: entered, retrying, destroyed }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      loading?.cancel();
      controller.abort();
      cleanup();
    }
  };
  arm();
})(globalThis);
