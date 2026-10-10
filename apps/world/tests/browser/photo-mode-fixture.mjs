// Offline real-controller/camera-rig/UI fixture. The background, wall and avatar mesh are synthetic,
// not evidence of campus composition. No account client or external writes exist here.
import * as pc from 'playcanvas';
import { PlayerController } from '/src/player-controller.js';
import { OrbitCameraController } from '/src/orbit-camera-controller.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '/src/input/input-focus-manager.js';
import { bindInputFocusRuntime } from '/src/input/input-focus-runtime.js';
import { bindPointerLockRuntime } from '/src/input/pointer-lock-runtime.js';
import { EmoteController, emoteOffsets } from '/src/online/emotes.js';
import { createPhotoMode } from '/src/photo/photo-mode.js';
import { createPhotoCameraController } from '/src/photo/photo-camera-controller.js';
import { createPhotoInput } from '/src/photo/photo-input.js';
import { createPhotoCapture } from '/src/photo/photo-capture.js';
import { bindPhotoModeEntry, createPhotoModePanel } from '/src/photo/photo-mode-panel.js';
import { MAIN_GATE_SPAWN } from '/src/campus-spawn.js';
import { roadviewGroundHeight } from '/src/roadview-layout.js';
import { box, surface } from '/src/campus-render-kit.js';
const qa = window.__PHOTO_QA__ = { ready: false };
try {
  const canvas = document.getElementById('application');
  const device = await pc.createGraphicsDevice(canvas, { deviceTypes: [new URL(location.href).searchParams.get('backend') === 'webgpu' ? pc.DEVICETYPE_WEBGPU : pc.DEVICETYPE_WEBGL2], antialias: true });
  const app = new pc.Application(canvas, { graphicsDevice: device }); app.scene.ambientLight = new pc.Color(.7, .7, .75);
  const root = new pc.Entity('Photo_QA'); root.setLocalScale(1, 1, -1); app.root.addChild(root);
  // Any campus point: the spawn walk lane, not a photo location.
  const spawn = MAIN_GATE_SPAWN, ground = roadviewGroundHeight(spawn.x, spawn.z);
  box(root, 'synthetic-ground', [spawn.x, ground - .05, spawn.z + 10], [80, .1, 80], surface('#88a595'));
  for (const [i, color] of ['#84b8d2', '#d28484', '#d2c284', '#a084d2'].entries())
    box(root, `synthetic-marker-${i}`, [spawn.x + (i - 1.5) * 4, ground + 1.5, spawn.z + 9 + (i % 2) * 3], [1, 3, 1], surface(color));
  // A real collider for the photo rig, rendered so the stop is visible, inside the travel radius.
  // (Only the photo rig collides with it; the player keeps the real campus colliders.)
  const wall = Object.freeze({ id: 'qa-photo-wall', minX: spawn.x + 4, maxX: spawn.x + 4.6, minY: ground, maxY: ground + 4, minZ: spawn.z - 8, maxZ: spawn.z + 8 });
  box(root, 'synthetic-wall', [spawn.x + 4.3, ground + 2, spawn.z], [.6, 4, 16], surface('#c9b79c'));
  const player = new pc.Entity('Photo_Player'); root.addChild(player); player.setLocalPosition(spawn.x, ground + 1.15, spawn.z);
  const avatar = box(player, 'synthetic-avatar', [0, -.55, 0], [.35, .75, .3], surface('#f2d36e'), 0, 'capsule');
  const camera = new pc.Entity('Photo_Camera'); camera.addComponent('camera', { nearClip: .3, farClip: 400, fov: 62, clearColor: new pc.Color(.4, .6, .8) }); app.root.addChild(camera);
  const focus = createInputFocusManager();
  const controller = new PlayerController(player, { campusShuttleEnabled: false });
  const orbit = new OrbitCameraController(camera, canvas, { canUseGameplayShortcut: () => focus.can('GAMEPLAY_SHORTCUT') });
  orbit.yaw = .35; orbit.pitch = .42; orbit.distance = 3.5;
  bindInputFocusRuntime({ manager: focus, controller, orbit });
  const pointerLock = bindPointerLockRuntime({ manager: focus, canvas, orbit });
  controller.setTransportGate(() => focus.can('WORLD_ACTION'));
  const emotes = new EmoteController({ clock: { now: () => performance.now() } });
  const state = { world: true, region: 'campus', space: 'campus', combat: false, cinematic: false, transitioning: false, accountId: 'guest' };
  const rig = createPhotoCameraController({ camera, collision: { obstacles: () => [wall], floorHeight: () => ground } });
  const mode = createPhotoMode({ orbit, rig, inputFocus: focus, getPosition: () => player.getLocalPosition(),
    getState: () => ({ ...state, grounded: controller.grounded, mounted: controller.mounted }),
    getPointerLocked: () => pointerLock.status().locked,
    beforeOpen: () => emotes.cancel('photo-mode'),
    requestPose: () => emotes.request('photo_pose', { moving: controller.moving, grounded: controller.grounded, mounted: controller.mounted }),
    cancelPose: () => emotes.cancel('photo-mode-close') });
  const input = createPhotoInput({ mode, rig, canvas, canUseShortcut: () => focus.can('GAMEPLAY_SHORTCUT'),
    getMouseLook: () => ({ sensitivity: orbit.mouseSensitivity, invertY: orbit.invertMouseY }) });
  const panel = createPhotoModePanel({ mode, rig, input, fallbackFocus: canvas, capture: createPhotoCapture({ app, canvas, mode }) });
  const entry = bindPhotoModeEntry({ button: document.getElementById('photo-mode-toggle'), mode });
  const resize = () => device.resizeCanvas(innerWidth, innerHeight); addEventListener('resize', resize); resize();
  let ticks = 0;
  app.on('update', dt => {
    mode.update(); controller.update(Math.min(dt, .05), orbit.yaw);
    const emote = emotes.update({ moving: controller.moving, grounded: controller.grounded, mounted: controller.mounted });
    const pose = emote ? emoteOffsets(emote.id, emote.elapsedMs) : { bodyRoll: 0 };
    avatar.setLocalEulerAngles(0, 0, pose.bodyRoll);
    // Same single-owner branch as the World loop.
    if (!(mode.active && mode.applyCamera(dt))) orbit.apply(player.getLocalPosition());
    entry.refresh(); ticks++;
  });
  Object.assign(qa, { app, mode, rig, input, panel, orbit, controller, state, focus, pointerLock, wall,
    backend: device.isWebGPU ? 'webgpu' : 'webgl2',
    takeover() { return focus.claim('qa-transition', INPUT_FOCUS_POLICY.SYSTEM_LOCK); },
    snapshot() {
      const p = player.getLocalPosition(), c = camera.getPosition(), r = camera.getRotation();
      return { active: mode.active, ticks, input: controller.inputEnabled, cameraInput: orbit.inputEnabled,
        pose: { position: [c.x, c.y, c.z], rotation: [r.x, r.y, r.z, r.w], fov: camera.camera.fov, nearClip: camera.camera.nearClip },
        orbit: { yaw: orbit.yaw, pitch: orbit.pitch, distance: orbit.distance, firstPerson: orbit.firstPerson },
        rig: rig.snapshot(), photoInput: input.status(), ui: panel.status(), blocked: mode.blockedReason(),
        position: [p.x, p.y, p.z], touch: { ...controller.touchVector }, keys: [...controller.keys], claims: focus.size,
        topOwners: focus.snapshot().topOwners, pointerLock: pointerLock.status(),
        emote: emotes.active?.id ?? null, hud: document.body.dataset.photoMode ?? null, viewport: [canvas.width, canvas.height] };
    }
  });
  app.start(); qa.ready = true;
} catch (error) { qa.error = String(error.stack ?? error); throw error; }
