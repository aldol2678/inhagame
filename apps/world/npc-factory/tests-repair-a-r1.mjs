import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PERIODS} from './vocabulary.mjs';
import {validateBatch} from './validate.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const load = name => fs.readFileSync(path.join(root, 'data', name));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceBytes=load('validated/INKYUNG-20-A.json');
const repairedBytes=load('repaired/INKYUNG-20-A-R1.json');
const source = JSON.parse(sourceBytes), repaired = JSON.parse(repairedBytes);
assert.equal(validateBatch(repaired).status, 'PASS');
assert.equal(repaired.npcs.length, 20);
const changeLog=source.npcs.flatMap((before,i)=>PERIODS.flatMap(period=>[0,1].filter(index=>before.dialogue_hooks[period][index]!==repaired.npcs[i].dialogue_hooks[period][index]).map(index=>({path:`npcs/${before.npc_id}/dialogue_hooks/${period}/${index}`,before:before.dialogue_hooks[period][index],after:repaired.npcs[i].dialogue_hooks[period][index]}))));
assert.equal(changeLog.length, 160);

const expectedPaths = new Set();
for (let i = 0; i < source.npcs.length; i++) {
  const before = source.npcs[i], after = repaired.npcs[i];
  const beforeOther = structuredClone(before), afterOther = structuredClone(after);
  delete beforeOther.dialogue_hooks; delete afterOther.dialogue_hooks;
  assert.deepEqual(afterOther, beforeOther, `${before.npc_id} non-dialogue change`);
  for (const period of PERIODS) for (let hook = 0; hook < 2; hook++) {
    assert.notEqual(after.dialogue_hooks[period][hook], before.dialogue_hooks[period][hook]);
    expectedPaths.add(`npcs/${before.npc_id}/dialogue_hooks/${period}/${hook}`);
  }
}
assert.deepEqual(new Set(changeLog.map(entry => entry.path)), expectedPaths);
for (const entry of changeLog) {
  const [, id, , period, index] = entry.path.split('/');
  assert.equal(entry.before, source.npcs.find(n => n.npc_id === id).dialogue_hooks[period][Number(index)]);
  assert.equal(entry.after, repaired.npcs.find(n => n.npc_id === id).dialogue_hooks[period][Number(index)]);
}
const hooks = batch => batch.npcs.flatMap(n => PERIODS.flatMap(p => n.dialogue_hooks[p]));
const repairedHooks = hooks(repaired);
assert.equal(new Set(repairedHooks).size, 160);
const otherHooks = new Set(['B', 'C'].flatMap(letter => hooks(JSON.parse(load(`validated/INKYUNG-20-${letter}.json`)))));
assert.equal(repairedHooks.filter(hook => otherHooks.has(hook)).length, 0);
console.log('Public repaired fixture: 160 dialogue-only changes, validator PASS, unique hooks and no B/C duplicates PASS');
