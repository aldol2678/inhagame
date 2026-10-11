import { createIncomeCandidateRequest } from './income-http-client.mjs';
import { createConvenienceIncomeTransport } from './income-client-adapter.mjs';
import { createConvenienceJobClient } from './convenience-job-client.mjs';
import { createConvenienceJobPanel } from './convenience-job-panel.mjs';
import { createDeliveryIncomeClient } from './delivery-income-client.mjs';
import { createDeliveryIncomePanel } from './delivery-income-panel.mjs';

// Explicit developer mount only; never imported by main.js or the generated NPC runtime.
// Host supplies a LOCAL authenticated session and must call setAccount on every auth change.
export function mountIncomeCandidate({ root, getAuthorization, accountId = null, enabled = false,
  doc = globalThis.document, navigation = globalThis.window, fetcher = fetch, location = globalThis.location }) {
  if (!enabled || !root || !['localhost', '127.0.0.1'].includes(location?.hostname)) throw new Error('INCOME_CANDIDATE_LOCAL_ONLY');
  let accountEpoch = 0, currentAccount = null;
  const request = createIncomeCandidateRequest({ getAuthorization, fetcher, location, getAccountEpoch: () => accountEpoch });
  const job = createConvenienceJobClient({ enabled: true, transport: createConvenienceIncomeTransport({ request }) });
  const delivery = createDeliveryIncomeClient({ enabled: true, request });
  const jobPanel = createConvenienceJobPanel({ client: job, doc, navigation });
  const deliveryPanel = createDeliveryIncomePanel({ client: delivery, doc, navigation });
  const status = doc.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); root.append(status);
  const updateStatus = () => {
    const a = job.state(), b = delivery.state();
    status.textContent = !a.accountId ? '로컬 인증 계정이 필요해요.' : a.error || b.error ? '서버 기록을 확인하지 못했어요. 후보 서버 설정과 로컬 세션을 확인하세요.'
      : a.snapshot?.enabled === false || b.snapshot?.enabled === false ? '서버는 CLOSED 상태예요. 합성 브라우저 fixture에서 검토 흐름을 실행할 수 있어요.' : '로컬 개발 후보에 연결됐어요. 운영 계정과 분리된 테스트 기록만 사용해요.';
  };
  const unsubscribers = [job.subscribe(updateStatus), delivery.subscribe(updateStatus)];
  const buttons = [];
  for (const [label, open] of [['납품 후보 검토', button => { jobPanel.close(); void deliveryPanel.open({ opener: button }); }],
    ['편의점 후보 검토', button => { deliveryPanel.close(); button.focus?.(); jobPanel.openPanel(); }]]) {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', () => open(button)); root.append(button); buttons.push(button);
  }
  const setAccount = id => {
    const next = typeof id === 'string' && id ? id : null;
    if (next !== currentAccount) { accountEpoch++; currentAccount = next; }
    return Promise.all([job.setAccount(next), delivery.setAccount(next)]);
  };
  void setAccount(accountId);
  return { job, delivery, setAccount, dispose() { jobPanel.dispose(); deliveryPanel.dispose(); unsubscribers.forEach(fn => fn()); buttons.forEach(button => button.remove?.()); status.remove?.(); void setAccount(null); } };
}
