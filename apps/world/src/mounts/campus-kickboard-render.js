import * as pc from "playcanvas";
import { box, surface } from "../campus-render-kit.js";
import { PLAYER_ORIGIN_Y } from "../player-dimensions.js";
export function createCampusKickboard(parent, { rider = false } = {}) {
  const root = new pc.Entity(rider ? "Rider_CampusKickboard" : "Parked_CampusKickboard");
  parent.addChild(root);
  root.setLocalPosition(0, rider ? -PLAYER_ORIGIN_Y : 0, 0);
  root.enabled = false;
  const frame = surface("#26a69a"), rubber = surface("#20272a"), metal = surface("#bac8cd");
  box(root,"deck",[0,0.13,-0.08],[0.24,0.07,0.65],frame);
  box(root,"stem",[0,0.55,0.35],[0.045,0.84,0.045],metal);
  box(root,"handlebar",[0,0.97,0.35],[0.5,0.055,0.055],rubber);
  for (const z of [-0.4,0.4]) {
    const wheel=box(root,"wheel_"+z,[0,0.105,z],[0.21,0.045,0.21],rubber,0,"cylinder");
    wheel.setLocalEulerAngles(0,0,90);
  }
  return root;
}
