// Synthetic auth/server bridge installed only by the offline smoke. No production connection.
import * as pc from "playcanvas";
import { createClubRoomScene } from "/src/rooms/club-room-renderer.js";
import { createClubRoomSession } from "/src/rooms/club-room-session.js";
import { createClubRoomSeatActions } from "/src/rooms/club-room-seat-actions.js";
import { CLUB_ROOM_ID, CLUB_ROOM_SEATS, clubRoomSeatAnchors } from "/src/rooms/club-room-seats.js";
import { createSeatInteraction } from "/src/seat-interaction.js";
import { PlayerController } from "/src/player-controller.js";
import { roomMovementSpace } from "/src/rooms/room-world-adapter.js";
import { ROOMS } from "/src/rooms/room-registry.js";
import { createCharacter } from "/src/character-model.js";
import { createRemoteAvatarFactory } from "/src/online/remote-avatar.js";
import { EmoteController } from "/src/online/emotes.js";
import { OrbitCameraController } from "/src/orbit-camera-controller.js";

const qa = window.__CLUB_QA__ = { ready: false };
try {
  const n = Number(new URL(location.href).searchParams.get("member") ?? 1);
  const userId = `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  let identity = { userId, displayName: `인덕${n}` }, inside = true, remoteCount = 0, remoteEmote = null;
  const listeners = new Map();
  window.__clubDeliver = ({ topic, payload }) => listeners.get(topic)?.({ payload });
  const client = {
    rpc: (name, args) => window.__clubRpc(name, args, userId),
    auth: { getSession: async () => ({ data: { session: { user: { id: userId, is_anonymous: false }, access_token: "synthetic-fixture" } } }) },
    realtime: { setAuth: async () => {} },
    channel(topic, options) {
      const channel = { topic, on(_kind, _filter, fn) { listeners.set(topic, fn); return this; },
        subscribe(fn) { void window.__clubSubscribe(topic, options, userId).then(() => fn("SUBSCRIBED")); return this; } };
      return channel;
    },
    removeChannel(channel) { listeners.delete(channel.topic); return window.__clubUnsubscribe(channel.topic, userId); }
  };
  const canvas = document.getElementById("stage");
  const device = await pc.createGraphicsDevice(canvas, { deviceTypes: [pc.DEVICETYPE_WEBGL2], antialias: true });
  const app = new pc.Application(canvas, { graphicsDevice: device });
  const room = createClubRoomScene(app); room.root.enabled = true;
  app.scene.ambientLight.copy(room.ambient);
  const player = new pc.Entity("Club_QA_Player"); room.root.addChild(player);
  const character = createCharacter(app, player), controller = new PlayerController(player);
  controller.setMovementSpace(roomMovementSpace(ROOMS[CLUB_ROOM_ID]));
  const camera = new pc.Entity("Club_QA_Camera");
  camera.addComponent("camera", { fov: 60, nearClip: .05, farClip: 100, clearColor: room.clearColor }); app.root.addChild(camera);
  const orbit = new OrbitCameraController(camera, canvas); orbit.yaw = .6; orbit.pitch = .22; orbit.distance = 2.2;
  let session, seatActions;
  const emotes = new EmoteController({ clock: { now: () => Date.now() }, send: id => session.reportEmote(id) });
  const seating = createSeatInteraction({ player, controller, emotes,
    getOnline: () => session, getSpaceId: () => inside ? CLUB_ROOM_ID : "campus", getPlaceZoneId: () => inside ? CLUB_ROOM_ID : "campus",
    getAnchors: () => clubRoomSeatAnchors({ position: player.getLocalPosition() }), canInteract: () => inside && session?.status().online });
  const factory = createRemoteAvatarFactory({ app, parent: room.root, camera, canvas });
  session = createClubRoomSession({ player, controller, getClient: () => client, getIdentity: () => identity,
    isSeated: () => seating.seats.isSeated,
    createAvatar: initial => {
      const avatar = factory(initial); remoteCount += 1;
      return { update(sample, dt) { remoteEmote = sample.emote?.id ?? null; avatar.update(sample, dt); },
        destroy() { remoteCount -= 1; avatar.destroy(); } };
    },
    onSeatLost: () => seating.standUp("server"),
    onAccessLost: event => { inside = false; qa.lost = event.reason; },
    onChange: status => { document.getElementById("qa-status").textContent = `${status.phase} · ${status.count}/6명`; }
  });
  seatActions = createClubRoomSeatActions({ session, seating, player, controller, getRoomId: () => inside ? CLUB_ROOM_ID : "campus" });
  const positionBy = seatId => {
    seating.standUp("qa-position"); const a = CLUB_ROOM_SEATS.find(a => a.seatId === seatId);
    player.setLocalPosition(a.standPoint.x, a.standPoint.y, a.standPoint.z); player.setLocalEulerAngles(0, a.yaw, 0);
    controller.grounded = true; controller.velocityY = 0; controller.keys.clear();
  };
  document.getElementById("qa-seat").onclick = () => void seatActions.toggle();
  document.getElementById("qa-wave").onclick = () => { seatActions.cancel(); seating.requestEmote("wave", { moving: false, grounded: true, mounted: false }); };
  document.getElementById("qa-leave").onclick = () => { seatActions.cancel(); seating.standUp("leave"); session.stop(); inside = false; };
  qa.positionBy = positionBy;
  qa.sit = () => seatActions.toggle();
  qa.revalidate = () => session.revalidateNow();
  qa.identityChange = () => { identity = { userId: "10000000-0000-4000-8000-000000999999" }; session.update(.01); };
  qa.snapshot = () => ({ ready: qa.ready, inside, state: session.status(), stats: session.stats, remoteCount, remoteEmote,
    seated: seating.seats.isSeated, seatId: seating.seats.seated?.seatId, position: { ...player.getLocalPosition() },
    remoteEntities: room.root.findByTag("remote-player").length, nameplates: document.querySelectorAll(".remote-nameplate").length });
  const resize = () => device.resizeCanvas(innerWidth, innerHeight); addEventListener("resize", resize); resize();
  positionBy(n === 1 ? "chair_s0" : "chair_s2");
  app.on("update", dt => {
    if (inside && !seating.beforeController()) controller.update(Math.min(dt, .05), orbit.yaw);
    seatActions.update(); session.update(dt);
    const emote = emotes.update({ moving: controller.moving, grounded: controller.grounded, mounted: false });
    character.update(Math.min(dt, .05), { moving: controller.moving && !seating.seats.isSeated,
      mounted: false, grounded: controller.grounded, seated: seating.seats.isSeated, emote });
    orbit.apply(player.getLocalPosition(), character.eyeHeight);
  });
  app.start(); await session.enter(); qa.ready = true;
} catch (error) { qa.error = String(error?.stack ?? error); console.error(error); }
