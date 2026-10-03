import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune } from "@gltf-transform/functions";
import { chromium } from "playwright";
import http from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPRESENTATIVE_ASSETS } from "./gltf-transform-poc.mjs";

const EXP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(EXP_ROOT, "../..");
const OUTPUT_ROOT = path.join(EXP_ROOT, ".visual-output");
const OPTIMIZED_ROOT = path.join(OUTPUT_ROOT, "optimized");
const SCREENSHOT_ROOT = path.join(OUTPUT_ROOT, "screenshots");
const HARNESS_PATH = path.join(EXP_ROOT, "visual-harness.html");

const MAX_CHANGED_PERCENT = 1.0;
const MAX_MEAN_ABS_CHANNEL_DIFF = 0.5;
const SIGNIFICANT_CHANNEL_DELTA = 8;

function mime(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js":
    case ".mjs": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".glb": return "model/gltf-binary";
    default: return "application/octet-stream";
  }
}

function safeJoin(base, relative) {
  const resolved = path.resolve(base, "." + relative);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error("path traversal");
  return resolved;
}

async function prepareOptimizedAssets() {
  await rm(OUTPUT_ROOT, { recursive: true, force: true });
  await mkdir(OPTIMIZED_ROOT, { recursive: true });
  await mkdir(SCREENSHOT_ROOT, { recursive: true });

  const transformIO = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const outputs = new Map();
  for (const relativePath of REPRESENTATIVE_ASSETS) {
    const document = await transformIO.read(path.join(REPO_ROOT, relativePath));
    await document.transform(dedup(), prune());
    const outputPath = path.join(OPTIMIZED_ROOT, path.basename(relativePath));
    await transformIO.write(outputPath, document);
    outputs.set(relativePath, outputPath);
  }
  return outputs;
}

async function startServer() {
  const vendorRoot = path.join(EXP_ROOT, "node_modules", "three");
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      let filePath;
      if (url.pathname === "/harness") {
        filePath = HARNESS_PATH;
      } else if (url.pathname.startsWith("/repo/")) {
        filePath = safeJoin(REPO_ROOT, url.pathname.slice("/repo".length));
      } else if (url.pathname.startsWith("/optimized/")) {
        filePath = safeJoin(OPTIMIZED_ROOT, url.pathname.slice("/optimized".length));
      } else if (url.pathname.startsWith("/vendor/three/")) {
        filePath = safeJoin(vendorRoot, url.pathname.slice("/vendor/three".length));
      } else {
        res.writeHead(404); res.end("not found"); return;
      }

      res.writeHead(200, {
        "Content-Type": mime(filePath),
        "Cache-Control": "no-store",
        "Cross-Origin-Resource-Policy": "same-origin"
      });
      createReadStream(filePath).on("error", error => {
        if (!res.headersSent) res.writeHead(404);
        res.end(String(error.message));
      }).pipe(res);
    } catch (error) {
      res.writeHead(400);
      res.end(String(error.message));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function waitForRender(page) {
  await page.waitForFunction(() => window.__VISUAL_READY__ === true || Boolean(window.__VISUAL_ERROR__), null, {
    timeout: 15000
  });
  const error = await page.evaluate(() => window.__VISUAL_ERROR__ ?? null);
  if (error) throw new Error(error);
  return page.evaluate(() => window.__VISUAL_META__);
}

async function comparePngs(page, left, right) {
  return page.evaluate(async ({ left, right, threshold }) => {
    const load = source => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("png decode failed"));
      image.src = source;
    });
    const [a, b] = await Promise.all([
      load("data:image/png;base64," + left),
      load("data:image/png;base64," + right)
    ]);
    if (a.width !== b.width || a.height !== b.height) throw new Error("screenshot dimensions differ");

    const canvas = document.createElement("canvas");
    canvas.width = a.width;
    canvas.height = a.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(a, 0, 0);
    const first = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(b, 0, 0);
    const second = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    let changedPixels = 0;
    let absSum = 0;
    let maxChannelDiff = 0;
    const pixels = canvas.width * canvas.height;

    for (let i = 0; i < first.length; i += 4) {
      let pixelMax = 0;
      for (let c = 0; c < 3; c += 1) {
        const diff = Math.abs(first[i + c] - second[i + c]);
        absSum += diff;
        pixelMax = Math.max(pixelMax, diff);
        maxChannelDiff = Math.max(maxChannelDiff, diff);
      }
      if (pixelMax > threshold) changedPixels += 1;
    }

    return {
      width: canvas.width,
      height: canvas.height,
      changedPixels,
      changedPercent: Number(((changedPixels / pixels) * 100).toFixed(6)),
      meanAbsChannelDiff: Number((absSum / (pixels * 3)).toFixed(6)),
      maxChannelDiff
    };
  }, {
    left: left.toString("base64"),
    right: right.toString("base64"),
    threshold: SIGNIFICANT_CHANNEL_DELTA
  });
}

function browserAssetUrl(relativePath) {
  return "/repo/" + relativePath.split(path.sep).join("/");
}

function optimizedAssetUrl(relativePath) {
  return "/optimized/" + encodeURIComponent(path.basename(relativePath));
}

const optimized = await prepareOptimizedAssets();
const { server, baseUrl } = await startServer();
let browser;

try {
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--use-angle=swiftshader", "--disable-dev-shm-usage"]
  });
  const context = await browser.newContext({
    viewport: { width: 512, height: 512 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce"
  });

  const results = [];
  for (const asset of REPRESENTATIVE_ASSETS) {
    const page = await context.newPage();

    const originalUrl = new URL("/harness", baseUrl);
    originalUrl.searchParams.set("url", browserAssetUrl(asset));
    await page.goto(originalUrl.href, { waitUntil: "networkidle" });
    const originalMeta = await waitForRender(page);
    const canvas = page.locator("#stage");
    const originalPng = await canvas.screenshot();
    const stem = path.basename(asset, ".glb");
    await writeFile(path.join(SCREENSHOT_ROOT, stem + "-original.png"), originalPng);

    const optimizedUrl = new URL("/harness", baseUrl);
    optimizedUrl.searchParams.set("url", optimizedAssetUrl(asset));
    optimizedUrl.searchParams.set("camera", JSON.stringify(originalMeta.camera));
    await page.goto(optimizedUrl.href, { waitUntil: "networkidle" });
    const optimizedMeta = await waitForRender(page);
    const optimizedPng = await page.locator("#stage").screenshot();
    await writeFile(path.join(SCREENSHOT_ROOT, stem + "-optimized.png"), optimizedPng);

    const comparison = await comparePngs(page, originalPng, optimizedPng);
    const originalBounds = [
      ...originalMeta.bounds.min,
      ...originalMeta.bounds.max,
      ...originalMeta.bounds.center,
      originalMeta.bounds.radius
    ];
    const optimizedBounds = [
      ...optimizedMeta.bounds.min,
      ...optimizedMeta.bounds.max,
      ...optimizedMeta.bounds.center,
      optimizedMeta.bounds.radius
    ];
    const maxAbsBoundsDelta = Math.max(
      ...originalBounds.map((value, index) => Math.abs(value - optimizedBounds[index]))
    );
    const boundsEquivalent = maxAbsBoundsDelta <= 1e-6;
    const pass =
      comparison.changedPercent <= MAX_CHANGED_PERCENT &&
      comparison.meanAbsChannelDiff <= MAX_MEAN_ABS_CHANNEL_DIFF;

    results.push({
      asset,
      optimizedOutput: path.relative(REPO_ROOT, optimized.get(asset)).split(path.sep).join("/"),
      original: originalMeta,
      optimized: optimizedMeta,
      boundsEquivalent,
      maxAbsBoundsDelta: Number(maxAbsBoundsDelta.toExponential(6)),
      comparison,
      thresholds: {
        significantChannelDelta: SIGNIFICANT_CHANNEL_DELTA,
        maxChangedPercent: MAX_CHANGED_PERCENT,
        maxMeanAbsChannelDiff: MAX_MEAN_ABS_CHANNEL_DIFF
      },
      pass
    });

    await page.close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    renderer: "three@0.186.0 / Chrome headless / fixed camera+lighting",
    scope: "renderer-neutral visual equivalence gate; production PlayCanvas compatibility remains a separate gate",
    results,
    pass: results.every(item => item.pass)
  };

  await writeFile(path.join(OUTPUT_ROOT, "visual-regression.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));

  if (!report.pass) {
    process.exitCode = 1;
  }
} finally {
  await browser?.close().catch(() => {});
  await new Promise(resolve => server.close(resolve));
}
