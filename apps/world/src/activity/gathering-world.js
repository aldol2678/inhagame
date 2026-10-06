import * as pc from "playcanvas";
import { box, surface } from "../campus-render-kit.js";
import { GATHERING_SPOTS } from "./gathering-spots.js";

const LEAF_COLORS = Object.freeze(["#8f5a2a", "#b36b2d", "#c98a3d", "#755127"]);

export function createGatheringWorld(parent) {
  const spot = GATHERING_SPOTS[0];
  const root = new pc.Entity("CAMPUS_GATHERING_LEAF_PILE_01");
  parent.addChild(root);
  root.setLocalPosition(spot.position.x, 0.035, spot.position.z);

  for (let i = 0; i < 12; i += 1) {
    const angle = i * 2.399963229728653;
    const radius = 0.14 + (i % 4) * 0.08;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = (i % 3) * 0.018;
    box(root, `leaf-${i}`, [x, y, z], [0.20 + (i % 2) * 0.05, 0.018, 0.09],
      surface(LEAF_COLORS[i % LEAF_COLORS.length]), angle * 180 / Math.PI);
  }
  return root;
}
