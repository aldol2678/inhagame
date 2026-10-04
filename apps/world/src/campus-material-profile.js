const PROFILE = Object.freeze({
  neutral: Object.freeze({ specular: [0.16, 0.17, 0.18], gloss: 0.24, reflectivity: 0 }),
  ground: Object.freeze({ specular: [0.06, 0.075, 0.055], gloss: 0.10, reflectivity: 0 }),
  asphalt: Object.freeze({ specular: [0.055, 0.06, 0.065], gloss: 0.08, reflectivity: 0 }),
  concrete: Object.freeze({ specular: [0.16, 0.16, 0.15], gloss: 0.20, reflectivity: 0.02 }),
  brick: Object.freeze({ specular: [0.11, 0.075, 0.055], gloss: 0.14, reflectivity: 0 }),
  paint: Object.freeze({ specular: [0.28, 0.29, 0.27], gloss: 0.40, reflectivity: 0.04 }),
  metal: Object.freeze({ specular: [0.46, 0.49, 0.52], gloss: 0.68, reflectivity: 0.18 }),
  glass: Object.freeze({ specular: [0.62, 0.72, 0.80], gloss: 0.86, reflectivity: 0.34 }),
  wood: Object.freeze({ specular: [0.12, 0.085, 0.055], gloss: 0.18, reflectivity: 0 }),
  foliage: Object.freeze({ specular: [0.055, 0.08, 0.045], gloss: 0.09, reflectivity: 0 }),
  rubber: Object.freeze({ specular: [0.035, 0.04, 0.04], gloss: 0.055, reflectivity: 0 })
});

export const CAMPUS_MATERIAL_PROFILES = PROFILE;

const PALETTE = Object.freeze({
  ground: new Set(['#8b9274', '#729451', '#607c48']),
  asphalt: new Set(['#747d7b', '#737b79', '#92968e']),
  concrete: new Set([
    '#b4b4a8', '#c1bfb1', '#b6b2a0', '#c9c8ba', '#c8c7b4',
    '#d5d2c6', '#d7d3c7', '#ece9df', '#eeece2', '#b5b4a5'
  ]),
  brick: new Set(['#ac7965', '#ad7465', '#bc9571']),
  paint: new Set([
    '#e6e4d3', '#d8b453', '#d0b04e', '#c2aa63', '#e0c982',
    '#528b78', '#c7b29a', '#e8e3cf', '#dedcd1'
  ]),
  metal: new Set([
    '#e1e3df', '#e8e8df', '#858b86', '#a6aaa0', '#93998f',
    '#90958d', '#727e7c', '#687472', '#536b7a', '#505b5b'
  ]),
  glass: new Set([
    '#548d99', '#396773', '#304d65', '#486271', '#426574'
  ]),
  wood: new Set([
    '#93765e', '#8d6848', '#9d5944', '#8c4c3f', '#776750',
    '#6c5942', '#685443'
  ]),
  foliage: new Set([
    '#64854a', '#527745', '#527447', '#66866b', '#496443',
    '#65894b', '#5c8144', '#567f48', '#41694b', '#58784a'
  ]),
  rubber: new Set(['#303735', '#2c2d2d', '#1c2d38'])
});

export function normalizeMaterialHex(hex) {
  if (typeof hex !== 'string') return null;
  const value = hex.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(value) ? value : null;
}

export function inferCampusMaterialProfile(hex) {
  const color = normalizeMaterialHex(hex);
  if (!color) return 'neutral';
  for (const [profile, colors] of Object.entries(PALETTE))
    if (colors.has(color)) return profile;
  return 'neutral';
}

export function campusMaterialProfile(name = 'neutral') {
  return PROFILE[name] ?? PROFILE.neutral;
}
