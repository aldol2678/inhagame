// Small persistent 3D guestbook stand at the main gate.
import { box, surface } from "../campus-render-kit.js";
import { GATE_FRAME } from "../roadview-layout.js";
import { MAIN_GATE_GUESTBOOK } from "./guestbook-world.js";

export function createMainGateGuestbookObject(root) {
  const a = MAIN_GATE_GUESTBOOK;
  const entities = [];
  const add = (name, u, v, y, size, color, tilt = 0) => {
    const p = GATE_FRAME.at(u, v);
    const entity = box(root, name, [p.x, y, p.z], size, surface(color), a.yaw);
    if (tilt) entity.setLocalEulerAngles(tilt, a.yaw, 0);
    entities.push(entity);
    return entity;
  };

  add("main_gate_guestbook_plinth", a.u, a.v, 0.06, [0.92, 0.12, 0.72], "#4b4038");
  add("main_gate_guestbook_pedestal", a.u, a.v, 0.55, [0.72, 0.98, 0.56], "#6f513c");
  add("main_gate_guestbook_plaque", a.u, a.v - 0.305, 0.58, [0.48, 0.20, 0.035], "#d4ad5d");
  add("main_gate_guestbook_cover", a.u, a.v, 1.09, [1.00, 0.09, 0.65], "#2f6172", -14);
  const pages = add("main_gate_guestbook_pages", a.u, a.v - 0.01, 1.145, [0.91, 0.055, 0.57], "#eee4ca", -14);
  add("main_gate_guestbook_spine", a.u, a.v - 0.01, 1.175, [0.055, 0.025, 0.55], "#ba9145", -14);

  return Object.freeze({
    anchor: a,
    labelAnchor: pages,
    entities: Object.freeze(entities.slice()),
    destroy() {
      for (const entity of entities.splice(0)) entity.destroy?.();
    }
  });
}
