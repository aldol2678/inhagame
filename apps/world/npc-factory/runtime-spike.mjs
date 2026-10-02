import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PERIODS} from './vocabulary.mjs';
import {validateBatch} from './validate.mjs';

// Development-only data import rehearsal. It does not attach to WorldManager or render a character.
const root = path.dirname(fileURLToPath(import.meta.url));
const batch = JSON.parse(fs.readFileSync(path.join(root, 'data/validated/INKYUNG-20-A.json'), 'utf8'));
assert.equal(validateBatch(batch).status, 'PASS');
const minuteMarks = [0, 2.5, 5, 7.5];
for (let i = 0; i < PERIODS.length; i++) {
  const period = PERIODS[i];
  const actors = batch.npcs.map(npc => ({id: npc.npc_id, location: npc.schedule[period].location, activity: npc.schedule[period].activity, dialogue: npc.dialogue_hooks[period][0]}));
  const local = actors.filter(actor => actor.location !== 'off_zone');
  const counts = new Map(); for (const actor of local) counts.set(actor.location, (counts.get(actor.location) ?? 0) + 1);
  assert.ok([...counts.values()].every(count => count <= 6));
  assert.ok(actors.every(actor => actor.dialogue && actor.activity && actor.location));
  console.log(`${minuteMarks[i]}m ${period}: ${local.length} local, ${actors.length - local.length} off_zone, largest location ${Math.max(...counts.values())}, sample ${actors[0].id}/${actors[0].activity}`);
}
console.log('Import/time-state/location/activity/dialogue data rehearsal: PASS; rendered spawn, walk/sit animation and player-observed World Alive: NOT RUN');
