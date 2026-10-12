// Two actual browser pages, production club rendering/session/transport, deterministic server.
// Proves client integration only. It does not apply SQL or assert live Supabase authorization.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";
import { serverFixture } from "../support/club-server-fixture.mjs";

const output = path.resolve(process.env.CLUB_QA_OUTPUT || "test-results/club-room-multiplayer");
await mkdir(output, { recursive: true });
const report = [];
for (const viewport of [{ name: "desktop", width: 1280, height: 720, mobile: false },
  { name: "mobile", width: 390, height: 844, mobile: true }]) {
  const smoke = await startSmoke({ viewport, contextOptions: { isMobile: viewport.mobile, hasTouch: viewport.mobile } });
  const server = serverFixture(), subscriptions = new Map();
  const tick = setInterval(() => server.advance(50), 50);
  try {
    await smoke.context.exposeBinding("__clubRpc", (_source, name, args, userId) => server.client(userId).rpc(name, args));
    await smoke.context.exposeBinding("__clubSubscribe", ({ page }, topic, options, userId) => {
      const channel = server.client(userId).channel(topic, options).on("broadcast", { event: "club-packet" }, ({ payload }) => {
        void page.evaluate(event => window.__clubDeliver(event), { topic, payload }).catch(() => {});
      });
      subscriptions.set(topic, channel);
    });
    await smoke.context.exposeBinding("__clubUnsubscribe", (_source, topic, userId) => {
      const channel = subscriptions.get(topic); subscriptions.delete(topic);
      return server.client(userId).removeChannel(channel);
    });
    const a = await smoke.context.newPage(), b = await smoke.context.newPage();
    smoke.watch(a); smoke.watch(b);
    const open = async (page, member) => {
      await page.goto(`${smoke.origin}/tests/browser/club-room-multiplayer-harness.html?member=${member}`);
      await page.waitForFunction(() => window.__CLUB_QA__?.ready || window.__CLUB_QA__?.error, null, { timeout: TIMEOUT_MS });
      assert.equal(await page.evaluate(() => window.__CLUB_QA__.error ?? null), null);
    };
    await open(a, 1); await open(b, 2);
    await a.evaluate(() => window.__CLUB_QA__.revalidate());
    for (const page of [a, b]) await page.waitForFunction(() => window.__CLUB_QA__.snapshot().remoteCount === 1 &&
      window.__CLUB_QA__.snapshot().state.phase === "READY");
    await a.evaluate(() => window.__CLUB_QA__.positionBy("chair_s0"));
    await b.evaluate(() => window.__CLUB_QA__.positionBy("chair_s0"));
    const claims = await Promise.all([a, b].map(page => page.evaluate(() => window.__CLUB_QA__.sit())));
    assert.equal(claims.filter(Boolean).length, 1, "one synthetic server seat winner from simultaneous browser intents");
    const winner = claims[0] ? a : b, other = claims[0] ? b : a;
    await other.evaluate(() => window.__CLUB_QA__.positionBy("chair_s2"));
    assert.equal(await other.evaluate(() => window.__CLUB_QA__.sit()), true);
    for (const page of [a, b]) await page.evaluate(() => window.__CLUB_QA__.revalidate());
    for (const [name, page] of [["a", a], ["b", b]]) {
      await page.screenshot({ path: path.join(output, `${viewport.name}-${name}-seated.png`) });
      report.push({ viewport: viewport.name, member: name, snapshot: await page.evaluate(() => window.__CLUB_QA__.snapshot()) });
    }
    await winner.locator("#qa-wave").click();
    await other.waitForFunction(() => window.__CLUB_QA__.snapshot().remoteEmote === "wave");
    await winner.evaluate(() => window.__CLUB_QA__.identityChange());
    assert.equal(await winner.evaluate(() => window.__CLUB_QA__.snapshot().state.active), false);
    await other.evaluate(() => window.__CLUB_QA__.revalidate());
    await other.waitForFunction(() => window.__CLUB_QA__.snapshot().remoteCount === 0);
    await other.locator("#qa-leave").click();
    await other.waitForFunction(() => window.__CLUB_QA__.snapshot().stats.liveChannels === 0);
    assert.equal(smoke.problems.length, 0, JSON.stringify(smoke.problems));
  } finally { clearInterval(tick); await smoke.close(); }
}
await writeFile(path.join(output, "report.json"), JSON.stringify({ validation: "synthetic-server-two-browser-client-only", report }, null, 2));
console.log(`Club room two-browser client smoke passed: ${output}`);
