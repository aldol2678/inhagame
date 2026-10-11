// PERSONAL-ROOM-V2 PR A · C70 visual shell.
// Visual recesses never replace the authoritative wall / ceiling collision boxes.

import * as pc from "playcanvas";
import { box, surface } from "../campus-render-kit.js";
import { PERSONAL_ROOM_BASIC } from "./personal-room-layout.js";
import { createPersonalRoomMaterials } from "./personal-room-materials.js";
import { PERSONAL_ROOM_WINDOW, createPersonalRoomWindow } from "./personal-room-window.js";

export function createPersonalRoomShell(root, { materials } = {}) {
  const palette = materials ?? createPersonalRoomMaterials({
    root, app: pc.Application.getApplication(), engine: pc, fallbackSurface: surface
  });
  const { halfWidth: W, halfDepth: D, ceiling: H, wall: T, door } = PERSONAL_ROOM_BASIC;
  const wall = palette.get("wallPaint"), trim = palette.get("trimPaint");
  // This exact entity remains the existing floor texture loader's ownership seam.
  const floor = box(root, "floor", [0, -.05, 0], [2 * W + 2 * T, .1, 2 * D + 2 * T], surface("#b99168"));
  box(root, "ceiling", [0, H + .05, 0], [2 * W + 2 * T, .1, 2 * D + 2 * T], palette.get("ceilingPaint"));

  // A real visual opening exposes the recess and exterior card rather than putting
  // a glowing rectangle over an opaque wall. Gameplay still sees the intact wall.
  const { x, bottom, width, height } = PERSONAL_ROOM_WINDOW;
  const left = x - width / 2, right = x + width / 2, top = bottom + height;
  const north = new pc.Entity("wall_north");
  root.addChild(north);
  box(north, "wall_north_left", [(-W - T + left) / 2, H / 2, D + T / 2], [W + T + left, H, T], wall);
  box(north, "wall_north_right", [(right + W + T) / 2, H / 2, D + T / 2], [W + T - right, H, T], wall);
  box(north, "wall_north_below", [x, bottom / 2, D + T / 2], [width, bottom, T], wall);
  box(north, "wall_north_above", [x, (top + H) / 2, D + T / 2], [width, H - top, T], wall);
  box(root, "wall_south", [0, H / 2, -D - T / 2], [2 * W + 2 * T, H, T], wall);
  box(root, "wall_west", [-W - T / 2, H / 2, 0], [T, H, 2 * D], wall);
  box(root, "wall_east", [W + T / 2, H / 2, 0], [T, H, 2 * D], wall);

  // Thin painted trims stay within the wall's existing capsule clearance.
  box(root, "baseboard_north", [0, .045, D - .012], [2 * W, .09, .024], trim);
  box(root, "baseboard_west", [-W + .012, .045, 0], [.024, .09, 2 * D], trim);
  box(root, "baseboard_east", [W - .012, .045, 0], [.024, .09, 2 * D], trim);
  // Do not run a skirting board across the exit door leaf.
  const doorLeft = door.x - door.width / 2 - .07, doorRight = door.x + door.width / 2 + .07;
  box(root, "baseboard_south_left", [(-W + doorLeft) / 2, .045, -D + .012], [W + doorLeft, .09, .024], trim);
  box(root, "baseboard_south_right", [(doorRight + W) / 2, .045, -D + .012], [W - doorRight, .09, .024], trim);
  for (const side of [-1, 1]) {
    box(root, `ceiling_trim_z_${side}`, [0, H - .022, side * (D - .015)], [2 * W, .044, .03], trim);
    box(root, `ceiling_trim_x_${side}`, [side * (W - .015), H - .022, 0], [.03, .044, 2 * D], trim);
  }

  const frame = new pc.Entity("door_frame");
  root.addChild(frame);
  for (const side of [-1, 1]) {
    box(frame, `door_jamb_${side}`, [door.x + side * (door.width / 2 + .035), door.height / 2, -D + .028], [.07, door.height, .075], trim);
  }
  box(frame, "door_lintel", [door.x, door.height + .035, -D + .028], [door.width + .14, .07, .075], trim);
  box(root, "door", [door.x, door.height / 2, -D + .022], [door.width - .015, door.height - .015, .038], palette.get("oak"));
  // Restrained inset joinery and hardware make the door read at room-camera scale.
  for (const y of [.3, .83]) {
    box(frame, `door_panel_reveal_${y}`, [door.x, y, -D + .044], [door.width - .19, .42, .009], palette.get("oakDark"));
    box(frame, `door_panel_${y}`, [door.x, y, -D + .05], [door.width - .215, .394, .009], palette.get("oak"));
  }
  box(frame, "door_handle_plate", [door.x + door.width * .35, .59, -D + .066], [.045, .11, .014], palette.get("metal"));
  const handle = box(frame, "door_lever", [door.x + door.width * .35 - .04, .61, -D + .086], [.018, .11, .018], palette.get("metal"), 0, "cylinder");
  handle.setLocalEulerAngles(0, 0, 90);
  for (const y of [.21, 1.01]) {
    box(frame, `door_hinge_${y}`, [door.x - door.width / 2 + .014, y, -D + .055], [.019, .073, .019], palette.get("metal"), 0, "cylinder");
  }

  const window = createPersonalRoomWindow(root, { materials: palette });
  return { floor, window };
}
