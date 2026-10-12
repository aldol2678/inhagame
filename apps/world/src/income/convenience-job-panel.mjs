import { JOB_PHASE } from './convenience-job-state.mjs';

/** Accessible standalone candidate. Host owns world input suspension via onOpenChange. */
export function createConvenienceJobPanel({ client, doc = globalThis.document,
  navigation = globalThis.window, onOpenChange = () => {} } = {}) {
  if (!client || !doc?.body) throw new TypeError('Job panel requires client and document');
  const panel = doc.createElement('section');
  panel.className = 'furniture-editor convenience-job-panel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', '편의점 짧은 근무');
  const backdrop = doc.createElement('div'); backdrop.className = 'furniture-editor-backdrop'; backdrop.hidden = true;
  doc.body.append(backdrop, panel);
  let opener = null, owner = null, signature = '', selection = null, stepScope = null, controls = [], disposed = false;
  const node = (tag, text) => { const n = doc.createElement(tag); n.textContent = text; return n; };
  const button = (key, label, action, disabled = false) => {
    const b = node('button', label); b.type = 'button'; b.disabled = disabled; b.dataset.focusKey = key;
    b.addEventListener('click', () => { if (!b.disabled && !panel.hidden && panel.contains(b)) action(); }); controls.push(b); return b;
  };
  function close({ restoreFocus = true } = {}) {
    if (panel.hidden) return false;
    panel.hidden = true; backdrop.hidden = true; selection = null; stepScope = null; signature = '';
    onOpenChange(false);
    if (restoreFocus && opener && doc.body.contains(opener)) opener.focus?.({ preventScroll: true });
    opener = null; owner = null; return true;
  }
  function render() {
    if (panel.hidden) return;
    const s = client.state();
    if (s.accountId !== owner || [JOB_PHASE.CLOSED, JOB_PHASE.SIGNED_OUT].includes(s.phase)) { close({ restoreFocus: false }); return; }
    const currentScope = `${s.snapshot?.session?.id ?? ''}:${s.snapshot?.session?.revision ?? ''}`;
    if (stepScope !== currentScope) { stepScope = currentScope; selection = null; }
    const nextSignature = JSON.stringify([s, selection]);
    if (signature === nextSignature) return;
    signature = nextSignature;
    const inside = panel.contains(doc.activeElement), key = inside ? doc.activeElement?.dataset?.focusKey : null;
    const scroll = panel.scrollTop; controls = []; panel.replaceChildren();
    const title = node('h2', '편의점 짧은 근무'); title.tabIndex = -1;
    panel.append(title, button('close', '닫기', () => close()));
    panel.append(node('p', '검토용 후보 · 아직 실제 근무와 지급은 열리지 않았어요.'));
    const status = node('p', s.pending ? '서버에서 근무 상태를 확인 중이에요.' : '');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); panel.append(status);
    if (s.notice && !['WRONG_CHOICE', 'STEP_TOO_FAST', 'STEP_TOO_EARLY'].includes(s.notice)) panel.append(node('p', '서버에서 요청을 처리하지 않았어요. 아래 최신 근무 기록과 정산 한도를 확인해 주세요.'));
    const p = s.snapshot?.posting;
    if (p) {
      panel.append(node('p', `${p.locationLabel} · ${p.npcLabel}`));
      panel.append(node('p', `후보 기본급 ${p.baseCoin} 코인 · ${p.budgetDate} (한국 시간) 남은 공통 정산 한도 ${p.remainingCoin} 코인 · 남은 근무 ${p.remainingShifts}회`));
      panel.append(node('p', '오답은 다시 고칠 수 있고 기본급이 깎이지 않아요. 만료 전에 완료해야 하며 시간 보너스는 없어요.'));
    }
    if (s.phase === JOB_PHASE.RECOVERY) {
      status.textContent = '결과를 아직 확인하지 못했어요. 새 근무나 정산을 보내지 않고 서버 기록을 다시 확인해 주세요.';
      panel.append(button('refresh', '근무 기록 다시 확인', () => void client.refresh(), s.pending));
    } else if (s.phase === JOB_PHASE.LOADING) {
      status.textContent = '공고와 진행 중인 근무를 불러오는 중이에요.';
    } else if (s.phase === JOB_PHASE.POSTING) {
      if (s.snapshot.session?.status === 'EXPIRED') panel.append(node('p', '이전 근무가 만료되었어요. 정산되지 않았으며 새 근무 가능 여부는 아래 한도를 확인해 주세요.'));
      panel.append(node('p', '출근 → 상품 확인 → 계산·포장과 POS 돌발상황 → 진열 정리 → 퇴근 정산'));
      panel.append(button('start', '출근하기', () => void client.start(), s.pending || p.remainingShifts < 1 || p.remainingCoin < p.baseCoin));
    } else if (s.phase === JOB_PHASE.WORKING) {
      const session = s.snapshot.session, step = session.step;
      panel.append(node('p', `업무 ${session.completedSteps + 1}/${session.totalSteps}`), node('h3', step.prompt));
      const choices = node('div', ''); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', '업무 방법 선택');
      for (const c of step.choices) {
        const b = button(`choice:${c.id}`, selection === c.id ? `선택됨: ${c.label}` : c.label, () => { selection = c.id; render(); }, s.pending);
        b.setAttribute('aria-pressed', String(selection === c.id)); choices.append(b);
      }
      panel.append(choices);
      if (s.notice === 'WRONG_CHOICE') { const retry = node('p', '다른 방법을 골라 다시 해보세요. 기본급은 줄어들지 않아요.'); retry.setAttribute('role', 'status'); panel.append(retry); }
      if (['STEP_TOO_FAST', 'STEP_TOO_EARLY'].includes(s.notice)) panel.append(node('p', '업무 안내를 확인한 뒤 잠시 후 다시 진행해 주세요.'));
      if (step.feedback) { const feedback = node('p', step.feedback); feedback.setAttribute('role', 'status'); panel.append(feedback); }
      panel.append(button('submit', '선택한 방법으로 진행', () => void client.choose(selection), s.pending || selection === null));
      panel.append(node('p', '창을 닫아도 서버에 확인된 진행은 남아요. 다시 열면 근무 기록을 불러와요.'));
    } else if (s.phase === JOB_PHASE.CHECKOUT) {
      status.textContent = '모든 업무를 확인했어요. 퇴근 정산을 요청해 주세요.';
      panel.append(button('complete', '퇴근 정산 요청', () => void client.complete(), s.pending));
    } else if (s.phase === JOB_PHASE.CONFIRMED) {
      status.textContent = `서버 정산 확인: ${s.snapshot.receipt.coin} 코인. 최신 잔액은 지갑에서 확인해 주세요.`;
      if (s.snapshot.enabled !== false && p.remainingShifts > 0) panel.append(button('start', '새 근무 출근하기', () => void client.start(), s.pending || p.remainingCoin < p.baseCoin));
    }
    if (inside) (controls.find(c => c.dataset.focusKey === key && !c.disabled) ?? title).focus?.({ preventScroll: true });
    panel.scrollTop = scroll;
  }
  const unsubscribe = client.subscribe(render);
  const onBack = () => close(); navigation?.addEventListener?.('popstate', onBack);
  panel.addEventListener('pointerdown', event => event.stopPropagation());
  backdrop.addEventListener('pointerdown', event => event.stopPropagation());
  backdrop.addEventListener('click', () => close());
  panel.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const available = controls.filter(c => !c.disabled), first = available[0], last = available.at(-1);
      if (event.shiftKey && (doc.activeElement === first || !available.includes(doc.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (doc.activeElement === last || !available.includes(doc.activeElement))) { event.preventDefault(); first?.focus(); }
    }
  });
  return {
    panel, backdrop, close, update: render,
    get open() { return !panel.hidden; },
    openPanel() {
      const s = client.state();
      if (disposed || !panel.hidden || !s.enabled || !s.accountId || s.phase === JOB_PHASE.CLOSED) return false;
      owner = s.accountId; opener = doc.activeElement; panel.hidden = false; backdrop.hidden = false;
      onOpenChange(true); render(); controls[0]?.focus(); void client.refresh(); return true;
    },
    dispose() { close(); disposed = true; unsubscribe(); navigation?.removeEventListener?.('popstate', onBack); panel.remove?.(); backdrop.remove?.(); }
  };
}
