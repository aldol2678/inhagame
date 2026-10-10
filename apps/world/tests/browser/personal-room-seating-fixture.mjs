// Local-only browser fixture. Uses synthetic saved objects and no client, auth or persistence.
import * as pc from "playcanvas";
import { createPersonalRoomScene } from "/src/rooms/personal-room-renderer.js";
import { personalRoomSeatAnchors, personalRoomSeatZone, resolveRoomSeatStandPoint, roomSeatPointIsClear } from "/src/rooms/personal-room-seats.js";
import { createSeatInteraction } from "/src/seat-interaction.js";
import { createCharacter } from "/src/character-model.js";
import { createContextActionController } from "/src/context-action.js";
import { PlayerController } from "/src/player-controller.js";
import { OrbitCameraController } from "/src/orbit-camera-controller.js";
import { createRoomWorldAdapter } from "/src/rooms/room-world-adapter.js";
import { ROOMS } from "/src/rooms/room-registry.js";
import { EmoteController } from "/src/online/emotes.js";

const qa = window.__ROOM_SEATING_QA__ = { ready: false };
try {
  const roomId = "11111111-1111-4111-8111-111111111111";
  const canvas = document.getElementById("stage");
  const device = await pc.createGraphicsDevice(canvas, { deviceTypes: [pc.DEVICETYPE_WEBGL2], antialias: true });
  const app = new pc.Application(canvas, { graphicsDevice: device });
  const scene = createPersonalRoomScene(app);
  const campusRoot = new pc.Entity("QA_Campus"); app.root.addChild(campusRoot);
  const player = new pc.Entity("QA_Player"); campusRoot.addChild(player);
  const controller = new PlayerController(player), character = createCharacter(app, player);
  const camera = new pc.Entity("QA_Camera");
  camera.addComponent("camera", { fov: 55, nearClip: .05, farClip: 200 }); app.root.addChild(camera);
  const orbit = new OrbitCameraController(camera, canvas); orbit.yaw = .8; orbit.pitch = .35; orbit.distance = 3;
  let inside = true, editing = false, ticks = 0;
  let objects = [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", itemId: "furniture.induck_chair", surface: "floor", x: 0, z: 0, yaw: 45 },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", itemId: "furniture.dorm_single_sofa", surface: "floor", x: -1.75, z: 1.75, yaw: 0 }
  ];
  scene.ownedFurniture.setObjects(objects);
  const anchors = () => personalRoomSeatAnchors({ roomId: inside ? roomId : null, objects,
    obstacles: scene.obstacles, position: player.getLocalPosition() });
  const emotes = new EmoteController({ clock: { now: () => Date.now() } });
  const seating = createSeatInteraction({ player, controller, emotes, getAnchors: anchors,
    getSpaceId: () => inside ? roomId : "campus", getPlaceZoneId: () => inside ? personalRoomSeatZone(roomId) : null,
    canInteract: () => inside && !editing, resolveStandPoint: anchor => resolveRoomSeatStandPoint(anchor, scene.obstacles) });
  const world = createRoomWorldAdapter({ player, controller, orbit, campusRoot, roomScene: scene,
    seating, seats: seating.seats, places: { getCurrentPlaceZone: () => null },
    lighting: { save: () => ({ ambient: app.scene.ambientLight.clone(), clearColor: camera.camera.clearColor.clone() }),
      apply: value => { app.scene.ambientLight = value.ambient; camera.camera.clearColor = value.clearColor; } } });
  world.showRoom(ROOMS.ROOM_PERSONAL_BASIC);
  const context = createContextActionController({ button: document.getElementById("context-action"), shortcut: "F" });
  function positionBy(id) {
    seating.standUp("qa-reposition"); inside = true; editing = false; controller.inputEnabled = true;
    world.showRoom(ROOMS.ROOM_PERSONAL_BASIC);
    const anchor = personalRoomSeatAnchors({ roomId, objects, obstacles: scene.obstacles }).find(value => value.interactableId === id);
    if (!anchor) throw Error(`Seat unavailable: ${id}`);
    world.placePlayer(anchor.standPoint, anchor.yaw); orbit.yaw += .65;
  }
  document.getElementById("qa-fixed").onclick = () => positionBy("fixed-chair");
  document.getElementById("qa-chair").onclick = () => positionBy(objects[0].id);
  document.getElementById("qa-sofa").onclick = () => positionBy(objects[1].id);
  document.getElementById("qa-edit").onclick = () => {
    seating.standUp("furniture-edit"); editing = !editing; controller.inputEnabled = !editing;
  };
  document.getElementById("qa-exit").onclick = () => {
    world.createCheckpoint(); inside = false; world.showCampus(); world.placePlayer({ x: 40, y: 1.15, z: -80 }, 0);
  };
  addEventListener("keydown", event => { if (event.code === "KeyF" && !event.repeat) { event.preventDefault(); context.trigger(); } });
  qa.snapshot = () => ({ ready: qa.ready, ticks, inside, editing, seated: seating.seats.isSeated,
    seat: seating.seats.seated?.interactableId ?? null, position: { ...player.getLocalPosition() },
    pose: character.pose, parent: player.parent?.name, action: context.active?.label ?? null,
    safe: roomSeatPointIsClear(player.getLocalPosition(), scene.obstacles) });
  qa.removeOccupied = () => {
    const id = seating.seats.seated?.interactableId;
    objects = objects.filter(object => object.id !== id); scene.ownedFurniture.setObjects(objects); seating.beforeController();
  };
  const resize = () => device.resizeCanvas(innerWidth, innerHeight); addEventListener("resize", resize); resize();
  app.on("update", dt => {
    ticks++;
    if (!seating.beforeController()) controller.update(Math.min(dt, .05), orbit.yaw);
    character.update(Math.min(dt, .05), { moving: !seating.seats.isSeated && controller.moving,
      mounted: false, grounded: controller.grounded, seated: seating.seats.isSeated });
    const nearby = seating.refreshNearby();
    context.set("seat", seating.seats.isSeated ? { label: "일어나기", priority: 280, pressed: true, trigger: () => seating.toggle() }
      : nearby ? { label: "앉기", priority: 260, pressed: false, trigger: () => seating.toggle() } : null);
    context.refresh(); orbit.apply(player.getLocalPosition(), character.eyeHeight);
    document.getElementById("qa-status").textContent = editing ? "꾸미기" : seating.seats.isSeated ? "앉아 있어요" : "일어서 있어요";
  });
  positionBy("fixed-chair"); app.start(); qa.ready = true;
} catch (error) { qa.error = String(error?.stack ?? error); console.error(error); }
