import test from "node:test";
import assert from "node:assert/strict";

import { HUD_MODE, HUD_OVERLAY, LIFE_MODE, PET_CONTEXT, createHudContext } from "../src/hud/hud-context.js";
import { applyHudPresentation, bindHudPresentation } from "../src/hud/hud-presentation.js";
import { INPUT_FOCUS_CLASS } from "../src/input/input-focus-manager.js";

function fakeRoot() {
  return { dataset: {} };
}

test("HUD presentation writes state tokens only to data attributes", () => {
  const root = fakeRoot();
  applyHudPresentation(root, {
    mode: HUD_MODE.LIFE,
    lifeMode: LIFE_MODE.FISHING,
    petContext: PET_CONTEXT.NONE,
    overlay: HUD_OVERLAY.NONE,
    inputFocusClass: INPUT_FOCUS_CLASS.GAMEPLAY
  });

  assert.deepEqual(root.dataset, {
    hudMode: "LIFE",
    hudLifeMode: "FISHING",
    hudPetContext: "NONE",
    hudOverlay: "NONE",
    hudInputFocus: "GAMEPLAY"
  });
});

test("bound presentation follows context and does not mutate InputFocus", () => {
  const root = fakeRoot();
  const hud = createHudContext();
  const binding = bindHudPresentation({ context: hud, root });

  assert.equal(root.dataset.hudMode, "EXPLORE");
  hud.setMode(HUD_MODE.COMBAT);
  assert.equal(root.dataset.hudMode, "COMBAT");

  hud.syncInputFocus({
    focusClass: INPUT_FOCUS_CLASS.BLOCKING_UI,
    topOwners: ["inventory"]
  });
  assert.equal(root.dataset.hudOverlay, "INVENTORY");
  assert.equal(root.dataset.hudInputFocus, "BLOCKING_UI");

  binding.destroy();
  hud.setMode(HUD_MODE.EXPLORE);
  assert.equal(root.dataset.hudMode, "COMBAT");
});
