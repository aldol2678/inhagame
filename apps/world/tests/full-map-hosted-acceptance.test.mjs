import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("hosted Full Map acceptance binds both browser lanes to the exact PR head", () => {
  const workflow = read("../../../.github/workflows/full-map-readability-browser.yml");
  assert.match(workflow, /ref: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /EXPECTED_MAP_HEAD: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(workflow, /node apps\/world\/tests\/browser\/full-map-navigation-smoke.mjs/);
  assert.match(workflow, /node apps\/world\/tests\/browser\/full-map-readability-smoke.mjs/);
  for (const file of ["full-map-navigation-smoke.mjs", "full-map-readability-smoke.mjs"]) {
    const source = read(`./browser/${file}`);
    assert.match(source, /EXPECTED_MAP_HEAD/);
    assert.match(source, /assert.equal\(head, expectedHead/);
    assert.match(source, /sourceHashes/);
    assert.match(source, /createHash\("sha256"\)/);
  }
});
