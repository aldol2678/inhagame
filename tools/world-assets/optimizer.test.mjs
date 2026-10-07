import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ASSET_OPTIMIZATION_STATUS,
  DEFAULT_CONFIG_PATH,
  REPO_ROOT,
  optimizeConfiguredAssets,
  optimizeFile,
  readOptimizerConfig
} from "./optimize-world-assets.mjs";

test("production optimizer config covers all six World GLBs", async () => {
  const config = await readOptimizerConfig(DEFAULT_CONFIG_PATH);
  assert.equal(config.mode, "allowlist");
  assert.deepEqual(config.assets.map(item => item.file), [
    "induck-v3.glb",
    "annyongi-flight-v1.glb",
    "induck-cap-v1.glb",
    "induck-backpack-v1.glb",
    "induck-hoodie-v1.glb",
    "p0-qa-building.glb"
  ]);
  assert.equal(config.policy.onTransformError, "copy-source");
  assert.equal(config.policy.strictRejectsFallback, true);
  assert.equal(config.assets.find(item => item.file === "induck-v3.glb").keepEmptyLeafNodes, true);
  assert.equal(config.assets.find(item => item.file === "annyongi-flight-v1.glb").keepEmptyLeafNodes, true);
  assert.equal(config.assets.find(item => item.file === "induck-cap-v1.glb").keepEmptyLeafNodes, undefined);
  assert.equal(config.assets.find(item => item.file === "induck-backpack-v1.glb").keepEmptyLeafNodes, undefined);
  assert.equal(config.assets.find(item => item.file === "induck-hoodie-v1.glb").keepEmptyLeafNodes, undefined);
});

test("strict allowlist optimization preserves sources and optimizes all validated GLBs", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inhagame-world-assets-test-"));
  try {
    const tracked = [
      "induck-v3.glb",
      "annyongi-flight-v1.glb",
      "induck-cap-v1.glb",
      "induck-backpack-v1.glb",
      "induck-hoodie-v1.glb",
      "p0-qa-building.glb"
    ];
    const before = new Map();
    for (const file of tracked) {
      before.set(file, await readFile(path.join(REPO_ROOT, "apps/world/assets", file)));
    }

    const receipt = await optimizeConfiguredAssets({ outputRootOverride: dir, strict: true });
    assert.deepEqual(receipt.summary, { total: 6, optimized: 6, passthrough: 0, fallback: 0 });
    assert.ok(receipt.results.every(item => item.status === ASSET_OPTIMIZATION_STATUS.OPTIMIZED));
    assert.ok(receipt.results.every(item => item.outputBytes < item.sourceBytes));

    for (const file of tracked) {
      assert.deepEqual(
        await readFile(path.join(REPO_ROOT, "apps/world/assets", file)),
        before.get(file),
        `${file} source remains byte-identical`
      );
    }

    const report = JSON.parse(await readFile(path.join(dir, "optimization-report.json"), "utf8"));
    assert.equal(report.summary.fallback, 0);

    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const duck = await io.read(path.join(dir, "induck-v3.glb"));
    const nodeNames = new Set(duck.getRoot().listNodes().map(node => node.getName()));
    for (const pivot of ["DuckWing_L", "DuckWing_R", "DuckLeg_L", "DuckLeg_R"]) {
      assert.equal(nodeNames.has(pivot), true, `${pivot} semantic pivot survives optimization`);
    }
    const duckReceipt = report.results.find(item => item.file === "induck-v3.glb");
    assert.equal(duckReceipt.keepEmptyLeafNodes, true);

    const dragon = await io.read(path.join(dir, "annyongi-flight-v1.glb"));
    const dragonNodeNames = new Set(dragon.getRoot().listNodes().map(node => node.getName()));
    for (const pivot of ["DragonWing_L", "DragonWing_R", "RiderAnchor", "CloudWing_L", "CloudWing_R", "Forelock", "Tail", "Head"]) {
      assert.equal(dragonNodeNames.has(pivot), true, `${pivot} semantic pivot survives optimization`);
    }
    const sourceDragon=await io.read(path.join(REPO_ROOT,"apps/world/assets/annyongi-flight-v1.glb"));
    for(const node of sourceDragon.getRoot().listNodes()) {
      const optimized=dragon.getRoot().listNodes().find(n=>n.getName()===node.getName());
      assert.ok(optimized,node.getName());assert.deepEqual(optimized.getTranslation(),node.getTranslation());
      const mesh=node.getMesh();if(!mesh)continue;
      const actual=optimized.getMesh();assert.ok(actual);
      for(let i=0;i<mesh.listPrimitives().length;i++) {
        const expected=mesh.listPrimitives()[i],result=actual.listPrimitives()[i];
        for(const semantic of ['POSITION','NORMAL','COLOR_0']) assert.deepEqual(result.getAttribute(semantic).getArray(),expected.getAttribute(semantic).getArray(),node.getName()+semantic);
        assert.deepEqual(result.getIndices().getArray(),expected.getIndices().getArray());
      }
    }
    const dragonReceipt = report.results.find(item => item.file === "annyongi-flight-v1.glb");
    assert.equal(dragonReceipt.keepEmptyLeafNodes, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("transform failure copies source bytes and exposes FALLBACK_COPY", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inhagame-world-assets-fallback-"));
  try {
    const source = path.join(dir, "source.glb");
    const output = path.join(dir, "out", "source.glb");
    const bytes = Buffer.from("not-a-real-glb");
    await writeFile(source, bytes);

    const result = await optimizeFile({
      sourcePath: source,
      outputPath: output,
      minSavingsPercent: 1,
      transformer: async () => { throw new Error("SYNTHETIC_TRANSFORM_FAILURE"); }
    });

    assert.equal(result.status, ASSET_OPTIMIZATION_STATUS.FALLBACK_COPY);
    assert.equal(result.reason, "SYNTHETIC_TRANSFORM_FAILURE");
    assert.deepEqual(await readFile(output), bytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("optimizer refuses in-place writes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inhagame-world-assets-inplace-"));
  try {
    const file = path.join(dir, "asset.glb");
    await writeFile(file, Buffer.from("x"));
    await assert.rejects(
      optimizeFile({ sourcePath: file, outputPath: file }),
      /E_ASSET_OPTIMIZER_IN_PLACE/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("no useful size gain is reported as PASSTHROUGH_COPY instead of OPTIMIZED", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inhagame-world-assets-passthrough-"));
  try {
    const source = path.join(dir, "source.glb");
    const output = path.join(dir, "out", "source.glb");
    const bytes = Buffer.from("same-size-fixture");
    await writeFile(source, bytes);

    const result = await optimizeFile({
      sourcePath: source,
      outputPath: output,
      minSavingsPercent: 1,
      transformer: async (input, target) => copyFile(input, target)
    });

    assert.equal(result.status, ASSET_OPTIMIZATION_STATUS.PASSTHROUGH_COPY);
    assert.equal(result.reason, "MIN_SAVINGS_NOT_MET");
    assert.deepEqual(await readFile(output), bytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("strict configured run writes fallback receipt and then fails", async () => {
  const fixtureRoot = path.join(REPO_ROOT, "tools/world-assets/.strict-fallback-fixture");
  const sourceRoot = path.join(fixtureRoot, "source");
  const outputRoot = path.join(fixtureRoot, "output");
  const configPath = path.join(fixtureRoot, "config.json");

  await rm(fixtureRoot, { recursive: true, force: true });
  try {
    await mkdir(sourceRoot, { recursive: true });
    const source = path.join(sourceRoot, "broken.glb");
    const bytes = Buffer.from("invalid-glb-for-strict-fallback");
    await writeFile(source, bytes);
    await writeFile(configPath, JSON.stringify({
      schemaVersion: 1,
      mode: "allowlist",
      sourceRoot: "tools/world-assets/.strict-fallback-fixture/source",
      outputRoot: "tools/world-assets/.strict-fallback-fixture/output",
      policy: {
        onTransformError: "copy-source",
        strictRejectsFallback: true
      },
      assets: [{ file: "broken.glb", minSavingsPercent: 1 }]
    }), "utf8");

    await assert.rejects(
      optimizeConfiguredAssets({ configPath, outputRootOverride: outputRoot, strict: true }),
      error => {
        assert.match(error.message, /E_ASSET_OPTIMIZER_STRICT_FALLBACK:1/);
        assert.equal(error.receipt.summary.fallback, 1);
        assert.equal(error.receipt.results[0].status, ASSET_OPTIMIZATION_STATUS.FALLBACK_COPY);
        return true;
      }
    );

    assert.deepEqual(await readFile(path.join(outputRoot, "broken.glb")), bytes);
    const report = JSON.parse(await readFile(path.join(outputRoot, "optimization-report.json"), "utf8"));
    assert.equal(report.summary.fallback, 1);
    assert.equal(report.results[0].status, ASSET_OPTIMIZATION_STATUS.FALLBACK_COPY);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
