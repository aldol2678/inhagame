// PERSONAL-ROOM-V2 PR A · DORM_1_BASIC visual composition root.
// Fixed template fixtures and a separate Collection-owned placement layer.

import * as pc from "playcanvas";
import { surface } from "../campus-render-kit.js";
import { createPersonalRoomShell } from "./personal-room-shell-renderer.js";
import { createPersonalRoomFloorMaterial } from "./personal-room-floor-material.js";
import { createFurnitureLayer } from "./furniture-renderer.js";
import { createPersonalRoomMaterials } from "./personal-room-materials.js";
import { createPersonalRoomFixtures } from "./personal-room-fixtures-v2.js";
import { createPersonalRoomLighting } from "./personal-room-lighting.js";
import { createPersonalRoomDecor } from "./personal-room-decor-renderer.js";

export function createPersonalRoomScene(app){
  const root=new pc.Entity("Room_ROOM_PERSONAL_BASIC");root.setLocalScale(1,1,-1);
  const materials = createPersonalRoomMaterials({ root, app, engine: pc, fallbackSurface: surface });
  const { floor } = createPersonalRoomShell(root, { materials });
  const floorMaterial = createPersonalRoomFloorMaterial({ app, root, floor, engine: pc });
  const fixtures = createPersonalRoomFixtures({ app, root, materials });
  const { lights } = createPersonalRoomLighting(root, materials);
  root.enabled=false;app.root.addChild(root);
  const ownedFurniture = createFurnitureLayer(app,root);
  const decor = createPersonalRoomDecor(app,root,ownedFurniture.obstacles);
  const setOwnedObjects = ownedFurniture.setObjects;
  ownedFurniture.setObjects = objects => {
    setOwnedObjects(objects);
    decor.update(objects);
  };
  decor.update([]);
  const ensureVisualAssets = () => Promise.all([fixtures.ensureVisualAssets(),decor.ensureVisualAssets(),floorMaterial.ensureVisual()]);
  return {root,lights,ownedFurniture,ensureVisualAssets,onDeactivate:floorMaterial.deactivate,obstacles:ownedFurniture.obstacles,ambient:new pc.Color(0.43,0.41,0.39),clearColor:new pc.Color(0.17,0.16,0.15)};
}
