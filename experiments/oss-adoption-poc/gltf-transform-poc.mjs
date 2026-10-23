import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune } from "@gltf-transform/functions";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const REPRESENTATIVE_ASSETS = Object.freeze([
  "apps/world/assets/induck-v3.glb",
  "apps/world/assets/induck-backpack-v1.glb",
  "apps/world/assets/p0-qa-building.glb"
]);

function io() {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}

function summary(document) {
  const root = document.getRoot();
  return {
    scenes: root.listScenes().length,
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    primitives: root.listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().length, 0),
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    accessors: root.listAccessors().length,
    animations: root.listAnimations().length,
    skins: root.listSkins().length
  };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function runGltfTransformPoc(relativePath) {
  const sourcePath = path.join(REPO_ROOT, relativePath);
  const input = await readFile(sourcePath);
  const sourceStat = await stat(sourcePath);
  const transformIO = io();
  const started = performance.now();
  const document = await transformIO.read(sourcePath);
  const before = summary(document);

  await document.transform(dedup(), prune());

  const afterTransform = summary(document);
  const dir = await mkdtemp(path.join(os.tmpdir(), "inhagame-gltf-poc-"));
  const outputPath = path.join(dir, path.basename(relativePath));
  try {
    await transformIO.write(outputPath, document);
    const output = await readFile(outputPath);
    const roundTrip = await io().read(outputPath);
    const afterRoundTrip = summary(roundTrip);
    const elapsedMs = performance.now() - started;

    return {
      asset: relativePath,
      inputBytes: sourceStat.size,
      outputBytes: output.length,
      byteDelta: output.length - sourceStat.size,
      reductionPct: Number((((sourceStat.size - output.length) / sourceStat.size) * 100).toFixed(3)),
      elapsedMs: Number(elapsedMs.toFixed(3)),
      inputSha256: sha256(input),
      outputSha256: sha256(output),
      before,
      afterTransform,
      afterRoundTrip,
      sceneCountPreserved: before.scenes === afterRoundTrip.scenes,
      roundTripReadable: true,
      visualRegression: "NOT_TESTED"
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
