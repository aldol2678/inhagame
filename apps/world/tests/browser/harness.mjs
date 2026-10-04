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
import { chromium } from "playwright";

export const TIMEOUT_MS = Number(process.env.WORLD_SMOKE_TIMEOUT_MS || 90_000);
const worldDir = fileURLToPath(new URL("../../", import.meta.url));
const devServer = fileURLToPath(new URL("../../dev-server.mjs", import.meta.url));
const localPlayCanvas = fileURLToPath(new URL("./node_modules/playcanvas/build/playcanvas.mjs", import.meta.url));
// Every page that imports PlayCanvas; the smoke serves the version these import maps ask for.
const IMPORT_MAP_PAGES = ["campus/index.html", "editor/index.html"];

// The import maps are the contract: they must all name the version this package pins, so the smoke
// fails clearly when a page moves to another PlayCanvas instead of silently testing a different one.
async function pinnedPlayCanvas() {
  const pinned = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8")).devDependencies.playcanvas;
  const urls = new Set();
  for (const page of IMPORT_MAP_PAGES) {
    const html = await readFile(new URL(`../../${page}`, import.meta.url), "utf8");
    const url = html.match(/"playcanvas"\s*:\s*"([^"]+)"/)?.[1];
    assert.ok(url, `${page} import map has no playcanvas entry`);
    assert.ok(url.includes(`playcanvas@${pinned}/`),
      `${page} imports ${url}, but apps/world/tests/browser pins playcanvas ${pinned}; update package.json and package-lock.json`);
    urls.add(url);
  }
  return { urls, source: await readFile(localPlayCanvas) };
}

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer().once("error", reject).listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

async function startServer() {
  const port = await freePort();
  const env = { ...process.env, PORT: String(port) };
  delete env.NPC_AI_PILOT;
  const child = spawn(process.execPath, [devServer], { cwd: worldDir, env, stdio: ["ignore", "pipe", "pipe"] });
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
export async function startSmoke({ viewport = { width: 1280, height: 720 }, contextOptions = {} } = {}) {
  const playCanvas = await pinnedPlayCanvas();
  const server = await startServer();
  // GPU-less CI checks the explicit unsupported path and the Editor's legacy WebGL2 preview.
  const disabled = process.env.WORLD_SMOKE_DISABLE_WEBGPU === '1';
  const softwareWebGpu = process.env.WORLD_SMOKE_WEBGPU_SWIFTSHADER === '1';
  const gpuArgs = disabled
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : softwareWebGpu
      ? [
          '--enable-unsafe-webgpu',
          '--use-webgpu-adapter=swiftshader',
          '--enable-dawn-features=allow_unsafe_apis',
          '--disable-dawn-features=use_dxc',
          '--enable-webgpu-developer-features',
          '--use-gpu-in-tests',
          '--enable-accelerated-2d-canvas'
        ]
      : process.platform === 'linux'
        ? ['--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface', '--enable-unsafe-webgpu']
        : ['--enable-unsafe-webgpu'];
  const browser = await chromium.launch({
    headless: process.env.WORLD_SMOKE_HEADED !== '1',
    ...(process.env.WORLD_SMOKE_BROWSER || (process.platform === 'linux' && !disabled)
      ? { channel: process.env.WORLD_SMOKE_BROWSER || 'chromium' } : {}),
    args: gpuArgs
  });
  const problems = [];
  const blocked = new Set();
  const stubbed = new Set();
  const context = await browser.newContext({ ...contextOptions, viewport, serviceWorkers: "block" });
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
    if (stubbed.size) console.log(`stubbed: ${[...stubbed].sort().join(", ")}`);
    if (blocked.size) console.log(`blocked off-origin: ${[...blocked].sort().join(", ")}`);
    await context.close();
    await browser.close();
    server.stop();
  };
  return { origin: server.origin, context, problems, watch, close };
}
