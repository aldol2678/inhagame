// Runtime adapter for Campus <-> BIRYONG_REALM.
// Region travel is outdoor world travel, not a room transition. Campus presence/streaming
// pauses while the Biryong root owns the local player.
import { CAMPUS_MOVEMENT_SPACE } from "../player-controller.js";
import { cameraYawBehind } from "../rooms/room-world-adapter.js";
import { WORLD_REGION_ID } from "../regions/world-region-registry.js";
import { BIRYONG_REALM_REGION_ID, BIRYONG_STATION_P0_BOUNDS } from "./biryong-realm-layout.js";

export const BIRYONG_REALM_MOVEMENT_SPACE = Object.freeze({
  id: BIRYONG_REALM_REGION_ID,
  obstacles: Object.freeze([]),
  bounds: BIRYONG_STATION_P0_BOUNDS,
  allowMount: false,
  groundHeight: () => 0,
  constrain: (_position, next) => next
});

export function createBiryongRealmWorldAdapter({
  player, controller, orbit, campusRoot, biryongRoot,
  follow, stopFollowReason = "region", seating, seats, emotes,
  getOnline = () => null, places, getStreaming = () => null,
  closePanels = () => {}, setLocationLabel = () => {}, markRegion = () => {}
} = {}) {
  if (!player || !controller || !orbit || !campusRoot || !biryongRoot) {
    throw new TypeError("Biryong realm world adapter dependencies required");
  }

  const clearMotion = () => {
    controller.velocityY = 0;
    controller.jumpQueued = false;
    controller.grounded = true;
    controller.clearAssistedMovement?.();
    if (controller.touchVector) { controller.touchVector.x = 0; controller.touchVector.y = 0; }
    controller.keys?.clear();
  };

  return {
    leaveCampus() {
      follow?.stop(stopFollowReason);
      if (seats?.isSeated) seating?.standUp?.("region");
      emotes?.cancel?.("region");
      closePanels();
      getOnline()?.pauseCampus?.({ label: "비룡역" });
      campusRoot.enabled = false;
    },
    showBiryong() {
      biryongRoot.enabled = true;
      player.reparent(biryongRoot);
      controller.setMovementSpace(BIRYONG_REALM_MOVEMENT_SPACE);
      orbit.setIndoor?.(null);
      setLocationLabel("🐉 비룡역");
      markRegion(BIRYONG_REALM_REGION_ID);
    },
    showCampus() {
      biryongRoot.enabled = false;
      player.reparent(campusRoot);
      campusRoot.enabled = true;
      controller.setMovementSpace(CAMPUS_MOVEMENT_SPACE);
      orbit.setIndoor?.(null);
      markRegion(WORLD_REGION_ID.CAMPUS);
    },
    placePlayer(position, yaw = 0) {
      clearMotion();
      player.setLocalPosition(position.x, position.y ?? controller.groundY, position.z);
      player.setLocalEulerAngles(0, yaw, 0);
      orbit.yaw = cameraYawBehind(yaw);
    },
    resumeCampus() {
      const position = player.getLocalPosition();
      places?.update?.(position);
      setLocationLabel(places?.getCurrentPlaceZone?.()?.displayName ?? "캠퍼스 외곽");
      getOnline()?.resumeCampus?.();
      getStreaming()?.update?.(1, position);
    }
  };
}
