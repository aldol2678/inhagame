import * as pc from 'playcanvas';
import {
  SKY_CLOUD_PATCH_BUDGET,
  SKY_SUN_DIAMETER,
  SKY_SUN_DISTANCE,
  cloudVisualProfile,
  skyCloudLayout,
  sunDirectionFromEuler,
  sunVisualProfile,
  writeSunDirection
} from './sky-visual-policy.js';

function createCloudTexture(device) {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  const lobes = [
    [-0.28, 0.02, 0.28],
    [-0.05, -0.10, 0.36],
    [0.22, 0.03, 0.30],
    [0.02, 0.18, 0.26],
    [0.36, -0.10, 0.20]
  ];

  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size * 2 - 1;
    const v = (y + 0.5) / size * 2 - 1;
    let density = 0;
    for (const [cx, cy, sigma] of lobes) {
      const dx = u - cx, dy = v - cy;
      density = Math.max(density, Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)));
    }
    const edge = Math.max(0, 1 - Math.pow(Math.hypot(u * 0.86, v), 3.2));
    const alpha = Math.min(1, Math.max(0, (density - 0.10) * 1.22 * edge));
    const value = Math.round(alpha * 255);
    const i = (y * size + x) * 4;
    pixels[i] = value;
    pixels[i + 1] = value;
    pixels[i + 2] = value;
    pixels[i + 3] = value;
  }

  return new pc.Texture(device, {
    name: 'environment-cloud-mask',
    width: size,
    height: size,
    format: pc.PIXELFORMAT_RGBA8,
    levels: [pixels],
    mipmaps: false,
    minFilter: pc.FILTER_LINEAR,
    magFilter: pc.FILTER_LINEAR
  });
}

function createCloudMaterial(texture) {
  const material = new pc.StandardMaterial();
  material.name = 'environment-clouds';
  material.diffuse = new pc.Color(1, 1, 1);
  material.emissive = new pc.Color(1, 1, 1);
  material.emissiveMap = texture;
  material.opacityMap = texture;
  material.opacityMapChannel = 'a';
  material.opacity = 0.34;
  material.emissiveIntensity = 0.82;
  material.useLighting = false;
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.update();
  return material;
}

function createCloudMesh(device, tier) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (const patch of skyCloudLayout(tier)) {
    const yaw = patch.yaw * Math.PI / 180;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const hx = patch.width / 2, hz = patch.depth / 2;
    const corners = [
      [-hx, -hz, 0, 0],
      [ hx, -hz, 1, 0],
      [ hx,  hz, 1, 1],
      [-hx,  hz, 0, 1]
    ];
    const base = positions.length / 3;
    for (const [lx, lz, u, v] of corners) {
      positions.push(
        patch.x + lx * c + lz * s,
        patch.y,
        patch.z - lx * s + lz * c
      );
      normals.push(0, -1, 0);
      uvs.push(u, v);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  return pc.createMesh(device, positions, { normals, uvs, indices });
}

function createCloudTier(root, device, tier, material) {
  const mesh = createCloudMesh(device, tier);
  const entity = new pc.Entity(`environment_clouds_${tier}`);
  entity.addComponent('render', {
    type: 'asset',
    castShadows: false,
    receiveShadows: false,
    meshInstances: [new pc.MeshInstance(mesh, material)]
  });
  entity.enabled = false;
  root.addChild(entity);
  entity.on('destroy', () => mesh.destroy());
  return entity;
}

function createSun(root) {
  const material = new pc.StandardMaterial();
  material.name = 'environment-sun-disc';
  material.diffuse = new pc.Color(1, 0.94, 0.81);
  material.emissive = new pc.Color(1, 0.94, 0.81);
  material.emissiveIntensity = 2.2;
  material.opacity = 1;
  material.useLighting = false;
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.update();

  const entity = new pc.Entity('EnvironmentSunDisc');
  entity.addComponent('render', {
    type: 'sphere',
    castShadows: false,
    receiveShadows: false
  });
  entity.render.material = material;
  entity.setLocalScale(SKY_SUN_DIAMETER, SKY_SUN_DIAMETER, SKY_SUN_DIAMETER);
  root.addChild(entity);
  return { entity, material };
}

export function createSkyVisuals({
  app,
  camera,
  copyEnvironmentSkyState,
  getGraphicsTier
}) {
  const device = app.graphicsDevice;
  const root = new pc.Entity('EnvironmentSkyVisuals');
  app.root.addChild(root);

  const cloudRoot = new pc.Entity('EnvironmentCloudField');
  root.addChild(cloudRoot);
  const cloudTexture = createCloudTexture(device);
  const cloudMaterial = createCloudMaterial(cloudTexture);
  const cloudTiers = Object.fromEntries(
    Object.keys(SKY_CLOUD_PATCH_BUDGET).map(tier => [
      tier,
      createCloudTier(cloudRoot, device, tier, cloudMaterial)
    ])
  );

  const sun = createSun(root);
  const skyState = {
    sunColor: [1, 0.94, 0.81],
    sunEuler: [55, 30, 0],
    sunIntensity: 1.15,
    artificialLightFactor: 0,
    rainIntensity: 0,
    cloudCover: 0.24,
    sunLightScale: 1
  };

  let tier = null;
  let cloudProfile = cloudVisualProfile(skyState);
  let sunProfile = sunVisualProfile(skyState);
  let cloudPhase = 0;
  let destroyed = false;
  const sunDirection = [0, 0, -1];
  const lastMaterialSignal = {
    sunColor: [Number.NaN, Number.NaN, Number.NaN],
    sunIntensity: Number.NaN,
    artificialLightFactor: Number.NaN,
    rainIntensity: Number.NaN,
    cloudCover: Number.NaN,
    sunLightScale: Number.NaN
  };

  function applyTier(next) {
    const resolved = Object.hasOwn(SKY_CLOUD_PATCH_BUDGET, next) ? next : 'medium';
    if (tier === resolved) return;
    tier = resolved;
    for (const [name, entity] of Object.entries(cloudTiers)) entity.enabled = name === tier;
  }

  function applyMaterials() {
    const colorChanged = skyState.sunColor.some((value, index) =>
      Math.abs(value - lastMaterialSignal.sunColor[index]) >= 0.002
    );
    const scalarChanged =
      Math.abs(skyState.sunIntensity - lastMaterialSignal.sunIntensity) >= 0.002 ||
      Math.abs(skyState.artificialLightFactor - lastMaterialSignal.artificialLightFactor) >= 0.002 ||
      Math.abs(skyState.rainIntensity - lastMaterialSignal.rainIntensity) >= 0.002 ||
      Math.abs(skyState.cloudCover - lastMaterialSignal.cloudCover) >= 0.002 ||
      Math.abs(skyState.sunLightScale - lastMaterialSignal.sunLightScale) >= 0.002;
    if (!colorChanged && !scalarChanged) return;

    sunProfile = sunVisualProfile(skyState);
    sun.entity.enabled = sunProfile.visible;
    sun.material.opacity = sunProfile.opacity;
    sun.material.diffuse.set(...sunProfile.color);
    sun.material.emissive.set(...sunProfile.color);
    sun.material.emissiveIntensity = sunProfile.emissiveIntensity;
    sun.material.update();

    cloudProfile = cloudVisualProfile(skyState);
    cloudMaterial.opacity = cloudProfile.opacity;
    cloudMaterial.emissive.set(...cloudProfile.color);
    cloudMaterial.diffuse.set(...cloudProfile.color);
    cloudMaterial.emissiveIntensity = cloudProfile.emissiveIntensity;
    cloudMaterial.update();

    lastMaterialSignal.sunColor[0] = skyState.sunColor[0];
    lastMaterialSignal.sunColor[1] = skyState.sunColor[1];
    lastMaterialSignal.sunColor[2] = skyState.sunColor[2];
    lastMaterialSignal.sunIntensity = skyState.sunIntensity;
    lastMaterialSignal.artificialLightFactor = skyState.artificialLightFactor;
    lastMaterialSignal.rainIntensity = skyState.rainIntensity;
    lastMaterialSignal.cloudCover = skyState.cloudCover;
    lastMaterialSignal.sunLightScale = skyState.sunLightScale;
  }

  function update(dt) {
    if (destroyed) return;
    copyEnvironmentSkyState?.(skyState);
    applyTier(getGraphicsTier?.() ?? 'medium');
    applyMaterials();

    const cameraPosition = camera.getPosition();
    writeSunDirection(sunDirection, skyState.sunEuler);
    sun.entity.setPosition(
      cameraPosition.x + sunDirection[0] * SKY_SUN_DISTANCE,
      cameraPosition.y + sunDirection[1] * SKY_SUN_DISTANCE,
      cameraPosition.z + sunDirection[2] * SKY_SUN_DISTANCE
    );

    const safeDt = Math.max(0, Number.isFinite(dt) ? dt : 0);
    cloudPhase = (cloudPhase + safeDt * 0.55) % 360;
    cloudRoot.setPosition(cameraPosition.x, 0, cameraPosition.z);
    cloudRoot.setLocalEulerAngles(0, cloudPhase, 0);
  }

  function status() {
    const currentTier = tier ?? (getGraphicsTier?.() ?? 'medium');
    const direction = sunDirectionFromEuler(skyState.sunEuler);
    return Object.freeze({
      graphicsTier: currentTier,
      cloudPatchCount: SKY_CLOUD_PATCH_BUDGET[currentTier] ?? SKY_CLOUD_PATCH_BUDGET.medium,
      cloudDrawMeshes: 1,
      cloudOpacity: cloudProfile.opacity,
      cloudCover: skyState.cloudCover,
      cloudColor: Object.freeze([...cloudProfile.color]),
      sunVisible: sunProfile.visible,
      sunOpacity: sunProfile.opacity,
      sunLightScale: skyState.sunLightScale,
      sunColor: Object.freeze([...sunProfile.color]),
      sunDirection: direction,
      sunDrawMeshes: sunProfile.visible ? 1 : 0
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    root.destroy();
    cloudTexture.destroy();
    cloudMaterial.destroy();
    sun.material.destroy();
  }

  return Object.freeze({ update, status, destroy });
}
