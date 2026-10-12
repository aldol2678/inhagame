import { createIncomeCandidateRequest } from './income-http-client.mjs';
import { createDeliveryIncomeClient } from './delivery-income-client.mjs';
import { createDeliveryIncomePanel } from './delivery-income-panel.mjs';

// Scene preview cannot mutate even when a misconfigured local backend claims ACTIVE.
export function createIncomeScenePanelAdapter({ enabled = false, location = globalThis.location,
  getAuthorization, fetcher = fetch, doc = globalThis.document, navigation = globalThis.window,
  acquireInput = () => () => {}, onReturn = () => {} }) {
  if (!enabled || !['localhost', '127.0.0.1'].includes(location?.hostname)) throw new Error('INCOME_SCENE_LOCAL_ONLY');
  let epoch = 0, account = null, release = null, disposed = false;
  const http = createIncomeCandidateRequest({ getAuthorization, fetcher, location, getAccountEpoch: () => epoch });
  const request = async body => {
    if (body.op !== 'status') throw Object.assign(new Error('INCOME_CLOSED'), { status: 409 });
    const result = await http(body); return { ...result, enabled: false };
  };
  const delivery = createDeliveryIncomeClient({ enabled: true, request });
  const panel = createDeliveryIncomePanel({ client: delivery, doc, navigation, onOpenChange(open) {
    if (open) release = acquireInput('income-scene-candidate');
    else { const done = release; release = null; done?.(); onReturn(); }
  } });
  return { delivery, get open() { return !panel.element.hidden; },
    openPanel(options) { if (disposed) return false; return panel.open(options); },
    close: options => panel.close(options),
    setAccount(id) { const next = typeof id === 'string' && id ? id : null;
      if (next !== account) { epoch++; account = next; panel.close({ restoreFocus: false }); }
      return delivery.setAccount(next); },
    dispose() { if (disposed) return; disposed = true; epoch++; account = null; panel.dispose(); void delivery.setAccount(null); }
  };
}
