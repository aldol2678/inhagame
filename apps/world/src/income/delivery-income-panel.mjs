// Candidate-only delivery view. Every displayed holding/receipt comes from server status.
export function createDeliveryIncomePanel({ client, doc = globalThis.document, navigation = globalThis.window, onOpenChange = () => {} }) {
  const panel = doc.createElement('section'); panel.className = 'furniture-editor delivery-income-panel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', '가태린의 작은 요리 준비');
  const backdrop = doc.createElement('div'); backdrop.className = 'furniture-editor-backdrop'; backdrop.hidden = true;
  doc.body.append(backdrop, panel);
  let owner = null, opener = null, controls = [], disposed = false;
  const node = (tag, text) => { const el = doc.createElement(tag); el.textContent = text; return el; };
  function close({ restoreFocus = true } = {}) {
    if (panel.hidden) return false;
    panel.hidden = true; backdrop.hidden = true; onOpenChange(false);
    if (restoreFocus && opener && doc.body.contains(opener)) opener.focus?.({ preventScroll: true });
    owner = null; opener = null; return true;
  }
  const button = (label, callback, disabled = false) => {
    const el = node('button', label); el.type = 'button'; el.disabled = disabled;
    el.addEventListener('click', () => { if (!el.disabled && !panel.hidden && panel.contains(el)) callback(); }); controls.push(el); return el;
  };
  function render() {
    if (panel.hidden) return;
    const s = client.state();
    if (s.accountId !== owner) { close({ restoreFocus: false }); return; }
    const inside = panel.contains(doc.activeElement); controls = []; panel.replaceChildren();
    const heading = node('h2', '가태린의 작은 요리 준비'); heading.tabIndex = -1;
    panel.append(heading, button('닫기', () => close()));
    panel.append(node('p', '검토용 후보 · 실제 의뢰와 지급은 닫혀 있어요. 가태린과의 현장 연결은 준비 중이에요.'));
    const status = node('p', s.pending ? '서버 기록을 확인 중이에요.' : ''); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); panel.append(status);
    const p = s.snapshot;
    if (p) {
      panel.append(node('p', `가태린 · 잉어 1개 제한 납품 · 후보 ${p.coin} 코인`));
      panel.append(node('p', `보유 잉어 ${p.ownedQuantity}개 / 필요한 잉어 ${p.requiredQuantity}개`));
      panel.append(node('p', `${p.budgetDate} (한국 시간) 남은 공통 한도 ${p.remainingCoin} 코인 · 남은 납품 ${p.remainingDeliveries}회`));
      if (p.receipt) panel.append(node('p', `서버 정산 영수증 확인: ${p.receipt.coin} 코인 · 영수증 ${p.receipt.settlementId}`));
      if (p.status === 'EXPIRED') panel.append(node('p', '이전 의뢰가 만료됐어요. 재료는 정산되지 않았고 다시 수락할 수 있어요.'));
      if (!p.enabled) panel.append(node('p', '서버에서 의뢰를 열지 않았어요. 기존 영수증만 확인할 수 있어요.'));
      if (s.error) panel.append(node('p', '처리 결과가 불확실해요. 재료를 다시 제출하지 말고 기록을 확인해 주세요.'));
      else if (p.status === 'READY_TO_SETTLE') {
        panel.append(node('p', '수락한 의뢰예요. 제출하면 잉어 1개가 차감되고 같은 서버 정산에서 급여가 기록돼요.'));
        panel.append(button('잉어 1개 제출', () => void client.submit(), s.pending || !p.enabled || p.ownedQuantity < 1));
      } else panel.append(button('의뢰 수락', () => void client.accept(), s.pending || !p.enabled || p.remainingDeliveries < 1 || p.remainingCoin < p.coin));
    }
    if (s.notice) panel.append(node('p', '서버가 요청을 거절했어요. 보유 재료와 최신 기록을 확인해 주세요.'));
    panel.append(button('의뢰 기록 다시 확인', () => void client.refresh(), s.pending));
    if (inside) heading.focus?.({ preventScroll: true });
  }
  const keydown = event => {
    if (panel.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation?.(); close(); }
    if (event.key === 'Tab') {
      const focusable = controls.filter(el => !el.disabled); const index = focusable.indexOf(doc.activeElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && (index < 0 || index === focusable.length - 1)) { event.preventDefault(); focusable[0]?.focus(); }
    }
  };
  const back = () => close();
  panel.addEventListener('keydown', keydown); navigation?.addEventListener?.('popstate', back);
  const unsubscribe = client.subscribe(render);
  return {
    element: panel,
    async open({ opener: requestedOpener = doc.activeElement } = {}) {
      const s = client.state(); if (disposed || !s.enabled || !s.accountId) return false;
      opener = requestedOpener; owner = s.accountId; panel.hidden = false; backdrop.hidden = false; onOpenChange(true); render();
      controls[0]?.focus(); await client.refresh(); return !panel.hidden;
    }, close,
    dispose() { if (disposed) return; disposed = true; close(); unsubscribe(); navigation?.removeEventListener?.('popstate', back); panel.remove?.(); backdrop.remove?.(); }
  };
}
