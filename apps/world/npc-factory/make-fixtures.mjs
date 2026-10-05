import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const good = JSON.parse(fs.readFileSync(path.join(root, 'data/raw/INKYUNG-20-A.json'), 'utf8'));
const mutations = {
  unknown_location: b => { b.npcs[0].schedule.morning.location = 'invented_rooftop'; },
  unknown_activity: b => { b.npcs[0].schedule.morning.activity = 'fly'; },
  missing_target: b => { b.npcs[0].relationships.push({target_id: 'INKYUNG-NPC-999', type: 'acquaintance'}); },
  self_relationship: b => { b.npcs[0].relationships.push({target_id: b.npcs[0].npc_id, type: 'friend'}); },
  twenty_one_npcs: b => { const extra = structuredClone(b.npcs[0]); extra.npc_id = 'INKYUNG-NPC-021'; b.npcs.push(extra); b.npc_count = 21; },
  archetype_distribution: b => { b.npcs.find(n => n.archetype === 'student').archetype = 'staff'; },
  missing_evening: b => { delete b.npcs[0].schedule.evening; },
  crowd_seven: b => { for (const n of b.npcs.slice(0, 7)) { n.schedule.morning.location = 'inkyung_walkway'; n.schedule.morning.activity = 'walk'; n.dialogue_hooks.morning[0] = '아침 산책로를 천천히 걸어요.'; } },
  world_change: b => { b.npcs[0].constraints.can_change_world_state = true; },
  quest_capability: b => { b.npcs[0].constraints.can_start_quest = true; },
  duplicate_id: b => { b.npcs[1].npc_id = b.npcs[0].npc_id; },
  bad_version: b => { b.schema_version = '0.2'; },
  forbidden_dialogue: b => { b.npcs[0].dialogue_hooks.morning[0] = '퀘스트를 줄게요.'; },
  unknown_tag: b => { b.npcs[0].behavior_tags.push('teleporting'); }
};
const dir = path.join(root, 'data/fixtures/invalid'); fs.mkdirSync(dir, {recursive: true});
for (const [name, mutate] of Object.entries(mutations)) {
  const batch = structuredClone(good); mutate(batch);
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(batch) + '\n', {flag: 'wx'});
}
console.log(`${Object.keys(mutations).length} immutable invalid fixtures written`);
