import { waitForFurnitureVisuals } from './furniture-load-progress.js';
import * as pc from "playcanvas";
import { attachFurnitureVisual, furnitureAssetStatus } from "./furniture-glb-visual.js";
import { furnitureVisualForItem } from "./furniture-visual-assets.js";
import { planFurnitureVisualPlacements } from './furniture-visual-placement.js';
import { personalRoomAssetDiagnostics } from "./personal-room-asset-budget.js";
import { box as renderBox, surface as sharedSurface } from "../campus-render-kit.js";
import { FURNITURE_BY_ID, furnitureBox } from "./furniture-layout.js";
import { trophyDisplayVisual } from "./trophy-display-visual.js";
import { PERSONAL_ROOM_BASIC_OBSTACLES } from "./personal-room-layout.js";

export function createFurnitureLayer(app, root, { modelMode = "glb", isolatedMaterials = false } = {}) {
  const layer = new pc.Entity("personal_owned_furniture", app); root.addChild(layer);
  // A showroom uses another app/device; DOM callbacks need not run during its frame.
  const box = (parent, name, at, size, material, yaw = 0, type = "box") => renderBox(parent, name, at, size, material, yaw, type, app);
  const ownedMaterials = new Map();
  const surface = (hex, profileName) => {
    const shared = sharedSurface(hex, profileName);
    if (!isolatedMaterials) return shared;
    if (!ownedMaterials.has(shared)) ownedMaterials.set(shared, shared.clone());
    return ownedMaterials.get(shared);
  };
  const obstacles = [...PERSONAL_ROOM_BASIC_OBSTACLES];
  let generation = 0, revision = 0, destroyed = false, suspended = false;
  let visuals = [];
  let placementPlan = new Map();
  const placementGeometry = new Map();
  const visualByObject = new Map();
  const posters = new Map(); let signature = "", objects = [], displays = new Map();
  layer.on("destroy", () => {
    destroyed = true; generation++;
    for (const visual of visuals) visual.destroy();
    visuals = []; visualByObject.clear(); placementGeometry.clear(); placementPlan.clear();
    for (const material of posters.values()) { material.diffuseMap?.destroy(); material.destroy(); }
    posters.clear();
    for (const material of ownedMaterials.values()) material.destroy();
    ownedMaterials.clear();
  });
  const paintPoster = item => {
    if (posters.has(item.itemId)) return posters.get(item.itemId);
    const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 384;
    const context = canvas.getContext("2d");
    if (!context) return surface("#b9d7ef");
    context.fillStyle = item.itemId.includes("mcm") ? "#203b69" : "#f6efdc"; context.fillRect(0,0,512,384);
    context.fillStyle = item.itemId.includes("mcm") ? "#ffffff" : "#294a64";
    context.textAlign = "center"; context.font = "bold 30px sans-serif"; context.fillText(item.name,256,65,475);
    if (item.itemId.includes("campus_map")) {
      context.strokeStyle = "#b5bdac"; context.lineWidth = 12;
      context.beginPath(); context.moveTo(50,170); context.lineTo(440,300); context.moveTo(130,310); context.lineTo(330,125); context.stroke();
      context.fillStyle = "#6992b6";
      for (const [x,y] of [[80,110],[160,180],[300,110],[345,240],[130,260]]) context.fillRect(x,y,65,45);
    } else {
      context.font = "bold 70px sans-serif"; context.fillText(item.itemId.includes("mcm") ? "2026" : "INHA",256,235);
    }
    context.font = "24px sans-serif"; context.fillText("INHA WORLD",256,345);
    const texture = new pc.Texture(app.graphicsDevice,{ width:512,height:384,mipmaps:true }); texture.setSource(canvas);
    const material = new pc.StandardMaterial(); material.diffuseMap = texture; material.update(); posters.set(item.itemId,material); return material;
  };
  const displayNameplate = display => {
    const key = `display:${display.itemId}`;
    if (posters.has(key)) return posters.get(key);
    const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) return surface("#f6efdc");
    context.fillStyle = "#f6efdc"; context.fillRect(0,0,512,128);
    context.fillStyle = "#294a64"; context.textAlign = "center"; context.font = "bold 34px sans-serif";
    context.fillText(display.name,256,60,480);
    context.font = "24px sans-serif"; context.fillText("내 화면 · 임시 전시",256,100,480);
    const texture = new pc.Texture(app.graphicsDevice,{ width:512,height:128,mipmaps:true }); texture.setSource(canvas);
    const material = new pc.StandardMaterial(); material.diffuseMap = texture; material.update(); posters.set(key,material); return material;
  };
  function duck(parent, scale = 1) {
    box(parent,"body",[0,.13*scale,0],[.22*scale,.23*scale,.19*scale],surface("#33acb8"),0,"sphere");
    box(parent,"head",[0,.25*scale,-.025*scale],[.17*scale,.17*scale,.17*scale],surface("#47bfcc"),0,"sphere");
    box(parent,"beak",[0,.235*scale,-.12*scale],[.12*scale,.035*scale,.07*scale],surface("#f6b843"));
    for (const x of [-.045,.045]) box(parent,"eye",[x*scale,.275*scale,-.1*scale],[.025*scale,.025*scale,.025*scale],surface("#233140"),0,"sphere");
  }
  function renderObject(object) {
    const item = FURNITURE_BY_ID.get(object.itemId), bounds = furnitureBox(object); if (!item || !bounds) return;
    const entity = new pc.Entity(`placed_${object.id}`, app); entity.setLocalPosition(object.x,bounds.minY,object.z); entity.setLocalEulerAngles(0,object.yaw,0); layer.addChild(entity);
    const id = item.itemId;
    const candidate = furnitureVisualForItem(id);
    const selection = placementPlan.get(object.id);
    const visual = candidate?.geometryPolicy === 'character-r1' && !selection?.eligible ? null : candidate;
    // Preserve all procedural geometry as one atomic fallback. The same renderer
    // is used by owned rooms and isolated shop previews; catalog authority is unchanged.
    const anchor = entity;
    const fallback = new pc.Entity(id === 'furniture.dorm_single_sofa' ? 'sofa_procedural_fallback' : 'furniture_procedural_fallback', app);
    anchor.addChild(fallback);
    const visualParent = fallback;
    if (item.surfaces.includes("north")) {
      box(visualParent,"frame",[0,item.height/2,0],[item.width+.03,item.height+.03,item.depth],surface("#75654e"));
      box(visualParent,"poster",[0,item.height/2,-.023],[item.width,item.height,.006],paintPoster(item));
    } else if (id === "furniture.cooking_station") {
      box(visualParent,"cabinet",[0,.4,0],[.96,.8,.61],surface("#967454"));
      box(visualParent,"counter",[0,.83,0],[item.width,.08,item.depth],surface("#d9d7ce"));
      for (const x of [-.25,.25]) {
        box(visualParent,"burner",[x,.885,0],[.24,.03,.24],surface("#343a40"),0,"cylinder");
        box(visualParent,"handle",[x,.5,-.318],[.16,.03,.025],surface("#474a4a"));
      }
    } else if (id.includes("chair")) {
      box(visualParent,"seat",[0,.3,0],[.6,.08,.6],surface("#39aab7"));
      box(visualParent,"back",[0,.51,.28],[.6,.28,.08],surface("#6ecbd1"));
      for (const x of [-.23,.23]) for (const z of [-.23,.23]) box(visualParent,"leg",[x,.15,z],[.05,.3,.05],surface("#546773"));
    } else if (id.includes("lamp")) {
      box(visualParent,"base",[0,.025,0],[.22,.05,.22],surface("#556575"),0,"cylinder");
      box(visualParent,"stem",[0,.22,0],[.035,.36,.035],surface("#667c8c"));
      box(visualParent,"shade",[0,.39,0],[.22,.12,.22],surface("#ffe2a2"),0,"cylinder");
    } else if (id.includes("rug")) {
      box(visualParent,"rug",[0,.01,0],[2,.02,1.5],surface("#396caa"));
      box(visualParent,"stripe",[0,.021,0],[1.7,.004,1.2],surface("#85b6db"));
    } else if (id.includes("cushion")) {
      box(visualParent,"cushion",[0,.07,0],[.45,.14,.4],surface("#5ac9d1"),0,"sphere");
      box(visualParent,"beak",[0,.12,-.12],[.14,.025,.08],surface("#fac34e"));
    } else if (id.includes("single_sofa")) {
      const fabric=surface("#718da3"), dark=surface("#536b7c");
      box(fallback,"seat",[0,.25,0],[item.width,.22,item.depth*.72],fabric);
      box(fallback,"back",[0,.53,item.depth*.34],[item.width,.38,.16],fabric);
      for(const x of [-item.width/2+.08,item.width/2-.08]) box(fallback,"arm",[x,.38,0],[.16,.34,item.depth*.72],dark);
      for(const x of [-item.width*.36,item.width*.36]) for(const z of [-item.depth*.23,item.depth*.23])
        box(fallback,"leg",[x,.07,z],[.07,.14,.07],surface("#5b4635"));

    } else if (id.includes("side_table_low")) {
      box(visualParent,"top",[0,item.height-.04,0],[item.width,.08,item.depth],surface("#a97b50"));
      for(const x of [-item.width*.38,item.width*.38]) for(const z of [-item.depth*.38,item.depth*.38])
        box(visualParent,"leg",[x,(item.height-.08)/2,z],[.06,item.height-.08,.06],surface("#634b38"));
    } else if (id.includes("bookshelf_slim")) {
      const wood=surface("#765338"), edge=surface("#a77a50");
      box(visualParent,"back",[0,item.height/2,item.depth/2-.025],[item.width,item.height,.05],wood);
      for(const x of [-item.width/2+.035,item.width/2-.035]) box(visualParent,"side",[x,item.height/2,0],[.07,item.height,item.depth],wood);
      for(const y of [.04,item.height*.34,item.height*.66,item.height-.04]) box(visualParent,"shelf",[0,y,0],[item.width,.06,item.depth],edge);
    } else if (id.includes("plant_medium")) {
      box(visualParent,"pot",[0,.16,0],[.38,.32,.38],surface("#a95f3c"),0,"cylinder");
      for(const [x,y,z,s] of [[0,.48,0,.42],[-.13,.58,.04,.3],[.13,.62,-.03,.32],[0,.72,.08,.28]])
        box(visualParent,"leaf",[x,y,z],[s,.28,s*.72],surface("#4f8c58"),0,"sphere");
    } else if (id.includes("dorm_monitor")) {
      const bezel=surface("#26323b"), screen=surface("#78a9c8");
      box(visualParent,"screen",[0,.22,0],[item.width,.30,.06],bezel);
      box(visualParent,"panel",[0,.22,-.034],[item.width-.05,.25,.008],screen);
      box(visualParent,"stem",[0,.065,.02],[.04,.13,.04],surface("#53616b"));
      box(visualParent,"base",[0,.015,.02],[.22,.03,.12],surface("#53616b"));
    } else if (id.includes("trophy_shelf")) {
      const wood=surface("#725039"), shelf=surface("#a4774d");
      box(visualParent,"back",[0,item.height/2,item.depth/2-.02],[item.width,item.height,.04],wood);
      for(const x of [-item.width/2+.035,item.width/2-.035]) box(visualParent,"side",[x,item.height/2,0],[.07,item.height,item.depth],wood);
      for(const y of [.04,item.height*.48,item.height-.04]) box(visualParent,"shelf",[0,y,0],[item.width,.06,item.depth],shelf);
      const display = displays.get(object.id);
      for (const part of trophyDisplayVisual(display)) box(visualParent,part.name,part.at,part.size,surface(part.color),0,part.type ?? "box");
      if (display) box(visualParent,"owned_item_nameplate",[0,.42,-item.depth/2-.006],[.62,.14,.008],displayNameplate(display));
    } else if (id.includes("study_books_set")) {
      const colors=["#496b8c","#b05f54","#d0a14f","#6f8f62","#7d668e"];
      colors.forEach((color,index)=>box(visualParent,"book",[0,index*.032+.018,(index%2)*.012-.006],
        [item.width-index*.025,.03,item.depth],surface(color)));
      box(visualParent,"notebook",[.03,.17,0],[item.width*.82,.025,item.depth*.9],surface("#e6dfcc"));
    } else {
      box(visualParent,"base",[0,.025,0],[item.width,.05,item.depth],surface("#977449"));
      const duckRoot = new pc.Entity("duck", app); duckRoot.setLocalPosition(0,.04,0); visualParent.addChild(duckRoot);
      duck(duckRoot,(item.height-.04)/.335);
      if (id.includes("landlord")) box(visualParent,"building",[.08,.11,.075],[.1,.2,.08],surface("#b7c7dd"));
    }
    if (visual && modelMode !== "procedural" && !suspended) {
      const handle=attachFurnitureVisual({ app, anchor, fallback, visual, onChange: () => {
        syncGeometry(); revision++; layer.fire("visualchange");
      } });
      visuals.push(handle); visualByObject.set(object.id,handle);
    }
  }

  function render() {
    const next = JSON.stringify([objects,[...displays]]); if (signature === next) return;
    signature = next; generation++;
    placementPlan=planFurnitureVisualPlacements(objects,{visualForItem:furnitureVisualForItem,modelMode});
    for (const visual of visuals) visual.destroy();
    visuals = []; visualByObject.clear(); placementGeometry.clear();
    for (const child of [...layer.children]) child.destroy();
    for (const object of objects) renderObject(object);
    syncGeometry();
  }
  function syncGeometry() {
    placementGeometry.clear();
    for(const [id,entry] of placementPlan) {
      const status=visualByObject.get(id)?.status();
      if(entry.eligible && !suspended && status?.modelVisible) placementGeometry.set(id,Object.freeze({
        box:entry.box,seatPosition:entry.visual.seat?.position??null,sourceKey:status.sourceKey
      }));
    }
    const decor=obstacles.filter(box=>box.id.startsWith('personal_decor_'));
    obstacles.splice(0,obstacles.length,...PERSONAL_ROOM_BASIC_OBSTACLES,
      ...objects.filter(object=>object.surface==='floor'&&FURNITURE_BY_ID.get(object.itemId)?.solid)
        .map(object=>placementGeometry.get(object.id)?.box??furnitureBox(object)),...decor);
  }
  return {
    root: layer,
    deactivate() { suspended = true; generation++; for (const visual of visuals) visual.destroy(); visuals = []; visualByObject.clear(); syncGeometry(); },
    activate() { if (destroyed) return; if (suspended) { suspended = false; signature = ""; render(); } },
    whenVisualsReady: options => waitForFurnitureVisuals([...visuals], options),
    visualStatus: () => ({ generation, revision, destroyed, suspended, modelMode, placementCount: objects.length, contentKey: JSON.stringify([objects,[...displays]]), objects: visuals.map(visual => visual.status()), resources: furnitureAssetStatus(app) }),
    assetDiagnostics: options => personalRoomAssetDiagnostics(objects, options),
    obstacles,
    placementGeometry,
    placementNotices: () => [...placementPlan.values()].filter(entry=>entry.notice).map(({id,reason,notice})=>({id,reason,notice})),
    setObjects(next) { objects = next; render(); },
    setDisplays(next = []) { displays = new Map(next.map(display => [display.objectId, display])); render(); }
  };
}
