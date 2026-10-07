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

/** Runs the campus page's inline joystick bootstrap against v1/v2 storage. */
function campusClasses({ legacy = null, device = null } = {}) {
  const script = campus.match(/<script>\s*(try \{[\s\S]*?inhagame-device-settings-v2[\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "campus inline joystick script");
  const classes = new Set();
  const context = {
    localStorage: { getItem: (key) => ({
      "inhagame-campus-settings-v1": legacy,
      "inhagame-device-settings-v2": device
    })[key] ?? null },
    document: { body: { classList: { add: (name) => classes.add(name) } } }
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

test("4-6. hub.js writes registry v2 and keeps the legacy joystick mirror", () => {
  assert.doesNotMatch(hub, /sizeInput|joystick-size|saved\.size\)/);
  assert.match(hub, /const storageKey = "inhagame-campus-settings-v1";/);
  assert.match(hub, /const deviceSettingsKey = "inhagame-device-settings-v2";/);
  assert.match(hub, /controls: \{ \.\.\.controls, joystickSide: side \}/);
  assert.match(hub, /delete saved\.size;\s*localStorage\.setItem\(storageKey, JSON\.stringify\(\{ \.\.\.saved, side \}\)\);/);
  assert.match(hub, /sideInput\.addEventListener\("change", save\);/);
});

test("7-11. campus supports registry v2, legacy rollback and the fixed joystick size", () => {
  assert.doesNotMatch(campus, /joystick-large|config\.size/);
  assert.deepEqual(campusClasses({ legacy: JSON.stringify({ size: "large", side: "right" }) }), ["joystick-right"]);
  assert.deepEqual(campusClasses({ legacy: JSON.stringify({ side: "left" }) }), []);
  assert.deepEqual(campusClasses({ device: JSON.stringify({ schemaVersion: 2, controls: { joystickSide: "right" } }) }), ["joystick-right"]);
  assert.deepEqual(campusClasses({
    legacy: JSON.stringify({ side: "right" }),
    device: JSON.stringify({ schemaVersion: 2, controls: { joystickSide: "left" } })
  }), ["joystick-right"], "legacy rollback changes win during the compatibility window");
  assert.deepEqual(campusClasses(), []);
  assert.deepEqual(campusClasses({ legacy: "{not json" }), [], "broken storage falls back to the default controls");
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
