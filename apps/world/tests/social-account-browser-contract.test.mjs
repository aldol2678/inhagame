import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("social browser lane is PR-only, read-only and uses pinned existing QA dependencies", () => {
  const url = new URL("../../../.github/workflows/social-account-browser.yml", import.meta.url);
  assert.equal(existsSync(url), true, "dedicated browser lane is present");
  const workflow = readFileSync(url, "utf8");
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(workflow, /node apps\/world\/tests\/browser\/social-account-smoke\.mjs/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.doesNotMatch(workflow, /pull_request_target|secrets\.|write-all|contents: write|id-token:|environment:/);
});

test("browser fixture covers all three approved paths and emits count-only evidence", () => {
  const scenario = read("./browser/social-account-scenario.js");
  assert.match(scenario, /createChatPanel/);
  assert.match(scenario, /createLobbyPresenceSummary/);
  assert.match(scenario, /createSocialAccountSession/);
  assert.match(scenario, /chatAssertions/);
  assert.match(scenario, /presenceAssertions/);
  const runner = read("./browser/social-account-smoke.mjs");
  assert.match(runner, /WORLD_SMOKE_BROWSER/);
  assert.match(runner, /WORLD_SOCIAL_QA_OUTPUT/);
  assert.match(runner, /page\.screenshot/);
  assert.match(runner, /route\.abort\(/);
  assert.match(runner, /assert\.deepEqual\(external, \[\]\)/);
});
