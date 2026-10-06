// Offline real-controller/camera/UI fixture. The background and avatar mesh are synthetic,
// not evidence of the full lake's composition. No account client or external writes exist here.
import * as pc from 'playcanvas';
import { PlayerController } from '/src/player-controller.js';
import { OrbitCameraController } from '/src/orbit-camera-controller.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '/src/input/input-focus-manager.js';
import { bindInputFocusRuntime } from '/src/input/input-focus-runtime.js';
import { createContextActionController } from '/src/context-action.js';
import { EmoteController, emoteOffsets } from '/src/online/emotes.js';
import { createPhotoMode } from '/src/photo/photo-mode.js';
import { createPhotoModePanel } from '/src/photo/photo-mode-panel.js';
import { INKYUNG_PHOTO_POINT } from '/src/photo/inkyung-photo-point.js';
import { roadviewGroundHeight } from '/src/roadview-layout.js';
import { box, surface } from '/src/campus-render-kit.js';
const qa = window.__PHOTO_QA__ = { ready: false };
try {
  const canvas = document.getElementById('application');
  const device = await pc.createGraphicsDevice(canvas, { deviceTypes: [pc.DEVICETYPE_WEBGL2], antialias: true });
  const app = new pc.Application(canvas, { graphicsDevice: device }); app.scene.ambientLight = new pc.Color(.7, .7, .75);
  const root = new pc.Entity('Photo_QA'); root.setLocalScale(1, 1, -1); app.root.addChild(root);
  const point = INKYUNG_PHOTO_POINT.position, ground = roadviewGroundHeight(point.x, point.z);
  box(root, 'synthetic-ground', [point.x, ground - .05, point.z], [80, .1, 80], surface('#88a595'));
  box(root, 'synthetic-view-marker', [point.x + 3, ground + 2, point.z + 5], [1, 4, 1], surface('#84b8d2'));
  const player = new pc.Entity('Photo_Player'); root.addChild(player); player.setLocalPosition(point.x, ground + 1.15, point.z);
  const avatar = box(player, 'synthetic-avatar', [0, -.55, 0], [.35, .75, .3], surface('#f2d36e'), 0, 'capsule');
  const camera = new pc.Entity('Photo_Camera'); camera.addComponent('camera', { nearClip: .3, farClip: 400, clearColor: new pc.Color(.4, .6, .8) }); app.root.addChild(camera);
  const focus = createInputFocusManager();
  const controller = new PlayerController(player, { campusShuttleEnabled: false });
  const orbit = new OrbitCameraController(camera, canvas, { canUseGameplayShortcut: () => focus.can('GAMEPLAY_SHORTCUT') });
  orbit.yaw = .45; orbit.pitch = .5; orbit.distance = 5;
  bindInputFocusRuntime({ manager: focus, controller, orbit });
  controller.setTransportGate(() => focus.can('WORLD_ACTION'));
  const emotes = new EmoteController({ clock: { now: () => performance.now() } });
  const state = { campus: true, seated: false, combat: false, transitioning: false, accountId: 'guest' };
  const mode = createPhotoMode({ orbit, inputFocus: focus, getPosition: () => player.getLocalPosition(),
    getState: () => ({ ...state, grounded: controller.grounded, mounted: controller.mounted }),
    beforeOpen: () => emotes.cancel('photo-mode'),
    requestPose: () => emotes.request('photo_pose', { moving: controller.moving, grounded: controller.grounded, mounted: controller.mounted }),
    cancelPose: () => emotes.cancel('photo-mode-close') });
  const panel = createPhotoModePanel({ mode, fallbackFocus: canvas });
  const context = createContextActionController({ button: document.getElementById('context-action'), shortcut: 'F' });
  addEventListener('keydown', event => { if (event.code === 'KeyF' && !event.repeat && focus.can('WORLD_ACTION')) context.trigger(); });
  const resize = () => device.resizeCanvas(innerWidth, innerHeight); addEventListener('resize', resize); resize();
  let ticks = 0;
  app.on('update', dt => {
    mode.update(); controller.update(Math.min(dt, .05), orbit.yaw);
    const emote = emotes.update({ moving: controller.moving, grounded: controller.grounded, mounted: controller.mounted });
    const pose = emote ? emoteOffsets(emote.id, emote.elapsedMs) : { bodyRoll: 0 };
    avatar.setLocalEulerAngles(0, 0, pose.bodyRoll); orbit.apply(player.getLocalPosition());
    context.set('photo', mode.contextAction()); context.setSuspended(!focus.can('WORLD_ACTION')); context.refresh(); ticks++;
  });
  Object.assign(qa, { app, mode, panel, orbit, controller, state, focus,
    takeover() { return focus.claim('qa-transition', INPUT_FOCUS_POLICY.SYSTEM_LOCK); },
    snapshot() { const p = player.getLocalPosition(); return { active: mode.active, ticks, input: controller.inputEnabled,
      cameraInput: orbit.inputEnabled, camera: { yaw: orbit.yaw, pitch: orbit.pitch, distance: orbit.distance, firstPerson: orbit.firstPerson, nearClip: camera.camera.nearClip },
      position: [p.x, p.y, p.z], touch: { ...controller.touchVector }, keys: [...controller.keys], claims: focus.size,
      pose: emotes.active?.id ?? null, hud: document.body.dataset.photoMode ?? null, viewport: [canvas.width, canvas.height] }; }
  });
  app.start(); qa.ready = true;
} catch (error) { qa.error = String(error.stack ?? error); throw error; }
