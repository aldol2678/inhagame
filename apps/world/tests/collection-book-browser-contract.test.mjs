import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
test('Collection browser workflow is exact-head read-only hosted QA with bounded artifacts',()=>{
  const file=new URL('../../../.github/workflows/collection-book-browser.yml',import.meta.url);
  assert.ok(existsSync(file),'narrow Collection browser workflow must exist');
  const workflow=readFileSync(file,'utf8');
  assert.match(workflow,/permissions:\n  contents: read/);
  assert.match(workflow,/ref: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/EXPECTED_COLLECTION_BOOK_HEAD: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(workflow,/timeout-minutes: 12/);
  assert.match(workflow,/retention-days: 14/);
  assert.doesNotMatch(workflow,/secrets\.|pull_request_target|contents: write|deploy|supabase db push/);
});
test('Collection smoke validates immutable source and screenshot hashes with offline network boundaries',()=>{
  const source=read('./browser/collection-book-smoke.mjs');
  assert.match(source,/EXPECTED_COLLECTION_BOOK_HEAD/);
  assert.match(source,/assert.equal\(head, expectedHead/);
  assert.match(source,/sourceHashes/);assert.match(source,/servedSourceHashes/);
  assert.match(source,/assert.deepEqual\(servedSourceHashes, report.sourceHashes\)/);
  assert.match(source,/createHash\('sha256'\)/);assert.match(source,/screenshots.push/);
  assert.match(source,/route.abort/);assert.match(source,/pathname.startsWith\('\/api\/'\)/);
  assert.match(source,/switchAccount/);assert.match(source,/signOut/);
});
test('account-switch browser proof checks hidden client state after old response settles',()=>{
  const source=read('./browser/collection-book-smoke.mjs');
  assert.match(source,/assert.deepEqual\(caseReport.accountIsolation/);
  assert.match(source,/state: 'IDLE', snapshot: null/);
});
test('browser requests are GET-only and limited to the fixture static asset allowlist',()=>{
  const source=read('./browser/collection-book-smoke.mjs');
  assert.match(source,/route.request\(\).method\(\) === 'GET'/);
  assert.match(source,/staticPaths.has\(url.pathname\)/);
});
