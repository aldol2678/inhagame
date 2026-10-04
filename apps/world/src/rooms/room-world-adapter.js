// The world side of a campus ⇄ room transition (see room-transition.js). Everything is injected,
// so Node tests drive it with fakes; main.js only supplies the real objects.
//
// Entering: Follow/seat/emote end, open panels close, campus online pauses (the player leaves
// the Place Zone channel, so no ghost stays outside), the campus scene and sun switch off, the
// player moves under the room root with the room's collision, bounds and indoor camera.
// Leaving: the reverse, at a safe return anchor, then the Place Zone resolves and campus online
// rejoins it. Nothing is persisted and no room channel exists.

import { CAMPUS_MOVEMENT_SPACE } from "../player-controller.js";

export const roomMovementSpace = (room, obstacles = room.obstacles) => Object.freeze({
  id: room.id, obstacles, bounds: room.bounds, allowMount: false,
  groundHeight: () => 0, constrain: (_position, next) => next
});

// Orbit yaw that puts the camera behind a player facing `yawDeg` (entity yaw, degrees).
export const cameraYawBehind = (yawDeg) => {
  const r = yawDeg * Math.PI / 180;
  return Math.atan2(-Math.sin(r), Math.cos(r));
};

export function createRoomWorldAdapter({
  player, controller, orbit, campusRoot, roomScene = null, getRoomScene = null, sun = null,
  lighting = { save: () => null, apply: () => {} },
  follow, stopFollowReason = "room", seating, seats, emotes,
  getOnline = () => null, places, streaming = null,
  closePanels = () => {}, getLocationLabel = () => null, setLocationLabel = () => {}, markSpace = () => {}
}) {
  let outdoorLighting = null;
  let activeRoomScene = null;
  let activeRoom = null;
  const resolveRoomScene = (room) => {
    const scene = getRoomScene?.(room) ?? roomScene;
    if (!scene?.root) throw new Error(`Room scene unavailable: ${room?.id ?? "unknown"}`);
    return scene;
  };
  const placePlayer = (position, yaw) => {
    controller.velocityY = 0;
    controller.jumpQueued = false;
    controller.grounded = true;
    controller.clearAssistedMovement?.();
    if (controller.touchVector) { controller.touchVector.x = 0; controller.touchVector.y = 0; }
    controller.keys?.clear();
    player.setLocalPosition(position.x, position.y ?? 1.15, position.z);
    player.setLocalEulerAngles(0, yaw, 0);
    orbit.yaw = cameraYawBehind(yaw);
  };
  return {
    // Capture the actual source, not the target's return anchor (a campus friend visit may start
    // anywhere). The closure also survives failures after only part of showRoom/showCampus ran.
    createCheckpoint() {
      const source = {
        scene: activeRoomScene, room: activeRoom, outdoorLighting,
        campusEnabled: campusRoot.enabled, sunEnabled: sun?.enabled,
        roomEnabled: activeRoomScene?.root.enabled,
        parent: player.parent ?? activeRoomScene?.root ?? campusRoot,
        position: { ...player.getLocalPosition() }, yaw: player.getLocalEulerAngles?.().y ?? 0,
        // Euler Y alone is not yaw beyond ±90° in PlayCanvas (e.g. 137° -> 180/43/180).
        rotation: player.getLocalRotation?.()?.clone?.() ?? null,
        movement: controller.space ?? CAMPUS_MOVEMENT_SPACE,
        indoor: orbit.indoor ? { ...orbit.indoor, ...(orbit.indoor.saved ? { saved: { ...orbit.indoor.saved } } : {}) } : null,
        camera: { yaw: orbit.yaw, pitch: orbit.pitch, distance: orbit.distance },
        lighting: lighting.save(), location: getLocationLabel(),
        campusPaused: getOnline()?.campusPaused ?? Boolean(activeRoomScene)
      };
      return () => {
        const errors = [];
        const attempt = run => { try { run(); } catch (error) { errors.push(error); } };
        // An exit may have resumed campus before failing. Stop public pose publication first,
        // including when a later spatial restoration itself fails and must stay locked.
        attempt(() => getOnline()?.pauseCampus({ label: source.room?.label ?? "전환 복구 중" }));
        attempt(() => { if (activeRoomScene?.root && activeRoomScene !== source.scene) activeRoomScene.root.enabled = false; });
        activeRoomScene = source.scene;
        activeRoom = source.room;
        outdoorLighting = source.outdoorLighting;
        attempt(() => { if (activeRoomScene?.root) activeRoomScene.root.enabled = source.roomEnabled; });
        attempt(() => { campusRoot.enabled = source.campusEnabled; if (sun) sun.enabled = source.sunEnabled; });
        attempt(() => player.reparent(source.parent));
        attempt(() => placePlayer(source.position, source.yaw));
        attempt(() => { if (source.rotation) player.setLocalRotation(source.rotation); });
        attempt(() => controller.setMovementSpace(source.movement));
        attempt(() => { orbit.indoor = source.indoor; Object.assign(orbit, source.camera); });
        attempt(() => { if (source.lighting) lighting.apply(source.lighting); });
        attempt(() => markSpace(source.room?.id ?? null));
        // Do not rejoin campus if a spatial restoration failed. Never publish an indoor pose
        // into a campus channel. Already-paused interiors also retain their existing session.
        if (!errors.length) {
          attempt(() => {
            const online = getOnline();
            if (source.campusPaused) online?.pauseCampus({ label: source.room?.label ?? "실내" });
            else {
              places.update(source.position);
              online?.resumeCampus();
              streaming?.update(1, source.position);
            }
          });
        }
        attempt(() => setLocationLabel(source.location ?? source.room?.locationLabel ?? places.getCurrentPlaceZone()?.displayName ?? "캠퍼스 외곽"));
        if (errors.length) throw new AggregateError(errors, "Room transition restoration failed");
      };
    },
    getPlaceZoneId: () => places.getCurrentPlaceZone()?.id ?? null,
    leaveCampus(room) {
      follow?.stop(stopFollowReason);
      if (seats?.isSeated) seating.standUp("room");
      emotes?.cancel("room");
      closePanels();
      getOnline()?.pauseCampus({ label: room.label });
      campusRoot.enabled = false;
      if (sun) sun.enabled = false;
    },
    showRoom(room) {
      const nextRoomScene = resolveRoomScene(room);
      if (!activeRoomScene) outdoorLighting = lighting.save();
      if (activeRoomScene?.root && activeRoomScene !== nextRoomScene) activeRoomScene.root.enabled = false;
      activeRoomScene = nextRoomScene;
      activeRoom = room;
      activeRoomScene.root.enabled = true;
      player.reparent(activeRoomScene.root);
      lighting.apply(activeRoomScene);
      const obstacles = nextRoomScene.obstacles ?? room.obstacles;
      controller.setMovementSpace(roomMovementSpace(room, obstacles));
      const indoorCamera = { obstacles };
      if (room.cameraLimits) indoorCamera.limits = room.cameraLimits;
      orbit.setIndoor(indoorCamera);
      setLocationLabel(room.locationLabel ?? `🏠 ${room.label}`);
      markSpace(room.id);
      // Optional scene visuals load after activation without blocking movement or arrival.
      void nextRoomScene.ensureVisualAssets?.();
    },
    showCampus() {
      if (activeRoomScene?.root) activeRoomScene.root.enabled = false;
      activeRoomScene = null;
      activeRoom = null;
      player.reparent(campusRoot);
      campusRoot.enabled = true;
      if (sun) sun.enabled = true;
      if (outdoorLighting) lighting.apply(outdoorLighting);
      controller.setMovementSpace(CAMPUS_MOVEMENT_SPACE);
      orbit.setIndoor(null);
      markSpace(null);
    },
    // A clean arrival: no leftover jump, assist, joystick or held keys.
    placePlayer,
    resumeCampus() {
      const position = player.getLocalPosition();
      places.update(position);
      setLocationLabel(places.getCurrentPlaceZone()?.displayName ?? "캠퍼스 외곽");
      getOnline()?.resumeCampus();
      streaming?.update(1, position);
    }
  };
}
