// Shared offline harness for the World browser smokes (boot, graphics, unsupported, editor).
//
// apps/world is served by the committed dev-server.mjs on 127.0.0.1. Each page's PlayCanvas
// import-map URL is answered from the pinned npm copy in this folder; supabase-js is replaced by an
// empty script, so the online layer and the population heartbeat stay off; /api/* (hub telemetry,
// NPC/quest flags) answers 204, except the local server's valid /api/world-time JSON; every
// other off-origin request is aborted. Nothing reaches
// production, and no login or secret is used.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { createSofaCancellationTracker } from "./housing-sofa-cancellation-policy.mjs";
import { resolveWorldSmokeSource } from "./harness-source.mjs";

export const TIMEOUT_MS = Number(process.env.WORLD_SMOKE_TIMEOUT_MS || 90_000);
const worldDir = fileURLToPath(new URL("../../", import.meta.url));
const localPlayCanvas = fileURLToPath(new URL("./node_modules/playcanvas/build/playcanvas.mjs", import.meta.url));
// Selectable roots are QA-only: sampler and imported engine stay pinned to this checkout.
async function pinnedPlayCanvas(worldRoot) {
  const selected = await resolveWorldSmokeSource({ worldRoot, defaultWorldRoot: worldDir,
    samplerPackagePath: fileURLToPath(new URL("./package.json", import.meta.url)) });
  return { ...selected, source: await readFile(localPlayCanvas) };
}

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer().once("error", reject).listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

async function startServer({ worldRoot, devServer }) {
  const port = await freePort();
  const env = { ...process.env, PORT: String(port) };
  delete env.NPC_AI_PILOT;
  const child = spawn(process.execPath, [devServer], { cwd: worldRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`dev-server did not start:\n${log}`)), 15_000);
    const onData = chunk => {
      log += chunk;
      if (log.includes("listening")) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`dev-server exited (${code}):\n${log}`)); });
  });
  return { origin: `http://127.0.0.1:${port}`, stop: () => child.kill() };
}

// Starts the server and a headless Chromium with one offline context. `watch(page)` records page
// errors, console errors and failed or 4xx/5xx same-origin requests into `problems`, and returns a
// promise that rejects on the first uncaught page error or crash (race it against waits to fail fast).
export async function startSmoke({ viewport = { width: 1280, height: 720 }, contextOptions = {}, browserType = "chromium", worldRoot } = {}) {
  const playCanvas = await pinnedPlayCanvas(worldRoot);
  const server = await startServer(playCanvas);
  // GPU-less CI checks the explicit unsupported path and the Editor's legacy WebGL2 preview.
  const disabled = process.env.WORLD_SMOKE_DISABLE_WEBGPU === '1';
  const gpuArgs = disabled
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : process.platform === 'linux'
      ? ['--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface', '--enable-unsafe-webgpu']
      : ['--enable-unsafe-webgpu'];
  const launcher = browserType === "webkit" ? webkit : chromium;
  const browser = await launcher.launch({
    headless: process.env.WORLD_SMOKE_HEADED !== '1',
    ...(process.env.WORLD_SMOKE_EXECUTABLE ? { executablePath: process.env.WORLD_SMOKE_EXECUTABLE } : {}),
    ...(browserType === "chromium" && (process.env.WORLD_SMOKE_BROWSER || (process.platform === 'linux' && !disabled))
      ? { channel: process.env.WORLD_SMOKE_BROWSER || 'chromium' } : {}),
    ...(browserType === "chromium" ? { args: gpuArgs } : {})
  });
  const problems = [];
  const sofaCancellations = createSofaCancellationTracker(problems);
  const blocked = new Set();
  const stubbed = new Set();
  const context = await browser.newContext({ ...contextOptions, viewport, serviceWorkers: "block" });
  await context.exposeBinding('__worldSmokeSofaAbort', ({ page }, { url, requestId }) => {
    if (url === `${server.origin}/assets/furniture/dorm-single-sofa-v1.glb` && /^\d+$/.test(requestId)) sofaCancellations.signalled(page, url, requestId);
  });
  await context.addInitScript(() => {
    const original = globalThis.fetch; let sequence=0;
    globalThis.fetch = function(input, options) {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      const signal = options?.signal;
      if (url.origin === location.origin && url.pathname === '/assets/furniture/dorm-single-sofa-v1.glb' && signal) {
        const requestId=String(++sequence),headers=new Headers(options?.headers);
        headers.set('x-world-smoke-sofa-request',requestId);options={...options,headers};
        const notify = () => { void globalThis.__worldSmokeSofaAbort({url:url.href,requestId}).catch(() => {}); };
        if (signal.aborted) notify(); else signal.addEventListener('abort', notify, { once:true });
      }
      return original.call(this, input, options);
    };
  });
  if (disabled) await context.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === server.origin) {
      // The shared clock consumes JSON. A mocked 204 here produces an artificial aborted
      // request in Chromium; use the existing offline dev-server time endpoint instead.
      if (!url.pathname.startsWith("/api/") || url.pathname === "/api/world-time") return route.continue();
      stubbed.add(url.pathname);
      return route.fulfill({ status: 204 });
    }
    if (playCanvas.urls.has(url.href)) {
      return route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: playCanvas.source });
    }
    if (url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith("/npm/@supabase/supabase-js@")) {
      stubbed.add(`${url.hostname}${url.pathname}`);
      return route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: "/* supabase-js stubbed: World boots offline */" });
    }
    blocked.add(`${url.origin}${url.pathname}`);
    return route.abort("blockedbyclient");
  });

  const watch = page => {
    let fatal;
    const fatalError = new Promise((_, reject) => { fatal = reject; });
    fatalError.catch(() => {});
    page.on("pageerror", error => {
      problems.push(`pageerror: ${error.stack || error.message}`);
      fatal(new Error(`uncaught page error: ${error.message}`));
    });
    page.on("crash", () => fatal(new Error("page crashed")));
    page.on("console", message => {
      if (message.type() !== "error") return;
      const source = message.location()?.url || "";
      // Requests this harness aborted on purpose are reported below, not treated as page errors.
      if (/^Failed to load resource/.test(message.text()) && source && !source.startsWith(server.origin)) return;
      problems.push(`console.error: ${message.text()}${source ? ` (${source})` : ""}`);
    });
    page.on("requestfailed", request => {
      if (!request.url().startsWith(server.origin)) return;
      const url = new URL(request.url());
      const errorText = request.failure()?.errorText;
      // Chromium reports mocked 204 No Content fetches as ERR_ABORTED in Playwright even though
      // this harness deliberately fulfilled the request. Keep the production 204 contract strict;
      // ignore only this known artifact for the one confirmed telemetry endpoint we stub ourselves.
      if (url.pathname === "/api/hub-event" && stubbed.has(url.pathname) && errorText === "net::ERR_ABORTED") return;
      if (url.pathname === "/assets/furniture/dorm-single-sofa-v1.glb" && sofaCancellations.failed(page, request.url(), errorText, request.headers()["x-world-smoke-sofa-request"])) return;
      problems.push(`request failed: ${request.url()} ${errorText}`);
    });
    page.on("response", response => {
      if (response.url().startsWith(server.origin) && response.status() >= 400) {
        problems.push(`HTTP ${response.status()}: ${response.url()}`);
      }
    });
    return fatalError;
  };

  const close = async () => {
    if (sofaCancellations.records.length) console.log(`observed optional sofa cancellations: ${JSON.stringify(sofaCancellations.records)}`);
    if (stubbed.size) console.log(`stubbed: ${[...stubbed].sort().join(", ")}`);
    if (blocked.size) console.log(`blocked off-origin: ${[...blocked].sort().join(", ")}`);
    await context.close();
    await browser.close();
    server.stop();
  };
  return { origin: server.origin, context, problems, watch, close, sofaCancellations: sofaCancellations.records };
}
