// Synthetic auth/server bridge installed only by the offline smoke. No production connection.
import * as pc from "playcanvas";
import { createPersonalRoomScene } from "/src/rooms/personal-room-renderer.js";
import { createPersonalRoomSession } from "/src/rooms/room-session.js";
import { createRoomChat } from "/src/rooms/room-chat.js";
import { createChatPanel } from "/src/online/chat-panel.js";
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

const qa = window.__SOCIAL_QA__ = { ready: false };
try {
  const kind = new URL(location.href).searchParams.get("kind") ?? "club";
  const personal = kind === "personal", roomId = personal ? "20000000-0000-4000-8000-000000000001" : CLUB_ROOM_ID;
  const n = Number(new URL(location.href).searchParams.get("member") ?? 1);
  const userId = `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  let identity = { userId, displayName: `인덕${n}` }, inside = true, remoteCount = 0, remoteEmote = null;
  const channels = new Map();
  window.__socialDeliver = ({ id, kind, event, payload, state }) => {
    const channel = channels.get(id); if (!channel) return;
    if (state) channel.state = state;
    for (const l of channel.listeners) if(l.kind === kind && l.event === event) l.fn({ payload });
  };
  const client = {
    rpc: (name, args) => window.__socialRpc(name, args),
    auth: { getSession: async () => ({ data: { session: { user: { id: userId, is_anonymous: false }, access_token: "synthetic-fixture" } } }) },
    realtime: { setAuth: async () => {} },
    channel(topic, options) {
      const channel = { id:crypto.randomUUID(), topic, listeners:[], state:{},
        on(kind, filter, fn) { this.listeners.push({kind,event:filter.event,fn}); return this; },
        subscribe(fn) { this.status=fn; void window.__socialSubscribe(this.id,topic,options).then(()=>fn("SUBSCRIBED")); return this; },
        presenceState() { return this.state; },
        track(p) { return window.__socialTrack(this.id,p); },
        send(p) { return window.__socialSend(this.id,p); },
        untrack() {} };
      channels.set(channel.id,channel);return channel;
    },
    removeChannel(channel) { channels.delete(channel.id); return window.__socialRemove(channel.id); }
  };
  const canvas = document.getElementById("stage");
  const device = await pc.createGraphicsDevice(canvas, { deviceTypes: [pc.DEVICETYPE_WEBGL2], antialias: true });
  const app = new pc.Application(canvas, { graphicsDevice: device });
  const room = personal ? createPersonalRoomScene(app) : createClubRoomScene(app); room.root.enabled = true;
  app.scene.ambientLight.copy(room.ambient);
  const player = new pc.Entity("Club_QA_Player"); room.root.addChild(player);
  const character = createCharacter(app, player), controller = new PlayerController(player);
  controller.setMovementSpace(roomMovementSpace(ROOMS[personal ? "ROOM_PERSONAL_BASIC" : CLUB_ROOM_ID]));
  const camera = new pc.Entity("Club_QA_Camera");
  camera.addComponent("camera", { fov: 80, nearClip: .05, farClip: 100, clearColor: room.clearColor }); app.root.addChild(camera);
  const orbit = new OrbitCameraController(camera, canvas); orbit.yaw = 0; orbit.pitch = .15; orbit.distance = 2.6;
  let session, seatActions, chat, panel;
  const ownBubble = document.getElementById("local-chat-bubble");
  const emotes = new EmoteController({ clock: { now: () => Date.now() }, send: id => session.reportEmote(id) });
  const seating = createSeatInteraction({ player, controller, emotes,
    getOnline: () => session, getSpaceId: () => inside ? CLUB_ROOM_ID : "campus", getPlaceZoneId: () => inside ? CLUB_ROOM_ID : "campus",
    getAnchors: () => clubRoomSeatAnchors({ position: player.getLocalPosition() }), canInteract: () => inside && session?.status().online });
  const factory = createRemoteAvatarFactory({ app, parent: room.root, camera, canvas });
  session = (personal ? createPersonalRoomSession : createClubRoomSession)({ player, controller, getClient: () => client, getIdentity: () => identity,
    isSeated: () => seating.seats.isSeated,
    createAvatar: initial => {
      const avatar = factory(initial); remoteCount += 1;
      return { update(sample, dt) { remoteEmote = sample.emote?.id ?? null; avatar.update(sample, dt); },
        destroy() { remoteCount -= 1; avatar.destroy(); } };
    },
    onSeatLost: () => seating.standUp("server"),
    onAccessLost: event => { inside = false; qa.lost = event.reason; chat?.stop(); panel?.reset(); },
    onChange: status => { document.getElementById("qa-status").textContent = `${personal ? "친구방" : "동아리방"} ${status.phase} · ${status.count}명`; }
  });
  chat = createRoomChat({ getClient:()=>client,getIdentity:()=>identity });
  session.setChatBubbles((sid,uid)=>chat.bubbleFor(sid,uid));
  panel = createChatPanel({ toggle:document.getElementById("chat-toggle"),form:document.getElementById("chat-form"),
    input:document.getElementById("chat-input"),feedList:document.getElementById("chat-feed"),hint:document.getElementById("chat-hint"),
    getChat:()=>chat,onFocusChat:()=>{controller.keys.clear();} });
  panel.setRoomScope(true);
  chat.feed.onChange(entries=>panel.renderFeed(entries));
  seatActions = createClubRoomSeatActions({ session, seating, player, controller, getRoomId: () => inside ? CLUB_ROOM_ID : "campus" });
  const positionBy = seatId => {
    seating.standUp("qa-position"); const a = CLUB_ROOM_SEATS.find(a => a.seatId === seatId);
    player.setLocalPosition(a.standPoint.x, a.standPoint.y, a.standPoint.z); player.setLocalEulerAngles(0, a.yaw, 0);
    controller.grounded = true; controller.velocityY = 0; controller.keys.clear();
  };
  document.getElementById("qa-seat").onclick = () => void seatActions.toggle();
  document.getElementById("qa-wave").onclick = () => { seatActions.cancel(); seating.requestEmote("wave", { moving: false, grounded: true, mounted: false }); };
  document.getElementById("qa-leave").onclick = () => { seatActions.cancel(); seating.standUp("leave"); chat.stop(); panel.reset(); session.stop(); inside = false; };
  qa.positionBy = positionBy;
  qa.sit = () => seatActions.toggle();
  qa.revalidate = () => session.revalidateNow();
  qa.identityChange = () => { identity = { userId: "10000000-0000-4000-8000-000000999999" }; session.update(.01); chat.update(); panel.reset(); };
  qa.reconnectChat = () => { for(const channel of channels.values())if(channel.topic.startsWith("world:room-chat:"))channel.status("CHANNEL_ERROR"); };
  qa.reenterChat = () => chat.enter({kind,roomId,sessionId:session.status().sessionId});
  qa.chat = chat; qa.panel = panel;
  qa.switchRoom = async () => { chat.stop(); panel.reset(); return chat.enter({kind:"personal",roomId:"20000000-0000-4000-8000-000000000002",sessionId:crypto.randomUUID()}); };
  qa.snapshot = () => ({ kind,chat:chat.status(),feed:chat.feed.entries,ownBubble:chat.ownBubble(),channels:channels.size,
    activeInput:document.activeElement?.id,
 ready: qa.ready, inside, state: session.status(), stats: session.stats, remoteCount, remoteEmote,
    seated: seating.seats.isSeated, seatId: seating.seats.seated?.seatId, position: { ...player.getLocalPosition() },
    remoteEntities: room.root.findByTag("remote-player").length, nameplates: document.querySelectorAll(".remote-nameplate").length });
  const resize = () => device.resizeCanvas(innerWidth, innerHeight); addEventListener("resize", resize); resize();
  if (personal) { player.setLocalPosition(n===1?-.4:.4,1.15,0); controller.grounded=true; }
  else positionBy(n === 1 ? "chair_s0" : "chair_s1");
  app.on("update", dt => {
    if (inside && !seating.beforeController()) controller.update(Math.min(dt, .05), orbit.yaw);
    if(!personal) seatActions.update(); session.update(dt); chat.update();
    if(inside && session.status().online && !chat.status().active) void qa.reenterChat();
    const say=chat.ownBubble(); ownBubble.textContent=say??""; ownBubble.hidden=!say;
    const head = camera.camera.worldToScreen(player.getPosition().clone().add(new pc.Vec3(0,character.eyeHeight+.3,0)));
    ownBubble.style.left=`${head.x}px`;ownBubble.style.top=`${head.y}px`;
    const emote = emotes.update({ moving: controller.moving, grounded: controller.grounded, mounted: false });
    character.update(Math.min(dt, .05), { moving: controller.moving && !seating.seats.isSeated,
      mounted: false, grounded: controller.grounded, seated: seating.seats.isSeated, emote });
    // Shared framing keeps both real avatars in portrait; no scene geometry or HUD is hidden.
    orbit.apply({x:personal?0:-.35,y:1.15,z:personal?0:-.34}, character.eyeHeight);
  });
  app.start(); await (personal ? session.enter({roomId,ownerUserId:"10000000-0000-4000-8000-000000000001",role:n===1?"owner":"visitor"}) : session.enter()); qa.ready = true;
} catch (error) { qa.error = String(error?.stack ?? error); console.error(error); }
