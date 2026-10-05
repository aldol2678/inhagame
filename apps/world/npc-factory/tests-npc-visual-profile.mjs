import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCampusExpansion } from './npc-campus-expansion.mjs';
import { resolveNpcAppearance, visualProfileFor } from './npc-appearance-resolver.mjs';
import { validateNpcVisualProfile } from './npc-visual-profile.mjs';

const baseBatch = JSON.parse(readFileSync(new URL('./data/repaired/INKYUNG-20-A-R1.json', import.meta.url), 'utf8'));
const baseRoster = JSON.parse(readFileSync(new URL('./data/fixtures/public-roster.json', import.meta.url), 'utf8'));
const expansionManifest = JSON.parse(readFileSync(new URL('./data/expansion/CAMPUS-28-P2A.json', import.meta.url), 'utf8'));
const expansion = buildCampusExpansion(expansionManifest);

const npcById = new Map([...baseBatch.npcs, ...expansion.batch.npcs].map(npc => [npc.npc_id, npc]));
const roster = [...baseRoster.npcs, ...expansion.roster.npcs];
assert.equal(roster.length, 48, 'visual factory covers the current 48-person campus population');

const signatures = new Set();
const styles = new Set();
const outfits = new Set();
const accessories = new Set();
const motionStyles = new Set();
for (const entry of roster) {
  const original = JSON.stringify(entry);
  const npc = npcById.get(entry.npc_id);
  const appearance = resolveNpcAppearance(entry, npc);
  const profile = validateNpcVisualProfile(appearance.profile);
  assert.equal(profile.schema_version, 1);
  assert.equal(profile.tier, 'resident');
  assert.equal(appearance.presentation, entry.gender);
  assert.equal(JSON.stringify(entry), original, `${entry.npc_id}: resolver mutated roster input`);
  assert.ok(appearance.height >= .94 && appearance.height <= 1.06);
  assert.match(appearance.hair_color, /^#[0-9a-f]{6}$/i);
  assert.match(appearance.outfit_color, /^#[0-9a-f]{6}$/i);
  assert.match(appearance.accent_color, /^#[0-9a-f]{6}$/i);
  signatures.add([appearance.hair_style, appearance.outfit_style, appearance.accessory, appearance.outfit_color].join('|'));
  styles.add(appearance.hair_style);
  outfits.add(appearance.outfit_style);
  accessories.add(appearance.accessory);
  motionStyles.add(profile.motion.style);
  assert.deepEqual(visualProfileFor(entry, npc), visualProfileFor(entry, npc), `${entry.npc_id}: resolver is not deterministic`);
}
assert.equal(signatures.size, 48, 'all 48 resident NPCs keep a distinct primary visual signature');
assert.ok(styles.size >= 7, 'campus population uses broad hair variation');
assert.ok(outfits.size >= 6, 'campus population uses the full outfit family');
assert.ok(accessories.size >= 8, 'campus population uses broad accessory variation');
assert.ok(motionStyles.size >= 3, 'NPC personality produces multiple motion presentations');

const baseAppearances = baseRoster.npcs.map(entry => resolveNpcAppearance(entry, npcById.get(entry.npc_id)));
assert.ok(new Set(baseAppearances.map(item => item.outfit_style)).size > 1,
  'legacy base 20 are no longer presented as one shirt-heavy block');
assert.ok(new Set(baseAppearances.map(item => item.height)).size > 1,
  'legacy base 20 receive silhouette height variation');

console.log('NPC Visual Factory P0-A/B/C: 48 deterministic resident profiles, compatibility fields and variation contracts PASS');
