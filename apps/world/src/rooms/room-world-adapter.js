// The world side of a campus ⇄ room transition (see room-transition.js). Everything is injected,
// so Node tests drive it with fakes; main.js only supplies the real objects.
//
// Entering: Follow/seat/emote end, open panels close, campus online pauses (the player leaves
// the Place Zone channel, so no ghost stays outside), the campus scene and sun switch off, the
// player moves under the room root with the room's collision, bounds and indoor camera.
// Leaving: the reverse, at a safe return anchor, then the Place Zone resolves and campus online
// rejoins it. Nothing is persisted and no room channel exists.

import { CAMPUS_MOVEMENT_SPACE } from "../player-controller.js";

export const roomMovementSpace = (room) => Object.freeze({
  id: room.id, obstacles: room.obstacles, bounds: room.bounds, allowMount: false,
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
  closePanels = () => {}, setLocationLabel = () => {}, markSpace = () => {}
}) {
  let outdoorLighting = null;
  let activeRoomScene = null;
  const resolveRoomScene = (room) => {
    const scene = getRoomScene?.(room) ?? roomScene;
    if (!scene?.root) throw new Error(`Room scene unavailable: ${room?.id ?? "unknown"}`);
    return scene;
  };
  return {
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
      activeRoomScene.root.enabled = true;
      player.reparent(activeRoomScene.root);
      lighting.apply(activeRoomScene);
      controller.setMovementSpace(roomMovementSpace(room));
      const indoorCamera = { obstacles: room.obstacles };
      if (room.cameraLimits) indoorCamera.limits = room.cameraLimits;
      orbit.setIndoor(indoorCamera);
      setLocationLabel(room.locationLabel ?? `🏠 ${room.label}`);
      markSpace(room.id);
    },
    showCampus() {
      if (activeRoomScene?.root) activeRoomScene.root.enabled = false;
      activeRoomScene = null;
      player.reparent(campusRoot);
      campusRoot.enabled = true;
      if (sun) sun.enabled = true;
      if (outdoorLighting) lighting.apply(outdoorLighting);
      controller.setMovementSpace(CAMPUS_MOVEMENT_SPACE);
      orbit.setIndoor(null);
      markSpace(null);
    },
    // A clean arrival: no leftover jump, assist, joystick or held keys.
    placePlayer(position, yaw) {
      controller.velocityY = 0;
      controller.jumpQueued = false;
      controller.grounded = true;
      controller.clearAssistedMovement?.();
      if (controller.touchVector) { controller.touchVector.x = 0; controller.touchVector.y = 0; }
      controller.keys?.clear();
      player.setLocalPosition(position.x, position.y ?? 1.15, position.z);
      player.setLocalEulerAngles(0, yaw, 0);
      orbit.yaw = cameraYawBehind(yaw);
    },
    resumeCampus() {
      const position = player.getLocalPosition();
      places.update(position);
      setLocationLabel(places.getCurrentPlaceZone()?.displayName ?? "캠퍼스 외곽");
      getOnline()?.resumeCampus();
      streaming?.update(1, position);
    }
  };
}
