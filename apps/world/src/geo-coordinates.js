// WGS84 landmark centres from OpenStreetMap, projected into the existing P0 world.
// x points east, z points north, 1 world unit ~= 2 m. Footprints and heights below
// are illustrative blockout dimensions, NOT a surveyed campus / navigation map.
import { METERS_PER_WORLD_UNIT } from './world-scale.js';

export const GEO_ORIGIN = Object.freeze({ lat: 37.44770, lon: 126.65319, x: 0, z: -90 });
const EAST_METRES_PER_DEGREE = 111320 * Math.cos(GEO_ORIGIN.lat * Math.PI / 180);
const NORTH_METRES_PER_DEGREE = 111195;

export function geoToWorld(lat, lon) {
  return {
    x: GEO_ORIGIN.x + (lon - GEO_ORIGIN.lon) * EAST_METRES_PER_DEGREE / METERS_PER_WORLD_UNIT,
    z: GEO_ORIGIN.z + (lat - GEO_ORIGIN.lat) * NORTH_METRES_PER_DEGREE / METERS_PER_WORLD_UNIT
  };
}

