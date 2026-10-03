import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const worldDir = fileURLToPath(new URL("../", import.meta.url));
const main = readFileSync(join(worldDir, "src/main.js"), "utf8");
const inputRuntime = readFileSync(join(worldDir, "src/input/world-input-runtime.js"), "utf8");
const presentation = readFileSync(join(worldDir, "src/hud/hud-presentation.js"), "utf8");

test("main wires HUD context beside, not inside, the existing InputFocus authority", () => {
  assert.match(inputRuntime, /import \{ createHudContext \} from "\.\.\/hud\/hud-context\.js";/);
  assert.match(inputRuntime, /import \{ bindHudPresentation \} from "\.\.\/hud\/hud-presentation\.js";/);
  assert.match(inputRuntime, /const inputFocus = createInputFocusManager\(\);\s*const hudContext = createHudContext\(\);/);
  assert.match(inputRuntime, /bindHudPresentation\(\{ context: hudContext, root \}\)/);
  assert.match(inputRuntime, /inputFocus\.subscribe\([\s\S]*snapshot => hudContext\.syncInputFocus\(snapshot\)[\s\S]*emitCurrent: true/s);
});

test("presentation bridge owns no visibility, movement, camera or input mutations", () => {
  assert.doesNotMatch(presentation, /\.hidden\s*=|style\.|classList\.|setInputEnabled|claim\(|release\(|pointerLock|worldAction/);
  assert.match(presentation, /root\.dataset\.hudMode/);
  assert.match(presentation, /root\.dataset\.hudOverlay/);
});

test("existing InputFocus and context-action wiring remains present", () => {
  assert.match(inputRuntime, /const inputFocus = createInputFocusManager\(\);/);
  assert.match(main, /bindInputFocusRuntime\(\{ manager: inputFocus, controller, orbit \}\);/);
  assert.match(main, /const contextActions = createContextActionController\(/);
  assert.match(main, /contextActions\.setSuspended\(suspended\);/);
});
