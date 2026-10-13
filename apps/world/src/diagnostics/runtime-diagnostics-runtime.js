import { createRuntimeDiagnostics } from './runtime-diagnostics.js';
import { createDiagnosticsPanel } from './diagnostics-panel.js';
import { WORLD_BUILD_ID } from './build-id.js';

// Observers only: no game-loop exception interception, network retries, or renderer mutation.
export function installRuntimeDiagnostics({ app, device, online, readState, publicZoneIds,
  inputFocus, opener, beforeOpen, returnFocus, target = globalThis.window,
  doc = globalThis.document, timers = globalThis, now, panelOptions = {} } = {}) {
  const diagnostics = createRuntimeDiagnostics({ readState, publicZoneIds, buildId: WORLD_BUILD_ID, now });
  const panel = createDiagnosticsPanel({ diagnostics, inputFocus, opener, beforeOpen, returnFocus, doc, ...panelOptions });
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
  listen(doc, 'visibilitychange', () => diagnostics.resetFrames());
  observe(app, 'postrender', () => { if (!doc.hidden) diagnostics.frame(); });
  observe(device, 'devicelost', () => { diagnostics.rendererLost(); panel.refresh(); });
  observe(device, 'devicerestored', () => { diagnostics.rendererRestored(); panel.refresh(); });
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
    cleanup.forEach(fn => fn()); diagnostics.reset(); panel.destroy();
  };
  listen(target, 'pagehide', event => { reset(); if (!event.persisted) destroy(); });
  listen(target, 'pageshow', event => { if (event.persisted) reset(); });
  return Object.freeze({ status: diagnostics.snapshot, destroy });
}
