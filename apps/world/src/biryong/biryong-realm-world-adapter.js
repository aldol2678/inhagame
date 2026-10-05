// Runtime adapter for Campus <-> BIRYONG_REALM.
// Region travel is outdoor world travel, not a room transition. Campus presence/streaming
// pauses while the Biryong root owns the local player.
import { CAMPUS_MOVEMENT_SPACE } from "../player-controller.js";
import { cameraYawBehind } from "../rooms/room-world-adapter.js";
import { WORLD_REGION_ID } from "../regions/world-region-registry.js";
import { BIRYONG_REALM_REGION_ID, BIRYONG_STATION_BUILDING } from "./biryong-realm-layout.js";
import { BIRYONG_REALM_P0_BOUNDS, BIRYONG_REALM_P0_OBSTACLES } from "./biryong-village-layout.js";

// Camera-only station volume follows the existing visible building. Movement
// remains the authored P0 contract (including its station passage).
const station = BIRYONG_STATION_BUILDING;
export const BIRYONG_REALM_CAMERA_OBSTACLES = Object.freeze([
  ...BIRYONG_REALM_P0_OBSTACLES,
  Object.freeze({ id: station.id,
    minX: station.x - station.width / 2, maxX: station.x + station.width / 2,
    minY: station.y - station.height / 2, maxY: station.y + station.height / 2,
    minZ: station.z - station.depth / 2, maxZ: station.z + station.depth / 2 })
]);

export const BIRYONG_REALM_MOVEMENT_SPACE = Object.freeze({
  id: BIRYONG_REALM_REGION_ID,
  obstacles: BIRYONG_REALM_P0_OBSTACLES,
  bounds: BIRYONG_REALM_P0_BOUNDS,
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
    createCheckpoint() {
      const source = {
        parent: player.parent ?? campusRoot,
        position: { ...player.getLocalPosition() },
        yaw: player.getLocalEulerAngles?.().y ?? 0,
        rotation: player.getLocalRotation?.()?.clone?.() ?? null,
        campusEnabled: campusRoot.enabled, biryongEnabled: biryongRoot.enabled,
        movement: controller.space ?? CAMPUS_MOVEMENT_SPACE,
        obstacles: orbit.outdoorObstacles,
        indoor: orbit.indoor,
        camera: { yaw: orbit.yaw, pitch: orbit.pitch, distance: orbit.distance },
        campusPaused: getOnline()?.campusPaused ?? !campusRoot.enabled
      };
      return () => {
        const errors = [];
        const attempt = run => { try { run(); } catch (error) { errors.push(error); } };
        attempt(() => getOnline()?.pauseCampus?.({ label: "지역 전환 복구 중" }));
        attempt(() => { campusRoot.enabled = source.campusEnabled; biryongRoot.enabled = source.biryongEnabled; });
        attempt(() => player.reparent(source.parent));
        attempt(() => { clearMotion(); player.setLocalPosition(source.position.x, source.position.y, source.position.z); });
        attempt(() => source.rotation ? player.setLocalRotation(source.rotation) : player.setLocalEulerAngles(0, source.yaw, 0));
        attempt(() => controller.setMovementSpace(source.movement));
        attempt(() => { orbit.setOutdoorObstacles?.(source.obstacles); orbit.indoor = source.indoor; Object.assign(orbit, source.camera); });
        attempt(() => markRegion(source.campusEnabled ? WORLD_REGION_ID.CAMPUS : BIRYONG_REALM_REGION_ID));
        // A failed spatial restoration must not publish region-local coordinates into Campus.
        if (!errors.length && !source.campusPaused) {
          attempt(() => {
            places?.update?.(source.position);
            getOnline()?.resumeCampus?.();
            getStreaming()?.update?.(1, source.position);
          });
        }
        attempt(() => setLocationLabel(source.campusEnabled
          ? places?.getCurrentPlaceZone?.()?.displayName ?? "캠퍼스 외곽" : "🐉 비룡역"));
        if (errors.length) throw new AggregateError(errors, "Biryong region restoration failed");
      };
    },
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
      orbit.setOutdoorObstacles?.(BIRYONG_REALM_CAMERA_OBSTACLES);
      setLocationLabel("🐉 비룡역");
      markRegion(BIRYONG_REALM_REGION_ID);
    },
    showCampus() {
      biryongRoot.enabled = false;
      player.reparent(campusRoot);
      campusRoot.enabled = true;
      controller.setMovementSpace(CAMPUS_MOVEMENT_SPACE);
      orbit.setIndoor?.(null);
      orbit.setOutdoorObstacles?.();
      markRegion(WORLD_REGION_ID.CAMPUS);
    },
    placePlayer(position, yaw = 0) {
      clearMotion();
      player.setLocalPosition(position.x, position.y ?? controller.groundY, position.z);
      player.setLocalEulerAngles(0, yaw, 0);
      orbit.yaw = cameraYawBehind(yaw);
    },
    dispose() {
      orbit.setOutdoorObstacles?.();
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
