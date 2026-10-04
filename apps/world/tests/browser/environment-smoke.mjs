import assert from 'node:assert/strict';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';

const smoke = await startSmoke();
try {
  const page = await smoke.context.newPage();
  smoke.watch(page);
  await page.goto(`${smoke.origin}/campus/?envTime=sunset&envWeather=fog`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS
  });
  await page.waitForFunction(
    () => window.__INHAGAME_ENVIRONMENT__?.status?.().settled &&
      window.__INHAGAME_ENVIRONMENT__?.status?.().weatherSettled &&
      window.__INHAGAME_NIGHT_LIGHTS__?.status?.().artificialLightFactor >= 0.17 &&
      window.__INHAGAME_NIGHT_WINDOWS__?.status?.().glowFactor > 0 &&
      window.__INHAGAME_RAIN__?.status &&
      window.__INHAGAME_SNOW__?.status &&
      window.__INHAGAME_POND_WEATHER__?.status?.() &&
      window.__INHAGAME_SKY__?.status?.() &&
      window.__INHAGAME_P0__?.getStatus?.().loading?.finished,
    null,
    { timeout: TIMEOUT_MS }
  );

  const initial = await page.evaluate(() => ({
    environment: window.__INHAGAME_ENVIRONMENT__.status(),
    streetLights: window.__INHAGAME_NIGHT_LIGHTS__.status(),
    nightWindows: window.__INHAGAME_NIGHT_WINDOWS__.status(),
    rain: window.__INHAGAME_RAIN__.status(),
    snow: window.__INHAGAME_SNOW__.status(),
    snowObjects: window.__INHAGAME_SNOW_OBJECTS__.status(),
    snowDepth: window.__INHAGAME_SNOW_DEPTH__.status(),
    snowThaw: window.__INHAGAME_SNOW_THAW__.status(),
    meltwater: window.__INHAGAME_MELTWATER__.status(),
    winterQa: window.__INHAGAME_WINTER_QA__.status(),
    pond: window.__INHAGAME_POND_WEATHER__.status(),
    sky: window.__INHAGAME_SKY__.status(),
    graphics: window.__INHAGAME_P0__.getStatus().graphics
  }));
  assert.equal(initial.environment.targetTime, 'SUNSET');
  assert.equal(initial.environment.targetWeather, 'FOG');
  assert.equal(initial.environment.fog.type, 'linear');
  assert.equal(initial.environment.rainIntensity, 0);
  assert.equal(initial.environment.wetness, 0);
  assert.equal(initial.rain.rainEnabled, false);
  assert.equal(initial.rain.wetGroundEnabled, false);
  assert.equal(initial.snow.enabled, false);
  assert.equal(initial.snow.snowIntensity, 0);
  assert.equal(initial.snow.groundEnabled, false);
  assert.equal(initial.snow.groundDrawMeshes, 0);
  assert.equal(initial.snow.footprintEnabled, false);
  assert.equal(initial.snow.footprintCount, 0);
  assert.equal(initial.snow.footprintDrawMeshes, 0);
  assert.equal(initial.snow.extraRealLights, 0);
  assert.equal(initial.snowObjects.enabled, false);
  assert.equal(initial.snowObjects.drawMeshes, 0);
  assert.equal(initial.snowObjects.snowAccumulation, 0);
  assert.equal(initial.snowObjects.extraRealLights, 0);
  assert.equal(initial.snowObjects.extraShadowCasters, 0);
  assert.equal(initial.snowDepth.enabled, false);
  assert.equal(initial.snowDepth.drawMeshes, 0);
  assert.equal(initial.snowDepth.snowDrawMeshes, 0);
  assert.equal(initial.snowDepth.plowDrawMeshes, 0);
  assert.equal(initial.snowDepth.extraRealLights, 0);
  assert.equal(initial.snowDepth.extraShadowCasters, 0);
  assert.equal(initial.snowThaw.enabled, false);
  assert.equal(initial.snowThaw.drawMeshes, 0);
  assert.equal(initial.snowThaw.slushDrawMeshes, 0);
  assert.equal(initial.snowThaw.iceDrawMeshes, 0);
  assert.equal(initial.snowThaw.extraRealLights, 0);
  assert.equal(initial.snowThaw.extraShadowCasters, 0);
  assert.equal(initial.snowThaw.externalTextures, 0);
  assert.equal(initial.meltwater.enabled, false);
  assert.equal(initial.meltwater.drawMeshes, 0);
  assert.equal(initial.meltwater.dripDrawMeshes, 0);
  assert.equal(initial.meltwater.runoffDrawMeshes, 0);
  assert.equal(initial.meltwater.extraRealLights, 0);
  assert.equal(initial.meltwater.extraShadowCasters, 0);
  assert.equal(initial.meltwater.externalTextures, 0);
  assert.equal(initial.meltwater.networkRequests, 0);
  assert.equal(initial.winterQa.withinBudget, true);
  assert.deepEqual(initial.winterQa.violations, []);
  assert.equal(initial.winterQa.drawMeshes, 0);
  assert.equal(initial.winterQa.trackedVertices, 0);
  assert.equal(initial.winterQa.resources.realLights, 0);
  assert.equal(initial.winterQa.resources.shadowCasters, 0);
  assert.equal(initial.winterQa.resources.externalTextures, 0);
  assert.equal(initial.winterQa.resources.networkRequests, 0);
  assert.equal(initial.pond.rainIntensity, 0);
  assert.equal(initial.pond.artificialLightFactor, 0.18);
  assert.equal(initial.pond.rippleSpeed, 0.025);
  assert.equal(initial.sky.cloudDrawMeshes, initial.sky.cloudLayerCount);
  assert.ok(initial.sky.cloudLayerCount >= 1 && initial.sky.cloudLayerCount <= 3);
  assert.ok(initial.sky.cloudPatchCount >= 6 && initial.sky.cloudPatchCount <= 16);
  assert.equal(
    initial.sky.cloudLayers.reduce((sum, layer) => sum + layer.patchCount, 0),
    initial.sky.cloudPatchCount
  );
  for (let i = 1; i < initial.sky.cloudLayers.length; i++) {
    assert.ok(initial.sky.cloudLayers[i].altitudeMin > initial.sky.cloudLayers[i - 1].altitudeMin);
    assert.ok(initial.sky.cloudLayers[i].driftDegPerSec < initial.sky.cloudLayers[i - 1].driftDegPerSec);
  }
  assert.equal(initial.sky.sunVisible, true);
  assert.ok(initial.sky.sunOpacity > 0);
  assert.equal(initial.sky.sunDrawMeshes, 1);
  assert.equal(initial.sky.atmosphereDrawMeshes, 1);
  assert.ok(initial.sky.atmosphereVertexCount < 200);
  assert.ok(initial.sky.atmosphereSunsetFactor > 0.5);
  assert.ok(initial.sky.sunGlowOpacity > 0);
  assert.equal(initial.sky.sunGlowDrawMeshes, 1);
  assert.ok(Math.abs(initial.sky.sunShadowAlignmentDot + 1) < 1e-6);
  assert.ok(initial.environment.fog.start < initial.environment.fog.end);
  assert.ok(initial.environment.exposure < 1.05 && initial.environment.exposure > 0.82);
  assert.equal(initial.environment.artificialLightFactor, 0.18);
  assert.equal(initial.streetLights.artificialLightFactor, 0.18);
  assert.ok(initial.streetLights.lampCount > 0);
  assert.equal(initial.streetLights.bulbCount, initial.streetLights.lampCount);
  assert.ok(initial.streetLights.dynamicBudget >= 0 && initial.streetLights.dynamicBudget <= 4);
  assert.ok(initial.streetLights.activeDynamicLights <= initial.streetLights.dynamicBudget);
  assert.equal(initial.nightWindows.realLights, 0);
  assert.equal(initial.nightWindows.drawMeshes, 1);
  assert.ok(initial.nightWindows.glowFactor > 0 && initial.nightWindows.glowFactor < 0.25);
  assert.ok(initial.nightWindows.litWindowCount > 0);
  assert.ok(initial.nightWindows.litWindowCount <= initial.nightWindows.maxWindowBudget);

  await page.evaluate(() => {
    window.__INHAGAME_ENVIRONMENT__.setTimeOfDay('day', { immediate: true });
    window.__INHAGAME_ENVIRONMENT__.setWeather('clear', { immediate: true });
  });
  await page.waitForFunction(
    () => window.__INHAGAME_ENVIRONMENT__.status().targetWeather === 'CLEAR' &&
      window.__INHAGAME_ENVIRONMENT__.status().weatherSettled &&
      window.__INHAGAME_SKY__.status().sunVisible === true &&
      window.__INHAGAME_NIGHT_WINDOWS__.status().glowFactor === 0,
    null,
    { timeout: TIMEOUT_MS }
  );
  const dayClear = await page.evaluate(() => ({
    environment: window.__INHAGAME_ENVIRONMENT__.status(),
    rain: window.__INHAGAME_RAIN__.status(),
    nightWindows: window.__INHAGAME_NIGHT_WINDOWS__.status(),
    sky: window.__INHAGAME_SKY__.status()
  }));
  assert.equal(dayClear.environment.targetWeather, 'CLEAR');
  assert.equal(dayClear.environment.fog.type, 'none');
  assert.equal(dayClear.environment.rainIntensity, 0);
  assert.equal(dayClear.environment.wetness, 0);
  assert.equal(dayClear.rain.rainEnabled, false);
  assert.equal(dayClear.rain.wetGroundEnabled, false);
  assert.equal(dayClear.nightWindows.enabled, false);
  assert.equal(dayClear.nightWindows.drawMeshes, 0);
  assert.equal(dayClear.nightWindows.glowFactor, 0);
  assert.equal(dayClear.sky.atmosphereDrawMeshes, 1);
  assert.equal(dayClear.sky.atmosphereSunsetFactor, 0);
  assert.ok(dayClear.sky.atmosphereHazeStrength > 0);
  assert.ok(dayClear.sky.atmosphereHorizonColor[2] > dayClear.sky.atmosphereHorizonColor[0]);
  assert.ok(dayClear.sky.atmosphereZenithColor[2] > dayClear.sky.atmosphereZenithColor[0]);
  assert.ok(dayClear.sky.sunGlowOpacity > 0.2);
  assert.equal(dayClear.sky.sunGlowDrawMeshes, 1);
  assert.ok(Math.abs(dayClear.sky.sunShadowAlignmentDot + 1) < 1e-6);
  assert.deepEqual(
    dayClear.sky.shadowRayDirection.map((value, index) => value + dayClear.sky.sunDirection[index]),
    [0, 0, 0]
  );

  await page.evaluate(() => window.__INHAGAME_ENVIRONMENT__.setWeather('cloudy'));
  await page.waitForFunction(
    () => window.__INHAGAME_ENVIRONMENT__.status().targetWeather === 'CLOUDY' &&
      window.__INHAGAME_ENVIRONMENT__.status().weatherSettled,
    null,
    { timeout: TIMEOUT_MS }
  );
  const cloudy = await page.evaluate(() => ({
    environment: window.__INHAGAME_ENVIRONMENT__.status(),
    rain: window.__INHAGAME_RAIN__.status(),
    sky: window.__INHAGAME_SKY__.status()
  }));
  assert.equal(cloudy.environment.targetWeather, 'CLOUDY');
  assert.equal(cloudy.environment.fog.type, 'none');
  assert.equal(cloudy.environment.rainIntensity, 0);
  assert.equal(cloudy.environment.wetness, 0);
  assert.equal(cloudy.rain.rainEnabled, false);
  assert.equal(cloudy.rain.wetGroundEnabled, false);
  assert.ok(cloudy.environment.cloudCover > dayClear.environment.cloudCover);
  assert.ok(cloudy.sky.cloudCover > dayClear.sky.cloudCover);
  assert.ok(cloudy.sky.cloudOpacity > dayClear.sky.cloudOpacity);
  assert.ok(cloudy.sky.sunOpacity < dayClear.sky.sunOpacity);
  assert.ok(cloudy.sky.sunLightScale < dayClear.sky.sunLightScale);
  assert.equal(cloudy.sky.sunVisible, true);
  assert.ok(cloudy.sky.sunGlowOpacity < dayClear.sky.sunGlowOpacity);
  assert.ok(
    cloudy.sky.atmosphereZenithColor.reduce((sum, value) => sum + value, 0) <
    dayClear.sky.atmosphereZenithColor.reduce((sum, value) => sum + value, 0)
  );

  await page.evaluate(() => window.__INHAGAME_ENVIRONMENT__.setWeather('snow'));
  await page.waitForFunction(
    () => window.__INHAGAME_ENVIRONMENT__.status().targetWeather === 'SNOW' &&
      window.__INHAGAME_ENVIRONMENT__.status().weatherSettled &&
      window.__INHAGAME_SNOW__.status().snowIntensity >= 0.999,
    null,
    { timeout: TIMEOUT_MS }
  );
  const snowDay = await page.evaluate(() => ({
    environment: window.__INHAGAME_ENVIRONMENT__.status(),
    rain: window.__INHAGAME_RAIN__.status(),
    snow: window.__INHAGAME_SNOW__.status(),
    snowObjects: window.__INHAGAME_SNOW_OBJECTS__.status(),
    snowDepth: window.__INHAGAME_SNOW_DEPTH__.status(),
    snowThaw: window.__INHAGAME_SNOW_THAW__.status(),
    meltwater: window.__INHAGAME_MELTWATER__.status(),
    winterQa: window.__INHAGAME_WINTER_QA__.status(),
    sky: window.__INHAGAME_SKY__.status()
  }));
  assert.equal(snowDay.environment.targetWeather, 'SNOW');
  assert.equal(snowDay.environment.fog.type, 'linear');
  assert.equal(snowDay.environment.rainIntensity, 0);
  assert.equal(snowDay.environment.snowIntensity, 1);
  assert.equal(snowDay.environment.wetness, 0);
  assert.equal(snowDay.rain.rainEnabled, false);
  assert.equal(snowDay.rain.wetGroundEnabled, false);
  assert.equal(snowDay.snow.enabled, true);
  assert.equal(snowDay.snow.drawMeshes, 1);
  assert.ok(snowDay.snow.flakeBudget >= 36 && snowDay.snow.flakeBudget <= 120);
  assert.ok(snowDay.snow.opacity > 0);
  assert.equal(snowDay.snow.groundEnabled, true);
  assert.ok(snowDay.snow.groundAccumulation > 0);
  assert.ok(snowDay.snow.groundLawnOpacity > 0);
  assert.ok(snowDay.snow.groundDrawMeshes >= 1 && snowDay.snow.groundDrawMeshes <= 2);
  if (snowDay.snow.graphicsTier === 'low') {
    assert.equal(snowDay.snow.groundRoadEnabled, false);
    assert.equal(snowDay.snow.groundRoadOpacity, 0);
    assert.equal(snowDay.snow.groundDrawMeshes, 1);
  } else {
    assert.equal(snowDay.snow.groundRoadEnabled, true);
    assert.ok(snowDay.snow.groundRoadOpacity > 0);
    assert.equal(snowDay.snow.groundDrawMeshes, 2);
  }
  assert.equal(snowDay.snow.footprintEnabled, true);
  assert.equal(snowDay.snow.footprintCount, 0);
  assert.equal(snowDay.snow.footprintDrawMeshes, 0);
  assert.ok(snowDay.snow.footprintBudget >= 12 && snowDay.snow.footprintBudget <= 28);
  assert.ok(snowDay.snow.footprintOpacity > 0);
  assert.equal(snowDay.snow.extraRealLights, 0);
  assert.equal(snowDay.snowObjects.enabled, true);
  assert.equal(snowDay.snowObjects.drawMeshes, 1);
  assert.ok(snowDay.snowObjects.opacity > 0);
  assert.ok(snowDay.snowObjects.roofSurfaceCount > 0);
  assert.equal(
    snowDay.snowObjects.benchSurfaceCount,
    Math.min(snowDay.snowObjects.availableBenchCount, snowDay.snowObjects.benchBudget)
  );
  assert.equal(
    snowDay.snowObjects.lampSurfaceCount,
    Math.min(snowDay.snowObjects.availableLampCount, snowDay.snowObjects.lampBudget)
  );
  assert.equal(
    snowDay.snowObjects.totalSurfaceCount,
    snowDay.snowObjects.roofSurfaceCount +
      snowDay.snowObjects.benchSurfaceCount +
      snowDay.snowObjects.lampSurfaceCount
  );
  assert.ok(snowDay.snowObjects.vertexCount > 0);
  assert.ok(snowDay.snowObjects.indexCount > 0);
  assert.equal(snowDay.snowObjects.extraRealLights, 0);
  assert.equal(snowDay.snowObjects.extraShadowCasters, 0);
  assert.equal(snowDay.snowDepth.enabled, true);
  assert.equal(snowDay.snowDepth.snowDrawMeshes, 1);
  assert.ok(snowDay.snowDepth.edgeLipCount > 0);
  assert.ok(snowDay.snowDepth.edgeLipCount <= snowDay.snowDepth.edgeLipBudget);
  assert.ok(snowDay.snowDepth.driftCount > 0);
  assert.ok(snowDay.snowDepth.driftCount <= snowDay.snowDepth.driftBudget);
  assert.ok(snowDay.snowDepth.snowVertexCount > 0);
  if (snowDay.snowDepth.graphicsTier === 'low') {
    assert.equal(snowDay.snowDepth.plowTraceBudget, 0);
    assert.equal(snowDay.snowDepth.plowTraceCount, 0);
    assert.equal(snowDay.snowDepth.plowDrawMeshes, 0);
    assert.equal(snowDay.snowDepth.drawMeshes, 1);
  } else {
    assert.ok(snowDay.snowDepth.plowTraceCount > 0);
    assert.ok(snowDay.snowDepth.plowTraceCount <= snowDay.snowDepth.plowTraceBudget);
    assert.equal(snowDay.snowDepth.plowDrawMeshes, 1);
    assert.equal(snowDay.snowDepth.drawMeshes, 2);
    assert.ok(snowDay.snowDepth.plowOpacity > 0);
  }
  assert.equal(snowDay.snowDepth.extraRealLights, 0);
  assert.equal(snowDay.snowDepth.extraShadowCasters, 0);
  assert.equal(snowDay.snowThaw.enabled, false);
  assert.equal(snowDay.snowThaw.drawMeshes, 0);
  assert.equal(snowDay.snowThaw.thawGate, 0);
  assert.equal(snowDay.snowThaw.extraRealLights, 0);
  assert.equal(snowDay.snowThaw.extraShadowCasters, 0);
  assert.equal(snowDay.snowThaw.externalTextures, 0);
  assert.equal(snowDay.meltwater.enabled, false);
  assert.equal(snowDay.meltwater.drawMeshes, 0);
  assert.equal(snowDay.meltwater.thawGate, 0);
  assert.equal(snowDay.meltwater.extraRealLights, 0);
  assert.equal(snowDay.meltwater.extraShadowCasters, 0);
  assert.equal(snowDay.meltwater.externalTextures, 0);
  assert.equal(snowDay.meltwater.networkRequests, 0);
  assert.equal(snowDay.winterQa.withinBudget, true);
  assert.deepEqual(snowDay.winterQa.violations, []);
  assert.ok(snowDay.winterQa.drawMeshes <= snowDay.winterQa.budget.drawMeshes);
  assert.ok(snowDay.winterQa.trackedVertices <= snowDay.winterQa.budget.trackedVertices);
  assert.ok(
    snowDay.winterQa.dynamicFootprintVertices <=
      snowDay.winterQa.budget.dynamicFootprintVertices
  );
  assert.deepEqual(snowDay.winterQa.resources, {
    realLights: 0,
    shadowCasters: 0,
    externalTextures: 0,
    networkRequests: 0
  });

  await page.evaluate(() => {
    const p = window.__INHAGAME_P0__.player.getLocalPosition();
    window.__P6F_SNOW_ORIGIN__ = { x: p.x, y: p.y, z: p.z };
    window.__INHAGAME_P0__.player.setLocalPosition(p.x + 0.65, p.y, p.z);
  });
  await page.waitForFunction(
    () => window.__INHAGAME_SNOW__.status().footprintCount > 0,
    null,
    { timeout: TIMEOUT_MS }
  );
  const snowFootprints = await page.evaluate(() => window.__INHAGAME_SNOW__.status());
  const winterFootprintQa = await page.evaluate(() => window.__INHAGAME_WINTER_QA__.status());
  assert.ok(snowFootprints.footprintCount > 0);
  assert.ok(snowFootprints.footprintCount <= snowFootprints.footprintBudget);
  assert.equal(snowFootprints.footprintDrawMeshes, 1);
  assert.ok(snowFootprints.footprintMeshUpdates >= 1);
  assert.equal(winterFootprintQa.withinBudget, true);
  assert.ok(winterFootprintQa.drawMeshes <= winterFootprintQa.budget.drawMeshes);
  assert.ok(winterFootprintQa.trackedVertices <= winterFootprintQa.budget.trackedVertices);
  assert.deepEqual(winterFootprintQa.violations, []);
  await page.evaluate(() => {
    const p = window.__P6F_SNOW_ORIGIN__;
    window.__INHAGAME_P0__.player.setLocalPosition(p.x, p.y, p.z);
    delete window.__P6F_SNOW_ORIGIN__;
  });

  assert.equal(snowDay.sky.snowIntensity, 1);
  assert.ok(snowDay.sky.cloudCover > cloudy.sky.cloudCover);
  assert.ok(snowDay.sky.cloudOpacity > cloudy.sky.cloudOpacity);
  assert.ok(snowDay.sky.sunOpacity < cloudy.sky.sunOpacity);
  assert.equal(snowDay.sky.sunVisible, true);

  await page.evaluate(() => {
    window.__INHAGAME_ENVIRONMENT__.setTimeOfDay('night');
    window.__INHAGAME_ENVIRONMENT__.setWeather('rain');
  });
  await page.waitForFunction(
    () => window.__INHAGAME_ENVIRONMENT__.status().settled &&
      window.__INHAGAME_ENVIRONMENT__.status().weatherSettled &&
      window.__INHAGAME_ENVIRONMENT__.status().targetTime === 'NIGHT' &&
      window.__INHAGAME_ENVIRONMENT__.status().targetWeather === 'RAIN' &&
      window.__INHAGAME_NIGHT_LIGHTS__.status().artificialLightFactor >= 0.999 &&
      window.__INHAGAME_NIGHT_WINDOWS__.status().glowFactor >= 0.999 &&
      window.__INHAGAME_RAIN__.status().rainIntensity >= 0.999 &&
      window.__INHAGAME_RAIN__.status().wetness >= 0.999 &&
      window.__INHAGAME_SNOW__.status().snowIntensity === 0 &&
      window.__INHAGAME_POND_WEATHER__.status().rainIntensity >= 0.999 &&
      window.__INHAGAME_POND_WEATHER__.status().artificialLightFactor >= 0.999 &&
      window.__INHAGAME_SKY__.status().sunVisible === false,
    null,
    { timeout: TIMEOUT_MS }
  );
  const nightRain = await page.evaluate(() => ({
    environment: window.__INHAGAME_ENVIRONMENT__.status(),
    streetLights: window.__INHAGAME_NIGHT_LIGHTS__.status(),
    nightWindows: window.__INHAGAME_NIGHT_WINDOWS__.status(),
    rain: window.__INHAGAME_RAIN__.status(),
    snow: window.__INHAGAME_SNOW__.status(),
    snowThaw: window.__INHAGAME_SNOW_THAW__.status(),
    meltwater: window.__INHAGAME_MELTWATER__.status(),
    winterQa: window.__INHAGAME_WINTER_QA__.status(),
    pond: window.__INHAGAME_POND_WEATHER__.status(),
    sky: window.__INHAGAME_SKY__.status(),
    graphics: window.__INHAGAME_P0__.getStatus().graphics
  }));
  assert.equal(nightRain.environment.targetTime, 'NIGHT');
  assert.equal(nightRain.environment.targetWeather, 'RAIN');
  assert.equal(nightRain.environment.fog.type, 'linear');
  assert.equal(nightRain.environment.rainIntensity, 1);
  assert.equal(nightRain.environment.wetness, 1);
  assert.equal(nightRain.rain.rainEnabled, true);
  assert.equal(nightRain.rain.wetGroundEnabled, true);
  assert.equal(nightRain.snow.enabled, false);
  assert.equal(nightRain.snow.snowIntensity, 0);
  assert.equal(nightRain.snowThaw.enabled, true);
  assert.ok(nightRain.snowThaw.snowAccumulation > 0);
  assert.equal(nightRain.snowThaw.snowIntensity, 0);
  assert.equal(nightRain.snowThaw.wetness, 1);
  assert.ok(nightRain.snowThaw.slushOpacity > 0);
  assert.equal(nightRain.snowThaw.slushDrawMeshes, 1);
  assert.ok(nightRain.snowThaw.slushCount > 0);
  assert.ok(nightRain.snowThaw.slushCount <= nightRain.snowThaw.slushBudget);
  assert.ok(nightRain.snowThaw.drawMeshes >= 1 && nightRain.snowThaw.drawMeshes <= 2);
  if (nightRain.snowThaw.graphicsTier === 'low') {
    assert.equal(nightRain.snowThaw.iceBudget, 0);
    assert.equal(nightRain.snowThaw.iceDrawMeshes, 0);
  }
  assert.equal(nightRain.snowThaw.extraRealLights, 0);
  assert.equal(nightRain.snowThaw.extraShadowCasters, 0);
  assert.equal(nightRain.snowThaw.externalTextures, 0);
  assert.equal(nightRain.meltwater.enabled, true);
  assert.ok(nightRain.meltwater.snowAccumulation > 0);
  assert.equal(nightRain.meltwater.snowIntensity, 0);
  assert.equal(nightRain.meltwater.wetness, 1);
  assert.ok(nightRain.meltwater.dripOpacity > 0);
  assert.ok(nightRain.meltwater.runoffOpacity > 0);
  assert.equal(nightRain.meltwater.dripDrawMeshes, 1);
  assert.equal(nightRain.meltwater.runoffDrawMeshes, 1);
  assert.equal(nightRain.meltwater.drawMeshes, 2);
  assert.ok(nightRain.meltwater.dripCount > 0);
  assert.ok(nightRain.meltwater.dripCount <= nightRain.meltwater.dripBudget);
  assert.ok(nightRain.meltwater.runoffCount > 0);
  assert.ok(nightRain.meltwater.runoffCount <= nightRain.meltwater.runoffBudget);
  assert.ok(nightRain.meltwater.drainCount <= nightRain.meltwater.drainBudget);
  if (nightRain.meltwater.graphicsTier === 'low') {
    assert.equal(nightRain.meltwater.drainBudget, 0);
    assert.equal(nightRain.meltwater.drainCount, 0);
  }
  assert.equal(nightRain.meltwater.extraRealLights, 0);
  assert.equal(nightRain.meltwater.extraShadowCasters, 0);
  assert.equal(nightRain.meltwater.externalTextures, 0);
  assert.equal(nightRain.meltwater.networkRequests, 0);
  assert.equal(nightRain.winterQa.withinBudget, true);
  assert.deepEqual(nightRain.winterQa.violations, []);
  assert.ok(nightRain.winterQa.drawMeshes <= nightRain.winterQa.budget.drawMeshes);
  assert.ok(nightRain.winterQa.trackedVertices <= nightRain.winterQa.budget.trackedVertices);
  assert.deepEqual(nightRain.winterQa.resources, {
    realLights: 0,
    shadowCasters: 0,
    externalTextures: 0,
    networkRequests: 0
  });
  assert.equal(nightRain.rain.rainDrawMeshes, 1);
  assert.equal(nightRain.rain.wetRoadDrawMeshes, 1);
  assert.ok(nightRain.rain.streakBudget >= 28 && nightRain.rain.streakBudget <= 96);
  assert.ok(nightRain.rain.rainOpacity > 0);
  assert.ok(nightRain.rain.wetRoadOpacity > 0);
  assert.equal(nightRain.rain.splashEnabled, true);
  assert.ok(nightRain.rain.splashGroups >= 1 && nightRain.rain.splashGroups <= 3);
  assert.equal(nightRain.rain.splashDrawMeshes, nightRain.rain.splashGroups);
  assert.ok(nightRain.rain.splashMarksPerGroup >= 5 && nightRain.rain.splashMarksPerGroup <= 11);
  assert.ok(nightRain.rain.splashOpacity > 0);
  assert.equal(nightRain.rain.puddleEnabled, true);
  assert.equal(nightRain.rain.puddleDrawMeshes, 1);
  assert.ok(nightRain.rain.puddleCount > 0);
  assert.ok(nightRain.rain.puddleCount <= nightRain.rain.puddleBudget);
  assert.ok(nightRain.rain.puddleOpacity > 0);
  assert.equal(nightRain.rain.puddleReflectivity, 0.78);
  assert.equal(nightRain.rain.extraRealLights, 0);
  assert.equal(nightRain.pond.rainIntensity, 1);
  assert.equal(nightRain.pond.artificialLightFactor, 1);
  assert.ok(nightRain.pond.rippleSpeed > initial.pond.rippleSpeed);
  assert.ok(nightRain.pond.bumpiness > initial.pond.bumpiness);
  assert.ok(nightRain.pond.reflectivity > initial.pond.reflectivity);
  assert.ok(nightRain.pond.gloss > initial.pond.gloss);
  assert.equal(nightRain.sky.sunVisible, false);
  assert.equal(nightRain.sky.sunOpacity, 0);
  assert.equal(nightRain.sky.sunDrawMeshes, 0);
  assert.equal(nightRain.sky.sunGlowDrawMeshes, 0);
  assert.equal(nightRain.sky.sunGlowOpacity, 0);
  assert.equal(nightRain.sky.atmosphereDrawMeshes, 1);
  assert.ok(
    nightRain.sky.atmosphereZenithColor.reduce((sum, value) => sum + value, 0) < 0.8
  );
  assert.equal(nightRain.sky.cloudDrawMeshes, nightRain.sky.cloudLayerCount);
  assert.ok(nightRain.sky.cloudLayerCount >= 1 && nightRain.sky.cloudLayerCount <= 3);
  assert.ok(nightRain.sky.cloudOpacity > initial.sky.cloudOpacity);
  assert.equal(nightRain.environment.artificialLightFactor, 1);
  assert.equal(nightRain.streetLights.artificialLightFactor, 1);
  assert.equal(nightRain.nightWindows.enabled, true);
  assert.equal(nightRain.nightWindows.drawMeshes, 1);
  assert.equal(nightRain.nightWindows.glowFactor, 1);
  assert.equal(nightRain.nightWindows.realLights, 0);
  assert.ok(nightRain.nightWindows.litWindowCount > 0);
  assert.ok(nightRain.environment.exposure < initial.environment.exposure);
  assert.ok(nightRain.streetLights.activeDynamicLights <= nightRain.streetLights.dynamicBudget);
  for (const field of ['tier', 'castShadows', 'shadowResolution', 'shadowDistance'])
    assert.equal(nightRain.graphics[field], initial.graphics[field], `environment must not own graphics field ${field}`);

  await page.evaluate(() => {
    window.__INHAGAME_ENVIRONMENT__.setWeather('clear');
    window.__INHAGAME_ENVIRONMENT__.setTimeOfDay('day', { immediate: true });
  });
  await page.waitForFunction(
    () => window.__INHAGAME_ENVIRONMENT__.status().weatherSettled &&
      window.__INHAGAME_ENVIRONMENT__.status().targetWeather === 'CLEAR' &&
      window.__INHAGAME_RAIN__.status().rainIntensity === 0 &&
      window.__INHAGAME_RAIN__.status().wetness === 0 &&
      window.__INHAGAME_SNOW__.status().snowIntensity === 0 &&
      window.__INHAGAME_POND_WEATHER__.status().rainIntensity === 0 &&
      window.__INHAGAME_POND_WEATHER__.status().artificialLightFactor === 0 &&
      window.__INHAGAME_NIGHT_WINDOWS__.status().glowFactor === 0 &&
      window.__INHAGAME_SKY__.status().sunVisible === true,
    null,
    { timeout: TIMEOUT_MS }
  );
  const clear = await page.evaluate(() => ({
    environment: window.__INHAGAME_ENVIRONMENT__.status(),
    rain: window.__INHAGAME_RAIN__.status(),
    snow: window.__INHAGAME_SNOW__.status(),
    streetLights: window.__INHAGAME_NIGHT_LIGHTS__.status(),
    nightWindows: window.__INHAGAME_NIGHT_WINDOWS__.status(),
    pond: window.__INHAGAME_POND_WEATHER__.status(),
    sky: window.__INHAGAME_SKY__.status()
  }));
  assert.equal(clear.environment.fog.type, 'none');
  assert.equal(clear.environment.rainIntensity, 0);
  assert.equal(clear.environment.wetness, 0);
  assert.equal(clear.rain.rainEnabled, false);
  assert.equal(clear.rain.wetGroundEnabled, false);
  assert.equal(clear.rain.rainDrawMeshes, 0);
  assert.equal(clear.rain.wetRoadDrawMeshes, 0);
  assert.equal(clear.rain.splashEnabled, false);
  assert.equal(clear.rain.splashDrawMeshes, 0);
  assert.equal(clear.rain.puddleEnabled, false);
  assert.equal(clear.rain.puddleDrawMeshes, 0);
  assert.equal(clear.rain.extraRealLights, 0);
  assert.equal(clear.snow.enabled, false);
  assert.equal(clear.snow.drawMeshes, 0);
  assert.equal(clear.snow.footprintEnabled, false);
  assert.equal(clear.streetLights.artificialLightFactor, 0);
  assert.equal(clear.nightWindows.enabled, false);
  assert.equal(clear.nightWindows.drawMeshes, 0);
  assert.equal(clear.nightWindows.glowFactor, 0);
  assert.equal(clear.pond.rainIntensity, 0);
  assert.equal(clear.pond.artificialLightFactor, 0);
  assert.equal(clear.pond.rippleSpeed, 0.025);
  assert.equal(clear.pond.bumpiness, 0.45);
  assert.equal(clear.pond.reflectivity, 0.6);
  assert.equal(clear.sky.sunVisible, true);
  assert.equal(clear.sky.sunOpacity, 1);
  assert.equal(clear.sky.sunDrawMeshes, 1);
  assert.equal(clear.sky.cloudDrawMeshes, clear.sky.cloudLayerCount);
  assert.ok(clear.sky.cloudLayerCount >= 1 && clear.sky.cloudLayerCount <= 3);
  assert.ok(clear.sky.cloudOpacity < nightRain.sky.cloudOpacity);

  const mobile = await smoke.context.newPage();
  smoke.watch(mobile);
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(`${smoke.origin}/campus/?envTime=night&envWeather=rain`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS
  });
  await mobile.waitForFunction(
    () => window.__INHAGAME_ENVIRONMENT__?.status?.().settled &&
      window.__INHAGAME_ENVIRONMENT__?.status?.().weatherSettled &&
      window.__INHAGAME_NIGHT_LIGHTS__?.status?.().artificialLightFactor >= 0.999 &&
      window.__INHAGAME_NIGHT_WINDOWS__?.status?.().glowFactor >= 0.999 &&
      window.__INHAGAME_RAIN__?.status?.().rainIntensity >= 0.999 &&
      window.__INHAGAME_POND_WEATHER__?.status?.().rainIntensity >= 0.999 &&
      window.__INHAGAME_POND_WEATHER__?.status?.().artificialLightFactor >= 0.999 &&
      window.__INHAGAME_SKY__?.status?.().sunVisible === false &&
      window.__INHAGAME_P0__?.getStatus?.().loading?.finished,
    null,
    { timeout: TIMEOUT_MS }
  );
  const mobileStatus = await mobile.evaluate(() => ({
    environment: window.__INHAGAME_ENVIRONMENT__.status(),
    streetLights: window.__INHAGAME_NIGHT_LIGHTS__.status(),
    nightWindows: window.__INHAGAME_NIGHT_WINDOWS__.status(),
    rain: window.__INHAGAME_RAIN__.status(),
    snow: window.__INHAGAME_SNOW__.status(),
    snowObjects: window.__INHAGAME_SNOW_OBJECTS__.status(),
    snowDepth: window.__INHAGAME_SNOW_DEPTH__.status(),
    snowThaw: window.__INHAGAME_SNOW_THAW__.status(),
    meltwater: window.__INHAGAME_MELTWATER__.status(),
    winterQa: window.__INHAGAME_WINTER_QA__.status(),
    pond: window.__INHAGAME_POND_WEATHER__.status(),
    sky: window.__INHAGAME_SKY__.status(),
    graphics: window.__INHAGAME_P0__.getStatus().graphics
  }));
  assert.equal(mobileStatus.environment.targetTime, 'NIGHT');
  assert.equal(mobileStatus.environment.targetWeather, 'RAIN');
  assert.equal(mobileStatus.environment.fog.type, 'linear');
  assert.equal(mobileStatus.rain.rainEnabled, true);
  assert.equal(mobileStatus.rain.wetGroundEnabled, true);
  assert.equal(mobileStatus.rain.splashEnabled, true);
  assert.equal(mobileStatus.rain.splashDrawMeshes, mobileStatus.rain.splashGroups);
  assert.equal(mobileStatus.rain.puddleEnabled, true);
  assert.equal(mobileStatus.rain.puddleDrawMeshes, 1);
  assert.ok(mobileStatus.rain.puddleCount <= mobileStatus.rain.puddleBudget);
  assert.equal(mobileStatus.rain.extraRealLights, 0);
  assert.equal(mobileStatus.snow.enabled, false);
  assert.equal(mobileStatus.snow.snowIntensity, 0);
  assert.equal(mobileStatus.snowObjects.enabled, false);
  assert.equal(mobileStatus.snowObjects.drawMeshes, 0);
  assert.equal(mobileStatus.snowObjects.extraRealLights, 0);
  assert.equal(mobileStatus.snowObjects.extraShadowCasters, 0);
  assert.equal(mobileStatus.snowDepth.enabled, false);
  assert.equal(mobileStatus.snowDepth.drawMeshes, 0);
  assert.equal(mobileStatus.snowDepth.extraRealLights, 0);
  assert.equal(mobileStatus.snowDepth.extraShadowCasters, 0);
  assert.equal(mobileStatus.snowThaw.enabled, false);
  assert.equal(mobileStatus.snowThaw.drawMeshes, 0);
  assert.equal(mobileStatus.snowThaw.snowAccumulation, 0);
  assert.equal(mobileStatus.snowThaw.extraRealLights, 0);
  assert.equal(mobileStatus.snowThaw.extraShadowCasters, 0);
  assert.equal(mobileStatus.snowThaw.externalTextures, 0);
  assert.equal(mobileStatus.meltwater.enabled, false);
  assert.equal(mobileStatus.meltwater.drawMeshes, 0);
  assert.equal(mobileStatus.meltwater.snowAccumulation, 0);
  assert.equal(mobileStatus.meltwater.extraRealLights, 0);
  assert.equal(mobileStatus.meltwater.extraShadowCasters, 0);
  assert.equal(mobileStatus.meltwater.externalTextures, 0);
  assert.equal(mobileStatus.meltwater.networkRequests, 0);
  assert.equal(mobileStatus.winterQa.withinBudget, true);
  assert.deepEqual(mobileStatus.winterQa.violations, []);
  assert.equal(mobileStatus.winterQa.drawMeshes, 0);
  assert.equal(mobileStatus.winterQa.trackedVertices, 0);
  assert.deepEqual(mobileStatus.winterQa.resources, {
    realLights: 0,
    shadowCasters: 0,
    externalTextures: 0,
    networkRequests: 0
  });
  assert.equal(mobileStatus.pond.rainIntensity, 1);
  assert.equal(mobileStatus.pond.artificialLightFactor, 1);
  assert.ok(mobileStatus.pond.bumpiness > 0.45);
  assert.ok(mobileStatus.pond.rippleSpeed > 0.025);
  assert.equal(mobileStatus.sky.graphicsTier, mobileStatus.graphics.tier);
  assert.equal(mobileStatus.sky.sunVisible, false);
  assert.equal(mobileStatus.sky.sunDrawMeshes, 0);
  assert.equal(mobileStatus.sky.cloudDrawMeshes, mobileStatus.sky.cloudLayerCount);
  assert.ok(mobileStatus.sky.cloudLayerCount >= 1 && mobileStatus.sky.cloudLayerCount <= 3);
  assert.ok(mobileStatus.sky.cloudPatchCount <= 16);
  if (mobileStatus.graphics.tier === 'low') assert.equal(mobileStatus.sky.cloudPatchCount, 6);
  if (mobileStatus.graphics.tier === 'low') assert.equal(mobileStatus.sky.cloudLayerCount, 1);
  if (mobileStatus.graphics.tier === 'medium') assert.equal(mobileStatus.sky.cloudLayerCount, 2);
  if (mobileStatus.graphics.tier === 'high') assert.equal(mobileStatus.sky.cloudLayerCount, 3);
  assert.equal(mobileStatus.rain.graphicsTier, mobileStatus.graphics.tier);
  assert.ok(mobileStatus.rain.streakBudget <= 96);
  if (mobileStatus.graphics.tier === 'low') assert.equal(mobileStatus.rain.streakBudget, 28);
  if (mobileStatus.graphics.tier === 'low') {
    assert.equal(mobileStatus.rain.splashGroups, 1);
    assert.equal(mobileStatus.rain.splashMarksPerGroup, 5);
    assert.equal(mobileStatus.rain.puddleBudget, 5);
  }
  assert.equal(mobileStatus.streetLights.artificialLightFactor, 1);
  assert.equal(mobileStatus.nightWindows.graphicsTier, mobileStatus.graphics.tier);
  assert.equal(mobileStatus.nightWindows.enabled, true);
  assert.equal(mobileStatus.nightWindows.drawMeshes, 1);
  assert.equal(mobileStatus.nightWindows.realLights, 0);
  assert.ok(mobileStatus.nightWindows.litWindowCount <= mobileStatus.nightWindows.maxWindowBudget);
  if (mobileStatus.graphics.tier === 'low') assert.ok(mobileStatus.nightWindows.maxWindowBudget <= 160);
  assert.ok(mobileStatus.streetLights.activeDynamicLights <= mobileStatus.streetLights.dynamicBudget);
  assert.deepEqual(smoke.problems, []);
  console.log('world environment smoke: PASS (atmospheric gradient + sun glow, layered cloud parallax, emissive night windows, rain splashes + puddles, accumulating ground snow + batched footprints + object snow caps + roof depth/drifts/plow traces + thaw slush/ice + eave meltwater/drainage + integrated winter budget QA, CLEAR/CLOUDY/FOG/RAIN/SNOW, sky, rain/snow, street lights, wet roads, Inkyung pond, 390px mobile)');
} finally {
  await smoke.close();
}
