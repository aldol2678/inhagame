// Separate, inspectable local roster. It does not amend the frozen A-R1 batch.
const hairStyles = new Set(['long', 'bob', 'ponytail', 'bun', 'short', 'sidepart', 'curly', 'medium']);
const outfitStyles = new Set(['cardigan', 'jacket', 'shirt', 'coat', 'hoodie', 'sweater']);
const accessories = new Set(['sketchbook', 'glasses', 'apron', 'badge', 'backpack', 'headphones', 'book', 'messenger', 'scarf']);
const hexColor = /^#[0-9a-f]{6}$/i;

export function validateDevRoster(batch, roster, candidateHash) {
  if (roster?.roster_id !== 'INKYUNG-20-A-R1-LOCAL-ROSTER' || roster.status !== 'LOCAL_CANDIDATE' ||
      roster.source_candidate_sha256 !== candidateHash || roster.npcs?.length !== 20) {
    throw new Error('Local roster identity/source mismatch');
  }
  const sourceById = new Map(batch.npcs.map(npc => [npc.npc_id, npc]));
  const seenIds = new Set(), studentNumbers = new Set(), signatures = new Set();
  const counts = { male: 0, female: 0 };
  for (const entry of roster.npcs) {
    const source = sourceById.get(entry.npc_id);
    if (!source || seenIds.has(entry.npc_id)) throw new Error(`Unknown/duplicate roster NPC: ${entry.npc_id}`);
    seenIds.add(entry.npc_id);
    if (!Object.hasOwn(counts, entry.gender) || entry.department_type !== source.identity.department_type) {
      throw new Error(`Roster identity mismatch: ${entry.npc_id}`);
    }
    counts[entry.gender]++;
    const student = source.archetype === 'student' || source.archetype === 'club_member';
    const academic = student || source.archetype === 'teaching_assistant' || source.archetype === 'faculty';
    const validResidence = student
      ? ['commuter', 'dorm_1', 'dorm_2'].includes(entry.residence)
      : entry.residence === null;
    if (!validResidence) throw new Error(`Invalid residence: ${entry.npc_id}`);
    if (student) {
      const entryYear = 2027 - source.identity.year_level;
      if (entry.student_number !== `SIM-${entryYear}-${entry.npc_id.slice(-3)}` ||
          studentNumbers.has(entry.student_number)) throw new Error(`Invalid simulated student number: ${entry.npc_id}`);
      studentNumbers.add(entry.student_number);
    } else if (entry.student_number !== null) {
      throw new Error(`Non-student has student number: ${entry.npc_id}`);
    }
    if (academic ? typeof entry.department !== 'string' || !entry.department.endsWith('학과') :
      entry.department !== null || !entry.affiliation) throw new Error(`Invalid department/affiliation: ${entry.npc_id}`);
    const visual = entry.visual;
    if (!visual || !hairStyles.has(visual.hair_style) || !outfitStyles.has(visual.outfit_style) ||
        !accessories.has(visual.accessory) || ![0, 1, 2, 3].includes(visual.skin_tone) ||
        !Number.isFinite(visual.height) || visual.height < .9 || visual.height > 1.1 ||
        ![visual.hair_color, visual.outfit_color, visual.accent_color].every(color => hexColor.test(color))) {
      throw new Error(`Invalid visual profile: ${entry.npc_id}`);
    }
    const signature = `${visual.hair_style}|${visual.outfit_color}|${visual.accessory}`;
    if (signatures.has(signature)) throw new Error(`Duplicate visual profile: ${entry.npc_id}`);
    signatures.add(signature);
  }
  if (seenIds.size !== batch.npcs.length || counts.male !== 10 || counts.female !== 10 || studentNumbers.size !== 13) {
    throw new Error('Local roster coverage/count mismatch');
  }
  return roster;
}

export function appearanceFor(entry) {
  return {
    ...entry.visual,
    presentation: entry.gender,
    label: entry.gender === 'female' ? '여성' : '남성'
  };
}
