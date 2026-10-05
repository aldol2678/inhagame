import * as pc from "playcanvas";

const devices = new WeakMap();

// Small procedural textures: water shading only, never displacement of the shoreline.
export function pondWaterMaterial(device, brightness = 1, variant = 'default') {
  let resources = devices.get(device);
  if (!resources) {
    const size = 64;
    const normals = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size * Math.PI * 2, v = y / size * Math.PI * 2;
      const nx = .16 * Math.cos(2 * u + v) + .08 * Math.cos(3 * u - 2 * v);
      const ny = .08 * Math.cos(2 * u + v) - .12 * Math.cos(3 * u - 2 * v);
      const length = Math.hypot(nx, ny, 1), i = (y * size + x) * 4;
      normals.set([127.5 * (nx / length + 1), 127.5 * (ny / length + 1),
        127.5 * (1 / length + 1), 255], i);
    }
    const normalMap = new pc.Texture(device, {
      name: "pond-ripples", width: size, height: size, format: pc.PIXELFORMAT_RGBA8,
      addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT, levels: [normals]
    });
    // Sky-colour reflection, not invented reflected buildings or a new scene-wide skybox.
    const faces = Array.from({ length: 6 }, (_, face) => {
      const pixels = new Uint8Array(16 * 16 * 4);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const u = (x + .5) / 8 - 1, v = (y + .5) / 8 - 1;
        const elevation = (face === 2 ? 1 : face === 3 ? -1 : -v) / Math.hypot(u, v, 1);
        const sky = Math.max(0, elevation);
        pixels.set([80 + 53 * sky, 127 + 54 * sky, 149 + 65 * sky, 255], (y * 16 + x) * 4);
      }
      return pixels;
    });
    const reflection = new pc.Texture(device, {
      name: "pond-sky-reflection", width: 16, height: 16, cubemap: true,
      format: pc.PIXELFORMAT_RGBA8, levels: [faces], mipmaps: false,
      minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR
    });
    resources = { normalMap, reflection, materials: new Map() };
    devices.set(device, resources);
  }
  const materialKey = `${brightness}:${variant}`;
  if (!resources.materials.has(materialKey)) {
    const material = new pc.StandardMaterial();
    material.name = "inkyung-water";
    material.diffuse = new pc.Color(.35 * brightness, .43 * brightness, .37 * brightness);
    material.specular = new pc.Color(.45, .50, .45);
    material.gloss = .78;
    material.fresnelModel = pc.FRESNEL_SCHLICK;
    material.cubeMap = resources.reflection;
    material.reflectivity = .6;
    material.normalMap = resources.normalMap;
    material.normalMapTiling.set(6, 8);
    material.bumpiness = .45;
    material.update();
    resources.materials.set(materialKey, material);
  }
  return resources.materials.get(materialKey);
}

export function applyPondWeatherMaterial(material, profile) {
  if (!material || !profile) return false;
  material.diffuse.set(...profile.diffuse);
  material.specular.set(...profile.specular);
  material.gloss = profile.gloss;
  material.reflectivity = profile.reflectivity;
  material.bumpiness = profile.bumpiness;
  material.update();
  return true;
}
