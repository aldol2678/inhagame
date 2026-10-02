import { npcSocialPairKey } from './npc-social-sim.mjs';

const VERSION = 1;
const MAX_BOND = 40;
const MAX_MEETINGS = 9999;
const round = value => Math.round(value * 1000) / 1000;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const npcSocialGraphKey = (hash, populationId = 'INKYUNG-48-P2A') =>
  `inha-npc-social-p2b-v1:${populationId}:${hash}`;

function storageRecordValid(record) {
  return record && typeof record === 'object' &&
    Number.isFinite(record.bond) && record.bond >= 0 && record.bond <= MAX_BOND &&
    Number.isInteger(record.meetingCount) && record.meetingCount >= 0 && record.meetingCount <= MAX_MEETINGS &&
    (record.lastMeetingTick === null || Number.isInteger(record.lastMeetingTick) && record.lastMeetingTick >= 0) &&
    (record.lastGroupId === null || typeof record.lastGroupId === 'string') &&
    (record.lastOutcome === null || typeof record.lastOutcome === 'string');
}

export function createPersistentNpcSocialGraph(batch, roster, hash, storage) {
  if (!batch?.batch_id || !Array.isArray(batch.npcs) || !roster?.npcs || !hash)
    throw new Error('NPC social graph requires population, roster and candidate hash');
  const npcById = new Map(batch.npcs.map(npc => [npc.npc_id, npc]));
  const rosterById = new Map(roster.npcs.map(entry => [entry.npc_id, entry]));
  const populationId = batch.batch_id;
  const key = npcSocialGraphKey(hash, populationId);
  let records = {};
  let persistent = Boolean(storage);

  try {
    const saved = JSON.parse(storage?.getItem(key) ?? 'null');
    if (saved?.version === VERSION && saved.populationId === populationId &&
        saved.records && typeof saved.records === 'object' && !Array.isArray(saved.records)) {
      for (const [pair, value] of Object.entries(saved.records)) {
        const [a, b, ...rest] = pair.split('|');
        if (rest.length || !npcById.has(a) || !npcById.has(b) || a === b || pair !== npcSocialPairKey(a, b) ||
            !storageRecordValid(value)) continue;
        records[pair] = {
          bond: round(value.bond),
          meetingCount: value.meetingCount,
          lastMeetingTick: value.lastMeetingTick,
          lastGroupId: value.lastGroupId,
          lastOutcome: value.lastOutcome
        };
      }
    }
  } catch {
    persistent = false;
  }

  function save() {
    if (!storage) { persistent = false; return false; }
    try {
      storage.setItem(key, JSON.stringify({ version: VERSION, populationId, records }));
      persistent = true;
      return true;
    } catch {
      persistent = false;
      return false;
    }
  }

  function structuralContext(a, b) {
    if (!npcById.has(a) || !npcById.has(b) || a === b) throw new Error('Unknown NPC social graph pair');
    const leftNpc = npcById.get(a);
    const rightNpc = npcById.get(b);
    const leftRoster = rosterById.get(a) ?? {};
    const rightRoster = rosterById.get(b) ?? {};
    const reasons = [];
    let score = 0;

    if (leftRoster.department && leftRoster.department === rightRoster.department) {
      score += 4;
      reasons.push('SAME_DEPARTMENT');
    }
    if (leftRoster.residence && leftRoster.residence !== 'commuter' &&
        leftRoster.residence === rightRoster.residence) {
      score += 3;
      reasons.push('SAME_RESIDENCE');
    }
    const rightInterests = new Set(rightNpc.interests ?? []);
    const sharedInterestCount = (leftNpc.interests ?? []).filter(value => rightInterests.has(value)).length;
    if (sharedInterestCount) {
      score += Math.min(3.75, sharedInterestCount * 1.25);
      reasons.push('SHARED_INTEREST');
    }
    if (leftNpc.identity?.year_level && leftNpc.identity.year_level === rightNpc.identity?.year_level) {
      score += 0.75;
      reasons.push('SAME_YEAR');
    }
    return { score: round(score), reasons, sharedInterestCount };
  }

  function recordFor(a, b) {
    const pair = npcSocialPairKey(a, b);
    return records[pair] ?? {
      bond: 0,
      meetingCount: 0,
      lastMeetingTick: null,
      lastGroupId: null,
      lastOutcome: null
    };
  }

  function describePair(a, b) {
    const structural = structuralContext(a, b);
    const record = recordFor(a, b);
    return {
      npcA: a,
      npcB: b,
      structuralAffinity: structural.score,
      persistentBond: record.bond,
      seedAffinity: round(clamp(structural.score + record.bond, 0, 100)),
      reasons: [...structural.reasons],
      sharedInterestCount: structural.sharedInterestCount,
      meetingCount: record.meetingCount,
      lastMeetingTick: record.lastMeetingTick,
      lastGroupId: record.lastGroupId,
      lastOutcome: record.lastOutcome
    };
  }

  function seedAffinity(a, b) {
    return describePair(a, b).seedAffinity;
  }

  function recordMeeting(groupId, memberNpcIds, outcome = 'COMPLETED', tick = 0) {
    if (typeof groupId !== 'string' || !groupId || typeof outcome !== 'string' || !outcome ||
        !Number.isInteger(tick) || tick < 0) throw new Error('Invalid NPC social graph meeting');
    const members = [...new Set(memberNpcIds ?? [])].filter(id => npcById.has(id)).sort();
    if (outcome !== 'COMPLETED' || members.length < 2) return false;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const pair = npcSocialPairKey(members[i], members[j]);
        const before = recordFor(members[i], members[j]);
        records[pair] = {
          bond: round(clamp(before.bond + 2, 0, MAX_BOND)),
          meetingCount: Math.min(MAX_MEETINGS, before.meetingCount + 1),
          lastMeetingTick: tick,
          lastGroupId: groupId,
          lastOutcome: outcome
        };
      }
    }
    save();
    return true;
  }

  function tiesFor(id, limit = 6) {
    if (!npcById.has(id)) throw new Error('Unknown NPC social graph profile');
    if (!Number.isInteger(limit) || limit < 0) throw new Error('NPC social graph tie limit must be non-negative');
    return [...npcById.keys()]
      .filter(otherId => otherId !== id)
      .map(otherId => {
        const detail = describePair(id, otherId);
        return {
          otherNpcId: otherId,
          ...detail
        };
      })
      .filter(row => row.seedAffinity > 0 || row.meetingCount > 0)
      .sort((a, b) => b.seedAffinity - a.seedAffinity ||
        b.meetingCount - a.meetingCount ||
        a.otherNpcId.localeCompare(b.otherNpcId))
      .slice(0, limit);
  }

  function clear() {
    if (storage) {
      try { storage.removeItem(key); }
      catch { return false; }
    }
    records = {};
    return true;
  }

  function status() {
    const rows = Object.values(records);
    return {
      version: VERSION,
      populationId,
      persistent,
      storedPairs: rows.length,
      totalBond: round(rows.reduce((sum, row) => sum + row.bond, 0)),
      completedMeetings: rows.reduce((sum, row) => sum + row.meetingCount, 0)
    };
  }

  return { seedAffinity, describePair, tiesFor, recordMeeting, clear, status, get persistent() { return persistent; } };
}
