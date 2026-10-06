import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const IMAGE_CMD = Object.freeze(['node', 'npc-factory/npc-ai-cloud-run.mjs']);
export const PACKAGE_DIRECTORIES = Object.freeze(['npc-factory', 'src', 'data', 'server']);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function packagedSourceHashes(root) {
  const result = {};
  const visit = relative => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else {
        assert.ok(entry.isFile(), 'packaged sources must be regular files');
        result[path] = sha256(readFileSync(join(root, path)));
      }
    }
  };
  for (const directory of PACKAGE_DIRECTORIES) visit(directory);
  return result;
}

export function verifyRuntimeReport(report, expected) {
  assert.equal(report.status, 'passed');
  assert.equal(report.head, expected.head, 'container evidence must match the exact checkout HEAD');
  assert.match(report.node, /^v22\./, 'the packaged runtime must be Node 22');
  assert.match(report.childRuntime.node, /^v22\./, 'the production child must be Node 22');
  assert.deepEqual(report.sourceHashes, expected.sourceHashes, 'image sources must match checkout bytes');
  assert.deepEqual(report.cmd, IMAGE_CMD);
  assert.equal(report.audit.denied ?? 0, 0, 'unexpected fetches must fail the run');
  assert.equal(report.checks.length, 16);
}
