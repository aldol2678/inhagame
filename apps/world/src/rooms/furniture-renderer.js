import * as pc from "playcanvas";
import { box, surface } from "../campus-render-kit.js";
import { FURNITURE_BY_ID, furnitureBox } from "./furniture-layout.js";
import { PERSONAL_ROOM_BASIC_OBSTACLES } from "./personal-room-layout.js";

export function createFurnitureLayer(app, root) {
  const layer = new pc.Entity("personal_owned_furniture"); root.addChild(layer);
  const obstacles = [...PERSONAL_ROOM_BASIC_OBSTACLES];
  const posters = new Map(); let signature = "";
  layer.on("destroy", () => {
    for (const material of posters.values()) { material.diffuseMap?.destroy(); material.destroy(); }
    posters.clear();
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
  function duck(parent, scale = 1) {
    box(parent,"body",[0,.13*scale,0],[.22*scale,.23*scale,.19*scale],surface("#33acb8"),0,"sphere");
    box(parent,"head",[0,.25*scale,-.025*scale],[.17*scale,.17*scale,.17*scale],surface("#47bfcc"),0,"sphere");
    box(parent,"beak",[0,.235*scale,-.12*scale],[.12*scale,.035*scale,.07*scale],surface("#f6b843"));
    for (const x of [-.045,.045]) box(parent,"eye",[x*scale,.275*scale,-.1*scale],[.025*scale,.025*scale,.025*scale],surface("#233140"),0,"sphere");
  }
  function renderObject(object) {
    const item = FURNITURE_BY_ID.get(object.itemId), bounds = furnitureBox(object); if (!item || !bounds) return;
    const entity = new pc.Entity(`placed_${object.id}`); entity.setLocalPosition(object.x,bounds.minY,object.z); entity.setLocalEulerAngles(0,object.yaw,0); layer.addChild(entity);
    const id = item.itemId;
    if (item.surfaces.includes("north")) {
      box(entity,"frame",[0,item.height/2,0],[item.width+.03,item.height+.03,item.depth],surface("#75654e"));
      box(entity,"poster",[0,item.height/2,-.023],[item.width,item.height,.006],paintPoster(item));
    } else if (id.includes("chair")) {
      box(entity,"seat",[0,.3,0],[.6,.08,.6],surface("#39aab7"));
      box(entity,"back",[0,.51,.28],[.6,.28,.08],surface("#6ecbd1"));
      for (const x of [-.23,.23]) for (const z of [-.23,.23]) box(entity,"leg",[x,.15,z],[.05,.3,.05],surface("#546773"));
    } else if (id.includes("lamp")) {
      box(entity,"base",[0,.025,0],[.22,.05,.22],surface("#556575"),0,"cylinder");
      box(entity,"stem",[0,.22,0],[.035,.36,.035],surface("#667c8c"));
      box(entity,"shade",[0,.39,0],[.22,.12,.22],surface("#ffe2a2"),0,"cylinder");
    } else if (id.includes("rug")) {
      box(entity,"rug",[0,.01,0],[2,.02,1.5],surface("#396caa"));
      box(entity,"stripe",[0,.021,0],[1.7,.004,1.2],surface("#85b6db"));
    } else if (id.includes("cushion")) {
      box(entity,"cushion",[0,.07,0],[.45,.14,.4],surface("#5ac9d1"),0,"sphere");
      box(entity,"beak",[0,.12,-.12],[.14,.025,.08],surface("#fac34e"));
    } else {
      box(entity,"base",[0,.025,0],[item.width,.05,item.depth],surface("#977449"));
      const duckRoot = new pc.Entity("duck"); duckRoot.setLocalPosition(0,.04,0); entity.addChild(duckRoot);
      duck(duckRoot,(item.height-.04)/.335);
      if (id.includes("landlord")) box(entity,"building",[.08,.11,.075],[.1,.2,.08],surface("#b7c7dd"));
    }
  }
  return {
    root: layer,
    obstacles,
    setObjects(objects) {
      const next = JSON.stringify(objects); if (signature === next) return;
      signature = next;
      for (const child of [...layer.children]) child.destroy();
      for (const object of objects) renderObject(object);
      obstacles.splice(0,obstacles.length,...PERSONAL_ROOM_BASIC_OBSTACLES,...objects.filter(object => object.surface === "floor" && FURNITURE_BY_ID.get(object.itemId)?.solid).map(furnitureBox));
    }
  };
}
