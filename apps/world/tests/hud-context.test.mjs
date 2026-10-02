import test from "node:test";
import assert from "node:assert/strict";

import {
  HUD_MODE,
  HUD_OVERLAY,
  LIFE_MODE,
  PET_CONTEXT,
  createHudContext,
  hudOverlayFromInputFocus
} from "../src/hud/hud-context.js";
import { INPUT_FOCUS_CLASS } from "../src/input/input-focus-manager.js";

test("HUD context defaults to Explore without changing gameplay input authority", () => {
  const hud = createHudContext();
  assert.deepEqual(hud.snapshot(), {
    mode: HUD_MODE.EXPLORE,
    lifeMode: LIFE_MODE.NONE,
    petContext: PET_CONTEXT.NONE,
    overlay: HUD_OVERLAY.NONE,
    overlayOwnerIds: [],
    inputFocusClass: INPUT_FOCUS_CLASS.GAMEPLAY,
    version: 0
  });
});

test("Life subtype enters LIFE while leaving other gameplay modes explicit", () => {
  const hud = createHudContext();
  hud.setLifeMode(LIFE_MODE.FISHING);
  assert.equal(hud.snapshot().mode, HUD_MODE.LIFE);
  assert.equal(hud.snapshot().lifeMode, LIFE_MODE.FISHING);

  hud.setMode(HUD_MODE.EXPLORE);
  assert.equal(hud.snapshot().mode, HUD_MODE.EXPLORE);
  assert.equal(hud.snapshot().lifeMode, LIFE_MODE.NONE);

  hud.setMode(HUD_MODE.COMBAT);
  assert.equal(hud.snapshot().mode, HUD_MODE.COMBAT);
  assert.equal(hud.snapshot().lifeMode, LIFE_MODE.NONE);
});

test("Pet follow and interaction remain presentation context rather than a blocking overlay", () => {
  const hud = createHudContext();
  hud.setPetContext(PET_CONTEXT.FOLLOW);
  assert.equal(hud.snapshot().mode, HUD_MODE.EXPLORE);
  assert.equal(hud.snapshot().petContext, PET_CONTEXT.FOLLOW);

  hud.setPetContext(PET_CONTEXT.INTERACTION);
  assert.equal(hud.snapshot().mode, HUD_MODE.EXPLORE);
  assert.equal(hud.snapshot().petContext, PET_CONTEXT.INTERACTION);

  hud.setMode(HUD_MODE.PET_RIDE);
  assert.equal(hud.snapshot().mode, HUD_MODE.PET_RIDE);
});

test("InputFocus snapshots are read only and mapped to HUD overlay presentation", () => {
  assert.equal(hudOverlayFromInputFocus({
    focusClass: INPUT_FOCUS_CLASS.BLOCKING_UI,
    topOwners: ["full-map"]
  }).overlay, HUD_OVERLAY.FULL_MAP);

  assert.equal(hudOverlayFromInputFocus({
    focusClass: INPUT_FOCUS_CLASS.BLOCKING_UI,
    topOwners: ["shop"]
  }).overlay, HUD_OVERLAY.SHOP);

  assert.equal(hudOverlayFromInputFocus({
    focusClass: INPUT_FOCUS_CLASS.BLOCKING_UI,
    topOwners: ["npc-dialogue", "mcm-dialogue"]
  }).overlay, HUD_OVERLAY.DIALOGUE);

  assert.equal(hudOverlayFromInputFocus({
    focusClass: INPUT_FOCUS_CLASS.SYSTEM_LOCK,
    topOwners: ["lobby-transition"]
  }).overlay, HUD_OVERLAY.SYSTEM_LOCK);

  assert.equal(hudOverlayFromInputFocus({
    focusClass: INPUT_FOCUS_CLASS.CHAT,
    topOwners: ["chat"]
  }).overlay, HUD_OVERLAY.CHAT);
});

test("multiple unrelated same-priority blocking owners collapse to generic BLOCKING_UI", () => {
  const hud = createHudContext();
  hud.syncInputFocus({
    focusClass: "MIXED",
    topOwners: ["full-map", "shop"]
  });
  assert.equal(hud.snapshot().overlay, HUD_OVERLAY.BLOCKING_UI);
  assert.deepEqual(hud.snapshot().overlayOwnerIds, ["full-map", "shop"]);
});

test("invalid states fail fast", () => {
  assert.throws(() => createHudContext({ mode: "UNKNOWN" }), /Unknown HUD mode/);
  assert.throws(
    () => createHudContext({ mode: HUD_MODE.EXPLORE, lifeMode: LIFE_MODE.FISHING }),
    /requires HUD_MODE\.LIFE/
  );

  const hud = createHudContext();
  assert.throws(() => hud.setMode("UNKNOWN"), /Unknown HUD mode/);
  assert.throws(() => hud.setLifeMode("UNKNOWN"), /Unknown Life mode/);
  assert.throws(() => hud.setPetContext("UNKNOWN"), /Unknown Pet context/);
});

test("subscribers receive only real state changes", () => {
  const hud = createHudContext();
  const versions = [];
  const off = hud.subscribe(state => versions.push(state.version), { emitCurrent: true });
  hud.setMode(HUD_MODE.EXPLORE);
  hud.setMode(HUD_MODE.COMBAT);
  hud.setMode(HUD_MODE.COMBAT);
  hud.setMode(HUD_MODE.EXPLORE);
  off();
  hud.setMode(HUD_MODE.COMBAT);
  assert.deepEqual(versions, [0, 1, 2]);
});
