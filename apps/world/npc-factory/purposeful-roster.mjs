import { PULSE_PERIODS, positionAt } from './dev-runtime-state.mjs';
import { MAIN_NPC_ID, QUEST_NPC_ID, runtimePresence } from './npc-presence.mjs';
import { createPurposefulStudent } from './purposeful-student-state.mjs';
import { purposefulBehaviorForNpc } from './purposeful-behavior.mjs';

const protectedIds = new Set([MAIN_NPC_ID, QUEST_NPC_ID]);
const locationLabels = Object.freeze({
  inkyung_spawn: '인경호 입구',
  inkyung_bench_east: '인경호 동쪽 벤치',
  inkyung_bench_west: '인경호 서쪽 벤치',
  inkyung_walkway: '인경호 산책로',
  inkyung_waterfront: '인경호 물가',
  inkyung_photo_point: '인경호 사진 지점',
  transit_to_main_hall: '본관 방향 길',
  transit_to_student_center: '학생회관 방향 길',
  transit_to_building: '강의동 방향 길',
  class_building_2: '2호관',
  class_building_4: '4호관',
  class_building_5: '5호관',
  class_building_6: '6호관',
  class_building_9: '9호관',
  class_hitech: '하이테크센터',
  class_seoho: '서호관',
  class_lawschool: '로스쿨관',
  class_60th: '60주년기념관',
  study_jungseok: '정석학술정보관',
  life_student_center: '학생회관',
  life_back_market_67: '후문 67번길',
  life_back_market_91: '후문 91번길',
  life_back_market_west: '후문 서쪽 골목',
  life_back_market_north: '후문 47번길 연결상권',
  life_back_gate: '후문',
  life_dorm_1: '제1생활관',
  life_dorm_2: '제2생활관'
});
const activityMeaning = Object.freeze({
  walk_to_class: ['CLASS', 'ATTEND_CLASS', 'ACADEMIC'],
  walk_to_club: ['CLUB', 'VISIT_CLUB', 'CLUB'],
  leave_zone: ['TRANSIT', 'GO_TO_NEXT_PLACE', 'TRANSIT'],
  walk: ['TRANSIT', 'GO_TO_NEXT_PLACE', 'WALK_BREAK'],
  sit: ['REST', 'REST', 'RESTING'],
  read: ['STUDY', 'READ', 'READING'],
  drink_coffee: ['HUNGER', 'GET_COFFEE', 'COFFEE'],
  eat_snack: ['HUNGER', 'EAT', 'EATING'],
  use_phone: ['REST', 'TAKE_BREAK', 'PHONE'],
  take_photo: ['EXPLORE', 'TAKE_PHOTO', 'PHOTO'],
  listen_to_music: ['REST', 'LISTEN_TO_MUSIC', 'MUSIC'],
  talk_with_friend: ['REST', 'TAKE_BREAK', 'WAITING'],
  wait: ['TRANSIT', 'WAIT', 'WAITING'],
  idle: ['REST', 'TAKE_BREAK', 'WAITING']
});

// Pulse attendance chooses each clock slot; the reviewed source stays unchanged.
// Off-zone slots use the existing C04 transit edge as a sink and re-entry point.
export function createPurposefulRoster(batch, navigator, { duration = 12, speed = 1.15 } = {}) {
  const result = new Map();
  // The photo point's first slot belongs to the stationary AI NPC (002).
  const nextSlot = new Map([['inkyung_photo_point', 1]]);
  const assignedSlots = new Map();
  function slotFor(location, id) {
    if (location === 'off_zone') return Number(id.slice(-3)) % 2;
    const key = `${location}.${id}`;
    if (!assignedSlots.has(key)) {
      const slot = nextSlot.get(location) ?? 0;
      assignedSlots.set(key, slot);
      nextSlot.set(location, slot + 1);
    }
    return assignedSlots.get(key);
  }
  for (const npc of [...batch.npcs].sort((a,b) => a.npc_id.localeCompare(b.npc_id))) {
    if (protectedIds.has(npc.npc_id)) continue;
    const id = npc.npc_id;
    const behavior = purposefulBehaviorForNpc(id);
    const entries = PULSE_PERIODS.map(period => runtimePresence(npc, period).slot);
    if (!entries.length) throw new Error(`No campus schedule for ${id}`);
    const destinations = {};
    const schedule = entries.map(slot => {
      const destination = `c04.${slot.location}.${id}`;
      const sink = slot.location === 'off_zone';
      const remote = slot.location === 'life_dorm_2';
      destinations[destination] ??= {
        type: remote ? 'REMOTE' : sink ? 'SINK' : slot.location.includes('bench') ? 'REST' : 'CAMPUS',
        label: sink ? '구역 경계' : locationLabels[slot.location] ?? slot.location,
        position: positionAt(sink ? 'transit_to_building' : slot.location, slotFor(slot.location, id))
      };
      const [need, goal, activity] = activityMeaning[slot.activity] ?? activityMeaning.idle;
      if (remote) return { need, goal, destination, activity, duration, remote: true };
      return sink
        ? { need: 'TRANSIT', goal: 'LEAVE_ZONE', destination, activity: 'OFF_ZONE', duration: duration * 2, sink: true }
        : { need, goal, destination, activity, duration };
    });
    const spawn = destinations[schedule[0].destination].position;
    const moveSpeed = speed * behavior.speedMultiplier;
    const controller = createPurposefulStudent({
      id, spawn, destinations, schedule, navigator, holdAtActivity: true, speed: moveSpeed,
      startHidden: entries[0].location === 'off_zone'
    });
    result.set(id, { controller, destinations, schedule, behavior, moveSpeed });
  }
  const protectedCount = batch.npcs.filter(npc => protectedIds.has(npc.npc_id)).length;
  const expected = batch.npcs.length - protectedCount;
  if (result.size !== expected) throw new Error(`Expected ${expected} purposeful NPCs; got ${result.size}`);
  return result;
}

