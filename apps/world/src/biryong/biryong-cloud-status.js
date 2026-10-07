// A row in Biryong's existing objective HUD, not a separate global notification lane.
export function createBiryongCloudStatus({ documentLike = globalThis.document, onRetry = () => {} } = {}) {
  const element = documentLike.createElement('span');
  element.className = 'biryong-cloud-status';
  element.hidden = true;
  const label = documentLike.createElement('span');
  label.setAttribute('role', 'status');
  label.setAttribute('aria-live', 'polite');
  const retry = documentLike.createElement('button');
  retry.type = 'button';
  retry.className = 'biryong-cloud-retry';
  retry.textContent = '다시 저장';
  retry.setAttribute('aria-label', '비룡 진행도 클라우드 저장 재시도');
  retry.hidden = true;
  retry.disabled = true;
  retry.addEventListener('click', event => {
    event.stopPropagation();
    if (!retry.disabled && !retry.hidden) onRetry();
  });
  // A focused native button owns its keyboard input without blocking gameplay
  // while this passive status row is merely visible.
  // keyup must still reach PlayerController to release keys held before focus.
  for (const name of ['keydown', 'pointerdown']) {
    retry.addEventListener(name, event => event.stopPropagation());
  }
  element.append(label, retry);
  return Object.freeze({ element, setStatus({ state = 'idle' } = {}) {
    const text = state === 'pending' ? '비룡 기록 동기화 대기'
      : state === 'saving' ? '비룡 기록 저장 중…'
      : state === 'failed' ? '비룡 기록 저장 확인 실패 · 현재 기기의 기록으로 계속할 수 있어요' : '';
    const hidden = !text;
    if (hidden && documentLike.activeElement === retry) retry.blur?.();
    element.hidden = hidden;
    if (label.textContent !== text) label.textContent = text;
    retry.hidden = state !== 'failed' && state !== 'saving';
    retry.disabled = state !== 'failed';
    return !hidden;
  } });
}
