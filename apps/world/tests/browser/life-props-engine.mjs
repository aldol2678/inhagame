// Actual pinned PlayCanvas GLB/container/scene-graph validation with its NullGraphicsDevice.
// No browser, GPU rendering, HTTP/network loading, lighting or visual hand-fit claim.
// npm ci --prefix apps/world/tests/browser
// node apps/world/tests/browser/life-props-engine.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const engine = new URL('./node_modules/playcanvas/build/playcanvas.dbg.mjs', import.meta.url).href;
const hook = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === 'playcanvas' ? engine : specifier, context);
} });
const pc = await import('playcanvas');
const { createHumanAvatar } = await import('../../npc-factory/dev-human-avatar.mjs');
const { createPurposefulActivityProps } = await import('../../npc-factory/purposeful-activity-props.mjs');
const { purposefulActivityPose } = await import('../../npc-factory/purposeful-activity-motion.mjs');
const { createClubRoomScene } = await import('../../src/rooms/club-room-renderer.js');
const { createEquipmentModelLoader } = await import('../../src/appearance/equipment-asset-loader.js');
const { LIFE_PROP_MODELS, NPC_ACTIVITY_PROPS, CLUB_TABLE_PROPS } = await import('../../src/life-props.js');
const spec = JSON.parse(readFileSync(new URL('../../assets/life-props-v1/attachment-spec.json', import.meta.url)));
const canvas = { id: 'life-props-null-engine', width: 512, height: 512 };
const app = new pc.AppBase(canvas), options = new pc.AppOptions();
options.graphicsDevice = new pc.NullGraphicsDevice(canvas);
options.componentSystems = [pc.RenderComponentSystem, pc.LightComponentSystem];
options.resourceHandlers = [pc.ContainerHandler];
app.init(options);
const flush = () => new Promise(resolve => setImmediate(resolve));
const approx = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`);
const array = v => [v.x, v.y, v.z];
const report = { engine: pc.version, device: 'NullGraphicsDevice', gpu: false, assets: [], npcAttachments: 0, roomModels: 0 };
try {
  for (const entry of spec.assets) {
    const url = LIFE_PROP_MODELS[entry.id], buffer = readFileSync(new URL(`../..${url}`, import.meta.url));
    // Real AssetRegistry + ContainerHandler parse the delivered bytes; no HTTP stub or fake entity.
    const asset = new pc.Asset(entry.id, 'container', { url,
      contents: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) });
    app.assets.add(asset);
    await new Promise((resolve, reject) => app.assets.loadFromUrl(url, 'container', error => error ? reject(error) : resolve()));
    const model = asset.resource.instantiateRenderEntity(); app.root.addChild(model);
    const meshInstances = model.findComponents('render').flatMap(component => component.meshInstances);
    const triangles = meshInstances.reduce((sum, mesh) => sum + mesh.mesh.primitive[0].count / 3, 0);
    assert.equal(triangles, entry.triangles);
    assert.equal(model.name, entry.root);
    assert.equal(model.findComponents('collision').length, 0);
    assert.equal(model.findComponents('rigidbody').length, 0);
    const bounds = meshInstances[0].aabb.clone(); for (const mesh of meshInstances.slice(1)) bounds.add(mesh.aabb);
    array(bounds.halfExtents).forEach((n, i) => approx(n * 2, entry.dimensions_metres_xyz_y_up[i], `${entry.id} dimension ${i}`));
    const rest = model.findByName('ANCHOR_rest').getLocalPosition();
    array(rest).forEach((n, i) => approx(n, entry.anchors_gltf_metres.rest[i], `${entry.id} rest ${i}`));
    report.assets.push({ id: entry.id, triangles, materialSurfaces: meshInstances.length });
    model.destroy();
  }

  const campus = new pc.Entity('Campus'); campus.setLocalScale(1, 1, -1); app.root.addChild(campus);
  const loader = createEquipmentModelLoader({ app, registry: LIFE_PROP_MODELS });
  for (const height of [.9, 1, 1.1]) {
    campus.enabled = false; // avatars may be constructed while their scene is hidden
    const visual = createHumanAvatar(campus, { id: 'QA-001' }, { height, outfit_color: '#456789', accent_color: '#abcdef',
      skin_tone: 0, hair_color: '#222222', presentation: 'male', outfit_style: 'shirt', hair_style: 'short', accessory: 'book' });
    const props = createPurposefulActivityProps({ visual, loadModel: loader });
    campus.enabled = true;
    for (const [activity, binding] of Object.entries(NPC_ACTIVITY_PROPS)) {
      props.update(activity); await flush();
      const model = visual.arms[0].findByName(`NPC_Activity_${binding.id}`);
      assert.ok(model, activity);
      assert.equal(visual.avatar.findByName('HeldBook').enabled, false);
      for (const phase of [0, .8, 2]) {
        const pose = purposefulActivityPose(activity, { phase });
        visual.arms.forEach((arm, i) => arm.setLocalEulerAngles(pose.armPitch[i], pose.armYaw[i], pose.armRoll[i]));
        const hand = visual.arms[0].getWorldTransform().transformPoint(new pc.Vec3(...binding.position));
        array(model.getPosition()).forEach((n, i) => approx(n, array(hand)[i], `${activity} hand ${i}`));
        const scale = model.getWorldTransform().getScale(new pc.Vec3());
        array(scale).forEach(n => approx(n, .5, `${activity} world scale at height ${height}`));
        if (phase === 0) {
          const actual = new pc.Quat().mul2(visual.arms[0].getLocalRotation(), model.getLocalRotation());
          const angles = spec.assets.find(a => a.id === binding.id).npc_attachment.desired_avatar_frame_euler_degrees;
          const expected = new pc.Quat().setFromEulerAngles(...angles);
          approx(Math.abs(actual.x*expected.x + actual.y*expected.y + actual.z*expected.z + actual.w*expected.w), 1, `${activity} phase-0 orientation`);
        }
      }
      report.npcAttachments++;
    }
    props.update('EATING', { sitting: true });
    assert.equal(visual.arms[0].children.filter(c => c.name.startsWith('NPC_Activity_')).length, 0);
    assert.equal(visual.avatar.findByName('HeldBook').enabled, true);
    props.update('PHONE'); await flush(); visual.avatar.destroy();
    props.update('READING'); await flush(); // disposed by real Entity.destroy
  }

  const room = createClubRoomScene(app);
  assert.equal(room.root.enabled, false);
  assert.deepEqual(array(room.root.getLocalScale()), [1, 1, -1]);
  const table = room.root.findByName('club_table');
  assert.equal(table.children.filter(c => c.name.startsWith('Club_Life_Prop_')).length, 0);
  room.root.enabled = true; await room.ensureVisualAssets(); await room.ensureVisualAssets();
  for (const prop of CLUB_TABLE_PROPS) {
    const model = table.findByName(`Club_Life_Prop_${prop.id}`); assert.ok(model);
    const rest = model.findByName('ANCHOR_rest');
    const expected = table.getWorldTransform().transformPoint(new pc.Vec3(prop.restTarget[0], .38, prop.restTarget[2]));
    array(rest.getPosition()).forEach((n, i) => approx(n, array(expected)[i], `${prop.id} tabletop rest ${i}`));
    assert.deepEqual(array(model.getLocalScale()), [.5, .5, .5]);
    if (prop.fallback) assert.equal(table.findByName(prop.fallback).enabled, false);
    assert.equal(model.findComponents('collision').length, 0); report.roomModels++;
  }
  assert.equal(table.children.filter(c => c.name.startsWith('Club_Life_Prop_')).length, 4);
  const models = table.children.filter(c => c.name.startsWith('Club_Life_Prop_'));
  room.root.enabled = false; await room.ensureVisualAssets();
  assert.deepEqual(table.children.filter(c => c.name.startsWith('Club_Life_Prop_')), models);
  room.root.destroy(); await room.ensureVisualAssets();
  for (const url of Object.values(LIFE_PROP_MODELS)) assert.ok(app.assets.getByUrl(url).resource, 'shared containers survive instance cleanup');
  console.log(JSON.stringify(report, null, 2));
} finally { app.destroy(); hook.deregister(); }
