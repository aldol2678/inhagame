// Shadow-only cache contract. Integrity is checked against current inputs, never a saved PASS.
export const RECAST_ARTIFACT_SCHEMA = 'inha.recast-npc-artifact/1';
export const RECAST_PACKAGE_VERSION = '0.43.1';
export const RECAST_ARTIFACT_URL = '/recast-data/campus.manifest.json';
export const RECAST_SOURCE_URLS = Object.freeze([
  '/npc-factory/dev-navigation.mjs',
  '/npc-factory/recast-navigator-poc.mjs',
  '/npc-factory/recast-navmesh-artifact.mjs',
  '/src/navigation/nav-graph.js',
  '/src/navigation/route-solver.js',
  '/src/polygon-collision.js'
]);
const hex = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
const error = code => new Error(`RECAST_ARTIFACT_${code}`);

// Object key order is irrelevant; array order remains part of the input contract.
export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && Object.getPrototypeOf(value) === Object.prototype) return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  throw error('INVALID_INPUT');
}
export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export const fingerprint = value => sha256(encoder.encode(canonicalJson(value)));

export async function readRecastSourceDigests({ fetcher = fetch } = {}) {
  return Object.fromEntries(await Promise.all(RECAST_SOURCE_URLS.map(async url => {
    const response = await fetcher(url, { cache: 'no-store' });
    if (!response.ok) throw error('SOURCE_UNAVAILABLE');
    return [url, await sha256(await response.arrayBuffer())];
  })));
}

export function recastArtifactInputs({ batch, roster, expansion, baseNavigator, corridorGraph,
  contract, sourceDigests } = {}) {
  if (!batch || !(roster instanceof Map) || expansion !== 'READY' ||
      typeof baseNavigator?.navigationGeometry !== 'function' ||
      canonicalJson(Object.keys(sourceDigests ?? {}).sort()) !== canonicalJson([...RECAST_SOURCE_URLS].sort()) ||
      Object.values(sourceDigests).some(value => !hex.test(value))) throw error('INVALID_INPUT');
  return {
    contract, batch, expansion, graph: corridorGraph,
    geometry: baseNavigator.navigationGeometry(),
    roster: [...roster].map(([id, member]) => ({ id, schedule: member.schedule, destinations: member.destinations })),
    sourceDigests
  };
}

// The pinned 0.43.1 exporter emits a little-endian MSET v1 / one-tile DNAV v7.
// Reject malformed headers and truncation before passing bytes into native WASM.
function validateSoloBinary(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 148 || bytes.byteLength > 16 * 1024 * 1024)
    throw error('BINARY_FORMAT');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x4d534554 || view.getUint32(4, true) !== 1 ||
      view.getUint32(8, true) !== 1 || !view.getUint32(40, true) ||
      view.getUint32(44, true) !== bytes.byteLength - 48 ||
      view.getUint32(48, true) !== 0x444e4156 || view.getUint32(52, true) !== 7)
    throw error('BINARY_FORMAT');
}

function validateSurface(surface) {
  if (!surface || ['surfaceTiles', 'corridorQuads', 'triangleCount'].some(key =>
    !Number.isSafeInteger(surface[key]) || surface[key] < 0) || !surface.triangleCount ||
    surface.triangleCount < 2 * (surface.surfaceTiles + surface.corridorQuads)) throw error('METADATA');
}

export async function createRecastArtifact({ bytes, inputSha256, contract, surface }) {
  validateSoloBinary(bytes); validateSurface(surface);
  if (!hex.test(inputSha256)) throw error('INVALID_INPUT');
  const body = { schema: RECAST_ARTIFACT_SCHEMA, contract, inputSha256,
    binarySha256: await sha256(bytes), byteLength: bytes.byteLength, surface };
  return { ...body, manifestSha256: await fingerprint(body) };
}

export async function validateRecastArtifact({ manifest, bytes, expectedInputSha256, contract }) {
  if (!manifest || manifest.schema !== RECAST_ARTIFACT_SCHEMA) throw error('SCHEMA');
  if (manifest.contract?.packageVersion !== RECAST_PACKAGE_VERSION ||
      canonicalJson(manifest.contract) !== canonicalJson(contract)) throw error('VERSION_OR_CONFIG');
  if (!hex.test(expectedInputSha256) || manifest.inputSha256 !== expectedInputSha256) throw error('INPUT_MISMATCH');
  const { manifestSha256, ...body } = manifest;
  if (!hex.test(manifestSha256) || await fingerprint(body) !== manifestSha256) throw error('MANIFEST_CHECKSUM');
  validateSurface(manifest.surface);
  if (!(bytes instanceof Uint8Array) || manifest.byteLength !== bytes.byteLength ||
      !hex.test(manifest.binarySha256) || await sha256(bytes) !== manifest.binarySha256) throw error('BINARY_CHECKSUM');
  validateSoloBinary(bytes);
  return { ...manifest.surface };
}

export async function loadRecastArtifact({ expectedInputSha256, fetcher = fetch,
  manifestUrl = RECAST_ARTIFACT_URL } = {}) {
  const response = await fetcher(manifestUrl, { cache: 'no-store' });
  if (!response.ok) throw error('UNAVAILABLE');
  const manifest = await response.json();
  // Content-addressed name keeps old/new deployment files from being silently paired.
  if (!hex.test(manifest.binarySha256)) throw error('MANIFEST_CHECKSUM');
  const binaryUrl = manifestUrl.replace(/[^/]+$/, `${manifest.binarySha256}.bin`);
  const binaryResponse = await fetcher(binaryUrl, { cache: 'no-store' });
  if (!binaryResponse.ok) throw error('BINARY_UNAVAILABLE');
  return { manifest, bytes: new Uint8Array(await binaryResponse.arrayBuffer()), expectedInputSha256 };
}
