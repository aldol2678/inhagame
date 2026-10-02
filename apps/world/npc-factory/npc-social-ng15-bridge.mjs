import { positionAt } from './dev-runtime-state.mjs';
import {
  NPC_SOCIAL_REGULAR_ATTENDANCE_POLICY,
  classifyNpcSocialTravelKind,
  npcSocialAssembleTimeoutSeconds,
  npcSocialTravelBudgetSeconds
} from './npc-social-travel-policy.mjs';

export const NG15_MEETING_LOCATION_BY_CLUSTER = Object.freeze({
  CREATIVE: 'inkyung_photo_point',
  TECH: 'inkyung_walkway',
  LEARNING: 'inkyung_bench_east',
  LIFESTYLE: 'inkyung_bench_west',
  EXPLORE: 'inkyung_waterfront'
});
export const NG15_LOCAL_MEETING_LOCATIONS = Object.freeze([...new Set(Object.values(NG15_MEETING_LOCATION_BY_CLUSTER))]);
export const NG15_ZONE_MEETING_LOCATIONS = Object.freeze([
  'transit_to_main_hall',
  'transit_to_student_center',
  'transit_to_building'
]);
const NG15_MEETING_LOCATIONS = Object.freeze([
  ...NG15_LOCAL_MEETING_LOCATIONS,
  ...NG15_ZONE_MEETING_LOCATIONS
]);
const NG15_LOCAL_LOCATION_SET = new Set(NG15_LOCAL_MEETING_LOCATIONS);

const ELIGIBLE_PHASES = new Set(['ACTING', 'MOVING']);
const ACTIVE_PHASES = new Set(['ASSEMBLING', 'MEETING', 'RETURNING']);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function createNpcSocialNg15Bridge({
  roster,
  navigator,
  positionAtFn = positionAt,
  dwellSeconds = 6,
  maxMembers = 3,
  travelBudgetKind = 'AUTO',
  maxTravelSeconds = null,
  assembleTimeoutSeconds = null,
  regularAttendancePolicy = NPC_SOCIAL_REGULAR_ATTENDANCE_POLICY,
  oneShotRetrySeconds = 1,
  onRegularMeetingOutcome = () => {}
} = {}) {
  if (!roster || !navigator) throw new Error('NG1.5 roster and navigator required');
  if (typeof onRegularMeetingOutcome !== 'function') throw new Error('Invalid NG1.5 meeting outcome callback');
  const attendancePolicy = {
    ...NPC_SOCIAL_REGULAR_ATTENDANCE_POLICY,
    ...(regularAttendancePolicy ?? {})
  };
  if (!Number.isInteger(attendancePolicy.minAttendees) || attendancePolicy.minAttendees < 3 ||
      !Number.isInteger(attendancePolicy.maxAttendees) ||
      attendancePolicy.maxAttendees < attendancePolicy.minAttendees ||
      !Number.isInteger(attendancePolicy.lateGraceTicks) || attendancePolicy.lateGraceTicks < 0)
    throw new Error('Invalid NG1.5 attendance policy');
  if (!(dwellSeconds > 0) || !Number.isInteger(maxMembers) || maxMembers < 3 ||
      !(oneShotRetrySeconds > 0) ||
      (assembleTimeoutSeconds !== null && !(assembleTimeoutSeconds > 0)))
    throw new Error('Invalid NG1.5 bridge configuration');
  if (travelBudgetKind !== 'AUTO') {
    const configuredBudgetSeconds = maxTravelSeconds ?? npcSocialTravelBudgetSeconds(travelBudgetKind);
    const configuredTimeoutSeconds = assembleTimeoutSeconds ?? npcSocialAssembleTimeoutSeconds(travelBudgetKind);
    if (!(configuredBudgetSeconds > 0) || configuredBudgetSeconds >= configuredTimeoutSeconds)
      throw new Error('Invalid NG1.5 bridge configuration');
  }

  const completedGroups = new Set();
  const failedGroups = new Set();
  const pendingRegularMeetings = new Map();
  let phase = 'IDLE';
  let phaseTime = 0;
  let active = null;
  let lastOutcome = null;
  // One-shot venue selection can call navigator.route many times. Production update()
  // runs at frame rate, but social meetup selection does not need frame-rate retries.
  // Scan immediately once, then at a bounded cadence until a candidate becomes viable.
  let oneShotRetryElapsed = oneShotRetrySeconds;

  function memberStates(ids) {
    return ids.map(id => roster.get(id)?.controller.status(false)).filter(Boolean);
  }

  function routeDistance(from, route) {
    let total = 0;
    let current = from;
    for (const point of route) {
      total += distance(current, point);
      current = point;
    }
    return total;
  }

  function travelPolicyFor(group) {
    const classified = travelBudgetKind === 'AUTO'
      ? classifyNpcSocialTravelKind(group)
      : { kind: travelBudgetKind, reason: 'OVERRIDE' };
    const budgetSeconds = maxTravelSeconds ?? npcSocialTravelBudgetSeconds(classified.kind);
    const timeoutSeconds = assembleTimeoutSeconds ?? npcSocialAssembleTimeoutSeconds(classified.kind);
    if (!(budgetSeconds > 0) || !(timeoutSeconds > 0) || budgetSeconds >= timeoutSeconds) return null;
    return { ...classified, budgetSeconds, assembleTimeoutSeconds: timeoutSeconds };
  }

  function targetSetForLocation(group, memberNpcIds, location, travelPolicy, { minMembers = memberNpcIds.length } = {}) {
    const participantIds = new Set(memberNpcIds);
    const occupied = [...roster.entries()]
      .filter(([id]) => !participantIds.has(id))
      .map(([, value]) => value.controller.status(false))
      .filter(state => state.visible)
      .map(state => state.position);
    const usedSlots = new Set();
    const targets = [];
    let maxTravelSecondsSeen = 0;
    for (const id of memberNpcIds) {
      const member = roster.get(id);
      const state = member?.controller.status(false);
      if (!state?.visible || !(member?.moveSpeed > 0)) continue;
      let selected = null;
      for (let slot = 0; slot < 27; slot++) {
        if (usedSlots.has(slot)) continue;
        const position = positionAtFn(location, slot);
        if (!position || !navigator.walkable(position)) continue;
        if (targets.some(target => distance(target.position, position) < .8)) continue;
        if (occupied.some(point => distance(point, position) < 1.15)) continue;
        // Route distance can never beat straight-line distance. Reject impossible
        // travel-budget candidates before invoking the much more expensive A* solver.
        const straightLineSeconds = distance(state.position, position) / member.moveSpeed;
        if (straightLineSeconds > travelPolicy.budgetSeconds) continue;
        const route = navigator.route(state.position, position);
        if (!route) continue;
        const travelSeconds = routeDistance(state.position, route) / member.moveSpeed;
        if (travelSeconds > travelPolicy.budgetSeconds) continue;
        selected = {
          id,
          destination: `ng15.${group.groupId}.${location}.${id}`,
          position,
          slot,
          travelSeconds
        };
        break;
      }
      if (!selected) continue;
      usedSlots.add(selected.slot);
      targets.push(selected);
      maxTravelSecondsSeen = Math.max(maxTravelSecondsSeen, selected.travelSeconds);
    }
    if (targets.length < minMembers) return null;
    return {
      location,
      memberNpcIds: targets.map(target => target.id),
      meetingScope: NG15_LOCAL_LOCATION_SET.has(location) ? 'LOCAL' : 'ZONE',
      maxTravelSeconds: maxTravelSecondsSeen,
      targets: targets.map(({ travelSeconds, ...target }) => target)
    };
  }

  function targetSet(group, memberNpcIds, travelPolicy, { minMembers = memberNpcIds.length } = {}) {
    const preferred = NG15_MEETING_LOCATION_BY_CLUSTER[group.primaryInterest] ?? 'inkyung_walkway';
    const remembered = travelPolicy.kind === 'REGULAR_GROUP' ? group.meetingPlaceRef : null;
    // A regular group keeps its remembered venue whenever that venue is still reachable.
    // Only an actually unreachable remembered venue may relocate to another campus anchor.
    if (remembered && NG15_MEETING_LOCATIONS.includes(remembered)) {
      const rememberedOption = targetSetForLocation(
        group, memberNpcIds, remembered, travelPolicy, { minMembers }
      );
      if (rememberedOption) return rememberedOption;
    }
    const locations = [preferred, ...NG15_MEETING_LOCATIONS.filter(location =>
      location !== preferred && location !== remembered
    )];
    const options = locations
      .map(location => targetSetForLocation(group, memberNpcIds, location, travelPolicy, { minMembers }))
      .filter(Boolean);
    if (!options.length) return null;
    // Interest keeps a small preference, but real navigation time is the main authority.
    return options.reduce((best, option) => {
      const score = option.maxTravelSeconds - (option.location === preferred ? 2.5 : 0);
      const bestScore = best.maxTravelSeconds - (best.location === preferred ? 2.5 : 0);
      return score < bestScore ? option : best;
    });
  }

  function eligibleMemberIds(group, blocked) {
    return group.memberNpcIds
      .filter(id => roster.has(id) && !blocked.has(id))
      .filter(id => {
        const state = roster.get(id).controller.status(false);
        return state.visible && !state.interrupted && !state.paused && ELIGIBLE_PHASES.has(state.phase);
      });
  }

  function attendanceSnapshot(group, pending, attendedNpcIds) {
    const invitedNpcIds = [...pending.invitedNpcIds];
    const attended = [...attendedNpcIds];
    const onTimeNpcIds = attended.filter(id => pending.onTimeNpcIds.has(id));
    const lateNpcIds = attended.filter(id => !pending.onTimeNpcIds.has(id));
    const attendedSet = new Set(attended);
    return {
      invitedNpcIds,
      attendedNpcIds: attended,
      onTimeNpcIds,
      lateNpcIds,
      absentNpcIds: invitedNpcIds.filter(id => !attendedSet.has(id))
    };
  }

  function recurringCandidate(snapshot, blocked) {
    if (!Number.isInteger(snapshot?.tick)) return { next: null, waiting: false };
    let waiting = false;
    const liveGroupIds = new Set((snapshot.groups ?? []).filter(group => group.status === 'ACTIVE').map(group => group.groupId));
    for (const groupId of [...pendingRegularMeetings.keys()]) {
      if (!liveGroupIds.has(groupId)) pendingRegularMeetings.delete(groupId);
    }

    for (const group of snapshot.groups ?? []) {
      if (group.status !== 'ACTIVE') continue;
      const travelPolicy = travelPolicyFor(group);
      if (!travelPolicy || travelPolicy.kind !== 'REGULAR_GROUP' ||
          !Number.isInteger(group.nextMeetingTick) || snapshot.tick < group.nextMeetingTick) continue;

      const invitedNpcIds = group.memberNpcIds.filter(id => roster.has(id)).slice(0, attendancePolicy.maxAttendees);
      let pending = pendingRegularMeetings.get(group.groupId);
      if (!pending || pending.scheduledMeetingTick !== group.nextMeetingTick) {
        const onTimeNpcIds = eligibleMemberIds(group, blocked)
          .filter(id => invitedNpcIds.includes(id))
          .slice(0, attendancePolicy.maxAttendees);
        pending = {
          scheduledMeetingTick: group.nextMeetingTick,
          graceUntilTick: group.nextMeetingTick + attendancePolicy.lateGraceTicks,
          invitedNpcIds,
          onTimeNpcIds: new Set(onTimeNpcIds)
        };
        pendingRegularMeetings.set(group.groupId, pending);
      }

      const eligible = eligibleMemberIds(group, blocked)
        .filter(id => pending.invitedNpcIds.includes(id))
        .slice(0, attendancePolicy.maxAttendees);
      if (eligible.length >= attendancePolicy.minAttendees) {
        const meeting = targetSet(group, eligible, travelPolicy, {
          minMembers: attendancePolicy.minAttendees
        });
        if (meeting) {
          const attendingNpcIds = meeting.memberNpcIds;
          pendingRegularMeetings.delete(group.groupId);
          return {
            next: {
              group,
              memberNpcIds: attendingNpcIds,
              travelPolicy,
              attendance: attendanceSnapshot(group, pending, attendingNpcIds),
              ...meeting
            },
            waiting: false
          };
        }
      }

      if (snapshot.tick >= pending.graceUntilTick) {
        const outcome = eligible.length < attendancePolicy.minAttendees
          ? 'POSTPONED_QUORUM' : 'POSTPONED_ROUTE';
        const attendance = attendanceSnapshot(group, pending, eligible);
        pendingRegularMeetings.delete(group.groupId);
        lastOutcome = { groupId: group.groupId, outcome, attendance };
        onRegularMeetingOutcome({ groupId: group.groupId, outcome, attendance });
        continue;
      }
      waiting = true;
    }
    return { next: null, waiting };
  }

  function oneShotCandidate(snapshot, blocked) {
    for (const group of snapshot?.groups ?? []) {
      if (group.status !== 'ACTIVE' || completedGroups.has(group.groupId) || failedGroups.has(group.groupId)) continue;
      const travelPolicy = travelPolicyFor(group);
      if (!travelPolicy || travelPolicy.kind === 'REGULAR_GROUP') continue;
      const eligible = eligibleMemberIds(group, blocked).slice(0, maxMembers);
      if (eligible.length < 3) continue;
      const meeting = targetSet(group, eligible, travelPolicy, { minMembers: 3 });
      if (meeting) return { group, memberNpcIds: meeting.memberNpcIds, travelPolicy, attendance: null, ...meeting };
    }
    return null;
  }

  function candidate(snapshot, blockedNpcIds, { allowOneShot = true } = {}) {
    const blocked = new Set(blockedNpcIds ?? []);
    const recurring = recurringCandidate(snapshot, blocked);
    if (recurring.next) return recurring.next;
    if (recurring.waiting || !allowOneShot) return null;
    return oneShotCandidate(snapshot, blocked);
  }

  function rollbackStarted(ids) {
    for (const id of ids) {
      const controller = roster.get(id)?.controller;
      if (controller?.status(false).interrupted) controller.endDetour();
    }
  }

  function begin(next) {
    const started = [];
    for (const target of next.targets) {
      const controller = roster.get(target.id).controller;
      const ok = controller.beginDetour({
        destination: target.destination,
        position: target.position,
        need: 'SOCIAL',
        goal: 'GROUP_MEETUP',
        activity: 'SOCIAL_MEETUP'
      });
      if (!ok) {
        rollbackStarted(started);
        failedGroups.add(next.group.groupId);
        lastOutcome = {
          groupId: next.group.groupId,
          outcome: 'START_FAILED',
          attendance: next.attendance ?? null
        };
        if (next.travelPolicy.kind === 'REGULAR_GROUP') {
          onRegularMeetingOutcome({
            groupId: next.group.groupId,
            outcome: 'START_FAILED',
            attendance: next.attendance ?? null
          });
        }
        return false;
      }
      started.push(target.id);
    }
    active = {
      groupId: next.group.groupId,
      primaryInterest: next.group.primaryInterest,
      meetingLocation: next.location,
      meetingScope: next.meetingScope,
      travelBudgetKind: next.travelPolicy.kind,
      travelBudgetReason: next.travelPolicy.reason,
      travelBudgetSeconds: next.travelPolicy.budgetSeconds,
      assembleTimeoutSeconds: next.travelPolicy.assembleTimeoutSeconds,
      estimatedTravelSeconds: next.maxTravelSeconds,
      scheduledMeetingTick: Number.isInteger(next.group.nextMeetingTick) ? next.group.nextMeetingTick : null,
      attendance: next.attendance ? {
        invitedNpcIds: [...next.attendance.invitedNpcIds],
        attendedNpcIds: [...next.attendance.attendedNpcIds],
        onTimeNpcIds: [...next.attendance.onTimeNpcIds],
        lateNpcIds: [...next.attendance.lateNpcIds],
        absentNpcIds: [...next.attendance.absentNpcIds]
      } : null,
      memberNpcIds: [...next.memberNpcIds],
      targets: next.targets.map(target => ({ id: target.id, position: { ...target.position } }))
    };
    phase = 'ASSEMBLING';
    phaseTime = 0;
    return true;
  }

  function endActive(outcome, markFailed = false) {
    if (!active) return;
    const current = active;
    rollbackStarted(current.memberNpcIds);
    if (markFailed) failedGroups.add(current.groupId);
    else if (outcome === 'COMPLETED') completedGroups.add(current.groupId);
    if (current.travelBudgetKind === 'REGULAR_GROUP' && outcome !== 'GROUP_GONE') {
      onRegularMeetingOutcome({
        groupId: current.groupId,
        outcome,
        attendance: current.attendance
      });
    }
    lastOutcome = {
      groupId: current.groupId,
      outcome,
      attendance: current.attendance
    };
    active = null;
    phase = 'IDLE';
    phaseTime = 0;
  }

  function shouldPauseForConversation(id, conversationId) {
    return Boolean(active && conversationId && ACTIVE_PHASES.has(phase) &&
      active.memberNpcIds.includes(conversationId) && active.memberNpcIds.includes(id));
  }

  function observationFor(id) {
    if (!active || !active.memberNpcIds.includes(id) || !['ASSEMBLING', 'MEETING'].includes(phase)) return null;
    return {
      location: `social.ng15.${active.meetingLocation}`,
      activity: 'talk_with_friend',
      socialMode: 'high'
    };
  }

  function tick(dt, socialSnapshot, { blockedNpcIds = [], conversationId = null } = {}) {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid NG1.5 bridge tick');

    if (!active) {
      if (dt === 0) return status();
      oneShotRetryElapsed += dt;
      const allowOneShot = oneShotRetryElapsed >= oneShotRetrySeconds;
      const next = candidate(socialSnapshot, blockedNpcIds, { allowOneShot });
      if (allowOneShot) oneShotRetryElapsed = 0;
      if (next) begin(next);
      return status();
    }

    const group = socialSnapshot?.groups?.find(item => item.groupId === active.groupId);
    if (!group || group.status === 'DISSOLVED') {
      endActive('GROUP_GONE');
      return status();
    }

    const states = memberStates(active.memberNpcIds);
    if (states.length !== active.memberNpcIds.length || states.some(state => state.phase === 'FAILED')) {
      endActive('MEMBER_FAILED', true);
      return status();
    }

    if (conversationId && active.memberNpcIds.includes(conversationId)) return status();

    if (phase === 'ASSEMBLING') {
      const arrived = states.every(state =>
        state.interrupted && state.phase === 'ACTING' && state.activity === 'SOCIAL_MEETUP');
      if (arrived) {
        phase = 'MEETING';
        phaseTime = 0;
      } else if ((phaseTime += dt) >= active.assembleTimeoutSeconds) {
        endActive('ASSEMBLE_TIMEOUT', true);
      }
    } else if (phase === 'MEETING') {
      phaseTime += dt;
      if (phaseTime >= dwellSeconds) {
        const resumed = active.memberNpcIds.map(id => roster.get(id).controller.endDetour());
        if (resumed.every(Boolean)) {
          phase = 'RETURNING';
          phaseTime = 0;
        } else {
          endActive('RESUME_FAILED', true);
        }
      }
    } else if (phase === 'RETURNING') {
      if (states.every(state => !state.interrupted)) endActive('COMPLETED');
      else if ((phaseTime += dt) >= active.assembleTimeoutSeconds) endActive('RETURN_TIMEOUT', true);
    }
    return status();
  }

  function status() {
    return {
      phase,
      active: active ? {
        groupId: active.groupId,
        primaryInterest: active.primaryInterest,
        meetingLocation: active.meetingLocation,
        meetingScope: active.meetingScope,
        travelBudgetKind: active.travelBudgetKind,
        travelBudgetReason: active.travelBudgetReason,
        travelBudgetSeconds: active.travelBudgetSeconds,
        assembleTimeoutSeconds: active.assembleTimeoutSeconds,
        estimatedTravelSeconds: active.estimatedTravelSeconds,
        scheduledMeetingTick: active.scheduledMeetingTick,
        attendance: active.attendance ? {
          invitedNpcIds: [...active.attendance.invitedNpcIds],
          attendedNpcIds: [...active.attendance.attendedNpcIds],
          onTimeNpcIds: [...active.attendance.onTimeNpcIds],
          lateNpcIds: [...active.attendance.lateNpcIds],
          absentNpcIds: [...active.attendance.absentNpcIds]
        } : null,
        memberNpcIds: [...active.memberNpcIds],
        targets: active.targets.map(target => ({ id: target.id, position: { ...target.position } }))
      } : null,
      completedGroups: [...completedGroups],
      failedGroups: [...failedGroups],
      pendingRegularMeetings: [...pendingRegularMeetings.entries()].map(([groupId, pending]) => ({
        groupId,
        scheduledMeetingTick: pending.scheduledMeetingTick,
        graceUntilTick: pending.graceUntilTick,
        invitedNpcIds: [...pending.invitedNpcIds],
        onTimeNpcIds: [...pending.onTimeNpcIds]
      })),
      lastOutcome: lastOutcome ? {
        ...lastOutcome,
        attendance: lastOutcome.attendance ? {
          invitedNpcIds: [...lastOutcome.attendance.invitedNpcIds],
          attendedNpcIds: [...lastOutcome.attendance.attendedNpcIds],
          onTimeNpcIds: [...lastOutcome.attendance.onTimeNpcIds],
          lateNpcIds: [...lastOutcome.attendance.lateNpcIds],
          absentNpcIds: [...lastOutcome.attendance.absentNpcIds]
        } : null
      } : null
    };
  }

  return { tick, status, observationFor, shouldPauseForConversation };
}
