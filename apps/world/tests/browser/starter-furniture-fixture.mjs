// QA composition root only. Every shop/wallet/inventory/layout operation crosses the
// Playwright binding to the disposable PostgREST database. No local grants or balances.
import * as pc from 'playcanvas';
import { createDorm1LobbyScene } from '/src/rooms/dorm1-lobby-renderer.js';
import { createPersonalRoomScene } from '/src/rooms/personal-room-renderer.js';
import { createDormShopDialogue } from '/src/shop/dorm-shop-dialogue.js';
import { createDormShopInteraction } from '/src/shop/dorm-shop-interaction.js';
import { createShopRouter } from '/src/shop/shop-router.js';
import { createShopPanel } from '/src/shop/shop-panel.js';
import { createShopFurnitureHandoff } from '/src/shop/shop-furniture-handoff.js';
import { createWalletClient } from '/src/wallet/wallet-client.js';
import { createInventoryClient } from '/src/inventory/inventory-client.js';
import { createFurnitureClient } from '/src/rooms/furniture-client.js';
import { createFurnitureEditor } from '/src/rooms/furniture-editor.js';
import { PersonalRoomClient } from '/src/rooms/personal-room-client.js';
import { parseRoomAccess } from '/src/rooms/room-session.js';
import { personalRoomSeatAnchors, personalRoomSeatZone, resolveRoomSeatStandPoint, roomSeatPointIsClear } from '/src/rooms/personal-room-seats.js';
import { createSeatInteraction } from '/src/seat-interaction.js';
import { createCharacter } from '/src/character-model.js';
import { createContextActionController } from '/src/context-action.js';
import { PlayerController } from '/src/player-controller.js';
import { OrbitCameraController } from '/src/orbit-camera-controller.js';
import { createRoomWorldAdapter } from '/src/rooms/room-world-adapter.js';
import { ROOMS } from '/src/rooms/room-registry.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '/src/input/input-focus-manager.js';
import { createInputFocusOwner } from '/src/input/input-focus-owner.js';

const qa = window.__STARTER_FURNITURE__ = { ready: false };
try {
  if (!window.__STARTER_IDENTITY__?.userId || typeof window.__STARTER_RPC__ !== 'function') throw Error('Disposable DB binding is required');
  const identity = window.__STARTER_IDENTITY__;
  let accountId = identity.userId, space = 'ROOM_DORM1_LOBBY', access = null, metadata = null;
  let frames = 0, blocked = false, invalid = false, savingRoom = false, fixedCamera = 'vendor';
  const notices = [], client = { rpc: (name, args) => window.__STARTER_RPC__(name, args ?? {}) };
  const canvas = document.getElementById('starter-stage');
  const device = await pc.createGraphicsDevice(canvas, { deviceTypes: [pc.DEVICETYPE_WEBGL2], antialias: true });
  const app = new pc.Application(canvas, { graphicsDevice: device });
  const camera = new pc.Entity('Starter_QA_Camera');
  camera.addComponent('camera', { fov: 55, nearClip: .03, farClip: 150 }); app.root.addChild(camera);
  const campus = new pc.Entity('Starter_QA_Campus'); app.root.addChild(campus);
  const player = new pc.Entity('Starter_QA_Player'); campus.addChild(player);
  const controller = new PlayerController(player), character = createCharacter(app, player);
  const orbit = new OrbitCameraController(camera, canvas);
  const lobby = createDorm1LobbyScene(app, { player, camera });
  if (!lobby.shopVendor?.visual?.avatar) throw Error('Production dorm vendor is not integrated');
  const room = createPersonalRoomScene(app);
  const focus = createInputFocusManager();
  const input = id => createInputFocusOwner({ manager: focus, ownerId: id, policy: INPUT_FOCUS_POLICY.BLOCKING_UI });
  const shopInput = input('shop'), dialogueInput = input('dorm-shop-dialogue'), editorInput = input('furniture-editor');
  const context = createContextActionController({ button: document.getElementById('context-action'), shortcut: 'F' });
  const shop = createShopRouter({ getClient: () => client, shopIds: ['shop.student_center', 'shop.dorm_furniture'] });
  const wallet = createWalletClient({ getClient: () => client });
  const inventory = createInventoryClient({ getClient: () => client });
  const personalRoom = new PersonalRoomClient({ getClient: () => client, getSelfUserId: () => accountId });
  let editor, panel, interaction;
  const furniture = createFurnitureClient({ getClient: () => client, getUserId: () => accountId,
    onChange(state) { room.ownedFurniture.setObjects(state.objects); editor?.update(state); } });
  const anchors = () => personalRoomSeatAnchors({ roomId: space === 'ROOM_PERSONAL_BASIC' ? metadata?.roomId : null,
    objects: furniture.state().objects, obstacles: room.obstacles, position: player.getLocalPosition() });
  const seating = createSeatInteraction({ player, controller, getAnchors: anchors, getSpaceId: () => metadata?.roomId ?? space,
    getPlaceZoneId: () => space === 'ROOM_PERSONAL_BASIC' ? personalRoomSeatZone(metadata?.roomId) : null,
    canInteract: () => space === 'ROOM_PERSONAL_BASIC' && !blocked && focus.can('WORLD_ACTION') && !editor?.open,
    resolveStandPoint: anchor => resolveRoomSeatStandPoint(anchor, room.obstacles) });
  const world = createRoomWorldAdapter({ player, controller, orbit, campusRoot: campus, seating, seats: seating.seats,
    getRoomScene: definition => definition.id === 'ROOM_PERSONAL_BASIC' ? room : lobby,
    places: { getCurrentPlaceZone: () => null },
    lighting: { save: () => ({ ambient: app.scene.ambientLight.clone(), clearColor: camera.camera.clearColor.clone() }),
      apply: value => { app.scene.ambientLight = value.ambient; camera.camera.clearColor = value.clearColor; } } });
  function refreshContext() {
    interaction?.update();
    const nearby = seating.refreshNearby();
    context.set('dorm-furniture-shop', interaction?.contextAction());
    context.set('seat', space !== 'ROOM_PERSONAL_BASIC' || editor?.open || !focus.can('WORLD_ACTION') ? null
      : seating.seats.isSeated ? { label: '일어나기', priority: 280, pressed: true, trigger: () => seating.toggle() }
        : nearby ? { label: '앉기', priority: 260, pressed: false, trigger: () => seating.toggle() } : null);
    context.refresh();
  }
  const inputChanged = (owner, open) => { if (open) owner.acquire(); else owner.release(); refreshContext(); };
  editor = createFurnitureEditor({ client: furniture, inventory, onOpenChange(open) {
    if (open) seating.standUp('furniture-edit'); inputChanged(editorInput, open);
  } });
  const handoff = createShopFurnitureHandoff({ inventory, getAccountId: () => accountId,
    getContext: () => ({ available: Boolean(accountId), busy: savingRoom, space,
      metadata: metadata && { visitRole: access?.role, ownerUserId: metadata.ownerUserId, personalRoomId: metadata.roomId },
      furniture: furniture.state(),
      // This QA does not claim Realtime coverage. These fields come only from the actual
      // room metadata + successful access RPC; no network presence/channel is fabricated.
      session: { active: access?.allowed === true, role: access?.role, ownerUserId: access?.ownerUserId, roomId: metadata?.roomId } }),
    openEditor: () => editor.openEditor(), guideToDorm: () => true, onStatus: value => notices.push(value) });
  panel = createShopPanel({ panel: document.getElementById('starter-shop'), shop, wallet, inventory,
    onPurchase: () => inventory.refresh('purchase'), getFurnitureAction: id => handoff.action(id),
    onDecorate: id => handoff.open(id), onStatus: value => notices.push(value),
    onOpenChange: open => inputChanged(shopInput, open) });
  const dialogue = createDormShopDialogue({ onOpenChange: open => inputChanged(dialogueInput, open) });
  interaction = createDormShopInteraction({ dialogue, getMode: () => shop.mode,
    getState: () => ({ space, position: player.getLocalPosition(), grounded: controller.grounded,
      available: Boolean(accountId), accountId, invalid: invalid || seating.seats.isSeated,
      blocked: blocked || !focus.can('WORLD_ACTION') || panel.open }), openShop: id => panel.openShop(id) });
  shop.onChange(change => { if (change.reason === 'account') interaction.invalidate(); });
  focus.subscribe(snapshot => { if (interaction.open && snapshot.topOwners.some(owner => owner !== 'dorm-shop-dialogue')) interaction.cancel(); });
  async function enterRoom() {
    if (savingRoom || !accountId) return false;
    savingRoom = true;
    try {
      const next = await personalRoom.ensure();
      const result = await client.rpc('check_world_room_access_v1', { p_room: next.roomId });
      if (result.error) throw Error(result.error.message);
      const checked = parseRoomAccess(result.data, next.roomId);
      if (!checked.allowed || checked.role !== 'owner' || checked.ownerUserId !== accountId) throw Error('Owner access was not granted');
      if (!await furniture.bind(next.roomId)) throw Error('Server furniture read failed');
      interaction.cancel(); panel.setOpen(false); seating.standUp('room');
      metadata = next; access = checked; space = 'ROOM_PERSONAL_BASIC';
      world.showRoom(ROOMS.ROOM_PERSONAL_BASIC); world.placePlayer({ x: 0, y: 1.15, z: -2.65 }, 0);
      fixedCamera = null; document.getElementById('starter-decorate').hidden = false; refreshContext(); return true;
    } finally { savingRoom = false; }
  }
  function enterLobby() {
    editor.forceClose(); seating.standUp('lobby'); interaction.cancel(); panel.setOpen(false);
    space = 'ROOM_DORM1_LOBBY'; access = null; metadata = null;
    world.showRoom(ROOMS.ROOM_DORM1_LOBBY); world.placePlayer({ x: 0, y: 1.15, z: .85 }, 0);
    fixedCamera = 'vendor'; document.getElementById('starter-decorate').hidden = true; refreshContext();
  }
  document.getElementById('starter-lobby').onclick = enterLobby;
  document.getElementById('starter-room').onclick = () => { void enterRoom().catch(error => { qa.error = error.stack; }); };
  document.getElementById('starter-decorate').onclick = () => editor.openEditor();
  document.addEventListener('keydown', event => {
    if (event.code === 'KeyF' && !event.repeat && focus.can('WORLD_ACTION')) { event.preventDefault(); context.trigger(); }
  });
  const project = position => { const p = camera.camera.worldToScreen(position); return { x: p.x, y: p.y, z: p.z }; };
  function subject(root) {
    const renders = root?.findComponents('render').filter(render => render.entity.enabled) ?? [];
    const points = [];
    for (const render of renders) for (const mesh of render.meshInstances) {
      const { center: c, halfExtents: h } = mesh.aabb;
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) points.push(project(new pc.Vec3(c.x + x*h.x, c.y + y*h.y, c.z + z*h.z)));
    }
    return { exists: Boolean(root?.enabled), meshCount: renders.reduce((n,r) => n+r.meshInstances.length,0),
      bounds: points.length ? { left: Math.min(...points.map(p=>p.x)), right: Math.max(...points.map(p=>p.x)),
        top: Math.min(...points.map(p=>p.y)), bottom: Math.max(...points.map(p=>p.y)), inFront: points.every(p=>p.z>0) } : null };
  }
  const sofa = () => furniture.state().objects.find(object => object.itemId === 'furniture.dorm_single_sofa');
  function captureView(kind) {
    fixedCamera = kind;
    if (kind === 'vendor') { camera.setPosition(1.4, 1.48, .8); camera.lookAt(0, .66, -2.7); }
    else if (kind === 'sofa') {
      const object = sofa(); if (!object) throw Error('No server-saved sofa');
      const point = room.root.getWorldTransform().transformPoint(new pc.Vec3(object.x, .57, object.z));
      const inward = new pc.Vec3(-point.x, 0, -point.z).normalize().mulScalar(innerWidth < 600 ? 3.4 : 2.6);
      camera.setPosition(point.x + inward.x, 1.65, point.z + inward.z); camera.lookAt(point);
    }
  }
  qa.snapshot = () => ({ ready: qa.ready, frames, space, accountId, access, metadata,
    shop: shop.status(), wallet: wallet.snapshot, inventory: inventory.snapshot, furniture: furniture.state(),
    seated: seating.seats.isSeated, seat: seating.seats.seated?.interactableId ?? null,
    position: { ...player.getLocalPosition() }, pose: character.pose, characterModel: character.modelState,
    safe: roomSeatPointIsClear(player.getLocalPosition(), room.obstacles), action: context.active?.label ?? null,
    focus: document.activeElement?.id || document.activeElement?.dataset?.focusKey || null,
    dialogueOpen: dialogue.open, shopOpen: panel.open, editorOpen: editor.open,
    vendor: subject(lobby.shopVendor.visual.avatar), player: subject(player),
    sofa: subject(sofa() && room.ownedFurniture.root.findByName(`placed_${sofa().id}`)),
    renderedObjects: room.ownedFurniture.root.children.map(entity => entity.name), notices: [...notices] });
  qa.setBlocked = value => { blocked = value; refreshContext(); };
  qa.setInvalid = value => { invalid = value; refreshContext(); };
  qa.position = (x,z) => { world.placePlayer({x,y:1.15,z},0); refreshContext(); };
  qa.guest = async value => { accountId = value ? null : identity.userId; shop.setAccount(accountId);
    await Promise.all([inventory.setAccount(accountId), wallet.setAccount(accountId)]);
    if (accountId) await shop.refresh('qa-account'); refreshContext(); };
  qa.approachSofa = () => {
    seating.standUp('qa-approach');
    const anchor = personalRoomSeatAnchors({ roomId: metadata?.roomId, objects: furniture.state().objects, obstacles: room.obstacles })
      .find(anchor => anchor.interactableId === sofa()?.id);
    if (!anchor) throw Error('Saved sofa has no safe approach');
    world.placePlayer(anchor.standPoint, anchor.yaw); captureView('sofa'); refreshContext();
  };
  qa.captureView = captureView;
  qa.refreshFurniture = () => furniture.refresh();
  qa.enterRoom = enterRoom;
  qa.refreshInventory = () => inventory.refresh('qa-verification');
  qa.actions = { editor: () => editor.openEditor(), handoff: id => handoff.action(id) };
  qa.dispose = () => { interaction.destroy(); editor.dispose(); character.destroy?.(); app.destroy(); };
  const resize = () => { device.resizeCanvas(innerWidth, innerHeight); if (fixedCamera) captureView(fixedCamera); };
  addEventListener('resize', resize); resize();
  shop.setAccount(accountId); await Promise.all([wallet.setAccount(accountId), inventory.setAccount(accountId), shop.refresh('qa-start')]);
  enterLobby();
  app.on('update', dt => {
    frames++;
    controller.inputEnabled = !blocked && focus.can('MOVE');
    if (!seating.beforeController()) controller.update(Math.min(dt,.05), orbit.yaw);
    character.update(Math.min(dt,.05), { moving: !seating.seats.isSeated && controller.moving, mounted: false, grounded: controller.grounded, seated: seating.seats.isSeated });
    refreshContext();
    if (panel.open && space === 'ROOM_DORM1_LOBBY' && !interaction.canAccess()) panel.setOpen(false);
    if (fixedCamera) captureView(fixedCamera); else orbit.apply(player.getLocalPosition(),character.eyeHeight);
  });
  app.start(); await character.ready;
  if (character.modelState !== 'glb') throw Error('Actual character GLB did not load');
  qa.ready = true;
} catch (error) { qa.error = String(error?.stack ?? error); console.error(error); }
