import * as pc from "playcanvas";
import { box, surface } from "../campus-render-kit.js";
import { PERSONAL_ROOM_DECOR, personalRoomDecorBox, visiblePersonalRoomDecor } from "./personal-room-decor-layout.js";
import { createPersonalRoomFixtureModel } from "./personal-room-fixture-model.js";

export function createPersonalRoomDecor(app, root, obstacles) {
  const anchors = new Map(), loaders = [];
  for (const prop of PERSONAL_ROOM_DECOR) {
    const anchor = new pc.Entity(`personal_decor_${prop.id}`);
    anchor.setLocalPosition(...prop.at); root.addChild(anchor); anchors.set(prop.id, anchor);
    const fallback = new pc.Entity(`${prop.id}_fallback`); anchor.addChild(fallback);
    if (prop.id === "reading_table") {
      box(fallback,"top",[0,.47,0],[1,.06,1],surface("#9a714a"));
      for (const x of [-.41,.41]) for (const z of [-.41,.41])
        box(fallback,"leg",[x,.22,z],[.08,.44,.08],surface("#5b4635"));
    } else if (prop.id === "floor_lamp") {
      box(fallback,"base",[0,.03,0],[.5,.06,.5],surface("#556575"),0,"cylinder");
      box(fallback,"stem",[0,.55,0],[.035,1.04,.035],surface("#667c8c"));
      box(fallback,"shade",[0,1.13,0],[.5,.26,.5],surface("#ffe2a2"),0,"cylinder");
      // Same local light serves both the placeholder and imported model; hiding the prop
      // for an owned placement also disables the light through its parent entity.
      const light = new pc.Entity("reading_lamp_light");
      light.addComponent("light",{type:"omni",color:new pc.Color(1,.91,.74),intensity:.18,range:2,castShadows:false});
      light.setLocalPosition(0,1.1,0);anchor.addChild(light);
    } else {
      box(fallback,"shelf",[0,.025,0],[.25,.05,1],surface("#9a714a"));
      box(fallback,"books",[0,.15,.1],[.15,.2,.5],surface("#60758a"));
    }
    loaders.push(createPersonalRoomFixtureModel({app,root,anchor,fallback,model:prop.model}));
  }
  return {
    ensureVisualAssets: () => Promise.all(loaders.map(ensure => ensure())),
    update(objects) {
      const visible = visiblePersonalRoomDecor(objects), ids = new Set(visible.map(prop => prop.id));
      for (const [id, anchor] of anchors) anchor.enabled = ids.has(id);
      // Keep the same array held by movement/camera; repeated snapshots cannot accumulate
      // duplicate colliders, and a hidden decoration has no invisible obstacle.
      const retained = obstacles.filter(box => !box.id.startsWith("personal_decor_"));
      obstacles.splice(0,obstacles.length,...retained,...visible.map(personalRoomDecorBox));
    }
  };
}
