import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const main = read("../src/main.js");
const player = read("../src/player-controller.js");
const orbit = read("../src/orbit-camera-controller.js");
const eventUi = read("../src/events/zombie-university-2026/event-ui.js");

test("P0-E removes panel-specific policy from PlayerController and OrbitCameraController", () => {
  assert.doesNotMatch(player, /profile-panel|view-settings|keyboard-shortcuts-panel/);
  assert.doesNotMatch(orbit, /profile-panel|view-settings|keyboard-shortcuts-panel/);
  assert.match(player, /if \(!this\.inputEnabled\) return;/);
  assert.match(orbit, /if \(!this\.inputEnabled \|\| !this\.canUseGameplayShortcut\(\)\) return;/);
});

test("P0-E collapses main gameplay gates to InputFocusManager", () => {
  assert.match(main, /const worldActionsSuspended = \(\) => !inputFocus\.can\("WORLD_ACTION"\);/);
  assert.match(main, /shouldIgnoreShortcut: \(\) => !inputFocus\.can\("GAMEPLAY_SHORTCUT"\),/);
  assert.match(main, /shouldIgnoreShortcut: \(\) => !inputFocus\.can\("WORLD_ACTION"\),/);
  const worldGate = main.match(/const worldActionsSuspended = \(\) =>[^;]+;/)?.[0] ?? "";
  assert.equal(worldGate, 'const worldActionsSuspended = () => !inputFocus.can("WORLD_ACTION");');
  const shortcutGates = [...main.matchAll(/shouldIgnoreShortcut:\s*\(\)\s*=>[^,]+,/g)].map(match => match[0]);
  assert.ok(shortcutGates.length >= 2);
  for (const gate of shortcutGates) {
    assert.doesNotMatch(gate, /fullMap|keyboardHelp|profile-panel|view-settings|npcTest|biryong/);
  }
});

test("MCM event info modal publishes idempotent blocking lifecycle", () => {
  assert.match(eventUi, /onOpenChange=\(\)=>\{\}/);
  assert.match(eventUi, /function openInfo\(\)[\s\S]*if\(open\)return false;[\s\S]*onOpenChange\(true\)/s);
  assert.match(eventUi, /function close\(\)[\s\S]*if\(!open\)return false;[\s\S]*onOpenChange\(false\)/s);
  assert.match(eventUi, /destroy\(\)\{close\(\);/);
});
