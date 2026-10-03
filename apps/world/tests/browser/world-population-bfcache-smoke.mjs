// Actual Chromium BFCache restoration of the production heartbeat module.
// All documents/modules are localhost fixtures; rpc() is an in-memory synthetic client.
// Raw CDP navigation preserves BFCache, unlike Playwright's normal navigation tracking.
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const moduleSource = await readFile(new URL("../../src/online/world-population-heartbeat.js", import.meta.url), "utf8");
const fixture = `
import { startWorldPopulationHeartbeat } from '/heartbeat.js';
const documentId = crypto.randomUUID();
const shows = [], hides = [], visibility = [], calls = [];
window.addEventListener('pageshow', event => shows.push(event.persisted));
window.addEventListener('pagehide', event => hides.push(event.persisted));
document.addEventListener('visibilitychange', () => visibility.push(document.visibilityState));
const intervals = new Set();
const listeners = new Map();
let space = 'campus', identity = 'guest', holdNext = false, releasePending = null;
const heartbeat = startWorldPopulationHeartbeat({
  client: { rpc(name, args) {
    calls.push({ name, args, identity });
    if (holdNext) {
      holdNext = false;
      return new Promise(resolve => { releasePending = () => resolve({ error: null }); });
    }
    return Promise.resolve({ error: null });
  } },
  getSnapshot: () => ({ placeZoneId: null, space }),
  scheduler: {
    setInterval(fn, ms) { const id = setInterval(fn, ms); intervals.add(id); return id; },
    clearInterval(id) { intervals.delete(id); clearInterval(id); },
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id)
  },
  windowTarget: {
    addEventListener(type, fn) { listeners.set(type, fn); window.addEventListener(type, fn); },
    removeEventListener(type, fn) { listeners.delete(type); window.removeEventListener(type, fn); }
  }
});
window.populationSnapshot = () => ({
  documentId, shows: [...shows], hides: [...hides], visibility: [...visibility],
  calls: [...calls], status: heartbeat.status(), intervals: intervals.size, listeners: listeners.size
});
window.prepareRestore = (nextSpace, nextIdentity) => { space = nextSpace; identity = nextIdentity; };
window.beginPending = () => { holdNext = true; void heartbeat.pulse(); return true; };
window.releasePending = () => { releasePending(); releasePending = null; };
`;
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const headers = {
    "Cache-Control": "no-cache",
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; connect-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  };
  if (request.method !== "GET") { response.writeHead(405).end(); return; }
  if (pathname === "/heartbeat.js" || pathname === "/fixture.mjs") {
    response.writeHead(200, { ...headers, "Content-Type": "text/javascript" })
      .end(pathname === "/heartbeat.js" ? moduleSource : fixture);
  } else if (pathname === "/fixture") {
    response.writeHead(200, { ...headers, "Content-Type": "text/html" })
      .end('<!doctype html><title>Population heartbeat fixture</title><script type="module" src="/fixture.mjs"></script>');
  } else if (pathname === "/away") {
    response.writeHead(200, { ...headers, "Content-Type": "text/html" }).end('<!doctype html><title>Away</title>');
  } else response.writeHead(404).end();
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const report = { actualBFCache: false, scope: "production heartbeat module; synthetic in-memory RPC; localhost only" };
try {
  browser = await chromium.launch({
    headless: true, channel: "chromium", ignoreDefaultArgs: ["--disable-back-forward-cache"]
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  const notRestored = [], exceptions = [];
  cdp.on("Page.backForwardCacheNotUsed", event => notRestored.push(event));
  cdp.on("Runtime.exceptionThrown", event => exceptions.push(event.exceptionDetails));
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
  const initial = await waitFor(
    "window.populationSnapshot?.().shows.length && window.populationSnapshot().status.lastSentAt && window.populationSnapshot()",
    "initial heartbeat"
  );
  assert.deepEqual(initial.shows, [false]);
  assert.equal(initial.calls.length, 1);
  assert.equal(initial.intervals, 1);
  assert.equal(initial.listeners, 2);
  const restored = [];
  const roundTrip = async () => {
    const history = await cdp.send("Page.getNavigationHistory");
    const entryId = history.entries[history.currentIndex].id;
    await cdp.send("Page.navigate", { url: `${origin}/away` });
    await waitFor("location.pathname === '/away'", "away document");
    await cdp.send("Page.navigateToHistoryEntry", { entryId });
    return waitFor(
      `window.populationSnapshot?.().shows.length === ${restored.length + 2} && window.populationSnapshot()`,
      "same-document BFCache restoration"
    );
  };
  const verifyRestored = snapshot => {
    assert.equal(snapshot.documentId, initial.documentId);
    assert.equal(snapshot.shows.at(-1), true, "browser-emitted persisted pageshow is required");
    assert.equal(snapshot.hides.at(-1), true, "browser admitted the original document into BFCache");
    assert.equal(snapshot.status.sessionId, initial.status.sessionId);
    assert.equal(snapshot.status.visitorId, initial.status.visitorId);
    assert.equal(snapshot.status.stopped, false);
    assert.equal(snapshot.status.paused, false);
    assert.equal(snapshot.intervals, 1);
    assert.equal(snapshot.listeners, 2);
  };
  for (const [space, identity] of [["lobby", "account-a"], ["campus", "guest"], ["personal_room", "account-b"]]) {
    const before = await evaluate("window.populationSnapshot().calls.length");
    await evaluate(`window.prepareRestore(${JSON.stringify(space)}, ${JSON.stringify(identity)})`);
    await roundTrip();
    const snapshot = await waitFor(
      `window.populationSnapshot().calls.length === ${before + 1} && window.populationSnapshot()`,
      "immediate restore heartbeat"
    );
    verifyRestored(snapshot);
    assert.equal(snapshot.calls.at(-1).name, "touch_world_online_session_v2");
    assert.equal(snapshot.calls.at(-1).args.p_space, space);
    assert.equal(snapshot.calls.at(-1).identity, identity);
    restored.push(snapshot);
  }
  // A pending old request must settle before exactly one current-identity restore request.
  await evaluate("window.beginPending()");
  const beforePendingRestore = await evaluate("window.populationSnapshot().calls.length");
  await evaluate("window.prepareRestore('campus', 'guest')");
  const pendingRestore = await roundTrip();
  verifyRestored(pendingRestore);
  assert.equal(pendingRestore.calls.length, beforePendingRestore);
  await evaluate("window.releasePending()");
  const afterPending = await waitFor(
    `window.populationSnapshot().calls.length === ${beforePendingRestore + 1} && window.populationSnapshot()`,
    "serialized fresh restore heartbeat"
  );
  assert.equal(afterPending.calls.at(-1).identity, "guest");
  restored.push(afterPending);
  const afterPoll = await waitFor(
    `window.populationSnapshot().calls.length === ${afterPending.calls.length + 1} && window.populationSnapshot()`,
    "resumed 20-second polling", 25000
  );
  assert.equal(afterPoll.intervals, 1);
  await evaluate("window.beginPending()");
  const beforeTimeout = await evaluate("window.populationSnapshot().calls.length");
  const timedOut = await waitFor(
    "window.populationSnapshot().status.stopped && window.populationSnapshot()",
    "10-second fail-closed request deadline", 15000
  );
  assert.equal(timedOut.status.lastError, "WORLD_HEARTBEAT_TIMEOUT");
  assert.equal(timedOut.intervals, 0);
  assert.equal(timedOut.listeners, 0);
  assert.equal(timedOut.calls.length, beforeTimeout);
  await evaluate("window.releasePending()");
  const afterLateResult = await evaluate("window.populationSnapshot()");
  assert.equal(afterLateResult.status.lastError, "WORLD_HEARTBEAT_TIMEOUT");
  assert.equal(afterLateResult.calls.length, beforeTimeout);
  assert.deepEqual(exceptions, []);
  Object.assign(report, { actualBFCache: true, rounds: restored.length, initial, restored, afterPoll, timedOut, afterLateResult });
  console.log("PASS: actual Chromium BFCache preserved the same heartbeat through four round trips; immediate/serialized refresh, resumed 20s poll, and 10s terminal deadline verified with synthetic RPCs");
} catch (error) {
  report.error = String(error.stack || error);
  throw error;
} finally {
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/world-population-bfcache.json", JSON.stringify(report, null, 2) + "\n");
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
