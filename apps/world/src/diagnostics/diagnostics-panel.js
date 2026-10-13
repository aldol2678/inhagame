import { createInputFocusOwner } from '../input/input-focus-owner.js';
import { createInputPolicy, INPUT_FOCUS_CLASS } from '../input/input-focus-manager.js';
import { createBugReport, formatBugReport, RUNTIME_ERROR_LABELS } from './runtime-diagnostics.js';

const networkLabels = { ONLINE: '온라인', CONNECTING: '연결 중', RECONNECTING: '재연결 중', OFFLINE: '연결 없음 · 로컬 플레이 가능', UNKNOWN: '확인할 수 없음' };
const qualityLabels = { low: '낮음', medium: '보통', high: '높음', auto: '자동', UNKNOWN: '확인할 수 없음' };

export function createDiagnosticsPanel({ diagnostics, inputFocus, opener, beforeOpen = () => {},
  returnFocus = () => opener, doc = document, clipboard = globalThis.navigator?.clipboard,
  urls = globalThis.URL, BlobType = globalThis.Blob } = {}) {
  const owner = createInputFocusOwner({ manager: inputFocus, ownerId: 'runtime-diagnostics',
    policy: createInputPolicy(INPUT_FOCUS_CLASS.BLOCKING_UI, { textInput: true }) });
  const dialog = doc.createElement('dialog');
  dialog.id = 'runtime-diagnostics-panel'; dialog.className = 'runtime-diagnostics';
  dialog.setAttribute('aria-labelledby', 'runtime-diagnostics-title');
  dialog.innerHTML = `
    <header><h2 id="runtime-diagnostics-title">진단 · 버그 보고</h2><button type="button" data-action="close" aria-label="진단 닫기">닫기</button></header>
    <div class="runtime-diagnostics-body">
      <p>문제가 생겼을 때 아래 정보를 확인하고 개발자에게 전달할 보고서를 만들 수 있어요. 자동으로 전송하지 않습니다.</p>
      <section aria-label="현재 게임 상태"><h3>현재 게임 상태</h3><dl data-readback></dl>
        <p data-health role="status"></p><button type="button" data-action="refresh">진단 새로고침</button>
        <h3>최근 감지한 오류</h3><ul data-errors></ul>
      </section>
      <section aria-label="문제 작성"><h3>어떤 문제가 있었나요?</h3>
        <p id="diagnostics-privacy">이메일, 계정 정보, 비밀번호, 채팅 내용은 적지 마세요. 보고서는 이 화면의 허용된 진단 정보와 직접 작성한 내용만 담습니다. 흔한 이메일·ID·토큰 형식은 생략하지만, 내보내기 전에 직접 확인해 주세요.</p>
        <label for="diagnostics-description">문제 설명 (필수)</label><textarea id="diagnostics-description" maxlength="1000" rows="3" aria-describedby="diagnostics-privacy"></textarea>
        <label for="diagnostics-reproduction">재현 단계</label><textarea id="diagnostics-reproduction" maxlength="1000" rows="3" placeholder="예: 설정을 열고 버튼을 눌렀어요."></textarea>
        <label for="diagnostics-context">발생 상황</label><textarea id="diagnostics-context" maxlength="1000" rows="2" placeholder="예: 휴대폰을 가로로 돌린 뒤 발생했어요."></textarea>
        <button type="button" data-action="generate">보고서 만들기</button>
      </section>
      <section aria-label="보고서 확인"><h3>보낼 내용 확인</h3>
        <textarea data-preview aria-label="생성된 버그 보고서" rows="7" readonly placeholder="보고서를 만들면 여기에 표시돼요."></textarea>
        <div class="runtime-diagnostics-actions"><button type="button" data-action="copy" disabled>텍스트 복사</button><button type="button" data-action="export" disabled>JSON 파일 저장</button><button type="button" data-action="clear">내용 지우기</button></div>
        <p data-notice role="status" aria-live="polite"></p>
      </section>
    </div>`;
  doc.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  const action = name => $(`[data-action="${name}"]`);
  const fields = Object.fromEntries(['description', 'reproduction', 'context'].map(key => [key, $(`#diagnostics-${key}`)]));
  const preview = $('[data-preview]'), notice = $('[data-notice]');
  const cleanup = [];
  let opened = false, destroyed = false, reportText = '', generation = 0, copying = false;
  const listen = (target, event, fn, options) => {
    target.addEventListener(event, fn, options);
    cleanup.push(() => target.removeEventListener(event, fn, options));
  };
  const invalidate = () => {
    generation++; reportText = ''; preview.value = ''; copying = false;
    action('copy').disabled = action('export').disabled = true; notice.textContent = '';
  };
  const refresh = () => {
    if (!opened || destroyed) return;
    const state = diagnostics.snapshot();
    const values = [
      ['FPS / 평균 프레임 간격', state.fps === null ? '측정 대기 · 화면이 멈추거나 숨겨지면 다시 측정해요.' : `${state.fps} FPS / ${state.frameTimeMs} ms`],
      ['렌더러', `${state.renderer} · ${state.rendererState === 'LOST' ? '그래픽 연결 끊김' : state.rendererState === 'UNKNOWN' ? '확인할 수 없음' : '사용 중'}`],
      ['그래픽 품질', `${qualityLabels[state.quality]} (설정: ${qualityLabels[state.qualityPreference]})`],
      ['월드 / 공개 구역', `${state.worldId} / ${state.zoneId ?? '해당 없음'}`],
      ['네트워크', networkLabels[state.network]], ['빌드', state.buildId === 'development' ? '개발 환경 · 배포 빌드 ID 없음' : state.buildId]
    ];
    $('[data-readback]').replaceChildren(...values.flatMap(([label, value]) => {
      const dt = doc.createElement('dt'), dd = doc.createElement('dd');
      dt.textContent = label; dd.textContent = value; return [dt, dd];
    }));
    $('[data-errors]').replaceChildren(...(state.recentErrors.length ? state.recentErrors : [{ code: null }]).map(({ code }) => {
      const li = doc.createElement('li'); li.textContent = code ? `${RUNTIME_ERROR_LABELS[code]} (${code})` : '아직 감지한 오류가 없어요.'; return li;
    }));
    const healthText = state.rendererState === 'LOST' ? RUNTIME_ERROR_LABELS.RENDERER_DEVICE_LOST
      : state.network === 'OFFLINE' ? RUNTIME_ERROR_LABELS.NETWORK_OFFLINE
      : state.network === 'RECONNECTING' ? RUNTIME_ERROR_LABELS.NETWORK_RECONNECTING
      : state.recentErrors.length ? '최근 오류가 있어요. 문제가 계속되면 보고서를 만들어 주세요.' : '현재 감지한 문제는 없어요.';
    if ($('[data-health]').textContent !== healthText) $('[data-health]').textContent = healthText;
  };
  const close = ({ restoreFocus = true } = {}) => {
    if (!opened) return;
    opened = false; generation++; copying = false;
    action('copy').disabled = !reportText;
    dialog.close(); opener?.setAttribute('aria-expanded', 'false'); owner.release();
    if (restoreFocus) returnFocus()?.focus?.();
  };
  const reset = () => {
    close({ restoreFocus: false }); invalidate();
    for (const input of Object.values(fields)) input.value = '';
    $('[data-readback]').replaceChildren(); $('[data-errors]').replaceChildren(); $('[data-health]').textContent = '';
  };
  const open = () => {
    if (opened || destroyed) return;
    owner.acquire();
    try {
      beforeOpen(); dialog.showModal(); opened = true;
      opener?.setAttribute('aria-expanded', 'true'); refresh(); action('close').focus();
    } catch { owner.release(); notice.textContent = '진단 화면을 열지 못했어요.'; }
  };
  if (opener) listen(opener, 'click', open);
  listen(action('close'), 'click', () => close());
  listen(dialog, 'cancel', event => { event.preventDefault(); close(); });
  // Native dialog contains tab focus; capture prevents existing menu/global shortcuts seeing typing.
  listen(dialog, 'keydown', event => { event.stopPropagation(); if (event.code === 'Escape') { event.preventDefault(); close(); } }, true);
  for (const type of ['keyup', 'pointerdown', 'pointerup', 'click', 'touchstart', 'touchmove', 'wheel']) {
    listen(dialog, type, event => event.stopPropagation());
  }
  listen(action('refresh'), 'click', () => { refresh(); notice.textContent = '진단 정보를 새로 확인했어요.'; });
  Object.values(fields).forEach(field => listen(field, 'input', invalidate));
  listen(action('generate'), 'click', () => {
    const report = createBugReport(diagnostics, Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value])));
    if (!report.description) { notice.textContent = '문제 설명을 먼저 적어 주세요.'; fields.description.focus(); return; }
    generation++; reportText = formatBugReport(report); preview.value = reportText;
    action('copy').disabled = action('export').disabled = false;
    notice.textContent = '보고서를 만들었어요. 내용을 확인한 뒤 복사하거나 저장해 주세요.';
  });
  listen(action('copy'), 'click', async () => {
    if (!opened || !reportText || copying) return;
    const token = generation; copying = true; action('copy').disabled = true;
    try {
      if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
      await clipboard.writeText(reportText);
      if (opened && token === generation) notice.textContent = '복사했어요. 개발자에게 직접 전달해 주세요.';
    } catch {
      if (opened && token === generation) { preview.focus(); preview.select(); notice.textContent = '자동 복사를 사용할 수 없어요. 선택된 내용을 직접 복사하거나 JSON 파일로 저장해 주세요.'; }
    } finally { if (token === generation) { copying = false; action('copy').disabled = !reportText; } }
  });
  listen(action('export'), 'click', () => {
    if (!opened || !reportText) return;
    let url;
    try {
      url = urls.createObjectURL(new BlobType([reportText], { type: 'application/json' }));
      const link = doc.createElement('a'); link.href = url; link.download = 'inha-world-bug-report.json';
      doc.body.append(link); link.click(); link.remove();
      notice.textContent = 'JSON 파일을 저장했어요. 개발자에게 직접 전달해 주세요.';
    } catch { notice.textContent = '파일을 저장하지 못했어요. 텍스트 복사를 이용해 주세요.'; }
    finally { if (url) urls.revokeObjectURL(url); }
  });
  listen(action('clear'), 'click', () => { invalidate(); for (const input of Object.values(fields)) input.value = ''; diagnostics.reset(); refresh(); notice.textContent = '작성 내용과 진단 기록을 지웠어요.'; });
  return Object.freeze({ open, close, reset, refresh,
    get opened() { return opened; },
    destroy() { if (destroyed) return; reset(); destroyed = true; cleanup.forEach(fn => fn()); dialog.remove(); }
  });
}
