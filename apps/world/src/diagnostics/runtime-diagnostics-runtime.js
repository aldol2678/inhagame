import { createRuntimeDiagnostics } from './runtime-diagnostics.js';
import { createDiagnosticsPanel } from './diagnostics-panel.js';
import { WORLD_BUILD_ID } from './build-id.js';

// Tells the player when the renderer stays lost and offers a reload. The engine owns the
// actual context restore; the campus position is already kept by the local resume record.
// The grace period only runs while the page is visible: mobile browsers drop the context in
// the background and normally restore it as the tab returns.
export function createGraphicsLossNotice({ doc = globalThis.document, timers = globalThis,
  reload = () => globalThis.location.reload(), graceMs = 4000 } = {}) {
  let node = null, button = null, timer = null, lost = false, reloading = false;
  const stop = () => { if (timer !== null) timers.clearTimeout(timer); timer = null; };
  const show = () => {
    timer = null;
    if (!lost || doc.hidden) return;
    if (!node) {
      node = doc.createElement('section');
      node.id = 'graphics-recovery-notice'; node.className = 'graphics-recovery-notice';
      node.setAttribute('role', 'alert');
      const title = doc.createElement('strong'), text = doc.createElement('p');
      title.textContent = '그래픽 연결이 끊겼어요';
      text.textContent = '화면이 곧 돌아오지 않으면 다시 불러와 주세요. 마지막 위치에서 이어서 시작할 수 있어요.';
      button = doc.createElement('button'); button.type = 'button'; button.textContent = '다시 불러오기';
      button.addEventListener('click', () => {
        if (reloading) return;
        reloading = true; button.disabled = true; button.textContent = '다시 여는 중…'; reload();
      });
      node.append(title, text, button); doc.body.appendChild(node);
    }
    node.hidden = false;
    // Desktop play holds the pointer; release it so the button can be reached.
    doc.exitPointerLock?.();
    button.focus?.({ preventScroll: true });
  };
  const arm = () => { stop(); if (lost && !doc.hidden) timer = timers.setTimeout(show, graceMs); };
  return Object.freeze({
    lost() { lost = true; arm(); },
    restored() { lost = false; stop(); if (node) node.hidden = true; },
    visibilityChanged() { if (lost && !(node && !node.hidden)) arm(); },
    get visible() { return Boolean(node && !node.hidden); },
    destroy() { lost = false; stop(); node?.remove(); node = button = null; }
  });
}

// Observers only: no game-loop exception interception, network retries, or renderer mutation.
export function installRuntimeDiagnostics({ app, device, online, readState, publicZoneIds,
  inputFocus, opener, beforeOpen, returnFocus, target = globalThis.window,
  doc = globalThis.document, timers = globalThis, now, panelOptions = {} } = {}) {
  const diagnostics = createRuntimeDiagnostics({ readState, publicZoneIds, buildId: WORLD_BUILD_ID, now });
  const panel = createDiagnosticsPanel({ diagnostics, inputFocus, opener, beforeOpen, returnFocus, doc, ...panelOptions });
  const lossNotice = createGraphicsLossNotice({ doc, timers, reload: () => target.location.reload() });
  let destroyed = false;
  const cleanup = [];
  const listen = (object, event, fn) => {
    object.addEventListener(event, fn); cleanup.push(() => object.removeEventListener(event, fn));
  };
  const observe = (object, event, fn) => {
    object?.on?.(event, fn); cleanup.push(() => object?.off?.(event, fn));
  };
  // Error/rejection/identity payloads are never inspected.
  listen(target, 'error', event => { if (event.target === target) diagnostics.record('RUNTIME_SCRIPT_ERROR'); });
  listen(target, 'unhandledrejection', () => diagnostics.record('RUNTIME_PROMISE_REJECTION'));
  listen(target, 'offline', () => { diagnostics.record('NETWORK_OFFLINE'); panel.refresh(); });
  listen(target, 'online', () => panel.refresh());
  listen(doc, 'visibilitychange', () => { diagnostics.resetFrames(); lossNotice.visibilityChanged(); });
  observe(app, 'postrender', () => { if (!doc.hidden) diagnostics.frame(); });
  observe(device, 'devicelost', () => { diagnostics.rendererLost(); lossNotice.lost(); panel.refresh(); });
  observe(device, 'devicerestored', () => { diagnostics.rendererRestored(); lossNotice.restored(); panel.refresh(); });
  const reset = () => { diagnostics.reset(); panel.reset(); };
  const offIdentity = online?.onIdentity?.(reset);
  const timer = timers.setInterval(() => {
    if (doc.hidden) return;
    diagnostics.snapshot(); // detects network transitions even while the panel is closed
    panel.refresh();
  }, 1000);
  const destroy = () => {
    if (destroyed) return;
    destroyed = true; offIdentity?.(); timers.clearInterval(timer);
    cleanup.forEach(fn => fn()); diagnostics.reset(); panel.destroy(); lossNotice.destroy();
  };
  listen(target, 'pagehide', event => { reset(); if (!event.persisted) destroy(); });
  listen(target, 'pageshow', event => { if (event.persisted) reset(); });
  return Object.freeze({ status: diagnostics.snapshot, destroy });
}
