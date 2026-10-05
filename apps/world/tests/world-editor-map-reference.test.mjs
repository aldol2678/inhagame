import test from "node:test";
import assert from "node:assert/strict";
import { MapReferenceController } from "../src/editor/map-reference-controller.js";
import {
  calibrateMapReference,
  createMapReference,
  footprintWorldPoints,
  imagePixelToWorld,
  validateFootprint,
  validateMapReference,
  worldToImagePixel
} from "../src/editor/map-reference.js";

const sample = () => createMapReference({
  name: "self-authored.png", mimeType: "image/png", width: 1000, height: 500,
  rightsNote: "직접 제작한 참조 도면"
});

test("local map reference starts centered in meter-based X/Z coordinates", () => {
  const reference = sample();
  assert.equal(reference.metersPerPixel, 0.04);
  assert.deepEqual(imagePixelToWorld(reference, [0, 0]), [-20, 10]);
  assert.deepEqual(imagePixelToWorld(reference, [1000, 500]), [20, -10]);
  assert.deepEqual(worldToImagePixel(reference, [0, 0]), [500, 250]);
  assert.ok(!("imageBlob" in reference));
});

test("two-point calibration preserves the first world anchor and measured distance", () => {
  const reference = sample();
  const first = [250, 250];
  const second = [750, 250];
  const before = imagePixelToWorld(reference, first);
  const calibrated = calibrateMapReference(reference, first, second, 100);
  assert.equal(calibrated.metersPerPixel, 0.2);
  assert.deepEqual(imagePixelToWorld(calibrated, first), before);
  const after = imagePixelToWorld(calibrated, second);
  assert.equal(Math.hypot(after[0] - before[0], after[1] - before[1]), 100);
  assert.equal(reference.metersPerPixel, 0.04);
});

test("traced footprint stays aligned with the reference after recalibration", () => {
  const reference = sample();
  const footprint = { points: [[100, 100], [200, 100], [200, 200], [100, 200]] };
  reference.footprints.push(footprint);
  assert.deepEqual(footprintWorldPoints(reference, footprint)[0], [-16, 6]);
  const calibrated = calibrateMapReference(reference, [0, 0], [500, 0], 100);
  assert.deepEqual(footprintWorldPoints(calibrated, footprint)[0], [0, -10]);
  assert.deepEqual(calibrated.footprints[0].points, footprint.points);
});

test("invalid rights, calibration, scale and degenerate footprints are rejected", () => {
  assert.throws(() => createMapReference({ name: "x.png", mimeType: "image/png", width: 10, height: 10, rightsNote: "" }), /RIGHTS_NOTE/);
  assert.throws(() => calibrateMapReference(sample(), [0, 0], [1, 0], 10), /CALIBRATION/);
  assert.throws(() => validateMapReference({ ...sample(), metersPerPixel: 0 }), /REFERENCE_INVALID/);
  assert.throws(() => validateFootprint([[0, 0], [1, 1], [2, 2]]), /AREA_INVALID/);
  assert.deepEqual(validateFootprint([[0, 0], [4, 0], [4, 3], [0, 3]]).length, 4);
});

test("replacing an image cannot be overwritten by an earlier pending reference save", async () => {
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 200, height: 100, close() {} });
  let releaseFirstWrite;
  let firstWriteStarted;
  const firstWrite = new Promise(resolve => { releaseFirstWrite = resolve; });
  const firstStarted = new Promise(resolve => { firstWriteStarted = resolve; });
  const writes = [];
  const store = {
    async writeReference(_worldId, record) {
      writes.push(record);
      if (writes.length === 1) { firstWriteStarted(); await firstWrite; }
    }
  };
  const controller = Object.create(MapReferenceController.prototype);
  Object.assign(controller, {
    worldId: "world.test", reference: sample(), imageBlob: { name: "old.png" }, bitmap: null,
    imageFile: { files: [{ name: "new.png", type: "image/png", size: 100 }] },
    rights: { value: "직접 제작" }, loadSequence: 0, writeQueue: Promise.resolve(),
    getStore: () => store, syncControls() {}, setMode() {}, render() {}, message() {}
  });
  try {
    controller.persist();
    await firstStarted;
    const importPromise = controller.importImage();
    await Promise.resolve();
    assert.equal(writes.length, 1);
    releaseFirstWrite();
    await importPromise;
    assert.equal(writes.at(-1).reference.name, "new.png");
  } finally {
    releaseFirstWrite();
    globalThis.createImageBitmap = previousCreateImageBitmap;
  }
});
