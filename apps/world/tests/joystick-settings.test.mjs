// INHA WORLD · Mobile Control Cleanup: one fixed joystick size, side (left / right) only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const settingsHtml = read("index.html");
const hub = read("hub.js");
const campus = read("campus/index.html");
const css = read("styles.css");

/** Runs the campus page's inline joystick script against a stored value; returns the body classes. */
function campusClasses(stored) {
  const script = campus.match(/<script>\s*(try \{[\s\S]*?inhagame-campus-settings-v1[\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "campus inline joystick script");
  const classes = new Set();
  const context = {
    localStorage: { getItem: (key) => (key === "inhagame-campus-settings-v1" ? stored : null) },
    document: { body: { classList: { add: (c) => classes.add(c) } } }
  };
  vm.runInNewContext(script, context);
  return [...classes].sort();
}

test("1-3. settings page: no size control, side control kept", () => {
  assert.doesNotMatch(settingsHtml, /joystick-size/);
  assert.doesNotMatch(settingsHtml, /조이스틱 크기/);
  assert.match(settingsHtml, /<select id="joystick-side"><option value="left">왼쪽<\/option><option value="right">오른쪽<\/option><\/select>/);
  assert.match(settingsHtml, /조이스틱 위치 설정입니다/);
});

test("4-5. hub.js: no size input; saves the side and drops a legacy size, keeping other fields", () => {
  assert.doesNotMatch(hub, /sizeInput|joystick-size|saved\.size\)/);
  assert.match(hub, /const storageKey = "inhagame-campus-settings-v1";/);
  assert.match(hub, /delete saved\.size;\s*localStorage\.setItem\(storageKey, JSON\.stringify\(\{ \.\.\.saved, side: sideInput\.value \}\)\);/);
  assert.match(hub, /sideInput\.addEventListener\("change", save\);/);
});

test("6-8. campus: legacy { size: large, side: right } applies right only; size never adds a class", () => {
  assert.doesNotMatch(campus, /joystick-large|config\.size/);
  assert.deepEqual(campusClasses(JSON.stringify({ size: "large", side: "right" })), ["joystick-right"]);
  assert.deepEqual(campusClasses(JSON.stringify({ size: "large", side: "left" })), []);
  assert.deepEqual(campusClasses(JSON.stringify({ side: "right" })), ["joystick-right"]);
  assert.deepEqual(campusClasses(null), []);
  assert.deepEqual(campusClasses("{not json"), [], "broken storage falls back to the default controls");
});

test("9-11. no joystick-large / joystick-size reference left in World source", () => {
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "tests" || name.startsWith(".")) continue; // tests assert the absence
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!/\.(js|mjs|html|css|json)$/.test(name)) continue;
      if (/joystick-large|joystick-size/.test(readFileSync(path, "utf8"))) hits.push(path);
    }
  };
  walk(new URL(".", root).pathname);
  assert.deepEqual(hits, []);
});

test("12-13. normal social cluster position and the right-hand mirror stay", () => {
  assert.match(css, /\.social-cluster \{[^}]*bottom: max\(154px, calc\(env\(safe-area-inset-bottom\) \+ 126px\)\);/);
  assert.match(css, /body\.joystick-right \.social-cluster \{\s*left: auto;\s*right: max\(28px, env\(safe-area-inset-right\)\);/);
  assert.match(css, /body\.joystick-right #joystick \{ left: auto; right: max\(24px, env\(safe-area-inset-right\)\); \}/);
  assert.match(css, /#joystick \{[^}]*width: 116px; height: 116px;/, "the one joystick size is the former normal size");
});
