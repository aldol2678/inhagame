// PERSONAL-ROOM-V2 PR A. A room-local, lifecycle-owned material palette.
// All profiles and tiny authored patterns are code-registered; no RPC asset URLs.
// Missing texture/material capabilities retain the flat campus surface fallback.

const profile = (color, gloss = .2, texture = null, extra = {}) => Object.freeze({ color, gloss, texture, ...extra });
export const PERSONAL_ROOM_MATERIAL_PROFILES = Object.freeze({
  wallPaint: profile('#e9e5dd', .13), ceilingPaint: profile('#f4f0e8', .12),
  trimPaint: profile('#d5cec1', .24), oak: profile('#b99061', .27, 'wood'),
  oakDark: profile('#76583d', .22, 'wood'), metal: profile('#555b59', .48),
  curtain: profile('#e7dfcc', .08, 'weave'), curtainHem: profile('#c7bca4', .08, 'weave'),
  windowFrame: profile('#eaece5', .36),
  // A single shallow glass layer; the exterior view behind it stays fully opaque.
  windowGlass: profile('#b4d7dc', .7, null, { opacity: .16, emissive: .03 }),
  exteriorSky: profile('#bedce0', .08, null, { emissive: .45 }),
  exteriorHaze: profile('#e7e7d5', .08, null, { emissive: .35 }),
  exteriorFoliage: profile('#829f92', .12, null, { emissive: .2 }),
  woodOak: profile('#b99061', .27, 'wood'), woodOakDark: profile('#76583d', .22, 'wood'),
  fabricLinen: profile('#f3ead9', .08, 'weave'), fabricLinenSeam: profile('#cfc4ad', .08, 'weave'),
  fabricTeal: profile('#397f80', .1, 'weave'), fabricTealLight: profile('#79a5a0', .1, 'weave'),
  storageIvory: profile('#e7e3d9', .22), metalWarm: profile('#827663', .48),
  graphite: profile('#333c3c', .24), laptopSilver: profile('#aeb7b5', .52),
  terracotta: profile('#b57959', .12), soil: profile('#453b30', .02),
  leafGreen: profile('#447462', .22), leafGreenLight: profile('#73937a', .24),
  rugWoven: profile('#b8baaa', .06, 'weave'), rugBorder: profile('#7b9890', .08, 'weave'),
  contactShadow: profile('#3c342b', .01, null, { opacity: .13, unlit: true }),
  practicalHousing: profile('#e6ded0', .24),
  practicalDiffuser: profile('#fff1d3', .12, null, { emissive: .58 }),
  switchPlate: profile('#e7e3d9', .25), switchInset: profile('#b2b2a9', .18)
});

export function personalRoomMaterialPattern(kind, normal = false, size = 64) {
  if (!['wood', 'weave'].includes(kind)) throw new TypeError('Unknown room pattern');
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    // Periodic edges, small contrast and deterministic samples: no canvas, image decode,
    // random texture changes on re-entry or additional network dependencies.
    const grain = kind === 'wood'
      ? Math.sin(x * Math.PI / 8 + .45 * Math.sin(y * Math.PI / 16))
      : ((x % 4 < 2 ? 1 : -1) + (y % 4 < 2 ? 1 : -1)) / 2;
    if (normal) {
      data[i] = 128 + Math.round(grain * (kind === 'wood' ? 5 : 8));
      data[i + 1] = 128 + Math.round((kind === 'weave' ? Math.sin(y * Math.PI / 2) : 0) * 6);
      data[i + 2] = 255;
    } else {
      const value = 246 + Math.round(grain * 7);
      data[i] = data[i + 1] = data[i + 2] = value;
    }
    data[i + 3] = 255;
  }
  return data;
}

export function createPersonalRoomMaterials({ root, app, engine, fallbackSurface }) {
  if (!root || !engine || typeof fallbackSurface !== 'function') throw new TypeError('Room material dependencies missing');
  const cache = new Map(), ownedMaterials = new Set(), textures = new Map();
  let disposed = false;
  const color = hex => {
    const n = Number.parseInt(hex.slice(1), 16);
    return new engine.Color((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255);
  };
  function texture(kind, normal) {
    const key = `${kind}:${normal ? 'normal' : 'color'}`;
    if (textures.has(key)) return textures.get(key);
    let candidate = null;
    if (app?.graphicsDevice && typeof engine.Texture === 'function') {
      try {
        candidate = new engine.Texture(app.graphicsDevice, {
          name: `personal-room-${key}`, width: 64, height: 64,
          format: engine.PIXELFORMAT_RGBA8, mipmaps: true,
          minFilter: engine.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: engine.FILTER_LINEAR,
          addressU: engine.ADDRESS_REPEAT, addressV: engine.ADDRESS_REPEAT
        });
        const target = candidate.lock();
        target.set(personalRoomMaterialPattern(kind, normal));
        candidate.unlock();
      } catch { candidate?.destroy(); candidate = null; }
    }
    textures.set(key, candidate);
    return candidate;
  }
  function get(name) {
    if (disposed) throw new Error('Personal room materials already destroyed');
    if (cache.has(name)) return cache.get(name);
    const definition = PERSONAL_ROOM_MATERIAL_PROFILES[name];
    if (!definition) throw new TypeError(`Unknown personal room material: ${name}`);
    let material = null;
    try {
      material = new engine.StandardMaterial();
      material.name = `personal-room-v2-${name}`;
      material.diffuse = color(definition.color);
      material.gloss = definition.gloss;
      material.specular = new engine.Color(.14, .14, .14);
      material.reflectivity = .12;
      if (definition.emissive) {
        material.emissive = color(definition.color);
        material.emissiveIntensity = definition.emissive;
      }
      if (definition.opacity !== undefined) {
        material.opacity = definition.opacity;
        material.blendType = engine.BLEND_NORMAL;
        material.depthWrite = false;
      }
      if (definition.unlit) material.useLighting = false;
      if (definition.texture) {
        material.diffuseMap = texture(definition.texture, false);
        material.normalMap = texture(definition.texture, true);
        material.bumpiness = .2;
        if (typeof engine.Vec2 === 'function') {
          const tiling = definition.texture === 'wood' ? [2, 4] : [6, 6];
          material.diffuseMapTiling = new engine.Vec2(...tiling);
          material.normalMapTiling = new engine.Vec2(...tiling);
        }
      }
      material.update();
      ownedMaterials.add(material);
    } catch {
      material?.destroy();
      material = fallbackSurface(definition.color);
    }
    cache.set(name, material);
    return material;
  }
  // Only mutate materials owned by this room. The fallback surface may be shared
  // campus-wide; silently retain its static appearance instead of contaminating it.
  function updateVisual(name, { color: rgb, emissiveIntensity } = {}) {
    const material = get(name);
    if (!ownedMaterials.has(material)) return false;
    if (rgb) {
      material.diffuse = new engine.Color(...rgb);
      material.emissive = new engine.Color(...rgb);
    }
    if (emissiveIntensity !== undefined) material.emissiveIntensity = emissiveIntensity;
    material.update();
    return true;
  }
  function destroy() {
    if (disposed) return;
    disposed = true;
    for (const material of ownedMaterials) material.destroy();
    for (const resource of textures.values()) resource?.destroy();
    ownedMaterials.clear(); textures.clear(); cache.clear();
  }
  root.once('destroy', destroy);
  return Object.freeze({ get, updateVisual, destroy, status: () => Object.freeze({
    disposed, materialCount: cache.size, ownedMaterialCount: ownedMaterials.size,
    textureCount: [...textures.values()].filter(Boolean).length
  }) });
}
