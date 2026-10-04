import assert from 'node:assert/strict';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';

const smoke = await startSmoke();

try {
  const page = await smoke.context.newPage();
  smoke.watch(page);

  await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS
  });

  await page.waitForFunction(
    () =>
      window.__INHAGAME_ENVIRONMENT__?.status?.().settled &&
      window.__INHAGAME_ENVIRONMENT__?.status?.().weatherSettled &&
      window.__INHAGAME_P0__?.getStatus?.().loading?.finished,
    null,
    { timeout: TIMEOUT_MS }
  );

  const result = await page.evaluate(async () => {
    const kit = await import('/src/campus-render-kit.js');
    const profile = await import('/src/campus-material-profile.js');
    const sampleColors = {
      ground: '#8b9274',
      asphalt: '#747d7b',
      concrete: '#b4b4a8',
      brick: '#ac7965',
      paint: '#e6e4d3',
      metal: '#e1e3df',
      glass: '#548d99',
      wood: '#8d6848',
      foliage: '#527447',
      rubber: '#303735'
    };

    const materials = Object.fromEntries(
      Object.entries(sampleColors).map(([name, color]) => {
        const material = kit.surface(color);
        return [name, {
          inferred: profile.inferCampusMaterialProfile(color),
          materialName: material.name,
          gloss: material.gloss,
          reflectivity: material.reflectivity,
          specular: [material.specular.r, material.specular.g, material.specular.b],
          diffuse: [material.diffuse.r, material.diffuse.g, material.diffuse.b]
        }];
      })
    );

    const glassA = kit.surface('#548d99');
    const glassB = kit.surface('#548d99');
    const glassNeutral = kit.surface('#548d99', 'neutral');

    const terrain = window.__INHAGAME_P0__.app.root.findByName('campus_terrain');
    const crowns = window.__INHAGAME_P0__.app.root.find(entity =>
      entity.name?.endsWith('_crown') && entity.render?.meshInstances?.length
    );

    return {
      materials,
      sameGlassInstance: glassA === glassB,
      overrideUsesSeparateInstance: glassA !== glassNeutral,
      cache: kit.campusMaterialCacheStatus(),
      terrainMaterial: terrain?.render?.meshInstances?.[0]?.material?.name ?? null,
      foliageMaterialNames: (crowns ?? []).slice(0, 10).map(entity =>
        entity.render.meshInstances[0].material.name
      )
    };
  });

  for (const [name, material] of Object.entries(result.materials)) {
    assert.equal(material.inferred, name);
    assert.match(material.materialName, new RegExp(`^campus-material-${name}:`));
    assert.ok(Number.isFinite(material.gloss));
    assert.ok(Number.isFinite(material.reflectivity));
    assert.equal(material.specular.length, 3);
    assert.equal(material.diffuse.length, 3);
  }

  assert.ok(result.materials.asphalt.gloss < result.materials.concrete.gloss);
  assert.ok(result.materials.concrete.gloss < result.materials.metal.gloss);
  assert.ok(result.materials.metal.gloss < result.materials.glass.gloss);
  assert.ok(result.materials.foliage.gloss < result.materials.wood.gloss);
  assert.ok(result.materials.glass.reflectivity > result.materials.metal.reflectivity);
  assert.equal(result.sameGlassInstance, true, 'same color/profile must reuse one material');
  assert.equal(result.overrideUsesSeparateInstance, true, 'explicit profile override gets distinct cache entry');
  assert.equal(result.terrainMaterial, 'campus-material-ground:#8b9274');
  assert.ok(result.foliageMaterialNames.length > 0);
  assert.ok(result.foliageMaterialNames.every(name => name.startsWith('campus-material-foliage:')));

  for (const name of [
    'ground', 'asphalt', 'concrete', 'brick', 'paint',
    'metal', 'glass', 'wood', 'foliage', 'rubber'
  ]) assert.ok(result.cache.profiles[name] >= 1, `cache exposes ${name} material profile`);

  assert.deepEqual(smoke.problems, []);
  console.log(
    `campus material P7A: PASS (${result.cache.materialCount} cached materials, semantic optical profiles, zero geometry additions)`
  );
} finally {
  await smoke.close();
}
