const material = (id, color, specular, gloss, reflectivity = 0, opacity = 1) =>
  Object.freeze({
    id,
    color,
    specular: Object.freeze(specular),
    gloss,
    reflectivity,
    opacity
  });

export const BIRYONG_VISUAL_MATERIAL_PROFILE_VERSION = "biryong.visual.material.p0b.v1";

export const BIRYONG_VISUAL_MATERIALS = Object.freeze({
  stone: material("stone", "#9eaaa5", [0.19, 0.20, 0.19], 0.22, 0.025),
  darkStone: material("darkStone", "#52615f", [0.30, 0.33, 0.33], 0.48, 0.08),
  road: material("road", "#424a4d", [0.05, 0.055, 0.06], 0.075, 0),
  path: material("path", "#ad9f82", [0.09, 0.08, 0.06], 0.12, 0),
  platform: material("platform", "#cbc2aa", [0.18, 0.18, 0.16], 0.24, 0.025),
  grass: material("grass", "#5f8359", [0.05, 0.075, 0.045], 0.08, 0),
  field: material("field", "#81955c", [0.055, 0.075, 0.042], 0.075, 0),
  roof: material("roof", "#315e5b", [0.24, 0.30, 0.29], 0.42, 0.055),
  roofWarm: material("roofWarm", "#744b33", [0.12, 0.075, 0.05], 0.16, 0),
  wood: material("wood", "#795638", [0.13, 0.085, 0.05], 0.18, 0),
  plaster: material("plaster", "#ddd1b7", [0.20, 0.19, 0.16], 0.26, 0.02),
  workshop: material("workshop", "#706b61", [0.19, 0.19, 0.18], 0.24, 0.02),
  accent: material("accent", "#cba753", [0.52, 0.46, 0.29], 0.66, 0.17),
  water: material("water", "#4f92ad", [0.62, 0.75, 0.82], 0.88, 0.30, 0.92)
});

export function biryongVisualMaterialProfile(id) {
  return BIRYONG_VISUAL_MATERIALS[id] ?? null;
}

export function biryongVisualMaterialIds() {
  return Object.freeze(Object.keys(BIRYONG_VISUAL_MATERIALS));
}
