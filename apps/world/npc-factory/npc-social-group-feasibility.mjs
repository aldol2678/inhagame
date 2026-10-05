import { positionAt } from './dev-runtime-state.mjs';
import {
  NPC_SOCIAL_REGULAR_MEETING_POLICY,
  npcSocialTravelBudgetSeconds
} from './npc-social-travel-policy.mjs';

export const NPC_SOCIAL_B2_FALLBACK_LOCATIONS = Object.freeze([
  'transit_to_main_hall',
  'transit_to_student_center',
  'transit_to_building',
  'inkyung_walkway',
  'inkyung_photo_point',
  'inkyung_waterfront'
]);

const ELIGIBLE_PHASES = new Set(['ACTING']);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const pointKey = point => `${point.x.toFixed(3)},${point.z.toFixed(3)}`;

function routeDistance(from, route) {
  let total = 0;
  let current = from;
  for (const point of route) {
    total += distance(current, point);
    current = point;
  }
  return total;
}

export function createNpcSocialGroupFeasibility({
  roster,
  navigator,
  positionAtFn = positionAt,
  maxTravelSeconds = npcSocialTravelBudgetSeconds('REGULAR_GROUP'),
  maxSlots = 9
} = {}) {
  if (!roster || !navigator || typeof positionAtFn !== 'function' ||
      !(maxTravelSeconds > 0) || !Number.isInteger(maxSlots) || maxSlots < 6)
    throw new Error('Invalid NPC social P2-B2 feasibility configuration');

  const routeCache = new Map();
  const groupCache = new Map();
  const trimCache = cache => {
    if (cache.size <= 2048) return;
    const removeCount = cache.size - 1536;
    let removed = 0;
    for (const key of cache.keys()) {
      cache.delete(key);
      if (++removed >= removeCount) break;
    }
  };

  return function validateNpcSocialGroup({ memberNpcIds, primaryInterest, tick = 0 } = {}) {
    if (!Number.isInteger(tick) || tick < 0) throw new Error('Invalid NPC social P2-B2 tick');
    const ids = [...new Set(memberNpcIds ?? [])].sort();
    if (ids.length < 3) return { ok: false, reason: 'MIN_MEMBERS' };
    const states = ids.map(id => {
      const member = roster.get(id);
      const state = member?.controller.status(false);
      return { id, member, state };
    });
    const stateFingerprint = states.map(({ id, state }) =>
      `${id}:${state?.phase ?? 'NONE'}:${state?.visible ? 1 : 0}:${state?.interrupted ? 1 : 0}:${state?.paused ? 1 : 0}:${state?.position ? pointKey(state.position) : 'none'}`
    ).join(';');
    const groupKey = `${primaryInterest ?? ''}|${ids.join('|')}|${stateFingerprint}`;
    const cachedGroup = groupCache.get(groupKey);
    if (cachedGroup) return { ...cachedGroup };
    if (states.some(({ member, state }) =>
      !member || !(member.moveSpeed > 0) || !state?.visible || state.interrupted || state.paused ||
      !ELIGIBLE_PHASES.has(state.phase))) {
      const result = { ok: false, reason: 'MEMBER_UNAVAILABLE' };
      groupCache.set(groupKey, result);
      trimCache(groupCache);
      return { ...result };
    }

    const preferred = NPC_SOCIAL_REGULAR_MEETING_POLICY.locationByCluster[primaryInterest] ??
      'inkyung_walkway';
    const locations = [preferred, ...NPC_SOCIAL_B2_FALLBACK_LOCATIONS.filter(location =>
      location !== preferred)];

    for (const location of locations) {
      const usedSlots = new Set();
      const selectedPositions = [];
      let maxTravelSecondsSeen = 0;
      let viable = true;

      for (const { id, member, state } of states) {
        let selected = null;
        for (let slot = 0; slot < maxSlots; slot++) {
          if (usedSlots.has(slot)) continue;
          const target = positionAtFn(location, slot);
          if (!target || !navigator.walkable(target)) continue;
          if (selectedPositions.some(point => distance(point, target) < .8)) continue;

          const routeKey = `${id}|${pointKey(state.position)}|${location}|${slot}`;
          let travelSeconds = routeCache.get(routeKey);
          if (travelSeconds === undefined) {
            const straightLineSeconds = distance(state.position, target) / member.moveSpeed;
            if (straightLineSeconds > maxTravelSeconds) {
              routeCache.set(routeKey, null);
              continue;
            }
            const route = navigator.route(state.position, target);
            travelSeconds = route ? routeDistance(state.position, route) / member.moveSpeed : null;
            if (!(travelSeconds <= maxTravelSeconds)) travelSeconds = null;
            routeCache.set(routeKey, travelSeconds);
            trimCache(routeCache);
          }
          if (travelSeconds === null) continue;
          selected = { slot, target, travelSeconds };
          break;
        }
        if (!selected) {
          viable = false;
          break;
        }
        usedSlots.add(selected.slot);
        selectedPositions.push(selected.target);
        maxTravelSecondsSeen = Math.max(maxTravelSecondsSeen, selected.travelSeconds);
      }

      if (viable) {
        const result = {
          ok: true,
          reason: 'ROUTE_VALIDATED',
          meetingLocation: location,
          maxTravelSeconds: Math.round(maxTravelSecondsSeen * 1000) / 1000,
          memberCount: ids.length
        };
        groupCache.set(groupKey, result);
        trimCache(groupCache);
        return { ...result };
      }
    }

    const result = { ok: false, reason: 'NO_COMMON_ROUTE' };
    groupCache.set(groupKey, result);
    trimCache(groupCache);
    return { ...result };
  };
}
