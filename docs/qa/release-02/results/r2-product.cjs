// RELEASE-02: before/after check of the two product changes. Usage: node r2-product.cjs <port> <out.json>
const fs = require('fs');
const { open, boot, devices } = require('./lib.cjs');
const [port, out] = process.argv.slice(2);
(async () => {
  const result = {};
  for (const [name, context] of [['pc', { viewport: { width: 1280, height: 720 } }], ['phone-landscape', devices['Pixel 7 landscape']]]) {
    const { browser, ctx, page, log, origin } = await open({ port: +port, context });
    await ctx.addInitScript(() => { try { localStorage.setItem('inha-world-graphics-quality-v1', 'very_low'); } catch {} });
    await boot(page, origin);
    await page.locator('#world-loading').waitFor({ state: 'hidden' });
    await (name === 'pc' ? page.locator('#main-gate-start').click() : page.locator('#main-gate-start').tap());
    await page.locator('#world-lobby').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.__INHAGAME_P0__.controller.inputEnabled);
    const r = { css: await page.evaluate(() => Object.fromEntries(['#tour', '#quest-hud', '#inkyung-living-moment'].map(s => [s, document.querySelector(s) ? getComputedStyle(document.querySelector(s)).display : 'absent']))),
      landscapeQuery: await page.evaluate(() => matchMedia('(pointer: coarse) and (orientation: landscape) and (max-height: 500px)').matches) };
    if (name === 'pc') {
      r.clubRoom = await page.evaluate(async () => {
        const P0 = window.__INHAGAME_P0__, { roadviewGroundHeight } = await import('/src/roadview-layout.js');
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const until = async fn => { for (let i = 0; i < 120 && !fn(); i++) await wait(250); return fn(); };
        const entered = P0.rooms.enter('ROOM_CLUBHOUSE_01');
        await until(() => P0.rooms.insideRoom && !P0.rooms.status().busy);
        const inside = P0.rooms.insideRoom;
        await wait(1500); const exited = P0.rooms.exit({ force: true });
        await until(() => !P0.rooms.insideRoom && !P0.rooms.status().busy);
        const first = P0.player.getLocalPosition(), firstPos = { x: first.x, y: first.y, z: first.z };
        const ground = roadviewGroundHeight(first.x, first.z);
        await wait(2500);
        const p = P0.player.getLocalPosition();
        return { entered, inside, exited, returnPosition: firstPos, groundAtReturn: ground, feetBelowSurface: +(ground - (firstPos.y - 1.15)).toFixed(3), settled: { x: p.x, y: p.y, z: p.z }, grounded: P0.controller.grounded };
      });
      await page.screenshot({ path: out.replace(/\.json$/, '-club-room-return.png') });
    }
    r.errors = log.errors; result[name] = r;
    await browser.close();
  }
  fs.writeFileSync(out, JSON.stringify(result, null, 1)); console.log(JSON.stringify(result, null, 1));
})();
