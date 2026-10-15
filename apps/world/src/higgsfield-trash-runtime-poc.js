import * as pc from "playcanvas";
import { box, surface } from "./campus-render-kit.js";
import { createPlayCanvasRuntimeContext } from "./runtime-adapter/playcanvas-context.js";
import { METERS_PER_WORLD_UNIT } from "./world-scale.js";
import { PLAYER_ORIGIN_Y } from "./player-dimensions.js";

export const HIGGSFIELD_TRASH_POC = Object.freeze({
  projectId: "58e1c25d-4df7-48b2-ae6b-12a25b65f56e",
  revision: 2,
  assetUri: "/assets/higgsfield-trash-bin-poc.glb",
  assetBytes: 58044,
  sourceTriangles: 720,
  sourceDimensionsMeters: Object.freeze([0.62, 0.62, 0.8525]),
  control: "current-campus procedural primitive"
});

const wu = meters => meters / METERS_PER_WORLD_UNIT;

export function isHiggsfieldTrashPocRequested({ hostname = "", search = "" } = {}) {
  const previewHost = hostname.endsWith(".vercel.app") || hostname === "localhost" || hostname === "127.0.0.1";
  return previewHost && new URLSearchParams(search).get("assetPoc") === "higgsfield-trash";
}

function cylinder(root, name, diameterMeters, heightMeters, yMeters, material) {
  const entity = new pc.Entity(name);
  entity.addComponent("render", { type: "cylinder" });
  entity.render.material = material;
  entity.setLocalPosition(0, wu(yMeters), 0);
  entity.setLocalScale(wu(diameterMeters), wu(heightMeters), wu(diameterMeters));
  root.addChild(entity);
  return entity;
}

function buildProceduralControl(root) {
  const dark = surface("#505b5b");
  const wood = surface("#8d6848");
  cylinder(root, "ControlInnerCan", 0.52, 0.72, 0.39, dark);
  cylinder(root, "ControlBaseRing", 0.62, 0.07, 0.035, dark);
  cylinder(root, "ControlTopRing", 0.62, 0.08, 0.78, dark);
  cylinder(root, "ControlTopCap", 0.54, 0.035, 0.835, dark);
  for (let index = 0; index < 8; index++) {
    const angle = Math.PI * 2 * index / 8;
    const radius = wu(0.285);
    box(
      root,
      `ControlWoodSlat_${String(index + 1).padStart(2, "0")}`,
      [Math.cos(angle) * radius, wu(0.41), Math.sin(angle) * radius],
      [wu(0.095), wu(0.60), wu(0.035)],
      wood,
      -angle * 180 / Math.PI
    );
  }
  return root;
}

function renderStats(entity) {
  const materials = new Set();
  let renderComponents = 0, meshInstances = 0, triangles = 0;
  for (const render of entity.findComponents("render")) {
    renderComponents++;
    for (const instance of render.meshInstances ?? []) {
      meshInstances++;
      if (instance.material?.name) materials.add(instance.material.name);
      const indices = [];
      try {
        instance.mesh?.getIndices(indices);
        triangles += Math.floor(indices.length / 3);
      } catch {}
    }
  }
  return Object.freeze({
    renderComponents,
    meshInstances,
    triangles,
    materials: Object.freeze([...materials].sort())
  });
}

export async function createHiggsfieldTrashRuntimePoc({ app, campusRoot, player }) {
  if (!app || !campusRoot || !player) throw new TypeError("app, campusRoot and player are required");

  const root = new pc.Entity("HiggsfieldTrashRuntimePOC");
  const origin = player.getLocalPosition();
  root.setLocalPosition(origin.x, origin.y - PLAYER_ORIGIN_Y, origin.z + 3);
  campusRoot.addChild(root);

  const generatedSlot = new pc.Entity("HiggsfieldTrashGeneratedSlot");
  generatedSlot.setLocalPosition(-0.65, 0, 0);
  root.addChild(generatedSlot);

  const controlSlot = new pc.Entity("HiggsfieldTrashControlSlot");
  controlSlot.setLocalPosition(0.65, 0, 0);
  root.addChild(controlSlot);
  buildProceduralControl(controlSlot);

  const context = createPlayCanvasRuntimeContext({ app, parent: generatedSlot });
  const startedAt = performance.now();
  const asset = await context.loadAsset(HIGGSFIELD_TRASH_POC.assetUri);
  const generated = context.createRenderable(asset, {
    visible: true,
    castShadow: true,
    receiveShadow: true
  });
  generated.name = "HiggsfieldTrashGeneratedGLB";
  const assetScale = 1 / METERS_PER_WORLD_UNIT;
  generated.setLocalScale(assetScale, assetScale, assetScale);
  generatedSlot.addChild(generated);

  const state = {
    ready: true,
    loadMs: performance.now() - startedAt,
    mode: "both",
    generated: renderStats(generated),
    control: renderStats(controlSlot)
  };

  const setMode = mode => {
    if (!["both", "generated", "control"].includes(mode)) throw new TypeError(`Unknown POC mode: ${mode}`);
    generatedSlot.enabled = mode !== "control";
    controlSlot.enabled = mode !== "generated";
    state.mode = mode;
    return mode;
  };

  return Object.freeze({
    root,
    generatedSlot,
    controlSlot,
    setMode,
    status: () => Object.freeze({
      ready: state.ready,
      mode: state.mode,
      loadMs: state.loadMs,
      provenance: HIGGSFIELD_TRASH_POC,
      generated: state.generated,
      control: state.control
    }),
    destroy: () => {
      context.dispose();
      root.destroy();
      state.ready = false;
    }
  });
}
