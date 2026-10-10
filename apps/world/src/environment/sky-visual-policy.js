const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const mix = (a, b, t) => a + (b - a) * t;
const mixTuple = (a, b, t) => a.map((value, index) => mix(value, b[index], t));

export const SKY_CLOUD_PATCH_BUDGET = Object.freeze({
  low: 6,
  medium: 10,
  high: 16
});

const cloudLayer = (
  id,
  patchCount,
  altitudeMin,
  altitudeMax,
  radius,
  driftDegPerSec,
  opacityScale,
  followRate,
  sizeScale
) => Object.freeze({
  id,
  patchCount,
  altitudeMin,
  altitudeMax,
  radius,
  driftDegPerSec,
  opacityScale,
  followRate,
  sizeScale
});

export const SKY_CLOUD_LAYER_POLICY = Object.freeze({
  low: Object.freeze([
    cloudLayer('mid', 6, 104, 132, 128, 0.22, 1.00, 1.55, 1.00)
  ]),
  medium: Object.freeze([
    cloudLayer('low', 6, 88, 112, 132, 0.50, 1.00, 1.05, 1.10),
    cloudLayer('high', 4, 134, 162, 172, 0.18, 0.72, 2.60, 0.86)
  ]),
  high: Object.freeze([
    cloudLayer('low', 7, 84, 108, 138, 0.62, 1.00, 0.90, 1.16),
    cloudLayer('mid', 5, 116, 142, 170, 0.34, 0.82, 1.65, 0.98),
    cloudLayer('high', 4, 150, 178, 205, 0.14, 0.60, 3.00, 0.82)
  ])
});

export const SKY_CLOUD_FIELD_RADIUS = Object.freeze({
  low: 128,
  medium: 172,
  high: 205
});

export const SKY_CLOUD_ALTITUDE = Object.freeze({
  min: 84,
  max: 178
});

export const SKY_SUN_DISTANCE = 480;
export const SKY_SUN_DIAMETER = 28;
export const SKY_MOON_DISTANCE = 470;
export const SKY_MOON_DIAMETER = 20;

export function skyCloudPatchBudget(tier) {
  return Object.hasOwn(SKY_CLOUD_PATCH_BUDGET, tier)
    ? SKY_CLOUD_PATCH_BUDGET[tier]
    : SKY_CLOUD_PATCH_BUDGET.medium;
}

export function skyCloudFieldRadius(tier) {
  return Object.hasOwn(SKY_CLOUD_FIELD_RADIUS, tier)
    ? SKY_CLOUD_FIELD_RADIUS[tier]
    : SKY_CLOUD_FIELD_RADIUS.medium;
}

export function skyCloudLayerPolicy(tier) {
  return Object.hasOwn(SKY_CLOUD_LAYER_POLICY, tier)
    ? SKY_CLOUD_LAYER_POLICY[tier]
    : SKY_CLOUD_LAYER_POLICY.medium;
}

export function skyCloudLayerCount(tier) {
  return skyCloudLayerPolicy(tier).length;
}

function unit(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function skyCloudLayerLayout(tier, layerIndex) {
  const policy = skyCloudLayerPolicy(tier);
  const layer = policy[Math.max(0, Math.min(policy.length - 1, Math.floor(layerIndex) || 0))];
  const seedOffset = (Math.max(0, Math.floor(layerIndex) || 0) + 1) * 1009;

  return Array.from({ length: layer.patchCount }, (_, i) => {
    const angle = unit(seedOffset + i + 11) * Math.PI * 2;
    const r = (0.30 + 0.70 * Math.sqrt(unit(seedOffset + i + 101))) * layer.radius;
    return Object.freeze({
      x: Math.cos(angle) * r,
      z: Math.sin(angle) * r,
      y: mix(layer.altitudeMin, layer.altitudeMax, unit(seedOffset + i + 211)),
      width: (28 + unit(seedOffset + i + 307) * 36) * layer.sizeScale,
      depth: (16 + unit(seedOffset + i + 401) * 26) * layer.sizeScale,
      yaw: unit(seedOffset + i + 503) * 180
    });
  });
}

export function skyCloudLayout(tier) {
  return skyCloudLayerPolicy(tier).flatMap((_, index) => skyCloudLayerLayout(tier, index));
}

export function writeSunSourceDirection(out, lightUp) {
  const x = Number(lightUp?.x ?? lightUp?.[0]) || 0;
  const y = Number(lightUp?.y ?? lightUp?.[1]) || 0;
  const z = Number(lightUp?.z ?? lightUp?.[2]) || 0;
  const length = Math.hypot(x, y, z);
  if (length < 1e-9) {
    out[0] = 0;
    out[1] = 1;
    out[2] = 0;
    return out;
  }
  out[0] = x / length;
  out[1] = y / length;
  out[2] = z / length;
  return out;
}

export function sunSourceDirectionFromLightUp(lightUp) {
  return Object.freeze([...writeSunSourceDirection([0, 1, 0], lightUp)]);
}

export function shadowRayDirectionFromSunSource(sourceDirection) {
  const source = sunSourceDirectionFromLightUp(sourceDirection);
  return Object.freeze([-source[0], -source[1], -source[2]]);
}

export function sunVisualProfile({
  sunColor = [1, 0.94, 0.81],
  sunIntensity = 1,
  artificialLightFactor = 0,
  rainIntensity = 0,
  snowIntensity = 0,
  sunLightScale = 1
} = {}) {
  const night = clamp01(artificialLightFactor);
  const rain = clamp01(rainIntensity);
  const snow = clamp01(snowIntensity);
  const weatherScale = clamp01(sunLightScale);
  const opacity = clamp01((1 - night * 1.08) * weatherScale * (1 - rain * 0.16) * (1 - snow * 0.10));
  const color = sunColor.slice(0, 3).map(clamp01);
  return Object.freeze({
    opacity,
    visible: opacity > 0.015,
    color: Object.freeze(color),
    emissiveIntensity: 1.55 + Math.max(0, Number(sunIntensity) || 0) * 0.72
  });
}

export function moonVisualProfile({
  artificialLightFactor = 0,
  rainIntensity = 0,
  snowIntensity = 0,
  cloudCover = 0.24
} = {}) {
  const night = clamp01((clamp01(artificialLightFactor) - 0.28) / 0.72);
  const rain = clamp01(rainIntensity);
  const snow = clamp01(snowIntensity);
  const cover = clamp01(cloudCover);
  const weatherVisibility = clamp01(
    (1 - cover * 0.76) *
    (1 - rain * 0.58) *
    (1 - snow * 0.42)
  );
  const opacity = clamp01(night * weatherVisibility);
  return Object.freeze({
    opacity,
    visible: opacity > 0.015,
    color: Object.freeze([0.78, 0.84, 0.94]),
    emissiveIntensity: 0.70 + opacity * 0.55
  });
}

export function cloudVisualProfile({
  sunColor = [1, 0.94, 0.81],
  artificialLightFactor = 0,
  rainIntensity = 0,
  snowIntensity = 0,
  cloudCover = 0.24
} = {}) {
  const night = clamp01(artificialLightFactor);
  const rain = clamp01(rainIntensity);
  const snow = clamp01(snowIntensity);
  const cover = clamp01(cloudCover);
  const daylight = 1 - night;

  const clear = [0.93, 0.96, 1.00];
  const overcast = [0.60, 0.66, 0.73];
  const rainy = [0.36, 0.42, 0.50];
  const snowy = [0.76, 0.80, 0.85];
  const nightCloud = [0.08, 0.10, 0.16];

  let color = mixTuple(clear, overcast, cover);
  color = mixTuple(color, rainy, rain);
  color = mixTuple(color, snowy, snow);
  color = mixTuple(color, nightCloud, night);

  const warmStrength = daylight * (1 - rain) * (1 - snow) * (1 - cover * 0.78) * 0.18;
  color = color.map((value, index) =>
    clamp01(mix(value, clamp01(sunColor[index] ?? 1), warmStrength))
  );

  return Object.freeze({
    color: Object.freeze(color),
    opacity: clamp01(0.18 + cover * 0.48 + rain * 0.08 + snow * 0.05 + night * 0.05),
    emissiveIntensity: mix(0.82, 0.26, night)
  });
}
