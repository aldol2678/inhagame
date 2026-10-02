// Archived C01/C02/C03 compatibility fixtures for historical Reality QA only.
// Live semantics use PlaceZoneRegistry; live rendering uses RenderChunkStreaming.
export const ZoneState = Object.freeze({
  UNLOADED: "UNLOADED",
  VISTA: "VISTA",
  NEAR: "NEAR",
  ACTIVE: "ACTIVE"
});

export class ZoneRegistry {
  constructor(zones) {
    this.zones = zones;
    this.byId = new Map(zones.map((zone) => [zone.id, zone]));
  }

  static async load(urls) {
    const zones = [];
    for (const url of urls) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Zone manifest load failed: ${url}`);
      zones.push(await response.json());
    }
    return new ZoneRegistry(zones);
  }

  get(id) { return this.byId.get(id); }

  findContaining(position) {
    return this.zones.find((zone) => {
      const { min, max } = zone.bounds;
      return position.x >= min[0] && position.x <= max[0]
        && position.z >= min[2] && position.z <= max[2];
    }) ?? null;
  }

  center(zone) {
    return {
      x: (zone.bounds.min[0] + zone.bounds.max[0]) / 2,
      y: (zone.bounds.min[1] + zone.bounds.max[1]) / 2,
      z: (zone.bounds.min[2] + zone.bounds.max[2]) / 2
    };
  }
}
