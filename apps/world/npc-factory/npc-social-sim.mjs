import { NPC_SOCIAL_REGULAR_MEETING_POLICY, npcSocialRegularMeetingPlaceRef } from './npc-social-travel-policy.mjs';
const PERIODS = Object.freeze(['morning', 'class_time', 'lunch', 'evening']);

export const INTEREST_CLUSTER_BY_INTEREST = Object.freeze({
  music: 'CREATIVE',
  film: 'CREATIVE',
  photography: 'CREATIVE',
  sketching: 'CREATIVE',
  design: 'CREATIVE',
  coding: 'TECH',
  architecture: 'TECH',
  reading: 'LEARNING',
  languages: 'LEARNING',
  coffee: 'LIFESTYLE',
  cooking: 'LIFESTYLE',
  plants: 'LIFESTYLE',
  walking: 'EXPLORE',
  cycling: 'EXPLORE',
  birdwatching: 'EXPLORE'
});

const RELATION_SEED = Object.freeze({
  friend: 16,
  clubmate: 12,
  coworker: 10,
  acquaintance: 6
});

const RELATION_RANK = Object.freeze({
  friend: 4,
  clubmate: 3,
  coworker: 2,
  acquaintance: 1
});

const SOCIAL_MODE = Object.freeze({ low: 0.25, medium: 0.65, high: 1 });
const SOCIAL_ACTIVITIES = new Set(['talk_with_friend', 'sit', 'wait', 'walk', 'walk_to_club', 'take_photo', 'drink_coffee']);

const DEFAULTS = Object.freeze({
  groupLimit: 5,
  naturalGroupTarget: 3,
  recentEventLimit: 80,
  formationAffinity: 7,
  joinAffinity: 8,
  formingTicks: 3,
  minGroupSize: 3,
  maxGroupSize: 6,
  minTenureTicks: 20,
  memberLeaveParticipation: 12,
  groupDissolveActivity: 12,
  activeDissolveGraceTicks: 30,
  regroupCooldownTicks: 36,
  relationshipCandidatePool: 6,
  protectedLeaderIds: Object.freeze(['INKYUNG-NPC-001', 'INKYUNG-NPC-002'])
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = value => Math.round(value * 1000) / 1000;

export function npcSocialPairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function hash32(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h += h << 13;
  h ^= h >>> 7;
  h += h << 3;
  h ^= h >>> 17;
  h += h << 5;
  return h >>> 0;
}

function random01(seed, tick, period, key) {
  let x = hash32(`${seed}|${tick}|${period}|${key}`);
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 0x100000000;
}

function clustersFor(npc) {
  return [...new Set((npc.interests ?? []).map(interest => INTEREST_CLUSTER_BY_INTEREST[interest]).filter(Boolean))];
}

function sharedClusters(a, b) {
  const right = new Set(clustersFor(b));
  return clustersFor(a).filter(cluster => right.has(cluster));
}

function deriveInitiative(npc) {
  const p = npc.personality ?? {};
  let value = (p.social_energy ?? 0.5) * 0.5
    + (p.talkativeness ?? 0.5) * 0.3
    + (1 - (p.routine_preference ?? 0.5)) * 0.2;
  const traits = new Set(p.traits ?? []);
  if (traits.has('curious')) value += 0.05;
  if (traits.has('playful') || traits.has('cheerful')) value += 0.035;
  if (traits.has('cautious') || traits.has('reserved')) value -= 0.025;
  return clamp(value, 0, 1);
}

function relationSeed(batch, a, b) {
  let best = null;
  for (const npc of batch.npcs) {
    if (npc.npc_id !== a && npc.npc_id !== b) continue;
    const target = npc.npc_id === a ? b : a;
    for (const relation of npc.relationships ?? []) {
      if (relation.target_id !== target) continue;
      if (!best || (RELATION_RANK[relation.type] ?? 0) > (RELATION_RANK[best] ?? 0)) best = relation.type;
    }
  }
  return best;
}

function validateBatch(batch) {
  if (!batch || !Array.isArray(batch.npcs) || batch.npcs.length < 3) throw new Error('NPC social simulation requires at least 3 NPCs');
  const ids = new Set();
  for (const npc of batch.npcs) {
    if (!npc?.npc_id || ids.has(npc.npc_id)) throw new Error('NPC social simulation requires unique npc_id values');
    ids.add(npc.npc_id);
    if (!npc.schedule || !npc.personality || !Array.isArray(npc.interests)) throw new Error(`NPC social input incomplete: ${npc.npc_id}`);
  }
}

function defaultObservation(npc, period) {
  const slot = npc.schedule?.[period];
  return slot ? {
    location: slot.location,
    activity: slot.activity,
    socialMode: slot.social_mode
  } : { location: 'off_zone', activity: 'leave_zone', socialMode: 'low' };
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function groupPairRelations(group, relations) {
  const rows = [];
  for (let i = 0; i < group.memberNpcIds.length; i++) {
    for (let j = i + 1; j < group.memberNpcIds.length; j++) {
      const relation = relations.get(npcSocialPairKey(group.memberNpcIds[i], group.memberNpcIds[j]));
      if (relation) rows.push(relation);
    }
  }
  return rows;
}

export function createNpcSocialSimulation(batch, options = {}) {
  validateBatch(batch);
  const config = { ...DEFAULTS, ...options };
  const protectedLeaderIds = new Set(config.protectedLeaderIds ?? DEFAULTS.protectedLeaderIds);
  const npcById = new Map(batch.npcs.map(npc => [npc.npc_id, npc]));
  const clustersById = new Map(batch.npcs.map(npc => [npc.npc_id, clustersFor(npc)]));
  const clusterSetsById = new Map([...clustersById].map(([id, clusters]) => [id, new Set(clusters)]));
  const allClusters = [...new Set([...clustersById.values()].flat())].sort();
  const clusterMembers = new Map(allClusters.map(cluster => [
    cluster,
    batch.npcs.filter(npc => clustersById.get(npc.npc_id).includes(cluster))
  ]));
  const initiativeById = new Map(batch.npcs.map(npc => [npc.npc_id, deriveInitiative(npc)]));
  const relations = new Map();
  const activeRelationKeys = new Set();
  const groups = new Map();
  const events = [];
  const regroupCooldown = new Map();
  let tick = 0;
  let nextGroupNumber = 1;

  for (let i = 0; i < batch.npcs.length; i++) {
    for (let j = i + 1; j < batch.npcs.length; j++) {
      const a = batch.npcs[i].npc_id;
      const b = batch.npcs[j].npc_id;
      const seedRelation = relationSeed(batch, a, b);
      const key = npcSocialPairKey(a, b);
      const contextualSeed = Number(config.initialAffinityProvider?.({
        npcA: batch.npcs[i],
        npcB: batch.npcs[j],
        seedRelation
      }) ?? 0);
      if (!Number.isFinite(contextualSeed) || contextualSeed < 0)
        throw new Error('NPC social initial affinity must be a finite non-negative number');
      const authoredSeed = RELATION_SEED[seedRelation] ?? 0;
      const initialAffinity = round(clamp(authoredSeed + contextualSeed, 0, 100));
      relations.set(key, {
        npcA: a,
        npcB: b,
        affinity: initialAffinity,
        floorAffinity: round(Math.max(authoredSeed * 0.45, contextualSeed)),
        contextualSeed: round(contextualSeed),
        encounterCount: 0,
        sharedActivityCount: 0,
        lastInteractionTick: null,
        seedRelation
      });
      if (seedRelation || initialAffinity > 0) activeRelationKeys.add(key);
    }
  }

  const cooldownKey = (cluster, npcId) => `${cluster}|${npcId}`;
  const onRegroupCooldown = (cluster, npcId) => (regroupCooldown.get(cooldownKey(cluster, npcId)) ?? -1) > tick;
  const blockRegroup = (cluster, npcId) => regroupCooldown.set(cooldownKey(cluster, npcId), tick + config.regroupCooldownTicks);

  function relationshipPreference(aId, bId) {
    const value = Number(config.relationshipPreferenceProvider?.({
      npcA: npcById.get(aId),
      npcB: npcById.get(bId),
      tick
    }) ?? 0);
    if (!Number.isFinite(value) || value < 0) throw new Error('NPC relationship preference must be finite and non-negative');
    return value;
  }

  function validateGroupCandidate(memberNpcIds, primaryInterest, leaderNpcId) {
    if (!config.groupCandidateValidator) return { ok: true, meta: null };
    const result = config.groupCandidateValidator({
      memberNpcIds: [...memberNpcIds],
      primaryInterest,
      leaderNpcId,
      tick
    });
    if (result === true) return { ok: true, meta: null };
    if (result === false || result == null) return { ok: false, meta: null };
    if (typeof result !== 'object') throw new Error('NPC group candidate validator must return boolean or object');
    return { ok: result.ok !== false, meta: { ...result } };
  }

  function memberPairRows(memberNpcIds) {
    const rows = [];
    for (let i = 0; i < memberNpcIds.length; i++) {
      for (let j = i + 1; j < memberNpcIds.length; j++) {
        const row = relations.get(npcSocialPairKey(memberNpcIds[i], memberNpcIds[j]));
        if (row) rows.push(row);
      }
    }
    return rows;
  }

  function emit(type, payload = {}) {
    events.push({ tick, type, ...payload });
    if (events.length > config.recentEventLimit) events.splice(0, events.length - config.recentEventLimit);
  }

  function observation(npc, period) {
    const fallback = defaultObservation(npc, period);
    const provided = config.observationProvider?.({ npc, tick, period, defaultObservation: { ...fallback } });
    const value = provided && typeof provided === 'object' ? { ...fallback, ...provided } : fallback;
    return {
      location: value.location ?? 'off_zone',
      activity: value.activity ?? 'leave_zone',
      socialMode: value.socialMode ?? value.social_mode ?? 'low'
    };
  }

  function updateRelationships(period) {
    const observed = new Map(batch.npcs.map(npc => [npc.npc_id, observation(npc, period)]));

    // Exact sparse update: untouched non-seeded pairs that are not co-located would remain
    // affinity=0 in the exhaustive loop, so skip them. Seeded or previously positive ties keep
    // receiving decay, while every co-located pair is evaluated for a possible encounter.
    const candidateKeys = new Set(activeRelationKeys);
    const idsByLocation = new Map();
    for (const [id, state] of observed) {
      if (state.location === 'off_zone') continue;
      const ids = idsByLocation.get(state.location) ?? [];
      ids.push(id);
      idsByLocation.set(state.location, ids);
    }
    for (const ids of idsByLocation.values()) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) candidateKeys.add(npcSocialPairKey(ids[i], ids[j]));
      }
    }

    for (const key of candidateKeys) {
      const relation = relations.get(key);
      if (!relation) continue;
      const a = npcById.get(relation.npcA);
      const b = npcById.get(relation.npcB);
      const left = observed.get(relation.npcA);
      const right = observed.get(relation.npcB);
      const samePlace = left.location !== 'off_zone' && left.location === right.location;
      const socialAvailability = average([SOCIAL_MODE[left.socialMode] ?? 0.25, SOCIAL_MODE[right.socialMode] ?? 0.25]);
      const leftClusters = clusterSetsById.get(relation.npcA);
      const rightClusters = clusterSetsById.get(relation.npcB);
      let sharedClusterCount = 0;
      for (const cluster of leftClusters) if (rightClusters.has(cluster)) sharedClusterCount += 1;
      const socialEnergy = average([a.personality.social_energy ?? 0.5, b.personality.social_energy ?? 0.5]);
      const talkativeness = average([a.personality.talkativeness ?? 0.5, b.personality.talkativeness ?? 0.5]);
      const sameActivity = left.activity === right.activity;
      const socialActivity = SOCIAL_ACTIVITIES.has(left.activity) || SOCIAL_ACTIVITIES.has(right.activity);

      let met = false;
      if (samePlace) {
        let chance = 0.08 + socialEnergy * 0.34 + talkativeness * 0.14 + socialAvailability * 0.18;
        chance += Math.min(0.18, sharedClusterCount * 0.09);
        if (relation.seedRelation) chance += 0.08;
        if (sameActivity) chance += 0.05;
        if (socialActivity) chance += 0.05;
        chance = clamp(chance, 0.1, 0.94);
        met = random01(config.seed ?? 'ng0', tick, period, key) < chance;
      }

      if (met) {
        let delta = 0.75 + sharedClusterCount * 0.42 + socialEnergy * 0.25;
        if (sameActivity) delta += 0.2;
        if (socialActivity) delta += 0.15;
        if (relation.seedRelation) delta += 0.12;
        relation.affinity = clamp(relation.affinity + delta, 0, 100);
        relation.encounterCount += 1;
        if (sameActivity || socialActivity) relation.sharedActivityCount += 1;
        relation.lastInteractionTick = tick;
      } else {
        const age = relation.lastInteractionTick === null ? tick : tick - relation.lastInteractionTick;
        const decay = age > 8 ? 0.035 : 0.01;
        const floor = relation.floorAffinity ?? 0;
        relation.affinity = Math.max(floor, relation.affinity - decay);
      }
      relation.affinity = round(relation.affinity);
      if (relation.seedRelation || relation.affinity > 0) activeRelationKeys.add(key);
      else activeRelationKeys.delete(key);
    }
  }

  function membershipMap() {
    const map = new Map();
    for (const group of groups.values()) {
      if (group.status === 'DISSOLVED') continue;
      for (const id of group.memberNpcIds) map.set(id, group.groupId);
    }
    return map;
  }

  function refreshGroup(group) {
    const pairRows = groupPairRelations(group, relations);
    group.cohesion = round(average(pairRows.map(row => row.affinity)));
    group.activity = round(average(Object.values(group.memberState).map(member => member.participation)));
    group.updatedAtTick = tick;
  }

  function updateExistingGroups() {
    for (const group of groups.values()) {
      if (group.status === 'DISSOLVED') continue;

      for (const id of [...group.memberNpcIds]) {
        const member = group.memberState[id];
        if (!member) continue;
        const metGroupMember = group.memberNpcIds.some(otherId => {
          if (otherId === id) return false;
          return relations.get(npcSocialPairKey(id, otherId))?.lastInteractionTick === tick;
        });
        member.participation = clamp(member.participation + (metGroupMember ? 4 : -0.5), 0, 100);

        if (id !== group.leaderNpcId
            && tick - member.joinedAtTick >= config.minTenureTicks
            && member.participation < config.memberLeaveParticipation) {
          group.memberNpcIds = group.memberNpcIds.filter(memberId => memberId !== id);
          delete group.memberState[id];
          blockRegroup(group.primaryInterest, id);
          emit('MEMBER_LEFT', { groupId: group.groupId, npcId: id, reason: 'LOW_PARTICIPATION' });
        }
      }

      refreshGroup(group);
      const age = tick - group.createdAtTick;
      if (group.memberNpcIds.length < config.minGroupSize
          || (group.status === 'ACTIVE' && age >= config.activeDissolveGraceTicks && group.activity < config.groupDissolveActivity)) {
        group.status = 'DISSOLVED';
        for (const id of group.memberNpcIds) blockRegroup(group.primaryInterest, id);
        emit('GROUP_DISSOLVED', { groupId: group.groupId, reason: group.memberNpcIds.length < config.minGroupSize ? 'MEMBER_COUNT' : 'LOW_ACTIVITY' });
        continue;
      }

      if (group.status === 'FORMING' && age >= config.formingTicks && group.cohesion >= config.formationAffinity) {
        group.status = 'ACTIVE';
        emit('GROUP_ACTIVATED', { groupId: group.groupId });
      }
      const rememberedMeetingPlace = npcSocialRegularMeetingPlaceRef(group, tick);
      if (!group.meetingPlaceRef && rememberedMeetingPlace) {
        group.meetingPlaceRef = rememberedMeetingPlace;
        group.meetingCadenceTicks = NPC_SOCIAL_REGULAR_MEETING_POLICY.cadenceTicks;
        group.lastMeetingTick = null;
        group.lastMeetingOutcome = null;
        group.nextMeetingTick = tick + group.meetingCadenceTicks;
        emit('GROUP_MEETING_PLACE_SET', {
          groupId: group.groupId,
          meetingPlaceRef: rememberedMeetingPlace,
          meetingCadenceTicks: group.meetingCadenceTicks,
          nextMeetingTick: group.nextMeetingTick
        });
      }
    }
  }

  function tryJoinGroups() {
    const memberships = membershipMap();
    for (const group of groups.values()) {
      if (group.status === 'DISSOLVED' || group.memberNpcIds.length >= config.maxGroupSize) continue;
      const candidates = batch.npcs
        .filter(npc => !memberships.has(npc.npc_id) && clustersById.get(npc.npc_id).includes(group.primaryInterest) && !onRegroupCooldown(group.primaryInterest, npc.npc_id))
        .map(npc => {
          const rows = group.memberNpcIds.map(memberId => relations.get(npcSocialPairKey(npc.npc_id, memberId))).filter(Boolean);
          const ties = rows.filter(row => row.encounterCount >= 2).length;
          const affinity = average(rows.map(row => row.affinity));
          const preference = average(group.memberNpcIds.map(memberId =>
            relationshipPreference(npc.npc_id, memberId)));
          return { npc, affinity, preference, score: affinity + preference, ties };
        })
        .filter(item => item.ties >= 2 && item.affinity >= config.joinAffinity)
        .sort((a, b) => b.score - a.score || b.affinity - a.affinity || a.npc.npc_id.localeCompare(b.npc.npc_id));

      const selected = candidates.find(item =>
        validateGroupCandidate(
          [...group.memberNpcIds, item.npc.npc_id].sort(),
          group.primaryInterest,
          group.leaderNpcId
        ).ok);
      if (!selected) continue;
      group.memberNpcIds.push(selected.npc.npc_id);
      group.memberNpcIds.sort();
      group.memberState[selected.npc.npc_id] = { joinedAtTick: tick, participation: 55 };
      refreshGroup(group);
      memberships.set(selected.npc.npc_id, group.groupId);
      emit('MEMBER_JOINED', {
        groupId: group.groupId,
        npcId: selected.npc.npc_id,
        relationshipPreference: round(selected.preference)
      });
    }
  }

  function tryFormGroups() {
    const liveLimit = Math.min(config.groupLimit, config.naturalGroupTarget ?? config.groupLimit);
    if ([...groups.values()].filter(group => group.status !== 'DISSOLVED').length >= liveLimit) return;
    const memberships = membershipMap();

    for (const cluster of allClusters) {
      if ([...groups.values()].filter(group => group.status !== 'DISSOLVED').length >= liveLimit) break;
      const pool = clusterMembers.get(cluster)
        .filter(npc => !memberships.has(npc.npc_id) && !onRegroupCooldown(cluster, npc.npc_id));
      if (pool.length < config.minGroupSize) continue;

      const leaders = pool
        .filter(npc => !protectedLeaderIds.has(npc.npc_id))
        .map(npc => ({ npc, initiative: initiativeById.get(npc.npc_id) }))
        .sort((a, b) => b.initiative - a.initiative || a.npc.npc_id.localeCompare(b.npc.npc_id));

      for (const leaderRow of leaders) {
        const leader = leaderRow.npc;
        const neighbors = pool
          .filter(npc => npc.npc_id !== leader.npc_id)
          .map(npc => {
            const relation = relations.get(npcSocialPairKey(leader.npc_id, npc.npc_id));
            const preference = relationshipPreference(leader.npc_id, npc.npc_id);
            return {
              npc,
              relation,
              preference,
              score: (relation?.affinity ?? 0) + preference
            };
          })
          .filter(item => item.relation?.encounterCount >= 2 && item.relation.affinity >= config.formationAffinity)
          .sort((a, b) => b.score - a.score ||
            b.relation.affinity - a.relation.affinity ||
            a.npc.npc_id.localeCompare(b.npc.npc_id));

        if (neighbors.length < config.minGroupSize - 1) continue;

        let members = null;
        let routeMeta = null;
        if (!config.groupCandidateValidator) {
          members = [leader.npc_id, ...neighbors.slice(0, config.maxGroupSize - 1).map(item => item.npc.npc_id)].sort();
        } else {
          const candidatePoolSize = Math.max(config.minGroupSize - 1,
            Math.min(neighbors.length, config.relationshipCandidatePool));
          const candidates = neighbors.slice(0, candidatePoolSize);
          // Neighbors are already sorted by relationship score. Stop at the first
          // route-valid pair instead of exhaustively route-planning every combination.
          // This preserves relationship priority while bounding A* work on the live clock.
          let routeSeed = null;
          seedSearch:
          for (let a = 0; a < candidates.length - 1; a++) {
            for (let b = a + 1; b < candidates.length; b++) {
              const seedMembers = [leader.npc_id, candidates[a].npc.npc_id, candidates[b].npc.npc_id].sort();
              const rows = memberPairRows(seedMembers);
              if (average(rows.map(row => row.affinity)) < config.formationAffinity) continue;
              const validated = validateGroupCandidate(seedMembers, cluster, leader.npc_id);
              if (!validated.ok) continue;
              routeSeed = { members: seedMembers, meta: validated.meta };
              break seedSearch;
            }
          }
          if (!routeSeed) continue;
          members = [...routeSeed.members];
          routeMeta = routeSeed.meta;
          for (const item of neighbors) {
            if (members.length >= config.maxGroupSize || members.includes(item.npc.npc_id)) continue;
            const proposal = [...members, item.npc.npc_id].sort();
            const rows = memberPairRows(proposal);
            if (average(rows.map(row => row.affinity)) < config.formationAffinity) continue;
            const validated = validateGroupCandidate(proposal, cluster, leader.npc_id);
            if (!validated.ok) continue;
            members = proposal;
            routeMeta = validated.meta;
          }
        }

        if (!members) continue;
        const connectedRows = memberPairRows(members);
        if (average(connectedRows.map(row => row.affinity)) < config.formationAffinity) continue;

        const groupId = `npc-group-${String(nextGroupNumber++).padStart(3, '0')}`;
        const group = {
          groupId,
          status: 'FORMING',
          primaryInterest: cluster,
          leaderNpcId: leader.npc_id,
          memberNpcIds: members,
          memberState: Object.fromEntries(members.map(id => [id, { joinedAtTick: tick, participation: 60 }])),
          cohesion: round(average(connectedRows.map(row => row.affinity))),
          activity: 60,
          meetingPlaceRef: null,
          meetingCadenceTicks: null,
          lastMeetingTick: null,
          lastMeetingOutcome: null,
          lastMeetingAttendance: null,
          nextMeetingTick: null,
          createdAtTick: tick,
          updatedAtTick: tick
        };
        groups.set(groupId, group);
        for (const id of members) memberships.set(id, groupId);
        emit('GROUP_CREATED', {
          groupId,
          primaryInterest: cluster,
          leaderNpcId: leader.npc_id,
          memberNpcIds: [...members],
          relationshipRouted: Boolean(config.groupCandidateValidator),
          routeMeetingLocation: routeMeta?.meetingLocation ?? null
        });
        break;
      }
    }
  }

  function advanceOne() {
    const period = PERIODS[tick % PERIODS.length];
    updateRelationships(period);
    updateExistingGroups();
    tryJoinGroups();
    tryFormGroups();
    tick += 1;
  }

  function step({ snapshot: takeSnapshot = true } = {}) {
    advanceOne();
    return takeSnapshot ? snapshot() : null;
  }

  function run(count, { snapshot: takeSnapshot = true } = {}) {
    if (!Number.isInteger(count) || count < 0) throw new Error('NPC social run count must be a non-negative integer');
    for (let i = 0; i < count; i++) advanceOne();
    return takeSnapshot ? snapshot() : null;
  }

  function recordGroupMeetingOutcome(groupId, outcome = 'COMPLETED', attendance = null) {
    const group = groups.get(groupId);
    if (!group || group.status === 'DISSOLVED' || !group.meetingPlaceRef ||
        !Number.isInteger(group.meetingCadenceTicks) || group.meetingCadenceTicks <= 0) return false;
    if (typeof outcome !== 'string' || !outcome) throw new Error('NPC social meeting outcome required');
    if (attendance !== null && (typeof attendance !== 'object' || Array.isArray(attendance)))
      throw new Error('NPC social attendance payload must be an object');
    group.lastMeetingOutcome = outcome;
    group.lastMeetingAttendance = attendance ? {
      invitedNpcIds: [...(attendance.invitedNpcIds ?? [])],
      attendedNpcIds: [...(attendance.attendedNpcIds ?? [])],
      onTimeNpcIds: [...(attendance.onTimeNpcIds ?? [])],
      lateNpcIds: [...(attendance.lateNpcIds ?? [])],
      absentNpcIds: [...(attendance.absentNpcIds ?? [])]
    } : null;
    if (outcome === 'COMPLETED') {
      const attended = [...new Set(
        (group.lastMeetingAttendance?.attendedNpcIds?.length
          ? group.lastMeetingAttendance.attendedNpcIds
          : group.memberNpcIds)
          .filter(id => group.memberNpcIds.includes(id))
      )].sort();
      const gain = Number(config.meetingAffinityGain ?? 2);
      if (!Number.isFinite(gain) || gain < 0) throw new Error('NPC social meeting affinity gain must be non-negative');
      for (let i = 0; i < attended.length; i++) {
        for (let j = i + 1; j < attended.length; j++) {
          const key = npcSocialPairKey(attended[i], attended[j]);
          const relation = relations.get(key);
          if (!relation) continue;
          relation.affinity = round(clamp(relation.affinity + gain, 0, 100));
          relation.encounterCount += 1;
          relation.sharedActivityCount += 1;
          relation.lastInteractionTick = tick;
          activeRelationKeys.add(key);
        }
      }
      group.lastMeetingTick = tick;
    }
    group.nextMeetingTick = tick + group.meetingCadenceTicks;
    group.updatedAtTick = tick;
    emit(outcome === 'COMPLETED' ? 'GROUP_REGULAR_MEETING_COMPLETED' : 'GROUP_REGULAR_MEETING_MISSED', {
      groupId,
      meetingPlaceRef: group.meetingPlaceRef,
      outcome,
      attendance: group.lastMeetingAttendance,
      lastMeetingTick: group.lastMeetingTick,
      nextMeetingTick: group.nextMeetingTick
    });
    return true;
  }

  function relationsFor(npcId, limit = 3) {
    if (!npcById.has(npcId)) throw new Error('Unknown NPC relationship profile');
    if (!Number.isInteger(limit) || limit < 0) throw new Error('NPC relationship limit must be a non-negative integer');
    return [...relations.values()]
      .filter(row => row.npcA === npcId || row.npcB === npcId)
      .filter(row => row.affinity > 0 || row.encounterCount > 0 || row.seedRelation)
      .map(row => ({
        otherNpcId: row.npcA === npcId ? row.npcB : row.npcA,
        affinity: row.affinity,
        floorAffinity: row.floorAffinity ?? 0,
        contextualSeed: row.contextualSeed ?? 0,
        encounterCount: row.encounterCount,
        sharedActivityCount: row.sharedActivityCount,
        lastInteractionTick: row.lastInteractionTick,
        seedRelation: row.seedRelation
      }))
      .sort((a, b) => b.affinity - a.affinity ||
        b.encounterCount - a.encounterCount ||
        a.otherNpcId.localeCompare(b.otherNpcId))
      .slice(0, limit);
  }

  function groupSnapshot() {
    return [...groups.values()].sort((a, b) => a.groupId.localeCompare(b.groupId)).map(group => ({
      ...group,
      memberNpcIds: [...group.memberNpcIds],
      memberState: Object.fromEntries(Object.entries(group.memberState).sort(([a], [b]) => a.localeCompare(b)).map(([id, value]) => [id, { ...value }]))
    }));
  }

  function viewSnapshot() {
    return {
      version: 1,
      tick,
      seed: config.seed ?? 'ng0',
      groups: groupSnapshot(),
      recentEvents: events.map(event => ({ ...event }))
    };
  }

  function snapshot() {
    const relationObject = Object.fromEntries([...relations.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, { ...value }]));
    return {
      ...viewSnapshot(),
      relations: relationObject
    };
  }

  return { step, run, snapshot, viewSnapshot, recordGroupMeetingOutcome, relationsFor };
}

export function summarizeNpcSocialSnapshot(snapshot) {
  const liveGroups = snapshot.groups.filter(group => group.status !== 'DISSOLVED');
  const counts = {};
  for (const event of snapshot.recentEvents) counts[event.type] = (counts[event.type] ?? 0) + 1;
  return {
    tick: snapshot.tick,
    liveGroups: liveGroups.length,
    formingGroups: liveGroups.filter(group => group.status === 'FORMING').length,
    activeGroups: liveGroups.filter(group => group.status === 'ACTIVE').length,
    dissolvedGroups: snapshot.groups.filter(group => group.status === 'DISSOLVED').length,
    maxMembers: Math.max(0, ...liveGroups.map(group => group.memberNpcIds.length)),
    eventCounts: counts
  };
}
