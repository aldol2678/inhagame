import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const profile = readFileSync(new URL("../src/campus-profile.js", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/view-distance-settings.js", import.meta.url), "utf8");

test("profile lifecycle emits only on real open-state transitions", () => {
  assert.match(profile, /onOpenChange = \(\) => \{\}/);
  assert.match(profile, /let panelOpen = panel\.hidden === false;/);
  assert.match(profile, /if \(value === panelOpen\) return panelOpen;/);
  assert.match(profile, /panel\.hidden = !panelOpen;\s*onOpenChange\(panelOpen\);/s);
  assert.match(profile, /get open\(\) \{ return panelOpen; \},\s*setOpen,/s);
});

test("settings lifecycle emits only on real open-state transitions", () => {
  assert.match(settings, /onOpenChange=\(\)=>\{\}/);
  assert.match(settings, /let panelOpen=panel\.hidden===false;/);
  assert.match(settings, /if\(value===panelOpen\)return panelOpen;/);
  assert.match(settings, /panel\.hidden=!panelOpen;[\s\S]*onOpenChange\(panelOpen\);/s);
  assert.match(settings, /get open\(\)\{return panelOpen;\},setOpen/);
});

test("settings no longer clears PlayerController directly", () => {
  assert.doesNotMatch(settings, /controller\.keys\.clear|controller\.ascendHeld|controller\.descendHeld/);
  assert.doesNotMatch(settings, /setInputEnabled\(/);
});
