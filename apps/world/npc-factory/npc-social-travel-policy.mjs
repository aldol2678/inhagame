export const NPC_SOCIAL_TRAVEL_BUDGET_SECONDS = Object.freeze({
  SPONTANEOUS: 15,
  SMALL_GROUP: 45,
  REGULAR_GROUP: 90
});

export function npcSocialTravelBudgetSeconds(kind) {
  const seconds = NPC_SOCIAL_TRAVEL_BUDGET_SECONDS[kind];
  if (!(seconds > 0)) throw new Error(`Unknown NPC social travel budget: ${kind}`);
  return seconds;
}

export const NPC_SOCIAL_ACTION_CLASSIFIER = Object.freeze({
  spontaneousMaxCohesion: 15,
  spontaneousMaxActivity: 70
});

export function classifyNpcSocialTravelKind(group) {
  if (!group || group.status === 'DISSOLVED') throw new Error('Live NPC social group required');
  if (group.meetingPlaceRef) {
    return { kind: 'REGULAR_GROUP', reason: 'RECURRING_MEETING_PLACE' };
  }
  if (group.status === 'FORMING') {
    return { kind: 'SPONTANEOUS', reason: 'FORMING_GROUP' };
  }
  const hasCohesion = Number.isFinite(group.cohesion);
  const hasActivity = Number.isFinite(group.activity);
  if ((hasCohesion && group.cohesion < NPC_SOCIAL_ACTION_CLASSIFIER.spontaneousMaxCohesion) ||
      (hasActivity && group.activity < NPC_SOCIAL_ACTION_CLASSIFIER.spontaneousMaxActivity)) {
    return { kind: 'SPONTANEOUS', reason: 'LOW_STABILITY' };
  }
  return { kind: 'SMALL_GROUP', reason: 'ACTIVE_GROUP' };
}

export const NPC_SOCIAL_ASSEMBLE_TIMEOUT_SECONDS = Object.freeze({
  SPONTANEOUS: 30,
  SMALL_GROUP: 60,
  REGULAR_GROUP: 120
});

export function npcSocialAssembleTimeoutSeconds(kind) {
  const seconds = NPC_SOCIAL_ASSEMBLE_TIMEOUT_SECONDS[kind];
  if (!(seconds > 0)) throw new Error(`Unknown NPC social assembly timeout: ${kind}`);
  return seconds;
}

export const NPC_SOCIAL_REGULAR_MEETING_POLICY = Object.freeze({
  minAgeTicks: 80,
  minCohesion: 30,
  minActivity: 80,
  cadenceTicks: 120,
  locationByCluster: Object.freeze({
    CREATIVE: 'inkyung_photo_point',
    TECH: 'transit_to_building',
    LEARNING: 'transit_to_main_hall',
    LIFESTYLE: 'transit_to_student_center',
    EXPLORE: 'inkyung_waterfront'
  })
});

export function npcSocialRegularMeetingPlaceRef(group, currentTick) {
  if (!group || !Number.isInteger(currentTick) || currentTick < 0)
    throw new Error('NPC social group and current tick required');
  if (group.meetingPlaceRef) return group.meetingPlaceRef;
  if (group.status !== 'ACTIVE') return null;
  const age = currentTick - group.createdAtTick;
  if (age < NPC_SOCIAL_REGULAR_MEETING_POLICY.minAgeTicks ||
      !Number.isFinite(group.cohesion) || group.cohesion < NPC_SOCIAL_REGULAR_MEETING_POLICY.minCohesion ||
      !Number.isFinite(group.activity) || group.activity < NPC_SOCIAL_REGULAR_MEETING_POLICY.minActivity) return null;
  return NPC_SOCIAL_REGULAR_MEETING_POLICY.locationByCluster[group.primaryInterest] ?? 'inkyung_walkway';
}

export const NPC_SOCIAL_REGULAR_ATTENDANCE_POLICY = Object.freeze({
  minAttendees: 3,
  maxAttendees: 6,
  lateGraceTicks: 12
});
