// Biryong Realm P0 spatial contract.
// Coordinates are LOCAL to BIRYONG_REALM, not WGS84/Campus coordinates.
// Same world scale as Campus: +X east, +Z north, 1 WU ~= 2 m.
import { PLAYER_ORIGIN_Y } from "../player-dimensions.js";
import { WORLD_REGION_ID } from "../regions/world-region-registry.js";

export const BIRYONG_REALM_REGION_ID = WORLD_REGION_ID.BIRYONG_REALM;

// Reserved master envelope for the first Biryong Realm expansion.
// P0 movement remains clamped to the station blockout below.
export const BIRYONG_REALM_RESERVED_BOUNDS = Object.freeze({
  minX: -120, maxX: 320,
  minZ: -280, maxZ: 220
});

export const BIRYONG_STATION_P0_BOUNDS = Object.freeze({
  minX: -38, maxX: 38,
  minZ: -32, maxZ: 46
});

export const BIRYONG_STATION_SPAWN = Object.freeze({
  regionId: BIRYONG_REALM_REGION_ID,
  x: 0,
  y: PLAYER_ORIGIN_Y,
  z: 0,
  yaw: 0
});

// The return stop is deliberately away from the arrival spawn so a player does not
// immediately see a stale interaction while the arrival transition is settling.
export const BIRYONG_STATION_RETURN_STOP = Object.freeze({
  id: "TRANSIT_BIRYONG_STATION_F1",
  x: 0,
  z: -12,
  interactionRadius: 2.25, // 4.5 m
  routeId: "transit.biryong_bus.f1",
  destinationRegionId: WORLD_REGION_ID.CAMPUS
});

export const BIRYONG_REALM_P0_ANCHORS = Object.freeze({
  station: Object.freeze({ x: 0, z: 0 }),
  villageCenter: Object.freeze({ x: 0, z: 75 }),
  themeParkCenter: Object.freeze({ x: 180, z: -80 }),
  harborCenter: Object.freeze({ x: 180, z: -230 })
});
