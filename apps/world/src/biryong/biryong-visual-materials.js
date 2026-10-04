import * as pc from "playcanvas";
import {
  BIRYONG_VISUAL_MATERIALS,
  BIRYONG_VISUAL_MATERIAL_PROFILE_VERSION
} from "./biryong-visual-material-policy.js";

const cache = new Map();

function color(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return new pc.Color(
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255
  );
}

function createMaterial(profile) {
  const material = new pc.StandardMaterial();
  material.name = `${BIRYONG_VISUAL_MATERIAL_PROFILE_VERSION}:${profile.id}`;
  material.diffuse = color(profile.color);
  material.specular = new pc.Color(...profile.specular);
  material.gloss = profile.gloss;
  material.reflectivity = profile.reflectivity;
  if (profile.reflectivity > 0) material.fresnelModel = pc.FRESNEL_SCHLICK;
  if (profile.opacity < 1) {
    material.opacity = profile.opacity;
    material.blendType = pc.BLEND_NORMAL;
    material.depthWrite = true;
  }
  material.update();
  return material;
}

export function biryongVisualMaterial(id) {
  const profile = BIRYONG_VISUAL_MATERIALS[id];
  if (!profile) throw new TypeError(`Unknown Biryong visual material: ${id}`);
  if (!cache.has(id)) cache.set(id, createMaterial(profile));
  return cache.get(id);
}

export function createBiryongVisualMaterialSet() {
  return Object.freeze(Object.fromEntries(
    Object.keys(BIRYONG_VISUAL_MATERIALS).map(id => [id, biryongVisualMaterial(id)])
  ));
}

export function biryongVisualMaterialCacheStatus() {
  return Object.freeze({
    version: BIRYONG_VISUAL_MATERIAL_PROFILE_VERSION,
    materialCount: cache.size,
    ids: Object.freeze([...cache.keys()])
  });
}
