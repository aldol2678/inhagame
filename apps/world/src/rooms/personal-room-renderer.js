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
  const { floor, window } = createPersonalRoomShell(root, { materials });
  const floorMaterial = createPersonalRoomFloorMaterial({ app, root, floor, engine: pc });
  const fixtures = createPersonalRoomFixtures({ app, root, materials });
  const lighting = createPersonalRoomLighting(root, materials);
  const { lights } = lighting;
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
  const ambient = new pc.Color(.43,.41,.39), clearColor = new pc.Color(.17,.16,.15);
  let previousVisual = '';
  function applyEnvironment(frame) {
    ambient.set(...frame.ambient);
    for (const light of lights) light.light.intensity = frame.intensity;
    lighting.setOn(frame.intensity > 0);
    // Avoid shader/material updates on every frame when the world is settled.
    const visualKey = [...frame.sky, frame.skyEmissive, frame.diffuser].map(n => n.toFixed(3)).join(':');
    if (visualKey !== previousVisual) {
      previousVisual = visualKey;
      materials.updateVisual('exteriorSky', { color: frame.sky, emissiveIntensity: frame.skyEmissive });
      materials.updateVisual('exteriorHaze', { color: frame.sky.map(n => Math.min(1, n * .85 + .08)), emissiveIntensity: frame.hazeEmissive });
      materials.updateVisual('exteriorFoliage', { color: frame.sky.map(n => n * .4), emissiveIntensity: .1 });
      materials.updateVisual('practicalDiffuser', { emissiveIntensity: frame.diffuser });
    }
  }
  return {root,lights,ownedFurniture,ensureVisualAssets,onDeactivate:floorMaterial.deactivate,
    obstacles:ownedFurniture.obstacles,ambient,clearColor,applyEnvironment,setCurtainOpen:window.setOpenness};
}
