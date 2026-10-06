import * as pc from 'playcanvas';
import {
  SKY_CLOUD_PATCH_BUDGET,
  SKY_SUN_DIAMETER,
  SKY_SUN_DISTANCE,
  cloudVisualProfile,
  skyCloudLayerLayout,
  skyCloudLayerPolicy,
  shadowRayDirectionFromSunSource,
  sunVisualProfile,
  writeSunSourceDirection
} from './sky-visual-policy.js';
import {
  ATMOSPHERE_DOME_RADIUS,
  ATMOSPHERE_ELEVATIONS,
  ATMOSPHERE_SEGMENTS,
  ATMOSPHERE_SUN_GLOW_SIZE,
  atmosphereSkyProfile,
  writeAtmosphereColor
} from './atmospheric-sky-policy.js';
import {
  NIGHT_STAR_BUDGET,
  NIGHT_STAR_RADIUS,
  nightStarLayout,
  nightStarVisibility
} from './night-star-policy.js';

const ATMOSPHERE_GRADIENT_TEXTURE_HEIGHT = 64;

function writeAtmosphereGradientTexture(texture, profile) {
  const pixels = texture.lock();
  const color = [0, 0, 0, 1];
  const minElevation = ATMOSPHERE_ELEVATIONS[0];
  const maxElevation = 90;

  for (let y = 0; y < ATMOSPHERE_GRADIENT_TEXTURE_HEIGHT; y++) {
    const t = y / (ATMOSPHERE_GRADIENT_TEXTURE_HEIGHT - 1);
    const elevation = minElevation + (maxElevation - minElevation) * t;
    writeAtmosphereColor(color, 0, profile, elevation);
    const offset = y * 4;
    pixels[offset] = Math.round(color[0] * 255);
    pixels[offset + 1] = Math.round(color[1] * 255);
    pixels[offset + 2] = Math.round(color[2] * 255);
    pixels[offset + 3] = 255;
  }

  texture.unlock();
}

function createAtmosphereGradientTexture(device, profile) {
  const texture = new pc.Texture(device, {
    name: 'environment-atmosphere-gradient',
    width: 1,
    height: ATMOSPHERE_GRADIENT_TEXTURE_HEIGHT,
    format: pc.PIXELFORMAT_RGBA8,
    mipmaps: false,
    minFilter: pc.FILTER_LINEAR,
    magFilter: pc.FILTER_LINEAR
  });
  texture.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
  texture.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
  writeAtmosphereGradientTexture(texture, profile);
  return texture;
}

function createAtmosphereMaterial(texture) {
  const material = new pc.StandardMaterial();
  material.name = 'environment-atmosphere-dome';
  material.diffuse = new pc.Color(0, 0, 0);
  material.emissive = new pc.Color(1, 1, 1);
  material.emissiveMap = texture;
  material.emissiveMapChannel = 'rgb';
  material.useLighting = false;
  material.useFog = false;
  material.useTonemap = false;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.update();
  return material;
}

function updateAtmosphereGradient(atmosphere, profile) {
  writeAtmosphereGradientTexture(atmosphere.texture, profile);
  atmosphere.profile = profile;
}

function createAtmosphereDome(root, device, profile) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const elevations = [];

  for (const elevation of ATMOSPHERE_ELEVATIONS) {
    const radians = elevation * Math.PI / 180;
    const y = Math.sin(radians) * ATMOSPHERE_DOME_RADIUS;
    const radius = Math.cos(radians) * ATMOSPHERE_DOME_RADIUS;
    for (let segment = 0; segment < ATMOSPHERE_SEGMENTS; segment++) {
      const angle = segment / ATMOSPHERE_SEGMENTS * Math.PI * 2;
      positions.push(
        Math.sin(angle) * radius,
        y,
        Math.cos(angle) * radius
      );
      uvs.push(0.5, (elevation - ATMOSPHERE_ELEVATIONS[0]) / (90 - ATMOSPHERE_ELEVATIONS[0]));
      elevations.push(elevation);
    }
  }

  for (let ring = 0; ring < ATMOSPHERE_ELEVATIONS.length - 1; ring++) {
    const row = ring * ATMOSPHERE_SEGMENTS;
    const next = (ring + 1) * ATMOSPHERE_SEGMENTS;
    for (let segment = 0; segment < ATMOSPHERE_SEGMENTS; segment++) {
      const a = row + segment;
      const b = row + (segment + 1) % ATMOSPHERE_SEGMENTS;
      const c = next + segment;
      const d = next + (segment + 1) % ATMOSPHERE_SEGMENTS;
      indices.push(a, c, b, b, c, d);
    }
  }

  const top = positions.length / 3;
  positions.push(0, ATMOSPHERE_DOME_RADIUS, 0);
  uvs.push(0.5, 1);
  elevations.push(90);
  const finalRing = (ATMOSPHERE_ELEVATIONS.length - 1) * ATMOSPHERE_SEGMENTS;
  for (let segment = 0; segment < ATMOSPHERE_SEGMENTS; segment++) {
    const a = finalRing + segment;
    const b = finalRing + (segment + 1) % ATMOSPHERE_SEGMENTS;
    indices.push(a, top, b);
  }

  const texture = createAtmosphereGradientTexture(device, profile);
  const mesh = pc.createMesh(device, positions, { uvs, indices });
  const material = createAtmosphereMaterial(texture);
  const entity = new pc.Entity('EnvironmentAtmosphereDome');
  entity.addComponent('render', {
    type: 'asset',
    castShadows: false,
    receiveShadows: false,
    meshInstances: [new pc.MeshInstance(mesh, material)]
  });
  root.addChild(entity);
  entity.on('destroy', () => mesh.destroy());

  return {
    entity,
    mesh,
    material,
    texture,
    elevations,
    profile
  };
}

function createSunGlowTexture(device) {
  const size = 32;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = ((x + 0.5) / size) * 2 - 1;
    const v = ((y + 0.5) / size) * 2 - 1;
    const radius = Math.hypot(u, v);
    const alpha = Math.pow(Math.max(0, 1 - radius), 2.2);
    const i = (y * size + x) * 4;
    pixels[i] = 255;
    pixels[i + 1] = 255;
    pixels[i + 2] = 255;
    pixels[i + 3] = Math.round(alpha * 255);
  }

  return new pc.Texture(device, {
    name: 'environment-sun-glow-mask',
    width: size,
    height: size,
    format: pc.PIXELFORMAT_RGBA8,
    levels: [pixels],
    mipmaps: false,
    minFilter: pc.FILTER_LINEAR,
    magFilter: pc.FILTER_LINEAR
  });
}

function createSunGlow(root, device) {
  const texture = createSunGlowTexture(device);
  const material = new pc.StandardMaterial();
  material.name = 'environment-sun-glow';
  material.diffuse = new pc.Color(0, 0, 0);
  material.emissive = new pc.Color(1, 0.90, 0.70);
  material.emissiveMap = texture;
  material.opacityMap = texture;
  material.opacityMapChannel = 'a';
  material.opacity = 0;
  material.emissiveIntensity = 1.35;
  material.useLighting = false;
  material.useFog = false;
  material.useTonemap = false;
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.update();

  const positions = [-0.5,-0.5,0, 0.5,-0.5,0, 0.5,0.5,0, -0.5,0.5,0];
  const uvs = [0,0, 1,0, 1,1, 0,1];
  const indices = [0,1,2, 0,2,3];
  const mesh = pc.createMesh(device, positions, { uvs, indices });

  const entity = new pc.Entity('EnvironmentSunGlow');
  entity.addComponent('render', {
    type: 'asset',
    castShadows: false,
    receiveShadows: false,
    meshInstances: [new pc.MeshInstance(mesh, material)]
  });
  entity.setLocalScale(ATMOSPHERE_SUN_GLOW_SIZE, ATMOSPHERE_SUN_GLOW_SIZE, 1);
  entity.enabled = false;
  root.addChild(entity);
  entity.on('destroy', () => mesh.destroy());

  return { entity, material, texture };
}

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

function createCloudMaterial(texture, tier, layerPolicy) {
  const material = new pc.StandardMaterial();
  material.name = `environment-clouds-${tier}-${layerPolicy.id}`;
  material.diffuse = new pc.Color(1, 1, 1);
  material.emissive = new pc.Color(1, 1, 1);
  material.emissiveMap = texture;
  material.opacityMap = texture;
  material.opacityMapChannel = 'a';
  material.opacity = 0.34 * layerPolicy.opacityScale;
  material.emissiveIntensity = 0.82;
  material.useLighting = false;
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.update();
  return material;
}

function createCloudMesh(device, tier, layerIndex) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (const patch of skyCloudLayerLayout(tier, layerIndex)) {
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

function createCloudLayer(parent, device, texture, tier, layerIndex, layerPolicy) {
  const material = createCloudMaterial(texture, tier, layerPolicy);
  const mesh = createCloudMesh(device, tier, layerIndex);
  const entity = new pc.Entity(`environment_clouds_${tier}_${layerPolicy.id}`);
  entity.addComponent('render', {
    type: 'asset',
    castShadows: false,
    receiveShadows: false,
    meshInstances: [new pc.MeshInstance(mesh, material)]
  });
  parent.addChild(entity);
  entity.on('destroy', () => mesh.destroy());
  return {
    entity,
    material,
    policy: layerPolicy,
    anchorX: 0,
    anchorZ: 0,
    phase: layerIndex * 37,
    initialized: false
  };
}

function createCloudTier(root, device, texture, tier) {
  const entity = new pc.Entity(`environment_cloud_tier_${tier}`);
  entity.enabled = false;
  root.addChild(entity);
  const layers = skyCloudLayerPolicy(tier).map((policy, index) =>
    createCloudLayer(entity, device, texture, tier, index, policy)
  );
  return { entity, layers };
}

function createStarMaterial() {
  const material = new pc.StandardMaterial();
  material.name = 'environment-night-stars';
  material.diffuse = new pc.Color(0, 0, 0);
  material.emissive = new pc.Color(0.86, 0.92, 1.00);
  material.emissiveIntensity = 1.5;
  material.opacity = 0;
  material.useLighting = false;
  material.useFog = false;
  material.useTonemap = false;
  material.blendType = pc.BLEND_ADDITIVE;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.update();
  return material;
}

function normalizedCross(ax, ay, az, bx, by, bz) {
  const x = ay * bz - az * by;
  const y = az * bx - ax * bz;
  const z = ax * by - ay * bx;
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function createStarMesh(device, tier) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (const star of nightStarLayout(tier)) {
    const dx = star.x, dy = star.y, dz = star.z;
    const helper = dy > 0.92 ? [1, 0, 0] : [0, 1, 0];
    const tangent = normalizedCross(helper[0], helper[1], helper[2], dx, dy, dz);
    const bitangent = normalizedCross(dx, dy, dz, tangent[0], tangent[1], tangent[2]);
    const cx = dx * NIGHT_STAR_RADIUS;
    const cy = dy * NIGHT_STAR_RADIUS;
    const cz = dz * NIGHT_STAR_RADIUS;
    const size = star.size;
    const corners = [
      [-1, -1],
      [ 1, -1],
      [ 1,  1],
      [-1,  1]
    ];
    const base = positions.length / 3;
    for (const [u, v] of corners) {
      positions.push(
        cx + tangent[0] * size * u + bitangent[0] * size * v,
        cy + tangent[1] * size * u + bitangent[1] * size * v,
        cz + tangent[2] * size * u + bitangent[2] * size * v
      );
      normals.push(-dx, -dy, -dz);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return pc.createMesh(device, positions, { normals, indices });
}

function createStarField(root, device) {
  const entity = new pc.Entity('EnvironmentNightStars');
  root.addChild(entity);
  const material = createStarMaterial();
  const tiers = Object.fromEntries(Object.keys(NIGHT_STAR_BUDGET).map(tier => {
    const mesh = createStarMesh(device, tier);
    const tierEntity = new pc.Entity(`environment_night_stars_${tier}`);
    tierEntity.addComponent('render', {
      type: 'asset',
      castShadows: false,
      receiveShadows: false,
      meshInstances: [new pc.MeshInstance(mesh, material)]
    });
    tierEntity.enabled = false;
    entity.addChild(tierEntity);
    tierEntity.on('destroy', () => mesh.destroy());
    return [tier, { entity: tierEntity, count: NIGHT_STAR_BUDGET[tier] }];
  }));
  return { entity, material, tiers };
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
  lightEntity,
  copyEnvironmentSkyState,
  getGraphicsTier
}) {
  const device = app.graphicsDevice;
  const root = new pc.Entity('EnvironmentSkyVisuals');
  app.root.addChild(root);

  const skyState = {
    sunColor: [1, 0.94, 0.81],
    sunEuler: [55, 30, 0],
    sunIntensity: 1.15,
    artificialLightFactor: 0,
    rainIntensity: 0,
    snowIntensity: 0,
    cloudCover: 0.24,
    sunLightScale: 1
  };

  let atmosphereProfile = atmosphereSkyProfile(skyState);
  const atmosphere = createAtmosphereDome(root, device, atmosphereProfile);

  const cloudTexture = createCloudTexture(device);
  const cloudTiers = Object.fromEntries(
    Object.keys(SKY_CLOUD_PATCH_BUDGET).map(tier => [
      tier,
      createCloudTier(root, device, cloudTexture, tier)
    ])
  );

  // Add the soft halo before the solid sun disc so the core stays crisp.
  const sunGlow = createSunGlow(root, device);
  const sun = createSun(root);
  const stars = createStarField(root, device);

  let tier = null;
  let cloudProfile = cloudVisualProfile(skyState);
  let sunProfile = sunVisualProfile(skyState);
  let starOpacity = nightStarVisibility(skyState);
  let destroyed = false;
  const sunDirection = [0, 0, -1];
  const lastMaterialSignal = {
    sunColor: [Number.NaN, Number.NaN, Number.NaN],
    sunIntensity: Number.NaN,
    artificialLightFactor: Number.NaN,
    rainIntensity: Number.NaN,
    snowIntensity: Number.NaN,
    cloudCover: Number.NaN,
    sunLightScale: Number.NaN
  };

  function applyTier(next) {
    const resolved = Object.hasOwn(SKY_CLOUD_PATCH_BUDGET, next) ? next : 'medium';
    if (tier === resolved) return;
    tier = resolved;
    for (const [name, cloudTier] of Object.entries(cloudTiers))
      cloudTier.entity.enabled = name === tier;
    for (const [name, starTier] of Object.entries(stars.tiers))
      starTier.entity.enabled = name === tier && starOpacity > 0.01;
  }

  function applyMaterials() {
    const colorChanged = skyState.sunColor.some((value, index) =>
      Math.abs(value - lastMaterialSignal.sunColor[index]) >= 0.002
    );
    const scalarChanged =
      Math.abs(skyState.sunIntensity - lastMaterialSignal.sunIntensity) >= 0.002 ||
      Math.abs(skyState.artificialLightFactor - lastMaterialSignal.artificialLightFactor) >= 0.002 ||
      Math.abs(skyState.rainIntensity - lastMaterialSignal.rainIntensity) >= 0.002 ||
      Math.abs(skyState.snowIntensity - lastMaterialSignal.snowIntensity) >= 0.002 ||
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
    for (const cloudTier of Object.values(cloudTiers)) {
      for (const layer of cloudTier.layers) {
        layer.material.opacity = cloudProfile.opacity * layer.policy.opacityScale;
        layer.material.emissive.set(...cloudProfile.color);
        layer.material.diffuse.set(...cloudProfile.color);
        layer.material.emissiveIntensity = cloudProfile.emissiveIntensity;
        layer.material.update();
      }
    }

    atmosphereProfile = atmosphereSkyProfile(skyState);
    updateAtmosphereGradient(atmosphere, atmosphereProfile);

    sunGlow.entity.enabled = sunProfile.visible && atmosphereProfile.sunGlowOpacity > 0.01;
    sunGlow.material.opacity = atmosphereProfile.sunGlowOpacity;
    sunGlow.material.emissive.set(...sunProfile.color);
    sunGlow.material.emissiveIntensity = 1.25 + atmosphereProfile.sunsetFactor * 0.55;
    sunGlow.material.update();

    starOpacity = nightStarVisibility(skyState);
    stars.material.opacity = starOpacity;
    stars.material.emissiveIntensity = 1.30 + starOpacity * 0.90;
    stars.material.update();
    for (const [name, starTier] of Object.entries(stars.tiers))
      starTier.entity.enabled = name === (tier ?? 'medium') && starOpacity > 0.01;

    lastMaterialSignal.sunColor[0] = skyState.sunColor[0];
    lastMaterialSignal.sunColor[1] = skyState.sunColor[1];
    lastMaterialSignal.sunColor[2] = skyState.sunColor[2];
    lastMaterialSignal.sunIntensity = skyState.sunIntensity;
    lastMaterialSignal.artificialLightFactor = skyState.artificialLightFactor;
    lastMaterialSignal.rainIntensity = skyState.rainIntensity;
    lastMaterialSignal.snowIntensity = skyState.snowIntensity;
    lastMaterialSignal.cloudCover = skyState.cloudCover;
    lastMaterialSignal.sunLightScale = skyState.sunLightScale;
  }

  function update(dt) {
    if (destroyed) return;
    copyEnvironmentSkyState?.(skyState);
    applyTier(getGraphicsTier?.() ?? 'medium');
    applyMaterials();

    const cameraPosition = camera.getPosition();
    atmosphere.entity.setPosition(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    stars.entity.setPosition(cameraPosition.x, cameraPosition.y, cameraPosition.z);

    // PlayCanvas directional lights shine along -entity.up. The visible source
    // therefore lives in +entity.up, so reading the real light transform keeps
    // the sun disc, glow and cast-shadow direction locked together.
    writeSunSourceDirection(sunDirection, lightEntity?.up);
    const sunX = cameraPosition.x + sunDirection[0] * SKY_SUN_DISTANCE;
    const sunY = cameraPosition.y + sunDirection[1] * SKY_SUN_DISTANCE;
    const sunZ = cameraPosition.z + sunDirection[2] * SKY_SUN_DISTANCE;
    sun.entity.setPosition(sunX, sunY, sunZ);
    sunGlow.entity.setPosition(sunX, sunY, sunZ);
    sunGlow.entity.setRotation(camera.getRotation());

    const safeDt = Math.max(0, Number.isFinite(dt) ? dt : 0);
    const activeTier = cloudTiers[tier ?? 'medium'];
    for (const layer of activeTier.layers) {
      if (!layer.initialized) {
        layer.anchorX = cameraPosition.x;
        layer.anchorZ = cameraPosition.z;
        layer.initialized = true;
      }

      const follow = 1 - Math.exp(-safeDt * layer.policy.followRate);
      layer.anchorX += (cameraPosition.x - layer.anchorX) * follow;
      layer.anchorZ += (cameraPosition.z - layer.anchorZ) * follow;

      // Keep the batched field surrounding the player during sustained travel
      // while preserving enough horizontal lag to create real motion parallax.
      const lagX = cameraPosition.x - layer.anchorX;
      const lagZ = cameraPosition.z - layer.anchorZ;
      const lag = Math.hypot(lagX, lagZ);
      const maxLag = layer.policy.radius * 0.42;
      if (lag > maxLag) {
        const scale = maxLag / lag;
        layer.anchorX = cameraPosition.x - lagX * scale;
        layer.anchorZ = cameraPosition.z - lagZ * scale;
      }

      layer.phase = (layer.phase + safeDt * layer.policy.driftDegPerSec) % 360;
      layer.entity.setPosition(layer.anchorX, 0, layer.anchorZ);
      layer.entity.setLocalEulerAngles(0, layer.phase, 0);
    }
  }

  function status() {
    const currentTier = tier ?? (getGraphicsTier?.() ?? 'medium');
    const direction = Object.freeze([...sunDirection]);
    const shadowRayDirection = shadowRayDirectionFromSunSource(direction);
    return Object.freeze({
      graphicsTier: currentTier,
      atmosphereDrawMeshes: 1,
      atmosphereVertexCount: atmosphere.elevations.length,
      atmosphereHorizonColor: Object.freeze([...atmosphereProfile.horizonColor]),
      atmosphereZenithColor: Object.freeze([...atmosphereProfile.zenithColor]),
      atmosphereHazeStrength: atmosphereProfile.hazeStrength,
      atmosphereSunsetFactor: atmosphereProfile.sunsetFactor,
      cloudPatchCount: SKY_CLOUD_PATCH_BUDGET[currentTier] ?? SKY_CLOUD_PATCH_BUDGET.medium,
      cloudLayerCount: cloudTiers[currentTier].layers.length,
      cloudDrawMeshes: cloudTiers[currentTier].layers.length,
      cloudLayers: Object.freeze(cloudTiers[currentTier].layers.map(layer => {
        const cameraPosition = camera.getPosition();
        return Object.freeze({
          id: layer.policy.id,
          patchCount: layer.policy.patchCount,
          altitudeMin: layer.policy.altitudeMin,
          altitudeMax: layer.policy.altitudeMax,
          driftDegPerSec: layer.policy.driftDegPerSec,
          opacityScale: layer.policy.opacityScale,
          parallaxLag: Math.hypot(
            cameraPosition.x - layer.anchorX,
            cameraPosition.z - layer.anchorZ
          )
        });
      })),
      cloudOpacity: cloudProfile.opacity,
      cloudCover: skyState.cloudCover,
      snowIntensity: skyState.snowIntensity,
      cloudColor: Object.freeze([...cloudProfile.color]),
      sunVisible: sunProfile.visible,
      sunOpacity: sunProfile.opacity,
      sunLightScale: skyState.sunLightScale,
      sunColor: Object.freeze([...sunProfile.color]),
      sunDirection: direction,
      shadowRayDirection,
      sunShadowAlignmentDot:
        direction[0] * shadowRayDirection[0] +
        direction[1] * shadowRayDirection[1] +
        direction[2] * shadowRayDirection[2],
      sunDrawMeshes: sunProfile.visible ? 1 : 0,
      sunGlowOpacity: atmosphereProfile.sunGlowOpacity,
      sunGlowDrawMeshes: sunGlow.entity.enabled ? 1 : 0,
      starCount: NIGHT_STAR_BUDGET[currentTier] ?? NIGHT_STAR_BUDGET.medium,
      starOpacity,
      starDrawMeshes: starOpacity > 0.01 ? 1 : 0,
      moonVisible: false
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    root.destroy();
    atmosphere.material.destroy();
    atmosphere.texture.destroy();
    for (const cloudTier of Object.values(cloudTiers))
      for (const layer of cloudTier.layers) layer.material.destroy();
    cloudTexture.destroy();
    sunGlow.texture.destroy();
    sunGlow.material.destroy();
    sun.material.destroy();
    stars.material.destroy();
  }

  return Object.freeze({ update, status, destroy });
}
