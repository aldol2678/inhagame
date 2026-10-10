import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const src = new URL('../src/life-props.js', import.meta.url);
test('the seven approved life prop GLBs have an explicit runtime binding', async () => {
  assert.ok(existsSync(src), 'life prop bindings must exist');
  const { LIFE_PROP_MODELS, NPC_ACTIVITY_PROPS, CLUB_TABLE_PROPS } = await import(src);
  assert.equal(Object.keys(LIFE_PROP_MODELS).length, 7);
  assert.deepEqual(Object.keys(NPC_ACTIVITY_PROPS), ['READING', 'COFFEE', 'PHONE', 'PHOTO', 'EATING']);
  assert.deepEqual(CLUB_TABLE_PROPS.map(p => p.id), ['open_laptop', 'takeaway_cup', 'stationery_notebook', 'open_book']);
  const manifest = JSON.parse(readFileSync(new URL('../assets/life-props-v1/manifest.json', import.meta.url)));
  const spec = JSON.parse(readFileSync(new URL('../assets/life-props-v1/attachment-spec.json', import.meta.url)));
  for (const asset of spec.assets) {
    const bytes = readFileSync(new URL(`..${LIFE_PROP_MODELS[asset.id]}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.assets.find(a => a.id === asset.id).sha256);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
    const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    assert.ok(gltf.nodes.some(node => node.name === asset.root));
    assert.ok(gltf.buffers.every(buffer => !buffer.uri));
    assert.equal(gltf.animations, undefined);
    const activity = asset.npc_attachment?.activity;
    if (activity) {
      assert.equal(NPC_ACTIVITY_PROPS[activity].id, asset.id);
      assert.deepEqual(NPC_ACTIVITY_PROPS[activity].position, asset.npc_attachment.hand_centre_parent_model_units);
      assert.deepEqual(NPC_ACTIVITY_PROPS[activity].rotation, asset.npc_attachment.runtime_surface_contact.local_rotation_xyzw ?? asset.npc_attachment.suggested_fixed_local_quaternion_xyzw);
      assert.deepEqual(NPC_ACTIVITY_PROPS[activity].contactPoint, asset.npc_attachment.runtime_surface_contact.point_gltf_metres);
      assert.deepEqual(NPC_ACTIVITY_PROPS[activity].contactNormal, asset.npc_attachment.runtime_surface_contact.normal_gltf);
      assert.equal(asset.npc_attachment.runtime_surface_contact.overlap_world_units, .0006);
    }
  }
});

// The scene-graph fixture exercises production controller/lifecycle logic. Actual PlayCanvas
// GLB parsing/transform validation is a separate optional engine test, not simulated here.
class Entity {
  constructor(name) { this.name = name; this.enabled = true; this.children = []; this.destroyed = false; this.events = new Map(); }
  addChild(child) { child.parent?.removeChild(child); child.parent = this; this.children.push(child); }
  removeChild(child) { this.children = this.children.filter(c => c !== child); child.parent = null; }
  setLocalPosition(...v) { this.position = v; }
  setLocalRotation(...v) { this.rotation = v; }
  setLocalScale(...v) { this.scale = v; }
  setLocalEulerAngles(...v) { this.euler = v; }
  findByName(name) { return this.name === name ? this : this.children.map(c => c.findByName(name)).find(Boolean); }
  once(event, fn) { this.events.set(event, [...(this.events.get(event) ?? []), fn]); }
  off(event, fn) { this.events.set(event, (this.events.get(event) ?? []).filter(f => f !== fn)); }
  destroy() { if (this.destroyed) return; this.destroyed = true; for (const fn of [...(this.events.get('destroy') ?? [])]) fn(); this.parent?.removeChild(this); for (const child of [...this.children]) child.destroy(); }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
async function propRig(height = .875 / 2.37) {
  const url = new URL('../npc-factory/purposeful-activity-props.mjs', import.meta.url);
  assert.ok(existsSync(url), 'activity prop controller must exist');
  const { createPurposefulActivityProps } = await import(url);
  const avatar = new Entity('NPC');
  const arm = new Entity('ArmPivot_-1'); avatar.addChild(arm);
  for (const name of ['HeldBook', 'BookSpine']) avatar.addChild(new Entity(name));
  const visual = { avatar, arms: [arm], worldScale: height };
  const requests = [];
  const loadModel = id => new Promise((resolve, reject) => requests.push({ id, resolve, reject }));
  const props = createPurposefulActivityProps({ visual, loadModel });
  return { visual, props, requests, arm, avatar };
}

test('activity props use shallow hand-surface contact and compensate each NPC height', async () => {
  const { NPC_ACTIVITY_PROPS } = await import(src);
  for (const height of [.32, .875 / 2.37, .42]) {
    const r = await propRig(height);
    for (const [activity, def] of Object.entries(NPC_ACTIVITY_PROPS)) {
      r.props.update(activity);
      const model = new Entity(def.id);
      r.requests.at(-1).resolve(model); await flush();
      assert.equal(model.parent, r.arm);
      // Independently reconstruct the contact in arm space, rather than accept a new root offset.
      const [x,y,z,w] = def.rotation;
      const rotate = v => [
        (1-2*y*y-2*z*z)*v[0]+(2*x*y-2*z*w)*v[1]+(2*x*z+2*y*w)*v[2],
        (2*x*y+2*z*w)*v[0]+(1-2*x*x-2*z*z)*v[1]+(2*y*z-2*x*w)*v[2],
        (2*x*z-2*y*w)*v[0]+(2*y*z+2*x*w)*v[1]+(1-2*x*x-2*y*y)*v[2]
      ];
      const normal = rotate(def.contactNormal), point = rotate(def.contactPoint), radii = [.07,.075,.07];
      const surface = model.position.map((v,i) => v-def.position[i]+point[i]*.5/height+normal[i]*.0006/height);
      assert.ok(Math.abs(surface.reduce((n,v,i)=>n+(v/radii[i])**2,0)-1)<1e-7, 'contact lies on hand surface after the small overlap is restored');
      const projection = surface.reduce((n,v,i)=>n+v*normal[i],0);
      assert.ok(Math.abs(projection-Math.hypot(...normal.map((v,i)=>v*radii[i])))<1e-7, 'contact uses the correct support plane');
      assert.notDeepEqual(model.position, def.position, 'the prop root cannot bisect the hand');
      assert.deepEqual(model.rotation, def.rotation);
      assert.deepEqual(model.scale, Array(3).fill(.5 / height));
      assert.equal(r.arm.children.length, 1, 'one model per NPC');
      assert.equal(r.avatar.findByName('HeldBook').enabled, false);
      assert.equal(r.avatar.findByName('BookSpine').enabled, false);
    }
    r.props.dispose();
    assert.equal(r.arm.children.length, 0);
  }
});

test('walking, sitting, hidden NPCs and non-prop activity remove props and restore old accessories', async () => {
  const r = await propRig();
  for (const options of [{ moving: true }, { sitting: true }, { visible: false }]) {
    r.props.update('READING'); const model = new Entity('book'); r.requests.at(-1).resolve(model); await flush();
    r.props.update('READING', options);
    assert.equal(model.destroyed, true);
    assert.equal(r.avatar.findByName('HeldBook').enabled, true);
    assert.equal(r.arm.children.length, 0);
  }
  for (const activity of ['WAITING', 'CLUB', 'RESTING', 'TRANSIT', null, '__proto__']) r.props.update(activity);
  assert.equal(r.requests.length, 3, 'non-prop activities never load');
});

test('repeated frames dedupe loads; old requests cannot attach after activity changes', async () => {
  const r = await propRig();
  for (let i = 0; i < 30; i++) r.props.update('READING');
  assert.equal(r.requests.length, 1);
  r.props.update('PHONE');
  const phone = new Entity('phone'); r.requests[1].resolve(phone); await flush();
  const staleBook = new Entity('book'); r.requests[0].resolve(staleBook); await flush();
  assert.equal(staleBook.destroyed, true);
  assert.deepEqual(r.arm.children, [phone]);
  for (let i = 0; i < 30; i++) r.props.update('PHONE');
  assert.equal(r.requests.length, 2);
  r.props.update(null);
  assert.equal(phone.destroyed, true);
});

test('failure preserves fallback without a frame retry loop; leaving and returning retries', async () => {
  const r = await propRig();
  r.props.update('COFFEE'); r.requests[0].reject(new Error('unavailable')); await flush();
  assert.equal(r.avatar.findByName('HeldBook').enabled, true);
  for (let i = 0; i < 30; i++) r.props.update('COFFEE');
  assert.equal(r.requests.length, 1);
  r.props.update(null); r.props.update('COFFEE');
  assert.equal(r.requests.length, 2);
  const cup = new Entity('cup'); r.requests[1].resolve(cup); await flush();
  assert.equal(cup.parent, r.arm);
});

test('destroying avatar or disposing controller discards pending entities and never unloads shared assets', async () => {
  for (const dispose of [r => r.props.dispose(), r => r.avatar.destroy()]) {
    const r = await propRig(); r.props.update('PHOTO'); dispose(r);
    const camera = new Entity('camera'); r.requests[0].resolve(camera); await flush();
    assert.equal(camera.destroyed, true); assert.equal(r.arm.children.length, 0);
    r.props.update('EATING'); assert.equal(r.requests.length, 1);
    r.props.dispose();
  }
  const a = await propRig(), b = await propRig();
  a.props.update('READING'); b.props.update('READING');
  const one = new Entity('book'), two = new Entity('book');
  a.requests[0].resolve(one); b.requests[0].resolve(two); await flush();
  a.props.dispose(); assert.equal(one.destroyed, true); assert.equal(two.destroyed, false);
  assert.equal(two.parent, b.arm);
});

test('setup errors destroy the failed instance and preserve fallback', async () => {
  const r = await propRig(); r.props.update('EATING');
  const broken = new Entity('sandwich'); broken.setLocalScale = () => { throw new Error('broken entity'); };
  r.requests[0].resolve(broken); await flush();
  assert.equal(broken.destroyed, true); assert.equal(r.arm.children.length, 0);
  assert.equal(r.avatar.findByName('HeldBook').enabled, true);
});

async function tableRig() {
  const url = new URL('../src/rooms/club-room-life-props.js', import.meta.url);
  assert.ok(existsSync(url), 'club table prop binding must exist');
  const { createClubTableProps } = await import(url);
  const root = new Entity('Room_ROOM_CLUBHOUSE_01'), table = new Entity('club_table'); root.addChild(table);
  for (const name of ['laptop', 'mug', 'papers']) table.addChild(new Entity(name));
  const requests = [];
  const app = { assets: { loadFromUrl: (url, type, finish) => requests.push({ url, type, finish }) } };
  const ensure = createClubTableProps({ app, root, table, height: .38 });
  return { root, table, requests, ensure };
}
const assetWith = model => ({ resource: { instantiateRenderEntity: () => model } });

test('table props load lazily once and replace only their corresponding placeholders', async () => {
  const r = await tableRig();
  assert.equal(r.requests.length, 0, 'room construction must not request models');
  const first = r.ensure(), second = r.ensure(); await flush();
  assert.equal(r.requests.length, 4);
  const { CLUB_TABLE_PROPS } = await import(src);
  for (let i = 0; i < r.requests.length; i++) {
    const model = new Entity('new'), def = CLUB_TABLE_PROPS[i];
    r.requests[i].finish(null, assetWith(model));
    const angle = def.yaw * Math.PI / 180, [x, y, z] = def.rest;
    const transformedRest = [Math.cos(angle)*x + Math.sin(angle)*z, y, -Math.sin(angle)*x + Math.cos(angle)*z];
    assert.deepEqual(model.position.map((v, k) => v + .5 * transformedRest[k]), [def.restTarget[0], .38, def.restTarget[2]]);
    assert.deepEqual(model.scale, [.5, .5, .5]);
    assert.deepEqual(model.euler, [0, def.yaw, 0]);
    assert.equal(model.parent, r.table);
    assert.equal(model.name, `Club_Life_Prop_${def.id}`);
    if (def.fallback) assert.equal(r.table.findByName(def.fallback).enabled, false);
  }
  assert.deepEqual(await first, [true, true, true, true]); await second;
  await r.ensure(); assert.equal(r.requests.length, 4, 'returning to the room reuses the same instances');
  assert.equal(r.table.children.length, 7, 'three hidden fallbacks plus four models');
});

test('room load failure keeps table fallbacks and root destroy makes pending loads inert', async () => {
  const r = await tableRig();
  const pending = r.ensure(); await flush();
  r.requests[0].finish(new Error('unavailable'));
  assert.equal(r.table.findByName('laptop').enabled, true);
  r.root.destroy();
  let instances = 0;
  for (const request of r.requests.slice(1)) request.finish(null, { resource: { instantiateRenderEntity() { instances++; return new Entity('late'); } } });
  assert.deepEqual(await pending, [false, false, false, false]);
  assert.equal(instances, 0);
  assert.deepEqual(await r.ensure(), [false, false, false, false]);
});

test('runtime wiring updates props alongside existing poses and exposes the room visual lifecycle', () => {
  const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');
  assert.match(runtime, /createEquipmentModelLoader\(\{ app, registry: LIFE_PROP_MODELS \}\)/);
  assert.match(runtime, /visual\.activityProps = createPurposefulActivityProps\(\{ visual, loadModel: loadLifeProp \}\)/);
  assert.match(runtime, /visual\.activityProps\.update\(purposefulActivity, \{ moving, sitting, visible: visual\.avatar\.enabled \}\)/);
  assert.match(runtime, /if \(!motion\.position \|\| socialPreviewFastForward\) \{\s*visual\.activityProps\.update\(null\)/);
  const room = readFileSync(new URL('../src/rooms/club-room-renderer.js', import.meta.url), 'utf8');
  assert.match(room, /createClubTableProps\(\{ app, root, table: g, height: h \}\)/);
  assert.match(room, /ensureVisualAssets: \(\) => Promise\.all\(fixtureLoaders\.map\(ensure => ensure\(\)\)\)/);
});
