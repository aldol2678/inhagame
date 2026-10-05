import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const biryong = readFileSync(new URL("../src/biryong/biryong-system.js", import.meta.url), "utf8");

test("Biryong scripted flow uses one BLOCKING_UI owner in main", () => {
  assert.match(main, /ownerId: "biryong-scripted".*policy: INPUT_FOCUS_POLICY\.BLOCKING_UI/s);
  assert.match(main, /onInputLockChange:\s*\(locked\)\s*=>\s*\{[\s\S]*biryongScriptedInput\.acquire\(\)[\s\S]*biryongScriptedInput\.release\(\)/s);
  const createBlock = main.match(/biryong = createBiryongSystem\(\{[\s\S]*?\n\}\);/)?.[0] ?? "";
  assert.doesNotMatch(createBlock, /\bcontroller\b/, "Biryong no longer receives direct PlayerController authority");
});

test("Biryong runtime publishes idempotent scripted input lifecycle", () => {
  assert.match(biryong, /onInputLockChange = \(\) => \{\}/);
  assert.match(biryong, /function holdInput\(hold\)[\s\S]*if \(inputHeld === next\) return false;[\s\S]*onInputLockChange\(inputHeld\)/s);
  assert.doesNotMatch(biryong, /controller\?\.setInputEnabled|controller\?\.keys\?\.clear/);
});

test("dialogue completion keeps the lock through chained cinematic work", () => {
  const endBlock = biryong.match(/function endDialogue\(\)[\s\S]*?return true;\s*\}/)?.[0] ?? "";
  assert.ok(endBlock.indexOf("done?.()") < endBlock.indexOf("holdInput(false)"),
    "completion callback runs before deciding whether input can be released");
  assert.match(endBlock, /if \(!dialogue && !shout && !cinematic\) holdInput\(false\)/);
  assert.match(biryong, /function completeEvent\(\) \{\s*holdInput\(true\);\s*cinematic = \{ kind: 'rise'/s);
});

test("Biryong status exposes input lock for runtime QA", () => {
  assert.match(biryong, /inputLocked: inputHeld/);
  assert.match(main, /biryongScripted: biryongScriptedInput\.active/);
});
