// PlayCanvas presentation for the parked stadium helicopter.
import * as pc from "playcanvas";
import { FacilityMeshBatch } from "../facility-mesh-batch.js";
import { setCampusHelicopterPropRoot } from "./campus-helicopter-world.js";

function fillHelicopter(batch) {
  const navy = "#203952";
  const glass = "#91d5ed";
  const orange = "#f3a431";
  const dark = "#172430";
  const steel = "#aeb7c2";

  batch.box(navy, [0, 0.58, 0], [1.45, 0.62, 1.9], 0);
  batch.box(glass, [0, 0.72, 0.56], [1.22, 0.4, 0.72], 0);
  batch.box(navy, [0, 0.6, -1.42], [0.28, 0.28, 1.7], 0);
  batch.box(navy, [0, 0.86, -2.22], [0.08, 0.72, 0.52], 0);
  batch.box(orange, [0, 0.57, 0.98], [0.44, 0.16, 0.16], 0);

  for (const side of [-1, 1]) {
    batch.tube(dark, [side * 0.55, 0.1, -0.68], [side * 0.55, 0.1, 0.72], 0.045, 6);
    batch.tube(steel, [side * 0.55, 0.1, -0.36], [side * 0.42, 0.42, -0.28], 0.026, 5);
    batch.tube(steel, [side * 0.55, 0.1, 0.38], [side * 0.42, 0.42, 0.3], 0.026, 5);
  }

  batch.tube(steel, [0, 1.1, 0], [0, 1.34, 0], 0.05, 6);
  batch.tube(dark, [-2.45, 1.34, 0], [2.45, 1.34, 0], 0.045, 6);
  batch.tube(dark, [0, 1.35, -2.45], [0, 1.35, 2.45], 0.045, 6);
  batch.tube(steel, [-0.02, 0.44, -2.47], [-0.02, 1.2, -2.47], 0.035, 6);
  batch.tube(dark, [-0.02, 0.82, -2.85], [-0.02, 0.82, -2.09], 0.035, 6);
}

export function buildCampusHelicopter(root) {
  const holder = new pc.Entity("stadium_campus_helicopter_root");
  root.addChild(holder);
  const batch = new FacilityMeshBatch();
  fillHelicopter(batch);
  batch.finish(holder, "stadium_campus_helicopter");
  setCampusHelicopterPropRoot(holder);
  return holder;
}
