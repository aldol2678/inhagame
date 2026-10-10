// Actual Chromium BFCache round trips for the remote controller + main lifecycle wiring.
// The character is a synthetic authority receipt; this does not prove full Campus admission/rendering.
// Playwright's Page navigation tracking does not support BFCache. Use its pinned browser launcher,
// then raw CDP navigation/evaluation, with BFCache explicitly enabled and no request interception.
// All documents, modules and flag responses come from this ephemeral localhost-only fixture server.
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const root = new URL("../../", import.meta.url);
const main = await readFile(new URL("src/main.js", root), "utf8");
const begin = main.indexOf("let assetCanaryRemoteStateCurrent =");
const end = main.indexOf("window.__INHAGAME_ASSET_PRODUCTION_CANARY__", begin);
assert.ok(begin >= 0 && end > begin, "use the actual main subscription and page lifecycle handlers");
const modules = new Map();
for (const name of ["asset-canary-remote-control.js", "npc-feature-flags.js", "asset-canary-telemetry.js"])
  modules.set(`/src/${name}`, await readFile(new URL(`src/${name}`, root), "utf8"));
modules.set("/fixture.mjs", `
import { createAssetCanaryRemoteControl } from '/src/asset-canary-remote-control.js';
import { FLAG_ENABLED } from '/src/npc-feature-flags.js';
import { createAssetCanaryTelemetry } from '/src/asset-canary-telemetry.js';
const previewHost = false;
const documentId = crypto.randomUUID();
const shows = [];
const hides = [];
window.addEventListener('pageshow', event => shows.push(event.persisted));
window.addEventListener('pagehide', event => hides.push(event.persisted));
const pollTimers = new Set();
const assetCanaryRemoteControl = createAssetCanaryRemoteControl({
  setTimer(fn, ms) {
    const id = setTimeout(() => { pollTimers.delete(id); fn(); }, ms);
    if (ms === 15000) pollTimers.add(id);
    return id;
  },
  clearTimer(id) { pollTimers.delete(id); clearTimeout(id); }
});
const assetCanaryRemoteState = await assetCanaryRemoteControl.start();
const reasons = [];
const character = {
  assetCanary: { authority: 'OPTIMIZED_CANARY' }, ready: Promise.resolve(),
  rollbackAssetCanary(reason) {
    reasons.push(reason);
    this.assetCanary = { authority: 'CANONICAL' };
    return this.assetCanary;
  }
};
const assetProductionCanary = { selected: true };
const assetCanaryTelemetry = createAssetCanaryTelemetry();
${main.slice(begin, end)}
window.canarySnapshot = () => ({
  documentId, shows: [...shows], hides: [...hides], remote: assetCanaryRemoteControl.status(),
  remoteState: assetCanaryRemoteStateCurrent, authority: character.assetCanary.authority,
  reasons: [...reasons], pollTimers: pollTimers.size
});
`);
let flag = true;
let flagReads = 0;
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (request.method !== "GET") { response.writeHead(405).end(); return; }
  const headers = {
    "Cache-Control": "no-cache",
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  };
  if (pathname === "/api/asset-canary-flag") {
    flagReads++;
    response.writeHead(flag === null ? 503 : 200, {
      ...headers, "Content-Type": "application/json", "Cache-Control": "no-store"
    }).end(JSON.stringify(flag === null ? { error: "synthetic outage" } : { enabled: flag }));
  } else if (modules.has(pathname)) {
    response.writeHead(200, { ...headers, "Content-Type": "text/javascript" }).end(modules.get(pathname));
  } else if (pathname === "/fixture") {
    response.writeHead(200, { ...headers, "Content-Type": "text/html" })
      .end('<!doctype html><title>Canary lifecycle fixture</title><script type="module" src="/fixture.mjs"></script>');
  } else if (pathname === "/away") {
    response.writeHead(200, { ...headers, "Content-Type": "text/html" })
      .end('<!doctype html><title>Away fixture</title>');
  } else response.writeHead(404).end();
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const report = { actualBFCache: false, scope: "real controller/main handlers; synthetic character; localhost only" };
try {
  browser = await chromium.launch({
    headless: true,
    channel: "chromium", // Full Chromium/new headless; legacy headless-shell disables BFCache by default.
    ignoreDefaultArgs: ["--disable-back-forward-cache"]
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  const notRestored = [];
  cdp.on("Page.backForwardCacheNotUsed", event => notRestored.push(event));
  const evaluate = async expression => {
    const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async (expression, description, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { const value = await evaluate(expression); if (value) return value; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`${description} timed out; BFCache rejection: ${JSON.stringify(notRestored)}`);
  };
  await cdp.send("Page.navigate", { url: `${origin}/fixture` });
  const initial = await waitFor("window.canarySnapshot?.().shows.length && window.canarySnapshot()", "initial fixture");
  assert.equal(initial.remoteState, "ENABLED");
  assert.equal(initial.authority, "OPTIMIZED_CANARY");
  assert.equal(initial.pollTimers, 1);
  assert.deepEqual(initial.shows, [false]);
  const restored = [];
  for (const [next, expected] of [[false, "DISABLED"], [true, "ENABLED"], [null, "UNAVAILABLE"]]) {
    const history = await cdp.send("Page.getNavigationHistory");
    const entryId = history.entries[history.currentIndex].id;
    await cdp.send("Page.navigate", { url: `${origin}/away` });
    await waitFor("location.pathname === '/away'", "away document");
    flag = next; // Synthetic flag changes while the old document is cached, never a remote mutation.
    const before = flagReads;
    await cdp.send("Page.navigateToHistoryEntry", { entryId });
    const snapshot = await waitFor(
      `window.canarySnapshot?.().remoteState === ${JSON.stringify(expected)} && window.canarySnapshot()`,
      "immediate flag refresh after real history restoration"
    );
    assert.equal(snapshot.documentId, initial.documentId, "BFCache preserves the same document");
    assert.equal(snapshot.shows.at(-1), true, "the browser must emit a real persisted pageshow");
    assert.equal(snapshot.hides.at(-1), true, "the browser admitted the document into BFCache");
    assert.equal(snapshot.shows.length, restored.length + 2);
    assert.equal(flagReads, before + 1, "one immediate restore read, before the 15-second poll");
    assert.equal(snapshot.pollTimers, 1, "one resumed polling chain");
    assert.equal(snapshot.authority, "CANONICAL", "later true never reactivates the optimized character");
    assert.deepEqual(snapshot.reasons, ["REMOTE_KILL_DISABLED"]);
    restored.push(snapshot);
  }
  flag = true;
  const beforePoll = flagReads;
  const afterPoll = await waitFor("window.canarySnapshot?.().remoteState === 'ENABLED' && window.canarySnapshot()",
    "resumed regular polling", 20000);
  assert.equal(flagReads, beforePoll + 1);
  assert.equal(afterPoll.pollTimers, 1);
  assert.equal(afterPoll.authority, "CANONICAL");
  Object.assign(report, { actualBFCache: true, rounds: restored.length, initial, restored, afterPoll, flagReads });
  console.log("PASS: actual Chromium BFCache restored the same document three times; immediate refresh and resumed poll verified");
} catch (error) {
  report.error = String(error.stack || error);
  throw error;
} finally {
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/asset-canary-bfcache.json", JSON.stringify(report, null, 2) + "\n");
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
