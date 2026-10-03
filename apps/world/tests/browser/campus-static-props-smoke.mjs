// Real Campus boot, original approved GLBs and PlayerController. The shared
// localhost harness blocks off-origin traffic and stubs all backend writes.
// Missing/duplicated props, material overrides, double unit conversion, lost
// collision and invisible renderings must each fail this batch independently.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';

const output = resolve(process.env.CAMPUS_STATIC_PROPS_QA_OUTPUT || 'test-results/campus-static-props');
const approved = [
  ['TRASHBIN', 8, 2], ['BOLLARD', 3, 2], ['BIKERACK', 14, 1],
  ['PLANTER', 12, 3], ['SIGN', 32, 3], ['VENDING', 21, 3]
].map(([kind, meshes, materials]) => ({
  kind: kind.toLowerCase(), assetId: `PROP_${kind}_CAMPUS_001`,
  url: `/assets/prop_${kind.toLowerCase()}_campus_001.glb`, meshes, materials
}));
const worldRoot = 'WorldDocument:world.campus-street-furniture-v1';
const report = { backend: process.env.WORLD_SMOKE_DISABLE_WEBGPU === '1' ? 'WebGL2' : 'WebGPU', sources: [], cases: [] };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const near = (actual, expected, message, tolerance = 3e-5) =>
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < tolerance, `${message}: ${actual} != ${expected}`);
await mkdir(output, { recursive: true });

// The HTTP body must be these exact source bytes, and runtime materials must
// retain the source GLB's PBR properties rather than an instance override.
try {
  for (const asset of approved) {
    const bytes = await readFile(new URL(`../..${asset.url}`, import.meta.url));
    assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
    assert.equal(bytes.readUInt32LE(4), 2);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    assert.equal(gltf.meshes.length, asset.meshes, `${asset.assetId} original meshes`);
    assert.equal(gltf.meshes.flatMap(mesh => mesh.primitives).length, asset.meshes, `${asset.assetId} original primitives`);
    assert.equal(gltf.materials.length, asset.materials, `${asset.assetId} original materials`);
    assert.ok(gltf.nodes.every(node => !node.matrix && !node.translation && !node.rotation && !node.scale),
      `${asset.assetId} source vertices are already baked into metre space`);
    asset.sha256 = sha256(bytes);
    asset.sourceMaterials = gltf.materials;
    asset.meshBounds = gltf.meshes.flatMap(mesh => mesh.primitives.map(primitive => {
      const accessor = gltf.accessors[primitive.attributes.POSITION];
      return { min: accessor.min, max: accessor.max };
    }));
    report.sources.push({ ...asset, bytes: bytes.length });
  }
} catch (error) {
  report.error = String(error?.stack ?? error);
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  throw error;
}

for (const spec of [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'mobile-portrait', width: 390, height: 844, mobile: true },
  { name: 'mobile-landscape', width: 844, height: 390, mobile: true }
]) {
  const result = { mode: spec.name, assetResponses: {}, warnings: [], views: [] };
  report.cases.push(result);
  let smoke, page;
  try {
    smoke = await startSmoke({ viewport: { width: spec.width, height: spec.height },
      contextOptions: { isMobile: spec.mobile, hasTouch: spec.mobile, deviceScaleFactor: 1 } });
    page = await smoke.context.newPage();
    const fatal = smoke.watch(page), responseBodies = [];
    for (const asset of approved) result.assetResponses[asset.assetId] = [];
    page.on('response', response => {
      const asset = approved.find(item => item.url === new URL(response.url()).pathname);
      if (!asset) return;
      const receipt = { status: response.status() };
      result.assetResponses[asset.assetId].push(receipt);
      const body = response.body().then(bytes => { receipt.sha256 = sha256(bytes); }, error => { receipt.error = String(error); });
      responseBodies.push(body);
    });
    page.on('console', message => { if (message.type() === 'warning') result.warnings.push(message.text()); });
    const settled = () => Promise.race([
      page.waitForFunction(() => {
        const status = window.__INHAGAME_P0__?.getStatus?.();
        return status?.renderer === 'UNAVAILABLE' || status?.loading?.finished &&
          status?.campusStaticProps && status.campusStaticProps.state !== 'loading';
      }, null, { timeout: TIMEOUT_MS }), fatal
    ]);
    const waitFrames = frame => Promise.race([
      page.waitForFunction(value => window.__INHAGAME_P0__.app.frame > value + 2, frame, { timeout: TIMEOUT_MS }), fatal
    ]);
    const verifyResponses = async count => {
      await Promise.all(responseBodies);
      for (const asset of approved) assert.deepEqual(result.assetResponses[asset.assetId],
        Array.from({ length: count }, () => ({ status: 200, sha256: asset.sha256 })),
        `${asset.assetId}: exactly ${count} original GLB HTTP 200 response(s)`);
    };
    await page.goto(`${smoke.origin}/campus/`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    await settled();
    result.boot = await page.evaluate(() => window.__INHAGAME_P0__.getStatus());
    assert.notEqual(result.boot.renderer, 'UNAVAILABLE', `Campus boot: ${result.boot.error}`);

    const readScene = () => page.evaluate(async ({ approved, worldRoot }) => {
      const { CAMPUS_STATIC_PROPS: props, CAMPUS_STATIC_PROPS_WORLD: world } = await import('/src/campus-static-props.js');
      const pc = await import('playcanvas');
      const d = window.__INHAGAME_P0__, all = root => [root, ...root.children.flatMap(all)], nodes = all(d.app.root);
      const materialState = material => ({
        name: material.name, diffuse: [material.diffuse.r, material.diffuse.g, material.diffuse.b],
        opacity: material.opacity, metalness: material.metalness, gloss: material.gloss,
        glossInvert: material.glossInvert, emissive: [material.emissive.r, material.emissive.g, material.emissive.b],
        emissiveIntensity: material.emissiveIntensity, twoSidedLighting: material.twoSidedLighting
      });
      return {
        status: d.getStatus().campusStaticProps, renderer: d.getStatus().renderer,
        worldAssets: world.assets.map(asset => asset.id).sort(), worldEntities: world.entities.length,
        worldRoots: nodes.filter(node => node.name === worldRoot).length,
        lights: nodes.filter(node => node.light).map(node => ({ name: node.name, type: node.light.type, castShadows: node.light.castShadows })),
        props: approved.map(source => {
          const prop = props.find(item => item.assetId === source.assetId);
          const entity = d.app.root.findByName(source.assetId);
          const renders = entity?.findComponents('render') ?? [], meshes = renders.flatMap(render => render.meshInstances);
          const containers = d.app.assets.list().filter(asset => asset.type === 'container' && asset.file?.url?.endsWith(source.url));
          const imported = containers[0]?.resource.materials?.map(asset => asset.resource ?? asset) ?? [];
          const bounds = meshes.map(mesh => ({ min: [...mesh.aabb.getMin().toArray()], max: [...mesh.aabb.getMax().toArray()] }));
          return {
            assetId: source.assetId, placement: prop, instances: nodes.filter(node => node.name === source.assetId).length,
            parent: entity?.parent?.name, grandparent: entity?.parent?.parent?.name,
            localScale: entity ? [...entity.getLocalScale().toArray()] : null,
            parentScale: entity?.parent ? [...entity.parent.getLocalScale().toArray()] : null,
            worldPosition: entity ? [...entity.getPosition().toArray()] : null,
            localPosition: entity ? [...entity.getLocalPosition().toArray()] : null,
            transform: entity ? [...entity.getWorldTransform().data] : [],
            renderComponents: renders.length, meshInstances: meshes.length, assetContainers: containers.length,
            propLights: entity?.findComponents('light').length ?? 0,
            materials: [...new Set(meshes.map(mesh => mesh.material.name))].sort(),
            allSourceMaterials: meshes.every(mesh => imported.includes(mesh.material)),
            importedMaterials: imported.map(materialState),
            // PlayCanvas's pinned glTF loader converts linear factors with Color.gamma().
            expectedMaterials: source.sourceMaterials.map(material => {
              const pbr = material.pbrMetallicRoughness ?? {}, factor = pbr.baseColorFactor ?? [1, 1, 1, 1];
              const color = new pc.Color(...factor).gamma();
              const emissive = new pc.Color(...(material.emissiveFactor ?? [0, 0, 0])).gamma();
              return { name: material.name, diffuse: [color.r, color.g, color.b], opacity: factor[3],
                metalness: pbr.metallicFactor ?? 1, gloss: pbr.roughnessFactor ?? 1, glossInvert: true,
                emissive: [emissive.r, emissive.g, emissive.b],
                emissiveIntensity: material.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1,
                twoSidedLighting: material.doubleSided ?? false };
            }),
            min: [0, 1, 2].map(axis => Math.min(...bounds.map(bound => bound.min[axis]))),
            max: [0, 1, 2].map(axis => Math.max(...bounds.map(bound => bound.max[axis])))
          };
        })
      };
    }, { approved, worldRoot });
    const verifyScene = scene => {
      assert.equal(scene.renderer, report.backend);
      assert.equal(scene.status.state, 'ready', JSON.stringify(scene.status));
      assert.equal(scene.status.entities, 6);
      assert.deepEqual(scene.status.diagnostics, []);
      assert.deepEqual([...scene.status.assetIds].sort(), approved.map(asset => asset.assetId).sort());
      assert.deepEqual(scene.worldAssets, approved.map(asset => asset.assetId).sort());
      assert.equal(scene.worldEntities, 6);
      assert.equal(scene.worldRoots, 1);
      for (const asset of approved) {
        const sceneProp = scene.props.find(prop => prop.assetId === asset.assetId), p = sceneProp.placement;
        assert.ok(p, `${asset.assetId} has an explicit placement`);
        assert.equal(sceneProp.instances, 1, `${asset.assetId} has one live entity`);
        assert.equal(sceneProp.assetContainers, 1, `${asset.assetId} has one cached container`);
        assert.equal(sceneProp.renderComponents, asset.meshes, `${asset.assetId} render components`);
        assert.equal(sceneProp.meshInstances, asset.meshes, `${asset.assetId} mesh instances`);
        assert.equal(sceneProp.materials.length, asset.materials, `${asset.assetId} material count`);
        assert.equal(sceneProp.importedMaterials.length, asset.materials);
        assert.equal(sceneProp.allSourceMaterials, true, `${asset.assetId} has no local material clone or override`);
        assert.deepEqual(sceneProp.importedMaterials, sceneProp.expectedMaterials, `${asset.assetId} retains original source PBR factors`);
        assert.equal(sceneProp.propLights, 0, `${asset.assetId} introduces no realtime light`);
        assert.equal(sceneProp.parent, worldRoot);
        assert.equal(sceneProp.grandparent, 'CampusBase');
        assert.deepEqual(sceneProp.localScale, [1, 1, 1]);
        assert.deepEqual(sceneProp.parentScale, [.5, .5, .5]);
        assert.ok([...sceneProp.transform, ...sceneProp.min, ...sceneProp.max].every(Number.isFinite));
        const [x, y, z] = p.position, angle = p.yaw * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
        near(sceneProp.worldPosition[0], x, `${asset.assetId} world X`);
        near(sceneProp.worldPosition[1], y, `${asset.assetId} world Y`);
        near(sceneProp.worldPosition[2], -z, `${asset.assetId} inherits one Z reflection`);
        p.position.forEach((value, axis) => near(sceneProp.localPosition[axis], value * 2, `${asset.assetId} document metre position ${axis}`));
        // Union transformed per-mesh source AABBs, matching the renderer. A
        // rotated sparse rack/sign need not fill its aggregate local bbox corners.
        const corners = asset.meshBounds.flatMap(bounds => [bounds.min[0], bounds.max[0]].flatMap(lx =>
          [bounds.min[1], bounds.max[1]].flatMap(ly => [bounds.min[2], bounds.max[2]].map(lz =>
            [x + (cos * lx + sin * lz) * .5, y + ly * .5, -(z + (-sin * lx + cos * lz) * .5)]))));
        for (let axis = 0; axis < 3; axis++) {
          near(sceneProp.min[axis], Math.min(...corners.map(corner => corner[axis])), `${asset.assetId} rendered minimum ${axis}`);
          near(sceneProp.max[axis], Math.max(...corners.map(corner => corner[axis])), `${asset.assetId} rendered maximum ${axis}`);
        }
        const [width, height, depth] = p.authoredDimensions;
        [width, height, depth].forEach((value, axis) => near(
          Math.max(...asset.meshBounds.map(bound => bound.max[axis])) - Math.min(...asset.meshBounds.map(bound => bound.min[axis])),
          value, `${asset.assetId} independently measured authored dimension ${axis}`));
        near(sceneProp.max[1] - sceneProp.min[1], height * .5, `${asset.assetId} half-metre rendered height`);
        near(sceneProp.min[1], y + p.bounds.min[1] * .5, `${asset.assetId} contacts authored ground`);
      }
    };
    result.initial = await readScene();
    verifyScene(result.initial);
    await verifyResponses(1);

    // Existing PlayerController receives deterministic normal walking input.
    // Tests do not replace its obstacles, movement space, ground or collision.
    result.walks = await page.evaluate(async () => {
      const { CAMPUS_STATIC_PROPS: props, CAMPUS_STATIC_PROP_COLLIDERS: colliders } = await import('/src/campus-static-props.js');
      const { WALK_SHAPE, PLAYER_ORIGIN_Y, HUMAN_HEIGHT } = await import('/src/player-dimensions.js');
      const { canOccupy } = await import('/src/world-collision.js');
      const d = window.__INHAGAME_P0__, c = d.controller;
      const results = [];
      const reset = position => {
        c.keys.clear(); c.clearAssistedMovement(); c.touchVector.x = 0; c.touchVector.y = 0;
        c.velocityY = 0; c.grounded = true; c.jumpQueued = false;
        d.player.setLocalPosition(position.x, position.y, position.z);
        if (!canOccupy(position, WALK_SHAPE)) throw new Error(`Walking start is blocked: ${JSON.stringify(position)}`);
      };
      const drive = (direction, distance) => {
        c.setAssistedMovement(direction);
        let remaining = distance / c.walkSpeed, clear = true, steps = 0;
        while (remaining > 1e-9) {
          const dt = Math.min(1 / 60, remaining); c.update(dt, 0); remaining -= dt; steps++;
          clear &&= canOccupy(d.player.getLocalPosition(), WALK_SHAPE);
        }
        c.clearAssistedMovement();
        const p = d.player.getLocalPosition();
        return { position: { x: p.x, y: p.y, z: p.z }, clear, steps };
      };
      for (const prop of props) {
        const [x, y, z] = prop.position, angle = prop.yaw * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
        const rotate = (lx, lz) => ({ x: cos * lx + sin * lz, z: -sin * lx + cos * lz });
        const position = (lx, lz) => { const r = rotate(lx, lz); return { x: x + r.x, y: prop.groundHeight + PLAYER_ORIGIN_Y, z: z + r.z }; };
        const boxes = prop.collision.filter(box => box.min[1] * .5 < HUMAN_HEIGHT && box.max[1] > 0)
          .map(box => ({ ...box, min: box.min.map(v => v * .5), max: box.max.map(v => v * .5) }));
        if (!boxes.length || !colliders.some(box => box.assetId === prop.assetId)) throw new Error(`${prop.assetId}: no walking blocker`);
        const envelope = { min: [0, 1, 2].map(axis => Math.min(...boxes.map(box => box.min[axis]))),
          max: [0, 1, 2].map(axis => Math.max(...boxes.map(box => box.max[axis]))) };
        const entry = { assetId: prop.assetId, approaches: [], corners: [], circuit: [], shoulderPassages: [] };
        for (const [side, axis, sign] of [['left', 0, -1], ['right', 0, 1], ['back', 2, -1], ['front', 2, 1]]) {
          const box = [...boxes].sort((a, b) => sign < 0 ? a.min[axis] - b.min[axis] : b.max[axis] - a.max[axis])[0];
          const local = [(box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2];
          const i = axis === 0 ? 0 : 1, edge = sign < 0 ? box.min[axis] : box.max[axis];
          local[i] = edge + sign * (WALK_SHAPE.radius + .65);
          reset(position(...local));
          const inward = rotate(axis === 0 ? -sign : 0, axis === 2 ? -sign : 0);
          const hit = drive(inward, 1.5);
          local[i] = edge + sign * WALK_SHAPE.radius;
          const expected = position(...local);
          const back = drive({ x: -inward.x, z: -inward.z }, .5);
          entry.approaches.push({ side, hit, expected, back,
            retreatDistance: Math.hypot(back.position.x - hit.position.x, back.position.z - hit.position.z) });
        }
        // A rounded corner must not trap the controller after diagonal contact.
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const corner = [sx < 0 ? envelope.min[0] : envelope.max[0], sz < 0 ? envelope.min[2] : envelope.max[2]];
          reset(position(corner[0] + sx * .65, corner[1] + sz * .65));
          const toward = rotate(-sx, -sz), hit = drive(toward, 1.4);
          const back = drive({ x: -toward.x, z: -toward.z }, .6);
          entry.corners.push({ sx, sz, hit, back,
            retreatDistance: Math.hypot(back.position.x - hit.position.x, back.position.z - hit.position.z) });
        }
        const margin = WALK_SHAPE.radius + .5;
        const left = envelope.min[0] - margin, right = envelope.max[0] + margin;
        const back = envelope.min[2] - margin, front = envelope.max[2] + margin;
        const start = position(left, back);
        reset(start);
        for (const [dx, dz, distance] of [[1, 0, right - left], [0, 1, front - back], [-1, 0, right - left], [0, -1, front - back]])
          entry.circuit.push(drive(rotate(dx, dz), distance));
        entry.circuitStart = start;
        // Tall sign graphics and the small bollard must not create broad walls.
        // Walk the two shoulders only 6 cm outside the capsule-expanded proxy.
        if (/_SIGN_|_BOLLARD_/.test(prop.assetId)) {
          for (const side of [-1, 1]) {
            const lx = (side < 0 ? envelope.min[0] : envelope.max[0]) + side * (WALK_SHAPE.radius + .06);
            const from = position(lx, back), expected = position(lx, front);
            reset(from);
            entry.shoulderPassages.push({ side, from, expected, ...drive(rotate(0, 1), front - back) });
          }
        }
        results.push(entry);
      }
      c.keys.clear(); c.clearAssistedMovement();
      return results;
    });
    assert.equal(result.walks.length, 6);
    for (const walk of result.walks) {
      assert.equal(walk.approaches.length, 4);
      for (const sample of walk.approaches) {
        assert.equal(sample.hit.clear && sample.back.clear, true, `${walk.assetId} ${sample.side} remains outside blockers`);
        near(sample.hit.position.x, sample.expected.x, `${walk.assetId} ${sample.side} stops X`, 6e-5);
        near(sample.hit.position.z, sample.expected.z, `${walk.assetId} ${sample.side} stops Z`, 6e-5);
        assert.ok(sample.retreatDistance > .45, `${walk.assetId} ${sample.side} can back away`);
      }
      for (const corner of walk.corners) {
        assert.equal(corner.hit.clear && corner.back.clear, true, `${walk.assetId} corner has no penetration`);
        assert.ok(corner.retreatDistance > .55, `${walk.assetId} corner allows escape`);
      }
      assert.equal(walk.circuit.length, 4);
      assert.ok(walk.circuit.every(sample => sample.clear && sample.steps > 0), `${walk.assetId} full circuit stays clear`);
      near(walk.circuit[3].position.x, walk.circuitStart.x, `${walk.assetId} circuit returns X`);
      near(walk.circuit[3].position.z, walk.circuitStart.z, `${walk.assetId} circuit returns Z`);
      if (/_SIGN_|_BOLLARD_/.test(walk.assetId)) assert.equal(walk.shoulderPassages.length, 2);
      for (const shoulder of walk.shoulderPassages) {
        assert.equal(shoulder.clear, true);
        near(shoulder.position.x, shoulder.expected.x, `${walk.assetId} narrow shoulder X`);
        near(shoulder.position.z, shoulder.expected.z, `${walk.assetId} narrow shoulder Z`);
      }
    }

    // Six views of the real, dispersed CampusBase instances. Normal first-person
    // gameplay framing avoids avatar obstruction; no clone/showroom or added light.
    for (const asset of approved) {
      const view = { assetId: asset.assetId };
      result.views.push(view);
      const positioned = await page.evaluate(async assetId => {
        const { CAMPUS_STATIC_PROPS: props } = await import('/src/campus-static-props.js');
        const { PLAYER_ORIGIN_Y, WALK_SHAPE } = await import('/src/player-dimensions.js');
        const { canOccupy } = await import('/src/world-collision.js');
        const d = window.__INHAGAME_P0__, prop = props.find(p => p.assetId === assetId);
        const meshes = d.app.root.findByName(assetId).findComponents('render').flatMap(render => render.meshInstances);
        const min = [0, 1, 2].map(axis => Math.min(...meshes.map(mesh => mesh.aabb.getMin().toArray()[axis])));
        const max = [0, 1, 2].map(axis => Math.max(...meshes.map(mesh => mesh.aabb.getMax().toArray()[axis])));
        const target = { x: (min[0] + max[0]) / 2, y: (min[1] + max[1]) / 2, z: -(min[2] + max[2]) / 2 };
        const aspect = innerWidth / innerHeight, vfov = d.orbit.camera.camera.fov * Math.PI / 180;
        const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
        const distance = Math.max(1.5, (max[1] - min[1]) / (2 * Math.tan(vfov / 2)) * 1.6,
          Math.hypot(max[0] - min[0], max[2] - min[2]) / (2 * Math.tan(hfov / 2)) * 1.5);
        // Prefer authored local +Z, so sign lettering and vending controls face
        // the reviewer even when their real-campus placement has a rotated yaw.
        const candidates = [0, 45, -45, 90, -90, 135, -135, 180].map(degrees => {
          const angle = (prop.yaw + degrees) * Math.PI / 180;
          const x = target.x + Math.sin(angle) * distance, z = target.z + Math.cos(angle) * distance;
          return { x, y: PLAYER_ORIGIN_Y + d.controller.space.groundHeight(x, z), z };
        });
        const point = candidates.find(p => canOccupy(p, WALK_SHAPE));
        if (!point) throw new Error(`${assetId} has no clear nearby gameplay view`);
        d.controller.keys.clear(); d.controller.clearAssistedMovement(); d.controller.velocityY = 0;
        d.player.setLocalPosition(point.x, point.y, point.z);
        if (!d.orbit.firstPerson) d.orbit.togglePerspective();
        d.orbit.yaw = Math.atan2(point.x - target.x, target.z - point.z);
        d.orbit.pitch = 0;
        return { frame: d.app.frame, target, point, distance, placement: prop.position };
      }, asset.assetId);
      await waitFrames(positioned.frame);
      const aimedFrame = await page.evaluate(({ target, distance }) => {
        const d = window.__INHAGAME_P0__;
        d.orbit.pitch = Math.atan2(d.orbit.camera.getPosition().y - target.y, distance);
        return d.app.frame;
      }, positioned);
      await waitFrames(aimedFrame);
      view.gameplayView = positioned;
      view.visibility = await page.evaluate(async assetId => {
        const pc = await import('playcanvas'), d = window.__INHAGAME_P0__;
        const meshes = d.app.root.findByName(assetId).findComponents('render').flatMap(render => render.meshInstances);
        const points = meshes.flatMap(mesh => {
          const min = mesh.aabb.getMin().clone(), max = mesh.aabb.getMax().clone();
          return [min.x, max.x].flatMap(x => [min.y, max.y].flatMap(y => [min.z, max.z].map(z =>
            d.orbit.camera.camera.worldToScreen(new pc.Vec3(x, y, z)))));
        });
        const left = Math.max(0, Math.floor(Math.min(...points.map(p => p.x))));
        const top = Math.max(0, Math.floor(Math.min(...points.map(p => p.y))));
        const right = Math.min(innerWidth, Math.ceil(Math.max(...points.map(p => p.x))));
        const bottom = Math.min(innerHeight, Math.ceil(Math.max(...points.map(p => p.y))));
        d.app.timeScale = 0;
        return { visibleMeshes: meshes.filter(mesh => mesh.visibleThisFrame).length,
          allInFront: points.every(point => point.z > 0), crop: { x: left, y: top, width: right - left, height: bottom - top } };
      }, asset.assetId);
      assert.equal(view.visibility.visibleMeshes, asset.meshes, `${asset.assetId} all source meshes reach the renderer`);
      assert.equal(view.visibility.allInFront, true);
      assert.ok(view.visibility.crop.width > 5 && view.visibility.crop.height > 5, `${asset.assetId} has visible projected bounds`);
      const hiddenFrame = await page.evaluate(assetId => {
        const d = window.__INHAGAME_P0__; d.app.root.findByName(assetId).enabled = false; return d.app.frame;
      }, asset.assetId);
      await waitFrames(hiddenFrame);
      const hidden = await page.screenshot();
      const visibleFrame = await page.evaluate(assetId => {
        const d = window.__INHAGAME_P0__; d.app.root.findByName(assetId).enabled = true; return d.app.frame;
      }, asset.assetId);
      await waitFrames(visibleFrame);
      view.screenshot = `${spec.name}-${asset.kind}.png`;
      const visible = await page.screenshot({ path: resolve(output, view.screenshot) });
      view.visibility.changedPixels = await page.evaluate(async ({ hidden, visible, crop }) => {
        const pixels = async encoded => {
          const img = new Image(); img.src = `data:image/png;base64,${encoded}`; await img.decode();
          const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
          return ctx.getImageData(crop.x, crop.y, crop.width, crop.height).data;
        };
        const [a, b] = await Promise.all([pixels(hidden), pixels(visible)]);
        let changed = 0;
        for (let i = 0; i < a.length; i += 4)
          if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 8) changed++;
        window.__INHAGAME_P0__.app.timeScale = 1;
        return changed;
      }, { hidden: hidden.toString('base64'), visible: visible.toString('base64'), crop: view.visibility.crop });
      assert.ok(view.visibility.changedPixels > 25, `${asset.assetId} must change real pixels inside its projected bounds`);
    }

    result.streaming = await page.evaluate(async ({ approved, worldRoot }) => {
      const { CAMPUS_STATIC_PROPS: props } = await import('/src/campus-static-props.js');
      const d = window.__INHAGAME_P0__, root = d.app.root.findByName(worldRoot);
      const entities = approved.map(asset => d.app.root.findByName(asset.assetId));
      const containers = approved.map(asset => d.app.assets.list().find(item => item.type === 'container' && item.file?.url?.endsWith(asset.url)));
      const persistent = () => root === d.app.root.findByName(worldRoot) && approved.every((asset, i) =>
        entities[i] === d.app.root.findByName(asset.assetId) &&
        containers[i] === d.app.assets.list().find(item => item.type === 'container' && item.file?.url?.endsWith(asset.url)));
      const settle = position => {
        for (let i = 0; i < d.registry.chunks.length + 2; i++) d.streaming.update(.25, position);
      };
      settle({ x: 10000, z: 10000 });
      const away = d.streaming.getMetrics(), persistentAway = persistent(), visits = [];
      for (const prop of props) {
        settle({ x: prop.position[0], z: prop.position[2] });
        visits.push({ assetId: prop.assetId, persistent: persistent(), metrics: d.streaming.getMetrics() });
      }
      return { chunks: d.registry.chunks.length, away, persistentAway, visits };
    }, { approved, worldRoot });
    assert.equal(result.streaming.persistentAway, true, 'all six base entities/containers survive eviction');
    assert.ok(result.streaming.away.chunkDestroys > 0);
    assert.equal(result.streaming.away.counts.UNLOADED, result.streaming.chunks, 'all dynamic chunks actually evicted');
    assert.equal(result.streaming.visits.length, 6);
    for (const visit of result.streaming.visits) {
      assert.equal(visit.persistent, true, `${visit.assetId} reentry preserves all six entities and containers`);
      assert.ok(visit.metrics.counts.UNLOADED < result.streaming.chunks, `${visit.assetId} dynamic chunks return`);
    }
    result.afterChunks = await readScene();
    verifyScene(result.afterChunks);
    assert.deepEqual(result.afterChunks.lights, result.initial.lights, 'streaming does not add lights');
    await verifyResponses(1);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    await settled();
    result.reload = await readScene();
    verifyScene(result.reload);
    assert.deepEqual(result.reload.lights, result.initial.lights, 'reload does not add lights');
    await verifyResponses(2);
    result.problems = [...smoke.problems];
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.warnings, [], 'no console/runtime warnings');
    result.pass = true;
    console.log(`campus static props ${spec.name}: PASS`, JSON.stringify({
      assets: approved.length, views: result.views.map(view => ({ assetId: view.assetId, changedPixels: view.visibility.changedPixels })),
      walkingCases: result.walks.length, allChunksEvicted: result.streaming.away.counts.UNLOADED,
      reload: result.reload.status, warnings: result.warnings, problems: result.problems
    }));
  } catch (error) {
    result.problems = [...(smoke?.problems ?? [])];
    result.error = String(error?.stack ?? error);
    if (page && !page.isClosed()) await page.screenshot({ path: resolve(output, `${spec.name}-failure.png`) }).catch(() => {});
    throw error;
  } finally {
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
    await smoke?.close();
  }
}
