// Real Chromium and DOM modules; all RPCs/identities are synthetic and off-origin traffic is blocked.
// npm ci --prefix apps/world/tests/browser
// WORLD_SMOKE_BROWSER=chrome node apps/world/tests/browser/social-account-smoke.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const allowed = new Set([
  "src/social/social-client.js", "src/social/social-account-session.js", "src/social/friend-panel.js",
  "src/social/player-card.js", "src/social/accompany-client.js", "src/online/chat-panel.js",
  "src/online/local-chat.js", "src/world-scale.js", "src/lobby/lobby-presence-summary.js",
  "src/network/protocol.js", "src/network/npc-talk-presence.js", "src/network/connection-state.js",
  "src/network/remote-player-manager.js", "src/network/interpolation.js"
]);
const html = `<!doctype html><meta charset="utf-8"><title>Account isolation browser fixture</title>
<style>body{font:16px system-ui;max-width:52rem;padding:24px;margin:auto}section,output,pre{display:block;margin:12px 0}pre{white-space:pre-wrap}button,input{font:inherit}</style>
<h1>1·2·4 synthetic account checks</h1><p>No real accounts, messages, or service RPCs</p>
<output id="summary"></output><button id="toggle">Friends</button><section id="friends"></section><section id="card"></section>
<button id="chat-toggle">Chat</button><form id="chat-form"><input id="chat-input" aria-label="Synthetic chat draft"></form><ol id="chat-feed"></ol><p id="chat-hint"></p>
<output id="population"></output><button id="presence-friends"></button><pre id="result">Running…</pre>
<script type="module">import { runSocialAccountSmoke } from "/scenario.js";
try { const result = await runSocialAccountSmoke(); document.body.dataset.result = JSON.stringify(result); document.querySelector("#result").textContent = "PASS " + JSON.stringify(result, null, 2); }
catch (error) { document.body.dataset.error = error.message; document.querySelector("#result").textContent = "FAIL " + error.message; }</script>`;
const server = createServer(async (req, res) => {
  const name = new URL(req.url, "http://localhost").pathname.slice(1);
  if (!name) { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(html); return; }
  if (name === "favicon.ico") { res.writeHead(204); res.end(); return; }
  if (name !== "scenario.js" && !allowed.has(name)) { res.writeHead(404); res.end(); return; }
  res.setHeader("Content-Type", "text/javascript");
  res.end(await readFile(new URL(name === "scenario.js" ? "./social-account-scenario.js" : `../../${name}`, import.meta.url)));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const output = resolve(process.env.WORLD_SOCIAL_QA_OUTPUT || "test-results/social-account");
await mkdir(output, { recursive: true });
const receipt = { browser: null, results: [] };
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.WORLD_SOCIAL_BROWSER_EXECUTABLE ? { executablePath: process.env.WORLD_SOCIAL_BROWSER_EXECUTABLE }
      : process.env.WORLD_SMOKE_BROWSER ? { channel: process.env.WORLD_SMOKE_BROWSER } : {}) });
  receipt.browser = browser.version();
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: "block" });
    const external = [], errors = [];
    const row = { viewport, passed: false };
    receipt.results.push(row);
    await context.route("**/*", route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      external.push(true);
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(origin);
      await page.waitForFunction(() => document.body.dataset.result || document.body.dataset.error);
      const outcome = await page.evaluate(() => ({ result: document.body.dataset.result, error: document.body.dataset.error }));
      assert.equal(outcome.error, undefined);
      Object.assign(row, JSON.parse(outcome.result));
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      row.passed = true;
    } finally {
      row.pageErrors = errors.length;
      row.externalRequests = external.length;
      await page.screenshot({ path: resolve(output, `account-isolation-${viewport.width}x${viewport.height}.png`), fullPage: true });
      await context.close();
    }
    console.log(JSON.stringify(row));
  }
} finally {
  await writeFile(resolve(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
