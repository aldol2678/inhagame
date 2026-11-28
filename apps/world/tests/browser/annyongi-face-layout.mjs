// The flight model uses vertex colors to draw several features in a single
// mesh. The material-based model stores each contour in a separate node.
const materialLines = [
  'Forelock curled contour', 'Nose lobe contour -1', 'Nose lobe contour 1',
  'Open smile outer contour', 'Smile upper lip -1', 'Smile upper lip 1'
];
const surface = node => ({ name: node, node });
export const MATERIAL_FACE = {
  lines: materialLines.map((name, i) => ({ ...surface(name), group: i === 0 ? 'forelock' : 'mouth' })),
  surfaces: ['Open smile berry inside', 'Lower tongue', 'Rosy cheek -1', 'Rosy cheek 1', 'Tiny fang -1', 'Tiny fang 1'].map(surface),
  eyes: ['Dot eye -1', 'Dot eye 1']
};

// build-annyongi.py stores the authored sRGB swatches as linear FLOAT COLOR_0.
export const VERTEX_FACE = {
  lines: [
    // Pale blue ink on blue skin must remain visible and retain its lighter tone.
    { name: 'Forelock curl', node: 'Forelock', swatch: '9fc7dc', group: 'forelock',
      pixelRatioLimit: .97, medianRange: [.65, .94] },
    { name: 'Nose', node: 'Nose', swatch: '211f1f', group: 'mouth' },
    { name: 'Mouth outline', node: 'Mouth', swatch: '211f1f', group: 'mouth' }
  ],
  surfaces: [
    { name: 'Mouth fill', node: 'Mouth', swatch: 'bf6280' },
    ...['Tongue', 'Cheek_L', 'Cheek_R', 'Fang_L', 'Fang_R'].map(surface)
  ],
  eyes: ['Eye_L', 'Eye_R']
};

export function faceLayout(hasNode) {
  if (hasNode('Forelock curled contour')) return MATERIAL_FACE;
  if (hasNode('Forelock')) return VERTEX_FACE;
  throw Error('Unable to identify the authored facial layout: missing forelock');
}

export function linearSwatch(hex) {
  return hex.match(/../g).map(pair => {
    const srgb = parseInt(pair, 16) / 255;
    return srgb <= .04045 ? srgb / 12.92 : ((srgb + .055) / 1.055) ** 2.4;
  });
}

export function matchesSwatch(colors, offset, swatch) {
  return swatch.every((channel, i) => Math.abs(colors[offset + i] - channel) < 1e-5);
}
