import * as pc from "playcanvas";
import { buildBuildingMassGeometry } from "../editor/building-mass.js";
import { buildPathRibbonGeometry, samplePathCenterline } from "../editor/path-spline.js";

function material(red, green, blue, opacity = 1) {
  const result = new pc.StandardMaterial();
  result.diffuse = new pc.Color(red, green, blue);
  result.emissive = new pc.Color(red * 0.12, green * 0.12, blue * 0.12);
  if (opacity < 1) {
    result.opacity = opacity;
    result.blendType = pc.BLEND_NORMAL;
    result.depthWrite = false;
  }
  result.update();
  return result;
}

function primitive(name, type, surface) {
  const object = new pc.Entity(name);
  object.addComponent("render", { type });
  object.render.material = surface;
  return object;
}

function hexMaterial(value = "#b8b8ad") {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  const hex = match ? match[1] : "b8b8ad";
  return material(
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255
  );
}

function safeAssetUri(asset, baseUrl) {
  const uri = new URL(asset.uri, baseUrl);
  if (uri.origin !== new URL(baseUrl).origin || !["http:", "https:"].includes(uri.protocol)) {
    throw new Error(`R_ASSET_URI_BLOCKED:${asset.id}`);
  }
  if (asset.type !== "model" || !/\.glb($|\?)/i.test(uri.pathname + uri.search)) {
    throw new Error(`R_ASSET_TYPE_UNSUPPORTED:${asset.id}`);
  }
  return uri.pathname + uri.search;
}

export function createPlayCanvasRuntimeContext({
  app,
  parent = app.root,
  metersPerUnit = 2,
  assetBaseUrl = new URL("/", location.href).href,
  registries = {},
  assetCache = new Map(),
  resolveAssetUri = null,
  assetShadow = null
}) {
  if (!app || !parent) throw new TypeError("PlayCanvas app and parent are required");
  const placeholderMaterial = material(0.95, 0.15, 0.45);
  const pathMaterial = material(0.22, 0.73, 0.9);
  const roadMaterial = material(0.43, 0.49, 0.52);
  const buildingMaterial = material(0.56, 0.69, 0.75);
  return {
    assetCache,
    resolveAssetUri: async asset => {
      if (resolveAssetUri) {
        const custom = await resolveAssetUri(asset);
        if (custom) return custom;
      }
      return safeAssetUri(asset, assetBaseUrl);
    },
    loadAsset: uri => new Promise((resolve, reject) => {
      app.assets.loadFromUrl(uri, "container", (error, asset) => {
        if (error || !asset?.resource) reject(error || new Error(`R_ASSET_EMPTY:${uri}`));
        else {
          void assetShadow?.observeResource?.(uri, asset, { consumer: "runtime-adapter" });
          resolve(asset);
        }
      });
    }),
    createRoot: world => {
      const root = new pc.Entity(`WorldDocument:${world.worldId}`);
      root.setLocalScale(1 / metersPerUnit, 1 / metersPerUnit, 1 / metersPerUnit);
      parent.addChild(root);
      return root;
    },
    createEntity: entity => new pc.Entity(entity.name),
    attach: (parentObject, object) => parentObject.addChild(object),
    setLocalTransform: (object, transform) => {
      object.setLocalPosition(...transform.position);
      object.setLocalRotation(new pc.Quat(...transform.rotation));
      object.setLocalScale(...transform.scale);
    },
    createRenderable: (asset, data) => {
      const visual = asset.resource.instantiateRenderEntity({
        castShadows: data.castShadow !== false,
        receiveShadows: data.receiveShadow !== false
      });
      visual.enabled = data.visible !== false;
      for (const render of visual.findComponents("render")) {
        render.castShadows = data.castShadow !== false;
        render.receiveShadows = data.receiveShadow !== false;
      }
      return visual;
    },
    createPlaceholder: (_binding, data) => {
      const visual = primitive("Missing asset", "box", placeholderMaterial);
      visual.setLocalPosition(0, 1, 0);
      visual.setLocalScale(2, 2, 2);
      visual.enabled = data.visible !== false;
      return visual;
    },
    createBuildingMass: data => {
      const geometry = buildBuildingMassGeometry(data.footprint, data.heightMeters);
      const mesh = pc.createMesh(app.graphicsDevice, geometry.positions, {
        normals: geometry.normals, uvs: geometry.uvs, indices: geometry.indices
      });
      const visual = new pc.Entity("Building mass");
      visual.addComponent("render", { type: "asset", meshInstances: [new pc.MeshInstance(mesh, buildingMaterial)], castShadows: true });
      visual.on("destroy", () => mesh.destroy());
      return { visual };
    },
    createStructure: data => {
      const surface = hexMaterial(data.color);
      const visual = primitive("Structure:box", "box", surface);
      visual.setLocalScale(...data.sizeMeters);
      visual.on("destroy", () => surface.destroy());
      return visual;
    },
    createPath: data => {
      const path = new pc.Entity(`Path:${data.pathType}`);
      if (data.interpolation === "catmull-rom") {
        const centerline = samplePathCenterline(data.points, data.interpolation, data.closed);
        const geometry = buildPathRibbonGeometry(centerline, data.widthMeters, data.closed);
        const mesh = pc.createMesh(app.graphicsDevice, geometry.positions, {
          normals: geometry.normals, uvs: geometry.uvs, indices: geometry.indices
        });
        const surface = data.pathType === "road" ? roadMaterial : pathMaterial;
        const visual = new pc.Entity("Spline surface");
        visual.addComponent("render", { type: "asset", meshInstances: [new pc.MeshInstance(mesh, surface)], castShadows: false });
        visual.on("destroy", () => mesh.destroy());
        path.addChild(visual);
        return path;
      }
      const points = data.closed ? [...data.points, data.points[0]] : data.points;
      for (let index = 1; index < points.length; index++) {
        const from = points[index - 1];
        const to = points[index];
        const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
        const length = Math.hypot(dx, dy, dz);
        if (length < 1e-6) continue;
        const segment = primitive(`Path segment ${index}`, "box", pathMaterial);
        segment.setLocalPosition((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2);
        segment.setLocalEulerAngles(-Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI, Math.atan2(dx, dz) * 180 / Math.PI, 0);
        segment.setLocalScale(data.widthMeters, 0.06, length);
        path.addChild(segment);
      }
      return path;
    },
    registerSpawn: registries.spawns?.register?.bind(registries.spawns),
    registerTrigger: registries.triggers?.register?.bind(registries.triggers),
    registerLocation: registries.locations?.register?.bind(registries.locations),
    destroyRoot: root => root.destroy(),
    dispose: () => { placeholderMaterial.destroy(); pathMaterial.destroy(); roadMaterial.destroy(); buildingMaterial.destroy(); }
  };
}

export function createSceneRegistries() {
  const make = () => {
    const items = new Map();
    return {
      items,
      register(record) {
        items.set(record.entityId, record);
        return () => items.delete(record.entityId);
      },
      get: entityId => items.get(entityId) ?? null
    };
  };
  return { spawns: make(), triggers: make(), locations: make() };
}
