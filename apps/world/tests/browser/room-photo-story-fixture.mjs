// No account credentials, server state, or external writes. This fixture exercises production
// DOM/controllers and real device-local IndexedDB against synthetic RPCs and a 2D canvas.
// It is deliberately not evidence for the real room renderer, collision, or physical walking.
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '../../src/input/input-focus-manager.js';
import { createInputFocusOwner } from '../../src/input/input-focus-owner.js';
import { createContextActionController } from '../../src/context-action.js';
import { createRoomHud } from '../../src/rooms/room-hud.js';
import { createRoomPhotoStory } from '../../src/rooms/room-photo-story.js';
import { createFurnitureClient } from '../../src/rooms/furniture-client.js';
import { createFurnitureEditor } from '../../src/rooms/furniture-editor.js';
import { validateFurniture } from '../../src/rooms/furniture-layout.js';
import { createPersonalRoomEnvironment, PERSONAL_ROOM_CONTROLS } from '../../src/rooms/personal-room-environment.js';
import { createPhotoMode } from '../../src/photo/photo-mode.js';
import { createPhotoCameraController } from '../../src/photo/photo-camera-controller.js';
import { createPhotoInput } from '../../src/photo/photo-input.js';
import { createPhotoCapture } from '../../src/photo/photo-capture.js';
import { createPhotoModePanel } from '../../src/photo/photo-mode-panel.js';
import { createSmartphone } from '../../src/phone/smartphone.js';
import { createFakeCameraEntity } from '../support/fake-camera.mjs';

const qa = window.__ROOM_STORY_QA__ = { ready: false };
try {
  const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const ROOM_A = '11111111-1111-4111-8111-111111111111';
  const ROOM_B = '22222222-2222-4222-8222-222222222222';
  const role = new URL(location.href).searchParams.get('role') ?? 'owner';
  const state = { active: true, busy: false, roomId: ROOM_A, ownerUserId: USER_A,
    accountId: role === 'guest' ? null : role === 'visitor' ? USER_B : USER_A,
    role: role === 'owner' ? 'owner' : 'visitor', grounded: true, position: { x: 0, y: 1, z: 0 } };
  const canvas = document.getElementById('application'), context2d = canvas.getContext('2d');
  const focus = createInputFocusManager();
  const editorOwner = createInputFocusOwner({ manager: focus, ownerId: 'furniture-editor', policy: INPUT_FOCUS_POLICY.BLOCKING_UI });
  const camera = createFakeCameraEntity({ position: [0, 1.6, 3.5], target: [0, 1, 0] });
  const orbit = { camera, yaw: 0, pitch: .2, distance: 3.5, firstPerson: false };
  const rig = createPhotoCameraController({ camera });
  const photo = createPhotoMode({ orbit, rig, inputFocus: focus, entryOwnerId: 'smartphone',
    getPosition: () => state.position,
    getState: () => ({ world: state.active, region: 'campus', space: state.roomId,
      grounded: state.grounded, transitioning: state.busy, accountId: state.accountId }) });
  const input = createPhotoInput({ mode: photo, rig, canvas, canUseShortcut: () => focus.can('GAMEPLAY_SHORTCUT') });
  const calls = [], editorCallbacks = [], completions = [], captures = [], viewed = [], notices = [];
  let editor, story, frame = null, ticks = 0, heldCompletion = null;
  const records = new Map();
  const owned = Object.freeze([
    Object.freeze({ itemId: 'furniture.dorm_desk_lamp', quantity: 1 }),
    Object.freeze({ itemId: 'furniture.induck_cushion', quantity: 1 }),
    Object.freeze({ itemId: 'furniture.campus_map_poster', quantity: 1 })
  ]);
  const inventory = { state: 'READY', snapshot: { items: owned }, onChange: () => () => {}, refresh: async () => true };
  const rpc = async (name, args) => {
    calls.push({ name, args: structuredClone(args) });
    const roomId = args.p_room;
    if (!records.has(roomId)) records.set(roomId, { roomId, role: state.role, revision: 0, objects: [] });
    const stored = records.get(roomId);
    if (name === 'get_world_room_furniture_v1') return { data: { ...structuredClone(stored), role: state.role }, error: null };
    if (name !== 'save_my_room_furniture_v1') throw Error(`Unexpected synthetic RPC: ${name}`);
    if (state.accountId !== state.ownerUserId || state.role !== 'owner') return { data: null, error: { message: 'LAYOUT_DENIED' } };
    const error = validateFurniture(args.p_objects, owned);
    if (error) return { data: null, error: { message: error } };
    const saved = { ...stored, role: 'owner', revision: stored.revision + 1, objects: structuredClone(args.p_objects) };
    records.set(roomId, saved); return { data: structuredClone(saved), error: null };
  };
  const client = createFurnitureClient({ getUserId: () => state.accountId, getClient: () => ({ rpc }),
    onChange: next => { editor?.update(next); } });
  editor = createFurnitureEditor({ client, inventory, onOpenChange: open => open ? editorOwner.acquire() : editorOwner.release() });
  const environment = createPersonalRoomEnvironment({
    getContext: () => ({ active: state.active, sessionKey: `${state.accountId}:${state.roomId}`, position: state.position,
      grounded: state.grounded, reducedMotion: true, blocked: !focus.can('WORLD_ACTION') }),
    applyFrame: value => { frame = value; }, getOutdoor: () => ({ artificialLightFactor: .2 })
  });
  const action = createContextActionController({ button: document.getElementById('qa-action'), shortcut: 'F' });
  const refreshAction = () => { action.set('room-environment', environment.contextAction()); action.refresh(); };
  const moveToControl = kind => { state.position = { ...PERSONAL_ROOM_CONTROLS[kind], y: 1 }; refreshAction(); };
  document.getElementById('qa-light').addEventListener('click', () => moveToControl('light'));
  document.getElementById('qa-curtain').addEventListener('click', () => moveToControl('curtain'));
  addEventListener('keydown', event => {
    if (event.code === 'KeyF' && !event.repeat && focus.can('WORLD_ACTION')) { event.preventDefault(); action.trigger(); refreshAction(); }
  });
  const captureContext = () => ({ position: { ...state.position }, mapSourceId: 'campus',
    locationId: state.roomId, locationName: '오프라인 방 사진 QA', capturedAtWorld: 'DAY', weatherId: 'CLEAR' });
  const phone = createSmartphone({ inputFocus: focus, photoMode: photo, getMap: () => null, getSettings: () => null,
    getIdentity: () => ({ userId: state.accountId }), getClient: () => null, getProgression: () => null,
    getCaptureContext: captureContext, canOpen: () => state.active && !state.busy && focus.can('WORLD_ACTION'),
    toggle: document.getElementById('phone-toggle'),
    onAlbumViewed: record => { viewed.push(record.id); story?.albumViewed(record); }, onWarning: text => notices.push(text) });
  phone.setAccount(state.accountId);
  story = createRoomPhotoStory({ inputFocus: focus, photoMode: photo, fallbackFocus: canvas,
    getContext: () => ({ ...client.state(), ...state }), getEnvironment: environment.status,
    openEditor: options => { editorCallbacks.push(options.onDone); return editor.openEditor(options); },
    openAlbum: record => phone.openAlbum(record), onStatus: text => notices.push(text) });
  const hud = createRoomHud({ root: document.getElementById('room-hud'), onStory: () => story.open(),
    onEdit: () => state.accountId === state.ownerUserId && state.role === 'owner' && editor.openEditor(),
    onLeave: () => { state.active = false; refresh(); } });
  const updateHud = () => hud.update({ ...state, phase: 'LOCAL', count: 1, visibility: 'private', ownerDisplayName: '합성 방 주인' });

  // Synthetic render frame emitter. The production capture controller still snapshots an actual
  // browser canvas at frameend, PNG-encodes it, and handles cancellation/session validation.
  const listeners = new Set();
  const app = { graphicsDevice: { contextLost: false }, on: (name, fn) => { if (name === 'frameend') listeners.add(fn); },
    off: (name, fn) => { if (name === 'frameend') listeners.delete(fn); }, renderNextFrame: false };
  const capture = createPhotoCapture({ app, canvas, mode: photo });
  const panel = createPhotoModePanel({ mode: photo, rig, input, capture, fallbackFocus: canvas,
    getCaptureContext: () => ({ ...phone.captureContext(), roomStoryTicket: story.ticket() }),
    onCaptured: async (result, context) => {
      const record = await phone.capture(result, context);
      captures.push({ id: record?.id ?? null, bytes: result.blob.size, width: result.width, height: result.height });
      const gate = heldCompletion;
      if (gate) { gate.reached = true; await gate.promise; if (heldCompletion === gate) heldCompletion = null; }
      const accepted = story.captured(record, context.roomStoryTicket);
      completions.push({ id: record?.id ?? null, accepted }); return record;
    }, getAlbumLatest: () => phone.latestPhoto(), onOpenAlbum: record => phone.openAlbum(record) });

  function refresh() { photo.update(); story.update(); environment.update(0); refreshAction(); updateHud(); }
  async function changeScope(change) {
    editor.forceClose(); phone.close();
    const previousAccount = state.accountId;
    Object.assign(state, change); photo.update(); story.update();
    if (previousAccount !== state.accountId) phone.setAccount(state.accountId);
    await client.bind(state.roomId); refresh();
  }
  const pagehide = event => {
    if (editor.guided) {
      if (event.persisted) editor.detachGuide();
      else editor.forceClose();
    }
    environment.reset();
  };
  addEventListener('pagehide', pagehide);
  const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
  addEventListener('resize', resize); resize();
  function render() {
    photo.applyCamera(1 / 60); story.update(); environment.update(1 / 60); refreshAction();
    const width = canvas.width, height = canvas.height;
    context2d.fillStyle = frame?.intensity ? '#8b9d9b' : '#364859'; context2d.fillRect(0, 0, width, height);
    context2d.fillStyle = '#907a65'; context2d.fillRect(0, height * .64, width, height * .36);
    context2d.fillStyle = environment.status().curtainsOpen ? '#d8edf0' : '#776c79';
    context2d.fillRect(width * .35, height * .13, width * .3, height * .3);
    for (const [i, object] of client.state().objects.entries()) {
      context2d.fillStyle = ['#ebc66d', '#6eb5ad', '#bf85ab'][i % 3];
      context2d.fillRect(width * (.12 + (object.x + 5) / 15), height * (.62 + object.z / 25), 32, 32);
    }
    context2d.fillStyle = '#f9f3e8'; context2d.font = '16px system-ui';
    context2d.fillText('SYNTHETIC ROOM · local photo story QA', 18, height - 24);
    for (const fn of [...listeners]) fn();
    ticks++; requestAnimationFrame(render);
  }
  await client.bind(state.roomId); refresh(); render();
  Object.assign(qa, { state, story, editor, client, phone, photo, panel, input, rig, environment, owned,
    USER_A, USER_B, ROOM_A, ROOM_B, calls, captures, completions, viewed, notices, changeScope, moveToControl,
    holdCaptureCompletion() {
      if (heldCompletion) throw Error('A capture completion is already held');
      let release; const promise = new Promise(resolve => { release = resolve; });
      heldCompletion = { promise, release, reached: false };
    },
    releaseCaptureCompletion() { heldCompletion?.release(); },
    callEditorCompletion(index = 0) { editorCallbacks[index]?.(); },
    simulateBfcache() {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); refresh();
    },
    snapshot() {
      return { story: story.status(), furniture: client.state(), environment: environment.status(), photo: photo.active,
        panel: panel.status(), phone: phone.status(), focus: focus.snapshot(), ticks,
        captureHeld: heldCompletion?.reached === true, completions: structuredClone(completions),
        stored: structuredClone(records.get(state.roomId) ?? null), calls: structuredClone(calls),
        editorCallbacks: editorCallbacks.length, owned: structuredClone(owned), viewed: [...viewed], captures: structuredClone(captures) };
    }
  });
  qa.ready = true;
} catch (error) { qa.error = String(error.stack ?? error); throw error; }
