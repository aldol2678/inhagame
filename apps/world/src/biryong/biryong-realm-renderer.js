// Outdoor P0 blockout for Biryong Station -> Biryong Village.
// The geometry is deliberately primitive and replaceable; layout anchors/zones are the durable contract.
import * as pc from "playcanvas";
import { box, surface } from "../campus-render-kit.js";
import { createBiryongVisualMaterialSet } from "./biryong-visual-materials.js";
import { createBiryongEnvironmentDensity } from "./biryong-environment-density.js";
import {
  BIRYONG_VILLAGE_ANCHORS,
  BIRYONG_VILLAGE_BUILDINGS,
  BIRYONG_VILLAGE_ROADS,
  BIRYONG_VILLAGE_WATER_CHANNELS
} from "./biryong-village-layout.js";

function segmentBox(root, name, a, b, width, y, height, material) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  const yaw = -Math.atan2(dz, dx) * 180 / Math.PI;
  box(root, name, [(a.x + b.x) / 2, y, (a.z + b.z) / 2], [length, height, width], material, yaw);
}

export function createBiryongRealmScene(app, {
  visualMaterials = false,
  visualDensity = false,
  getGraphicsTier = () => "medium"
} = {}) {
  const root = new pc.Entity("BiryongRealmCoordinateFrame");
  // Keep canonical +Z north while PlayCanvas renders north as -Z, matching Campus.
  root.setLocalScale(1, 1, -1);

  const legacyMaterials = () => Object.freeze({
    stone: surface("#9aa09b"),
    darkStone: surface("#616b66"),
    road: surface("#4c5457"),
    path: surface("#a69a7e"),
    platform: surface("#c8c2ad"),
    grass: surface("#66865a"),
    field: surface("#7f9259"),
    roof: surface("#385f5a"),
    roofWarm: surface("#704a32"),
    wood: surface("#7a5c3c"),
    plaster: surface("#d8cfb8"),
    workshop: surface("#746e63"),
    accent: surface("#c6a456"),
    water: surface("#5b91a8")
  });
  const materials = visualMaterials ? createBiryongVisualMaterialSet() : legacyMaterials();
  const {
    stone, darkStone, road, path, platform, grass, field,
    roof, roofWarm, wood, plaster, workshop, accent, water
  } = materials;

  // One continuous walkable visual floor from the station to the first village slice.
  box(root, "biryong_realm_p0_ground", [0, -0.07, 53], [140, 0.14, 170], grass);
  box(root, "biryong_fields_preview_west", [-56, -0.045, 104], [26, 0.05, 54], field);
  box(root, "biryong_fields_preview_east", [56, -0.045, 104], [26, 0.05, 54], field);

  // Station slice retained from the region foundation.
  box(root, "biryong_station_road", [0, -0.015, -12], [8, 0.03, 40], road);
  box(root, "biryong_station_platform", [8, 0.04, -5], [12, 0.08, 24], platform);
  box(root, "biryong_station_square", [0, 0.02, 11], [28, 0.04, 22], platform);
  box(root, "biryong_station_building", [0, 2.2, 25], [20, 4.4, 8], stone);
  box(root, "biryong_station_roof", [0, 4.65, 25], [22, 0.5, 10], roof);
  box(root, "biryong_station_door", [0, 1.3, 20.94], [3.0, 2.6, 0.12], darkStone);
  box(root, "biryong_station_sign", [0, 3.2, 20.84], [7.5, 0.7, 0.1], accent);

  for (const x of [-12, 12]) {
    box(root, `biryong_station_lamp_post_${x}`, [x, 1.7, 8], [0.12, 3.4, 0.12], darkStone);
    box(root, `biryong_station_lamp_${x}`, [x, 3.45, 8], [0.5, 0.25, 0.5], accent);
  }

  // The old construction barrier becomes the village threshold and stays walk-through.
  const gate = BIRYONG_VILLAGE_ANCHORS.villageGate;
  box(root, "biryong_village_gate_left", [-5.2, 1.7, gate.z], [0.7, 3.4, 0.7], darkStone);
  box(root, "biryong_village_gate_right", [5.2, 1.7, gate.z], [0.7, 3.4, 0.7], darkStone);
  box(root, "biryong_village_gate_beam", [0, 3.55, gate.z], [11, 0.5, 0.7], accent);

  // Roads are authored from the same layout points used by acceptance tests.
  for (const lane of BIRYONG_VILLAGE_ROADS) {
    for (let i = 1; i < lane.points.length; i += 1) {
      segmentBox(root, `${lane.id}_${i - 1}`, lane.points[i - 1], lane.points[i], lane.width, -0.012, 0.024,
        lane.id === "br_station_village_road" ? road : path);
    }
  }

  // Central square gives the village a legible destination immediately after the approach road.
  const center = BIRYONG_VILLAGE_ANCHORS.villageCenter;
  box(root, "biryong_village_central_square", [center.x, 0.015, center.z], [22, 0.03, 20], platform);
  box(root, "biryong_village_well_base", [center.x + 1, 0.25, center.z + 1], [2.2, 0.5, 2.2], stone, 0, "cylinder");
  box(root, "biryong_village_well_water", [center.x + 1, 0.51, center.z + 1], [1.55, 0.02, 1.55], water, 0, "cylinder");

  // Visible water-management heritage, a defining village motif from the lore candidate.
  for (const channel of BIRYONG_VILLAGE_WATER_CHANNELS) {
    for (let i = 1; i < channel.points.length; i += 1) {
      segmentBox(root, `${channel.id}_${i - 1}`, channel.points[i - 1], channel.points[i],
        channel.width, 0.005, 0.01, water);
    }
  }

  const wallFor = style => style === "workshop" ? workshop : style === "warehouse" ? stone : plaster;
  const roofFor = style => ["workshop", "warehouse", "council"].includes(style) ? roof : roofWarm;
  for (const item of BIRYONG_VILLAGE_BUILDINGS) {
    box(root, `${item.id}_body`, [item.x, item.height / 2, item.z],
      [item.width, item.height, item.depth], wallFor(item.style));
    box(root, `${item.id}_roof`, [item.x, item.height + 0.32, item.z],
      [item.width + 1.2, 0.64, item.depth + 1.2], roofFor(item.style));
    // One front door is enough for the blockout to read as inhabited architecture.
    box(root, `${item.id}_door`, [item.x, 1.05, item.z - item.depth / 2 - 0.03],
      [1.5, 2.1, 0.08], wood);
  }

  // Cheap market canopies and cargo imply the station -> market logistics loop without NPC runtime yet.
  for (const [i, x] of [-8, -1, 6].entries()) {
    box(root, `br_market_stall_${i}`, [x - 11, 0.55, 68], [4.5, 1.1, 2.8], wood);
    box(root, `br_market_canopy_${i}`, [x - 11, 1.35, 68], [5.0, 0.18, 3.2], accent);
  }
  for (const [i, z] of [58, 62, 66].entries()) {
    box(root, `br_workshop_crate_${i}`, [15.5, 0.45, z], [1.6, 0.9, 1.6], wood);
  }

  // North edge remains explicitly future-facing rather than pretending the whole realm is complete.
  const future = BIRYONG_VILLAGE_ANCHORS.northFuture;
  box(root, "biryong_future_marker_left", [-4.5, 1.3, future.z], [0.45, 2.6, 0.45], darkStone);
  box(root, "biryong_future_marker_right", [4.5, 1.3, future.z], [0.45, 2.6, 0.45], darkStone);
  box(root, "biryong_future_marker_beam", [0, 2.55, future.z], [9.5, 0.35, 0.45], accent);

  const environmentDensity = createBiryongEnvironmentDensity({
    root,
    enabled: visualDensity,
    getGraphicsTier
  });

  root.enabled = false;
  app.root.addChild(root);
  return Object.freeze({
    root,
    materialMode: visualMaterials ? "biryong.visual.material.p0b.v1" : "legacy",
    environmentDensity
  });
}
