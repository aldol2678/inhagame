import * as pc from "playcanvas";
import { box, surface } from "../campus-render-kit.js";
import {
  BIRYONG_ENVIRONMENT_BASE,
  BIRYONG_ENVIRONMENT_DENSITY_VERSION,
  BIRYONG_ENVIRONMENT_HIGH,
  BIRYONG_ENVIRONMENT_MEDIUM,
  biryongEnvironmentDensityPolicy
} from "./biryong-environment-density-policy.js";

let materialCache = null;
function materials() {
  if (materialCache) return materialCache;
  materialCache = Object.freeze({
    trunk: surface("#6f5339", "wood"),
    foliageDark: surface("#426846", "foliage"),
    foliageLight: surface("#5d814d", "foliage"),
    shrub: surface("#52764a", "foliage"),
    rock: surface("#78817b", "concrete"),
    metal: surface("#5e6968", "metal"),
    lantern: surface("#d0ad55", "paint"),
    markerStone: surface("#687572", "concrete"),
    markerAccent: surface("#b99345", "metal")
  });
  return materialCache;
}

function setShadow(entity, value) {
  if (entity?.render) entity.render.castShadows = value === true;
  return entity;
}

function createTree(root, item, index) {
  const trunkHeight = 2.4 * item.scale;
  setShadow(box(root, `br_density_tree_${index}_trunk`,
    [item.x, trunkHeight / 2, item.z],
    [0.52 * item.scale, trunkHeight, 0.52 * item.scale],
    materials().trunk, item.yaw, "cylinder"), true);
  setShadow(box(root, `br_density_tree_${index}_crown`,
    [item.x, trunkHeight + 1.15 * item.scale, item.z],
    [2.7 * item.scale, 2.35 * item.scale, 2.7 * item.scale],
    index % 2 ? materials().foliageDark : materials().foliageLight, item.yaw, "sphere"), true);
}

function createShrub(root, item, index) {
  setShadow(box(root, `br_density_shrub_${index}`,
    [item.x, 0.48 * item.scale, item.z],
    [1.55 * item.scale, 0.95 * item.scale, 1.3 * item.scale],
    materials().shrub, item.yaw, "sphere"), false);
}

function createRock(root, item, index) {
  setShadow(box(root, `br_density_rock_${index}`,
    [item.x, 0.42 * item.scale, item.z],
    [1.35 * item.scale, 0.82 * item.scale, 1.05 * item.scale],
    materials().rock, item.yaw, "sphere"), false);
}

function createLantern(root, item, index) {
  setShadow(box(root, `br_density_lantern_${index}_post`,
    [item.x, 1.35 * item.scale, item.z],
    [0.16 * item.scale, 2.7 * item.scale, 0.16 * item.scale],
    materials().metal, item.yaw), true);
  setShadow(box(root, `br_density_lantern_${index}_head`,
    [item.x, 2.78 * item.scale, item.z],
    [0.58 * item.scale, 0.42 * item.scale, 0.58 * item.scale],
    materials().lantern, item.yaw), false);
}

function createMarker(root, item, index) {
  setShadow(box(root, `br_density_marker_${index}_stone`,
    [item.x, 0.8 * item.scale, item.z],
    [0.7 * item.scale, 1.6 * item.scale, 0.55 * item.scale],
    materials().markerStone, item.yaw), true);
  setShadow(box(root, `br_density_marker_${index}_crest`,
    [item.x, 1.7 * item.scale, item.z],
    [0.38 * item.scale, 0.38 * item.scale, 0.18 * item.scale],
    materials().markerAccent, item.yaw, "sphere"), false);
}

function renderPlacements(root, placements, prefixOffset = 0) {
  placements.forEach((item, index) => {
    const id = prefixOffset + index;
    if (item.kind === "tree") createTree(root, item, id);
    else if (item.kind === "shrub") createShrub(root, item, id);
    else if (item.kind === "rock") createRock(root, item, id);
    else if (item.kind === "lantern") createLantern(root, item, id);
    else if (item.kind === "marker") createMarker(root, item, id);
  });
}

export function createBiryongEnvironmentDensity({
  root,
  enabled = false,
  getGraphicsTier = () => "medium"
} = {}) {
  if (!root) throw new TypeError("Biryong environment density root required");

  if (enabled !== true) {
    return Object.freeze({
      root: null,
      update: () => false,
      status: () => Object.freeze({
        version: BIRYONG_ENVIRONMENT_DENSITY_VERSION,
        enabled: false,
        tier: Object.hasOwn({ low: true, medium: true, high: true }, getGraphicsTier())
          ? getGraphicsTier() : "medium",
        counts: Object.freeze({ base: 0, medium: 0, high: 0, total: 0 })
      })
    });
  }

  const densityRoot = new pc.Entity("BiryongEnvironmentDensityP0C");
  const baseRoot = new pc.Entity("BiryongDensityBase");
  const mediumRoot = new pc.Entity("BiryongDensityMedium");
  const highRoot = new pc.Entity("BiryongDensityHigh");

  densityRoot.addChild(baseRoot);
  densityRoot.addChild(mediumRoot);
  densityRoot.addChild(highRoot);
  root.addChild(densityRoot);

  renderPlacements(baseRoot, BIRYONG_ENVIRONMENT_BASE, 0);
  renderPlacements(mediumRoot, BIRYONG_ENVIRONMENT_MEDIUM, BIRYONG_ENVIRONMENT_BASE.length);
  renderPlacements(highRoot, BIRYONG_ENVIRONMENT_HIGH,
    BIRYONG_ENVIRONMENT_BASE.length + BIRYONG_ENVIRONMENT_MEDIUM.length);

  densityRoot.enabled = true;
  let activeTier = null;

  function applyTier() {
    const policy = biryongEnvironmentDensityPolicy(getGraphicsTier());
    if (activeTier === policy.tier) return false;
    activeTier = policy.tier;
    baseRoot.enabled = true;
    mediumRoot.enabled = policy.tier !== "low";
    highRoot.enabled = policy.tier === "high";
    return true;
  }

  function update() {
    return applyTier();
  }

  function status() {
    const policy = biryongEnvironmentDensityPolicy(activeTier ?? getGraphicsTier());
    return Object.freeze({
      version: BIRYONG_ENVIRONMENT_DENSITY_VERSION,
      enabled: densityRoot.enabled,
      tier: policy.tier,
      counts: policy.counts
    });
  }

  if (densityRoot.enabled) applyTier();

  return Object.freeze({
    root: densityRoot,
    update,
    status
  });
}
