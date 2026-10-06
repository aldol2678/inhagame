import test from "node:test";
import assert from "node:assert/strict";
import { createInputFocusManager } from "../src/input/input-focus-manager.js";
import { createCinematicDirector } from "../src/cinematic/cinematic-director.js";

function cameraFixture() {
  const position = { x: 0, y: 2, z: 0 };
  const camera = {
    camera: { fov: 62 },
    forward: { x: 0, y: 0, z: -1 },
    getPosition: () => ({ ...position }),
    setPosition(x, y, z) { Object.assign(position, { x, y, z }); },
    lookAt(x, y, z) { this.lastLook = { x, y, z }; }
  };
  return { camera, position };
}

const sequence = Object.freeze({
  id: "TEST_CINE",
  duration: 2,
  blendSeconds: .25,
  streamingLeadSeconds: .5,
  skippable: true,
  poseAt(time) {
    return {
      pos: { x: time * 10, y: 5, z: 20 },
      look: { x: 30, y: 4, z: 40 },
      fov: 70
    };
  }
});

test("cinematic director owns input temporarily, blends the existing camera and restores FOV", () => {
  const inputFocus = createInputFocusManager();
  const { camera, position } = cameraFixture();
  const root = { dataset: {} };
  const director = createCinematicDirector({
    camera, inputFocus, root, reducedMotion: { matches: false }
  });

  assert.equal(director.start(sequence), true);
  assert.equal(director.active, true);
  assert.equal(root.dataset.cinematic, "TEST_CINE");
  assert.equal(inputFocus.snapshot().movement, false);
  assert.equal(inputFocus.snapshot().camera, false);

  director.update(.2);
  assert.equal(director.applyCamera(), true);
  assert.notEqual(position.x, 0);
  assert.ok(camera.camera.fov > 62 && camera.camera.fov < 70);

  assert.equal(director.skip(), true);
  assert.equal(director.active, false);
  assert.equal(camera.camera.fov, 62);
  assert.equal(root.dataset.cinematic, undefined);
  assert.equal(inputFocus.snapshot().movement, true);
  assert.equal(director.status().reason, "skip");
});

test("cinematic streaming interest includes current and look-ahead camera targets", () => {
  const director = createCinematicDirector({
    camera: cameraFixture().camera,
    inputFocus: createInputFocusManager(),
    reducedMotion: { matches: false }
  });
  director.start(sequence);
  director.update(.25);
  const points = director.streamingInterestPoints();
  assert.equal(points.length, 4);
  assert.ok(points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)));
  assert.notDeepEqual(points[0], points[2], "look-ahead pose must prewarm a future position");
});

test("reduced-motion users complete the optional reveal without camera travel or input lock", () => {
  const inputFocus = createInputFocusManager();
  const { camera, position } = cameraFixture();
  let completion = null;
  const director = createCinematicDirector({
    camera, inputFocus, reducedMotion: { matches: true }
  });
  assert.equal(director.start(sequence, { onComplete: result => { completion = result; } }), true);
  assert.equal(director.active, false);
  assert.deepEqual(position, { x: 0, y: 2, z: 0 });
  assert.equal(inputFocus.snapshot().movement, true);
  assert.equal(completion.reason, "reduced-motion");
});


test("cinematic timing catches up under low FPS instead of stretching with the gameplay step cap", () => {
  const director = createCinematicDirector({
    camera: cameraFixture().camera,
    inputFocus: createInputFocusManager(),
    reducedMotion: { matches: false }
  });
  director.start(sequence);
  for (let i = 0; i < 8; i++) director.update(1);
  assert.equal(director.active, false);
  assert.equal(director.status().reason, "complete");
});
