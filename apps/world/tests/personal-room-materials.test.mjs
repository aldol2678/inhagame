import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalRoomMaterials, personalRoomMaterialPattern, PERSONAL_ROOM_MATERIAL_PROFILES } from '../src/rooms/personal-room-materials.js';

function rig({ failMaterial = false, failTexture = false, graphics = true } = {}) {
  let destroyRoot;
  const created = [], textures = [], fallbacks = [];
  const root = { once(event, callback) { assert.equal(event, 'destroy'); destroyRoot = callback; } };
  const engine = {
    Color: class { constructor(r,g,b) { Object.assign(this, {r,g,b}); } },
    Vec2: class { constructor(x,y) { Object.assign(this, {x,y}); } },
    StandardMaterial: class { constructor() { this.destroyCalls = 0; created.push(this); } update() { if (failMaterial) throw new Error('shader unavailable'); } destroy() { this.destroyCalls++; } },
    Texture: class { constructor(device, options) { this.options = options; this.destroyCalls = 0; textures.push(this); } lock() { if(failTexture) throw new Error('texture unavailable'); return this.pixels = new Uint8Array(64*64*4); } unlock() {} destroy() { this.destroyCalls++; } },
    BLEND_NORMAL: 'normal', PIXELFORMAT_RGBA8: 'rgba8'
  };
  const fallbackSurface = color => { const m = { color, shared: true }; fallbacks.push(m); return m; };
  const materials = createPersonalRoomMaterials({ root, app: graphics ? {graphicsDevice:{}} : {}, engine, fallbackSurface });
  return { materials, created, textures, fallbacks, destroy: () => destroyRoot() };
}

test('room profiles separate linen, teal fabric, oak, painted storage and practical light', () => {
  assert.notEqual(PERSONAL_ROOM_MATERIAL_PROFILES.fabricTeal.color, PERSONAL_ROOM_MATERIAL_PROFILES.woodOak.color);
  assert.equal(PERSONAL_ROOM_MATERIAL_PROFILES.fabricTeal.texture, 'weave');
  assert.ok(PERSONAL_ROOM_MATERIAL_PROFILES.fabricTeal.gloss < PERSONAL_ROOM_MATERIAL_PROFILES.metalWarm.gloss);
  assert.ok(PERSONAL_ROOM_MATERIAL_PROFILES.practicalDiffuser.emissive > 0);
});
test('material lookup is stable and fabric/wood patterns are shared across colors', () => {
  const r = rig(); const teal = r.materials.get('fabricTeal');
  assert.strictEqual(r.materials.get('fabricTeal'), teal);
  const linen = r.materials.get('fabricLinen');
  assert.strictEqual(teal.diffuseMap, linen.diffuseMap);
  assert.strictEqual(teal.normalMap, linen.normalMap);
  r.materials.get('woodOak'); r.materials.get('woodOakDark');
  assert.deepEqual(r.materials.status(), {disposed:false,materialCount:4,ownedMaterialCount:4,textureCount:4});
});
test('authored texture samples are deterministic bounded and normals face outward', () => {
  for (const kind of ['wood','weave']) {
    const rgba = personalRoomMaterialPattern(kind); const normals = personalRoomMaterialPattern(kind,true);
    assert.deepEqual(rgba, personalRoomMaterialPattern(kind));
    assert.equal(rgba.length,64*64*4);
    for(let i=0;i<rgba.length;i+=4) { assert.ok(rgba[i]>=239 && rgba[i]<=253); assert.equal(rgba[i+3],255); assert.equal(normals[i+2],255); }
  }
  assert.throws(() => personalRoomMaterialPattern('rpc-url'));
});
test('unsupported texture graphics preserve fully usable color materials', () => {
  for(const options of [{graphics:false},{failTexture:true}]) {
    const r=rig(options); const m=r.materials.get('fabricLinen');
    assert.equal(m.diffuseMap,null); assert.equal(m.normalMap,null);
    assert.equal(r.materials.status().ownedMaterialCount,1);
    r.destroy(); for(const texture of r.textures) assert.equal(texture.destroyCalls,1);
  }
});
test('material failure retains cached shared surface fallback and never destroys it', () => {
  const r=rig({failMaterial:true}); const m=r.materials.get('fabricTeal');
  assert.equal(m.shared,true); assert.strictEqual(r.materials.get('fabricTeal'),m);
  assert.equal(r.materials.status().ownedMaterialCount,0);
  r.destroy(); r.destroy(); assert.equal(r.created[0].destroyCalls,1);
  assert.equal(r.fallbacks.length,1);
});
test('room teardown destroys each owned material and texture exactly once', () => {
  const r=rig(); for(const key of Object.keys(PERSONAL_ROOM_MATERIAL_PROFILES)) r.materials.get(key);
  r.destroy(); r.materials.destroy(); r.destroy();
  for(const material of r.created) assert.equal(material.destroyCalls,1);
  for(const texture of r.textures) assert.equal(texture.destroyCalls,1);
  assert.deepEqual(r.materials.status(), {disposed:true,materialCount:0,ownedMaterialCount:0,textureCount:0});
  assert.throws(() => r.materials.get('wallPaint'), /destroyed/);
});
test('unknown material keys cannot introduce remote or server-provided material definitions', () => {
  const r=rig(); assert.throws(()=>r.materials.get('https://example.test/model'), /Unknown/);
  assert.equal(r.created.length,0);
});
