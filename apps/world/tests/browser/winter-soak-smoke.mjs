import assert from 'node:assert/strict';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
import {
  WINTER_SOAK_CONTRACT,
  WINTER_SOAK_CYCLES,
  WINTER_SOAK_WEATHER_SEQUENCE
} from '../../src/environment/winter-soak-policy.js';

const smoke = await startSmoke();

try {
  const page = await smoke.context.newPage();
  smoke.watch(page);

  await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=snow`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS
  });

  await page.waitForFunction(
    () =>
      window.__INHAGAME_ENVIRONMENT__?.status?.().weatherSettled &&
      window.__INHAGAME_ENVIRONMENT__?.status?.().targetWeather === 'SNOW' &&
      window.__INHAGAME_SNOW__?.status?.().snowIntensity >= 0.999 &&
      window.__INHAGAME_WINTER_QA__?.status?.().withinBudget === true &&
      window.__INHAGAME_P0__?.getStatus?.().loading?.finished,
    null,
    { timeout: TIMEOUT_MS }
  );

  await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    for (let i = 0; i < 32; i++) d.app.fire('update', 0.1);
  });

  await page.waitForFunction(
    () => window.__INHAGAME_SNOW__.status().groundAccumulation > 0.3,
    null,
    { timeout: TIMEOUT_MS }
  );

  await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    const p = d.player.getLocalPosition();
    window.__P6L_PLAYER_ORIGIN__ = { x: p.x, y: p.y, z: p.z };
    d.player.setLocalPosition(p.x + 0.68, p.y, p.z);
    for (let i = 0; i < 3; i++) d.app.fire('update', 0.05);
  });

  await page.waitForFunction(
    () => window.__INHAGAME_SNOW__.status().footprintCount > 0,
    null,
    { timeout: TIMEOUT_MS }
  );

  const baseline = await page.evaluate(() => {
    const root = window.__INHAGAME_P0__.app.root;
    const isWinter = name =>
      name === 'EnvironmentSnowRoot' ||
      name === 'EnvironmentSnowGroundRoot' ||
      name.startsWith('environment_snow_') ||
      name.startsWith('environment_meltwater_');

    const collect = () => {
      const entities = [];
      const meshInstances = [];
      const meshes = [];
      const materials = [];

      const walk = entity => {
        if (isWinter(entity.name || '')) {
          entities.push(entity);
          const instances = entity.render?.meshInstances ?? [];
          for (const instance of instances) {
            meshInstances.push(instance);
            meshes.push(instance.mesh);
            materials.push(instance.material);
          }
        }
        for (const child of entity.children ?? []) walk(child);
      };
      walk(root);

      return { entities, meshInstances, meshes, materials };
    };

    const refs = collect();
    window.__P6L_WINTER_BASELINE__ = refs;
    const snow = window.__INHAGAME_SNOW__.status();
    return {
      entityCount: refs.entities.length,
      meshInstanceCount: refs.meshInstances.length,
      meshCount: refs.meshes.length,
      materialCount: refs.materials.length,
      footprintMeshUpdates: snow.footprintMeshUpdates,
      footprintCount: snow.footprintCount,
      winterQa: window.__INHAGAME_WINTER_QA__.status()
    };
  });

  assert.ok(baseline.entityCount > 0);
  assert.ok(baseline.meshInstanceCount > 0);
  assert.equal(baseline.meshCount, baseline.meshInstanceCount);
  assert.equal(baseline.materialCount, baseline.meshInstanceCount);
  assert.ok(baseline.footprintCount > 0);
  assert.ok(baseline.footprintMeshUpdates >= 1);
  assert.equal(baseline.winterQa.withinBudget, true);
  assert.deepEqual(baseline.winterQa.violations, []);

  const soakResult = await page.evaluate(
    ({ cycles, sequence }) => {
      const root = window.__INHAGAME_P0__.app.root;
      const d = window.__INHAGAME_P0__;
      const baseline = window.__P6L_WINTER_BASELINE__;
      const isWinter = name =>
        name === 'EnvironmentSnowRoot' ||
        name === 'EnvironmentSnowGroundRoot' ||
        name.startsWith('environment_snow_') ||
        name.startsWith('environment_meltwater_');

      const collect = () => {
        const entities = [];
        const meshInstances = [];
        const meshes = [];
        const materials = [];

        const walk = entity => {
          if (isWinter(entity.name || '')) {
            entities.push(entity);
            const instances = entity.render?.meshInstances ?? [];
            for (const instance of instances) {
              meshInstances.push(instance);
              meshes.push(instance.mesh);
              materials.push(instance.material);
            }
          }
          for (const child of entity.children ?? []) walk(child);
        };
        walk(root);

        return { entities, meshInstances, meshes, materials };
      };

      const sameRefs = (left, right) =>
        left.length === right.length && left.every((value, index) => value === right[index]);

      const samples = [];
      let stableEntities = true;
      let stableMeshInstances = true;
      let stableMeshes = true;
      let stableMaterials = true;
      let allWithinBudget = true;
      let maxDrawMeshes = 0;
      let maxTrackedVertices = 0;

      const initialFootprintUpdates = window.__INHAGAME_SNOW__.status().footprintMeshUpdates;

      for (let i = 0; i < cycles; i++) {
        const weather = sequence[i % sequence.length];
        window.__INHAGAME_ENVIRONMENT__.setWeather(weather, { immediate: true });

        // Accelerated soak: exercise all update subscribers without waiting wall-clock minutes.
        for (let tick = 0; tick < 5; tick++) d.app.fire('update', 0.05);

        const current = collect();
        const qa = window.__INHAGAME_WINTER_QA__.status();

        stableEntities &&= sameRefs(current.entities, baseline.entities);
        stableMeshInstances &&= sameRefs(current.meshInstances, baseline.meshInstances);
        stableMeshes &&= sameRefs(current.meshes, baseline.meshes);
        stableMaterials &&= sameRefs(current.materials, baseline.materials);
        allWithinBudget &&= qa.withinBudget && qa.violations.length === 0;
        maxDrawMeshes = Math.max(maxDrawMeshes, qa.drawMeshes);
        maxTrackedVertices = Math.max(maxTrackedVertices, qa.trackedVertices);

        samples.push({
          weather,
          drawMeshes: qa.drawMeshes,
          trackedVertices: qa.trackedVertices,
          withinBudget: qa.withinBudget
        });
      }

      const finalRefs = collect();
      const finalSnow = window.__INHAGAME_SNOW__.status();

      return {
        cycles,
        samples,
        baselineEntityCount: baseline.entities.length,
        finalEntityCount: finalRefs.entities.length,
        baselineMeshInstanceCount: baseline.meshInstances.length,
        finalMeshInstanceCount: finalRefs.meshInstances.length,
        stableEntities,
        stableMeshInstances,
        stableMeshes,
        stableMaterials,
        initialFootprintUpdates,
        finalFootprintUpdates: finalSnow.footprintMeshUpdates,
        passiveFootprintMeshRebuilds:
          finalSnow.footprintMeshUpdates - initialFootprintUpdates,
        finalFootprintCount: finalSnow.footprintCount,
        allWithinBudget,
        maxDrawMeshes,
        maxTrackedVertices,
        finalQa: window.__INHAGAME_WINTER_QA__.status()
      };
    },
    {
      cycles: WINTER_SOAK_CYCLES,
      sequence: [...WINTER_SOAK_WEATHER_SEQUENCE]
    }
  );

  assert.equal(soakResult.cycles, WINTER_SOAK_CYCLES);
  assert.equal(soakResult.samples.length, WINTER_SOAK_CYCLES);
  assert.equal(
    soakResult.finalEntityCount - soakResult.baselineEntityCount,
    WINTER_SOAK_CONTRACT.entityGrowth
  );
  assert.equal(
    soakResult.finalMeshInstanceCount - soakResult.baselineMeshInstanceCount,
    WINTER_SOAK_CONTRACT.meshInstanceGrowth
  );
  assert.equal(soakResult.stableEntities, true, 'winter entity identities must remain stable');
  assert.equal(soakResult.stableMeshInstances, true, 'winter MeshInstance identities must remain stable');
  assert.equal(soakResult.stableMeshes, true, 'winter Mesh objects must be reused across weather cycles');
  assert.equal(soakResult.stableMaterials, true, 'winter materials must be reused across weather cycles');
  assert.equal(
    soakResult.passiveFootprintMeshRebuilds,
    WINTER_SOAK_CONTRACT.passiveFootprintMeshRebuilds,
    'weather-only cycles must not rebuild the dynamic footprint mesh'
  );
  assert.equal(soakResult.allWithinBudget, true);
  assert.equal(soakResult.finalQa.withinBudget, true);
  assert.deepEqual(soakResult.finalQa.violations, []);
  assert.ok(soakResult.maxDrawMeshes <= soakResult.finalQa.budget.drawMeshes);
  assert.ok(soakResult.maxTrackedVertices <= soakResult.finalQa.budget.trackedVertices);
  assert.ok(
    soakResult.samples.some(sample => sample.weather === 'snow' && sample.drawMeshes > 0),
    'soak must exercise active winter rendering'
  );
  assert.ok(
    soakResult.samples.some(sample => sample.weather === 'rain'),
    'soak must exercise thaw/rain transitions'
  );

  await page.evaluate(() => {
    const p = window.__P6L_PLAYER_ORIGIN__;
    if (p) window.__INHAGAME_P0__.player.setLocalPosition(p.x, p.y, p.z);
    delete window.__P6L_PLAYER_ORIGIN__;
    delete window.__P6L_WINTER_BASELINE__;
  });

  assert.deepEqual(smoke.problems, []);
  console.log(
    `winter soak P6L: PASS (${WINTER_SOAK_CYCLES} accelerated cycles, ` +
    `${soakResult.baselineEntityCount} stable winter entities, ` +
    `${soakResult.baselineMeshInstanceCount} stable mesh instances, ` +
    `max ${soakResult.maxDrawMeshes} draws / ${soakResult.maxTrackedVertices} tracked vertices)`
  );
} finally {
  await smoke.close();
}
