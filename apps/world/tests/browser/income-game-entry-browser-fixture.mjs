import * as pc from 'playcanvas';
import { createHumanAvatar } from '../../npc-factory/dev-human-avatar.mjs';
import { createContextActionController } from '../../src/context-action.js';
import { createIncomeGameEntry, bindIncomeGameLifecycle } from '../../src/income/income-game-entry.mjs';
import { INCOME_CONVENIENCE_LOCATION as shop } from '../../src/income/income-convenience-location.mjs';
import { framebufferEvidence } from './life-props-browser-helpers.mjs';
const qa = window.__INCOME_GAME_QA__ = { ready: false, kind: 'ACTUAL_MODULE_RENDER_HARNESS', fullMainBoot: false,
  persistedLifecycleIsSynthetic: true, requests: [], events: [], locks: 0 };
const lifecycleLogKey = 'income-game-browser-real-lifecycle';
for (const type of ['pagehide','pageshow']) window.addEventListener(type, event => {
  if (!event.isTrusted) return;
  const history = JSON.parse(sessionStorage.getItem(lifecycleLogKey) || '[]');
  history.push({ type, persisted: event.persisted, trusted: true }); sessionStorage.setItem(lifecycleLogKey, JSON.stringify(history));
});
try {
  const canvas = document.getElementById('stage'); canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
  const device = await pc.createGraphicsDevice(canvas, { deviceTypes: [pc.DEVICETYPE_WEBGL2], antialias: true, preserveDrawingBuffer: true });
  const app = new pc.Application(canvas, { graphicsDevice: device }); app.autoRender = false;
  app.scene.ambientLight = new pc.Color(.7, .7, .7);
  const campus = new pc.Entity('SyntheticCampusRoot'); campus.setLocalScale(1, 1, -1); app.root.addChild(campus);
  const camera = new pc.Entity('HumanEvidenceCamera'); camera.addComponent('camera', { fov: 36, nearClip: .01, farClip: 30, clearColor: new pc.Color(.79,.84,.89) }); app.root.addChild(camera);
  const light = new pc.Entity('Light'); light.addComponent('light', { type: 'directional', intensity: 1 }); light.setLocalEulerAngles(35,35,0); app.root.addChild(light);
  const state = { sceneId: 'campus', position: { ...shop.position }, accountId: 'synthetic-account-a', blocked: false,
    mounted: false, seated: false, inside: false, conversationOpen: false, mainQuestPending: false,
    npc: { position: { ...shop.position } } };
  const control = document.getElementById('interaction');
  const context = createContextActionController({ button: control, shortcut: 'F' });
  // Hosted-game semantics deliberately avoid local auth and all income HTTP calls.
  const navigation = { location: { hostname: 'game.example' },
    addEventListener: (...args) => window.addEventListener(...args), removeEventListener: (...args) => window.removeEventListener(...args) };
  const entry = createIncomeGameEntry({ campusRoot: campus, contextActions: context, createAvatar: createHumanAvatar,
    readScene: () => state, getLocalAuthHost: () => { throw new Error('HOSTED_GAME_MUST_NOT_READ_LOCAL_AUTH'); },
    acquireInput: () => { qa.locks++; let released = false; return () => { if (!released) { qa.locks--; released = true; } }; }, navigation });
  const target = entry.employerEntity.getPosition();
  camera.setPosition(target.x + 2.6, target.y + 1.55, target.z + 4.4); camera.lookAt(target.x, target.y + .95, target.z);
  const lifecycle = bindIncomeGameLifecycle({ navigation, getRuntime: () => entry });
  const update = () => { entry.update(); context.refresh(); app.render(); };
  const close = () => entry.dialog.querySelector('button:last-child')?.click();
  document.addEventListener('keydown', event => {
    if (event.code === 'KeyF' && !event.repeat && !qa.locks) { event.preventDefault(); context.trigger(); context.refresh(); }
  });
  document.getElementById('delivery').addEventListener('click', () => entry.incomeChoice('INKYUNG-NPC-013')?.trigger());
  for (const type of ['click','keydown','pointerdown']) document.addEventListener(type, e => qa.events.push({ type, trusted: e.isTrusted, code: e.code, pointerType: e.pointerType }), true);
  function pixels() {
    const drawCallsBefore = device._drawCallsPerFrame; app.render(); const drawCalls = device._drawCallsPerFrame - drawCallsBefore;
    const gl = device.gl, data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return { ...framebufferEvidence(data, canvas.width, canvas.height), drawCalls, renderer: device.deviceType, humanRenderComponents: entry.employerEntity.findComponents('render').length };
  }
  Object.assign(qa, { entry, app, device, state, context,
    update, pixels, close, realLifecycle: () => JSON.parse(sessionStorage.getItem(lifecycleLogKey) || '[]'),
    stats: () => ({ enabled: entry.employerEntity.enabled, parts: entry.employerEntity.findComponents('render').length,
      action: context.active?.id ?? null, locks: qa.locks, dialogOpen: !entry.dialog.hidden,
      avatarName: entry.employerEntity.name, hasTorso: !!entry.employerEntity.findByName('Torso'),
      hasHead: !!entry.employerEntity.findByName('Head'), visibleParts: entry.employerEntity.findComponents('render').filter(r => r.enabled && r.entity.enabled).length }),
    mode: patch => { Object.assign(state, patch); update(); return qa.stats(); },
    persistedHide: () => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); context.refresh(); app.render(); },
    persistedShow: () => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); context.refresh(); app.render(); },
    dispose: () => { lifecycle(); entry.dispose(); app.destroy(); }
  });
  app.start(); update(); qa.ready = true;
} catch (error) { qa.error = error.stack || String(error); throw error; }
