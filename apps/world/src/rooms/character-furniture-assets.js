// Code-owned character-form visuals; immutable delivery SHA/size verified on 2026-10-15.
// Placement compatibility and procedural fallback remain authoritative.
// Source GLBs and textures must remain outside the public checkout.
export const CHARACTER_FURNITURE_CANDIDATES = Object.freeze([
  Object.freeze({
    itemId: 'furniture.induck_chair', version: 'annyongi-character-chair-r2',
    url: '/api/brand-asset?asset=annyongi-character-chair-r2-70ec784f8796.glb',
    sha256: '70ec784f87966d43ef80ce4a742e9ce43a1a7d40312be00b9a569843edf190b8',
    byteLength: 3243832, triangles: 141368, primitives: 51, materials: 8,
    min: Object.freeze([-0.6066427826881409, 0, -0.47999998927116394]),
    max: Object.freeze([0.6066427826881409, 1.2269999980926514, 0.47999998927116394]),
    transform: Object.freeze({ yaw: 0, scale: Object.freeze([1, 1, 1]) }),
    frontAxis: '-Z', geometryPolicy: 'character-r1',
    seat: Object.freeze({ position: Object.freeze([0, .34, -.155]) }),
    allowedExtensions: Object.freeze([]), textureBytesEstimate: 0, enabled: true
  }),
  Object.freeze({
    itemId: 'furniture.dorm_side_table_low', version: 'induck-character-nightstand-r1',
    url: '/api/brand-asset?asset=induck-character-nightstand-r1-01a2764ecb9c.glb',
    sha256: '01a2764ecb9c581f033e5fc35e4e97ddd027897865f3057a5948cb3ee1a48b77',
    byteLength: 4818556, triangles: 187930, primitives: 46, materials: 7,
    min: Object.freeze([-0.3394647538661957, 0, -0.36405059695243835]),
    max: Object.freeze([0.3394647538661957, 1.1579430103302002, 0.36405059695243835]),
    transform: Object.freeze({ yaw: 0, scale: Object.freeze([1, 1, 1]) }),
    frontAxis: '-Z', geometryPolicy: 'character-r1',
    // One embedded 1024 x 1024 image, RGBA8 including the complete mip chain.
    allowedExtensions: Object.freeze([]), textureBytesEstimate: 5592404, enabled: true
  }),
  Object.freeze({
    itemId: 'furniture.dorm_bookshelf_slim', version: 'annyongi-character-bookshelf-r3',
    url: '/api/brand-asset?asset=annyongi-character-bookshelf-r3-05b6fa9c384e.glb',
    sha256: '05b6fa9c384e92c62967da51ebad1b29769e0f503670510f060f2965a977f8f9',
    byteLength: 14752504, triangles: 667380, primitives: 47, materials: 7,
    min: Object.freeze([-0.6036725044250488, 0, -0.26113367080688477]),
    max: Object.freeze([0.6036725044250488, 1.894493818283081, 0.24646763503551483]),
    transform: Object.freeze({ yaw: 0, scale: Object.freeze([1, 1, 1]) }),
    frontAxis: '-Z', geometryPolicy: 'character-r1',
    allowedExtensions: Object.freeze([]), textureBytesEstimate: 0, enabled: true
  })
]);
