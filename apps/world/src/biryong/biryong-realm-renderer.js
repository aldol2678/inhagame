// Minimal outdoor blockout for the Biryong Realm region handoff.
// This is intentionally a station slice, not the village/theme-park art pass.
import * as pc from "playcanvas";
import { box, surface } from "../campus-render-kit.js";

export function createBiryongRealmScene(app) {
  const root = new pc.Entity("BiryongRealmCoordinateFrame");
  // Keep canonical +Z north while PlayCanvas renders forward on -Z, matching Campus.
  root.setLocalScale(1, 1, -1);

  const stone = surface("#9aa09b");
  const darkStone = surface("#616b66");
  const road = surface("#4c5457");
  const platform = surface("#c8c2ad");
  const grass = surface("#66865a");
  const roof = surface("#385f5a");
  const accent = surface("#c6a456");

  box(root, "biryong_station_ground", [0, -0.06, 6], [76, 0.12, 76], grass);
  box(root, "biryong_station_road", [0, -0.015, -12], [8, 0.03, 40], road);
  box(root, "biryong_station_platform", [8, 0.04, -5], [12, 0.08, 24], platform);
  box(root, "biryong_station_square", [0, 0.02, 11], [28, 0.04, 22], platform);

  // Small station silhouette. Future art may replace every primitive without changing anchors.
  box(root, "biryong_station_building", [0, 2.2, 25], [20, 4.4, 8], stone);
  box(root, "biryong_station_roof", [0, 4.65, 25], [22, 0.5, 10], roof);
  box(root, "biryong_station_door", [0, 1.3, 20.94], [3.0, 2.6, 0.12], darkStone);
  box(root, "biryong_station_sign", [0, 3.2, 20.84], [7.5, 0.7, 0.1], accent);

  for (const x of [-12, 12]) {
    box(root, "biryong_station_lamp_post", [x, 1.7, 8], [0.12, 3.4, 0.12], darkStone);
    box(root, "biryong_station_lamp", [x, 3.45, 8], [0.5, 0.25, 0.5], accent);
  }

  // Northern construction gate communicates that the rest of Biryong Realm is authored later.
  box(root, "biryong_north_gate_left", [-5.2, 1.5, 42], [0.6, 3, 0.6], darkStone);
  box(root, "biryong_north_gate_right", [5.2, 1.5, 42], [0.6, 3, 0.6], darkStone);
  box(root, "biryong_north_gate_beam", [0, 2.75, 42], [11, 0.5, 0.6], accent);

  root.enabled = false;
  app.root.addChild(root);
  return Object.freeze({ root, obstacles: Object.freeze([]) });
}
