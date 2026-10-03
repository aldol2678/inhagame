import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune } from "@gltf-transform/functions";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(TOOL_ROOT, "../..");
export const DEFAULT_CONFIG_PATH = path.join(TOOL_ROOT, "optimization.config.json");

export const ASSET_OPTIMIZATION_STATUS = Object.freeze({
  OPTIMIZED: "OPTIMIZED",
  PASSTHROUGH_COPY: "PASSTHROUGH_COPY",
  FALLBACK_COPY: "FALLBACK_COPY"
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function confined(root, relative) {
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`E_ASSET_PATH_ESCAPE:${relative}`);
  }
  return resolved;
}

function parseArgs(argv) {
  const result = { strict: false, configPath: DEFAULT_CONFIG_PATH, outputRoot: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--strict") result.strict = true;
    else if (arg === "--config") result.configPath = path.resolve(argv[++index] ?? "");
    else if (arg === "--output-root") result.outputRoot = path.resolve(argv[++index] ?? "");
    else throw new Error(`E_ASSET_OPTIMIZER_ARG:${arg}`);
  }
  return result;
}

export async function readOptimizerConfig(configPath = DEFAULT_CONFIG_PATH) {
  const raw = JSON.parse(await readFile(configPath, "utf8"));
  if (raw?.schemaVersion !== 1) throw new Error("E_ASSET_OPTIMIZER_CONFIG_VERSION");
  if (raw.mode !== "allowlist") throw new Error("E_ASSET_OPTIMIZER_MODE");
  if (!Array.isArray(raw.assets) || raw.assets.length === 0) throw new Error("E_ASSET_OPTIMIZER_ASSETS");
  if (raw.policy?.onTransformError !== "copy-source") throw new Error("E_ASSET_OPTIMIZER_FALLBACK_POLICY");

  const seen = new Set();
  for (const item of raw.assets) {
    if (!item || typeof item.file !== "string" || !/^[A-Za-z0-9._-]+\.glb$/u.test(item.file)) {
      throw new Error("E_ASSET_OPTIMIZER_FILE");
    }
    if (seen.has(item.file)) throw new Error(`E_ASSET_OPTIMIZER_DUPLICATE:${item.file}`);
    seen.add(item.file);
    if (typeof item.minSavingsPercent !== "number" || !Number.isFinite(item.minSavingsPercent) ||
        item.minSavingsPercent < 0 || item.minSavingsPercent > 100) {
      throw new Error(`E_ASSET_OPTIMIZER_SAVINGS:${item.file}`);
    }
  }
  return raw;
}

export async function transformGlb(sourcePath, outputPath) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(sourcePath);
  await document.transform(dedup(), prune());
  await io.write(outputPath, document);
}

export async function optimizeFile({
  sourcePath,
  outputPath,
  minSavingsPercent = 0,
  transformer = transformGlb
}) {
  const sourceReal = path.resolve(sourcePath);
  const outputReal = path.resolve(outputPath);
  if (sourceReal === outputReal) throw new Error("E_ASSET_OPTIMIZER_IN_PLACE");

  await mkdir(path.dirname(outputReal), { recursive: true });
  const sourceBytes = await readFile(sourceReal);
  const sourceStat = await stat(sourceReal);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inhagame-asset-opt-"));
  const tempOutput = path.join(tempDir, path.basename(outputReal));

  try {
    try {
      await transformer(sourceReal, tempOutput);
      const optimizedBytes = await readFile(tempOutput);
      const savingsPercent = ((sourceStat.size - optimizedBytes.length) / sourceStat.size) * 100;

      if (savingsPercent >= minSavingsPercent && optimizedBytes.length <= sourceStat.size) {
        await copyFile(tempOutput, outputReal);
        return Object.freeze({
          status: ASSET_OPTIMIZATION_STATUS.OPTIMIZED,
          sourceBytes: sourceStat.size,
          outputBytes: optimizedBytes.length,
          savingsPercent: Number(savingsPercent.toFixed(3)),
          sourceSha256: sha256(sourceBytes),
          outputSha256: sha256(optimizedBytes),
          reason: null
        });
      }

      await copyFile(sourceReal, outputReal);
      return Object.freeze({
        status: ASSET_OPTIMIZATION_STATUS.PASSTHROUGH_COPY,
        sourceBytes: sourceStat.size,
        outputBytes: sourceStat.size,
        savingsPercent: 0,
        sourceSha256: sha256(sourceBytes),
        outputSha256: sha256(sourceBytes),
        reason: "MIN_SAVINGS_NOT_MET"
      });
    } catch (error) {
      await copyFile(sourceReal, outputReal);
      return Object.freeze({
        status: ASSET_OPTIMIZATION_STATUS.FALLBACK_COPY,
        sourceBytes: sourceStat.size,
        outputBytes: sourceStat.size,
        savingsPercent: 0,
        sourceSha256: sha256(sourceBytes),
        outputSha256: sha256(sourceBytes),
        reason: String(error?.message ?? error)
      });
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function optimizeConfiguredAssets({
  configPath = DEFAULT_CONFIG_PATH,
  outputRootOverride = null,
  strict = false
} = {}) {
  const config = await readOptimizerConfig(configPath);
  const sourceRoot = confined(REPO_ROOT, config.sourceRoot);
  const outputRoot = outputRootOverride
    ? path.resolve(outputRootOverride)
    : confined(REPO_ROOT, config.outputRoot);

  if (outputRoot === sourceRoot || outputRoot.startsWith(sourceRoot + path.sep)) {
    throw new Error("E_ASSET_OPTIMIZER_OUTPUT_INSIDE_SOURCE");
  }

  await mkdir(outputRoot, { recursive: true });
  const results = [];

  for (const asset of config.assets) {
    const sourcePath = confined(sourceRoot, asset.file);
    const outputPath = confined(outputRoot, asset.file);
    const result = await optimizeFile({
      sourcePath,
      outputPath,
      minSavingsPercent: asset.minSavingsPercent
    });
    results.push(Object.freeze({
      file: asset.file,
      source: path.relative(REPO_ROOT, sourcePath).split(path.sep).join("/"),
      output: path.relative(REPO_ROOT, outputPath).split(path.sep).join("/"),
      ...result
    }));
  }

  const fallbackCount = results.filter(item => item.status === ASSET_OPTIMIZATION_STATUS.FALLBACK_COPY).length;
  const optimizedCount = results.filter(item => item.status === ASSET_OPTIMIZATION_STATUS.OPTIMIZED).length;
  const passthroughCount = results.filter(item => item.status === ASSET_OPTIMIZATION_STATUS.PASSTHROUGH_COPY).length;

  const receipt = Object.freeze({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    config: path.relative(REPO_ROOT, configPath).split(path.sep).join("/"),
    mode: config.mode,
    strict,
    summary: Object.freeze({
      total: results.length,
      optimized: optimizedCount,
      passthrough: passthroughCount,
      fallback: fallbackCount
    }),
    results: Object.freeze(results)
  });

  const reportPath = path.join(outputRoot, "optimization-report.json");
  await writeFile(reportPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");

  if (strict && config.policy?.strictRejectsFallback && fallbackCount > 0) {
    const error = new Error(`E_ASSET_OPTIMIZER_STRICT_FALLBACK:${fallbackCount}`);
    error.receipt = receipt;
    throw error;
  }

  return receipt;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const receipt = await optimizeConfiguredAssets({
    configPath: args.configPath,
    outputRootOverride: args.outputRoot,
    strict: args.strict
  });
  console.log(JSON.stringify(receipt, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    if (error?.receipt) console.error(JSON.stringify(error.receipt, null, 2));
    console.error(String(error?.stack ?? error));
    process.exitCode = 1;
  });
}
