import * as pc from 'playcanvas';
import { PlayerController } from '../../src/player-controller.js';
import { mountConvenienceAuthorityRuntime } from '../../src/income/convenience-authority-runtime.mjs';
import { readIncomeResolvedFramebuffer } from './income-game-entry-framebuffer.mjs';

// Actual engine/controller/runtime modules, real DOM and native fetch. Only the HTTP replies and
// account provider are synthetic. This intentionally does not import/boot the full main module.
const qa = window.__CONVENIENCE_AUTHORITY_QA__ = { ready: false, kind: 'ACTUAL_MODULE_RENDER_SYNTHETIC_HTTP',
  fullMainBoot: false, realDatabase: false, realAuthentication: false, paymentEvidence: false,
  persistedLifecycleIsSynthetic: true, events: [], leases: { acquired: 0, released: 0, active: 0 } };
try {
  const canvas = document.getElementById('stage'); canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
  const device = await pc.createGraphicsDevice(canvas, { deviceTypes: [pc.DEVICETYPE_WEBGL2], antialias: true, preserveDrawingBuffer: true });
  const app = new pc.Application(canvas, { graphicsDevice: device });
  app.scene.ambientLight = new pc.Color(.9, .9, .9);
  const entity = new pc.Entity('ActualControllerPlayerSyntheticMesh');
  const material = new pc.StandardMaterial(); material.diffuse = new pc.Color(.1, .45, .75); material.update();
  entity.addComponent('render', { type: 'box', material }); entity.setLocalScale(.6, 1.7, .6);
  entity.setLocalPosition(116, 1.15, 45); app.root.addChild(entity);
  const camera = new pc.Entity('EvidenceCamera'); camera.addComponent('camera', { fov: 42, nearClip: .1, farClip: 100, clearColor: new pc.Color(.79, .84, .89) });
  camera.setPosition(123, 7, 53); camera.lookAt(119, 1, 45); app.root.addChild(camera);
  const controller = new PlayerController(entity);
  const scene = { accountId: 'synthetic-account-a', sceneId: 'campus', blocked: false, mounted: false, seated: false, inside: false };
  let accountListener;
  const host = { convenienceAuthority: true, accountId: scene.accountId,
    getAuthorization: async () => 'Bearer synthetic.browser.fixture.not.real',
    subscribe(fn) { accountListener = fn; return () => { accountListener = null; }; } };
  const runtime = mountConvenienceAuthorityRuntime({ controller, host, readScene: () => scene,
    acquireInput() {
      qa.leases.acquired++; qa.leases.active++; controller.inputEnabled = false;
      let released = false;
      return () => {
        if (released) throw Error('INPUT_LEASE_RELEASED_TWICE'); released = true;
        qa.leases.active--; qa.leases.released++; controller.inputEnabled = qa.leases.active === 0;
      };
    } });
  // Outside authority sessions this isolated harness holds the entity in place. The actual controller
  // update runs on every authority frame; unrelated full-campus physics are not claimed as coverage.
  app.on('update', dt => { runtime.update(); if (controller.authoritativeWalk) controller.update(dt, 0); });
  for (const type of ['click', 'keydown', 'pointerdown', 'pointerup']) document.addEventListener(type, event => {
    qa.events.push({ type, trusted: event.isTrusted, code: event.code, pointerType: event.pointerType });
  }, true);
  const position = () => { const p = entity.getLocalPosition(); return { x: p.x, y: p.y, z: p.z }; };
  Object.assign(qa, { app, controller, runtime, scene,
    stats: () => ({ active: runtime.authority.active, walker: !!controller.authoritativeWalk,
      position: position(), snapshot: runtime.authority.snapshot, panelOpen: runtime.panel.open,
      transportLocks: [...controller.transportLocks], inputEnabled: controller.inputEnabled, leases: { ...qa.leases },
      phase: runtime.job.state().phase, accountId: runtime.job.state().accountId,
      actualController: controller instanceof PlayerController, actualEntity: entity instanceof pc.Entity,
      touchVector: { ...controller.touchVector } }),
    frame(dt = 1 / 60) { if (controller.authoritativeWalk) controller.update(dt, 0); return position(); },
    account(id) { host.accountId = id; scene.accountId = id; accountListener?.(id); },
    scenePatch(patch) { Object.assign(scene, patch); runtime.update(); },
    persistedHide() { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); },
    persistedShow() { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); },
    pixels: () => new Promise((resolve, reject) => {
      const after = () => { clearTimeout(timer); try { resolve({ ...readIncomeResolvedFramebuffer(device.gl), renderer: device.deviceType }); } catch (error) { reject(error); } };
      const timer = setTimeout(() => { app.off('postrender', after); reject(Error('FRAMEBUFFER_TIMEOUT')); }, 6000);
      app.once('postrender', after);
    }),
    dispose() { runtime.dispose(); app.destroy(); }
  });
  app.start(); qa.ready = true;
} catch (error) { qa.error = error.stack || String(error); throw error; }
