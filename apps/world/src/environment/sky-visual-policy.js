const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const mix = (a, b, t) => a + (b - a) * t;
const mixTuple = (a, b, t) => a.map((value, index) => mix(value, b[index], t));

export const SKY_CLOUD_PATCH_BUDGET = Object.freeze({
  low: 6,
  medium: 10,
  high: 16
});

export const SKY_CLOUD_FIELD_RADIUS = Object.freeze({
  low: 120,
  medium: 150,
  high: 180
});

export const SKY_CLOUD_ALTITUDE = Object.freeze({
  min: 92,
  max: 148
});

export const SKY_SUN_DISTANCE = 480;
export const SKY_SUN_DIAMETER = 28;

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

function unit(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function skyCloudLayout(tier) {
  const count = skyCloudPatchBudget(tier);
  const radius = skyCloudFieldRadius(tier);
  return Array.from({ length: count }, (_, i) => {
    const angle = unit(i + 11) * Math.PI * 2;
    const r = (0.34 + 0.66 * Math.sqrt(unit(i + 101))) * radius;
    return Object.freeze({
      x: Math.cos(angle) * r,
      z: Math.sin(angle) * r,
      y: mix(SKY_CLOUD_ALTITUDE.min, SKY_CLOUD_ALTITUDE.max, unit(i + 211)),
      width: 28 + unit(i + 307) * 36,
      depth: 16 + unit(i + 401) * 26,
      yaw: unit(i + 503) * 180
    });
  });
}

export function writeSunDirection(out, euler) {
  const pitch = (Number(euler?.[0]) || 0) * Math.PI / 180;
  const yaw = (Number(euler?.[1]) || 0) * Math.PI / 180;
  const cp = Math.cos(pitch);
  const x = Math.sin(yaw) * cp;
  const y = Math.sin(pitch);
  const z = -Math.cos(yaw) * cp;
  const length = Math.hypot(x, y, z) || 1;
  out[0] = x / length;
  out[1] = y / length;
  out[2] = z / length;
  return out;
}

export function sunDirectionFromEuler(euler) {
  return Object.freeze([...writeSunDirection([0, 0, -1], euler)]);
}

export function sunVisualProfile({
  sunColor = [1, 0.94, 0.81],
  sunIntensity = 1,
  artificialLightFactor = 0,
  rainIntensity = 0,
  sunLightScale = 1
} = {}) {
  const night = clamp01(artificialLightFactor);
  const rain = clamp01(rainIntensity);
  const weatherScale = clamp01(sunLightScale);
  const opacity = clamp01((1 - night * 1.08) * weatherScale * (1 - rain * 0.16));
  const color = sunColor.slice(0, 3).map(clamp01);
  return Object.freeze({
    opacity,
    visible: opacity > 0.015,
    color: Object.freeze(color),
    emissiveIntensity: 1.55 + Math.max(0, Number(sunIntensity) || 0) * 0.72
  });
}

export function cloudVisualProfile({
  sunColor = [1, 0.94, 0.81],
  artificialLightFactor = 0,
  rainIntensity = 0,
  cloudCover = 0.24
} = {}) {
  const night = clamp01(artificialLightFactor);
  const rain = clamp01(rainIntensity);
  const cover = clamp01(cloudCover);
  const daylight = 1 - night;

  const clear = [0.93, 0.96, 1.00];
  const overcast = [0.60, 0.66, 0.73];
  const rainy = [0.36, 0.42, 0.50];
  const nightCloud = [0.15, 0.19, 0.27];

  let color = mixTuple(clear, overcast, cover);
  color = mixTuple(color, rainy, rain);
  color = mixTuple(color, nightCloud, night);

  const warmStrength = daylight * (1 - rain) * (1 - cover * 0.78) * 0.18;
  color = color.map((value, index) =>
    clamp01(mix(value, clamp01(sunColor[index] ?? 1), warmStrength))
  );

  return Object.freeze({
    color: Object.freeze(color),
    opacity: clamp01(0.18 + cover * 0.48 + rain * 0.08 + night * 0.05),
    emissiveIntensity: mix(0.82, 0.42, night)
  });
}
