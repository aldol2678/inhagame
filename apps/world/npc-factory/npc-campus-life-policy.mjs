export const NPC_CAMPUS_LIFE_LOCATIONS = Object.freeze({
  BUILDING_2: 'class_building_2',
  BUILDING_4: 'class_building_4',
  BUILDING_5: 'class_building_5',
  BUILDING_6: 'class_building_6',
  BUILDING_9: 'class_building_9',
  HITECH: 'class_hitech',
  SEOHO: 'class_seoho',
  LAWSCHOOL: 'class_lawschool',
  ANNIVERSARY_60: 'class_60th',
  JUNGSEOK: 'study_jungseok',
  STUDENT_CENTER: 'life_student_center',
  BACK_MARKET_67: 'life_back_market_67',
  BACK_MARKET_91: 'life_back_market_91',
  BACK_MARKET_WEST: 'life_back_market_west',
  BACK_MARKET_NORTH: 'life_back_market_north',
  BACK_GATE: 'life_back_gate',
  DORM_1: 'life_dorm_1',
  DORM_2: 'life_dorm_2'
});

const L = NPC_CAMPUS_LIFE_LOCATIONS;
const protectedIds = new Set(['INKYUNG-NPC-001', 'INKYUNG-NPC-002']);

// Identity and authored life context, never client RNG or join time, own the plan.
export function campusLifeSeed(npc, entry, salt = '') {
  const context = JSON.stringify([npc.npc_id, entry?.department, npc.identity?.year_level,
    entry?.residence, [...(npc.interests ?? [])].sort(),
    (npc.relationships ?? []).map(r => [r.target_id, r.type]).sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
  let hash = 2166136261;
  for (const character of context + salt) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

const LOCATION_LABEL = Object.freeze({
  [L.BUILDING_2]: '2호관',
  [L.BUILDING_4]: '4호관',
  [L.BUILDING_5]: '5호관',
  [L.BUILDING_6]: '6호관',
  [L.BUILDING_9]: '9호관',
  [L.HITECH]: '하이테크센터',
  [L.SEOHO]: '서호관',
  [L.LAWSCHOOL]: '로스쿨관',
  [L.ANNIVERSARY_60]: '60주년기념관',
  [L.JUNGSEOK]: '정석학술정보관',
  [L.STUDENT_CENTER]: '학생회관',
  [L.BACK_MARKET_67]: '후문 67번길',
  [L.BACK_MARKET_91]: '후문 91번길',
  [L.BACK_MARKET_WEST]: '후문 서쪽 골목',
  [L.BACK_MARKET_NORTH]: '후문 47번길 연결상권',
  [L.BACK_GATE]: '후문',
  [L.DORM_1]: '제1생활관',
  [L.DORM_2]: '제2생활관'
});

function dialogueFor(period, slot) {
  const label = LOCATION_LABEL[slot.location] ?? '캠퍼스';
  if (period === 'class_time') {
    const action = { walk_to_class: '수업', read: '독서', eat_snack: '식사',
      walk_to_club: '동아리 활동', use_phone: '공강 휴식', walk: '산책' }[slot.activity] ?? '공강';
    return [`${label} 쪽에서 ${action} 시간을 보내고 있어요.`,
      slot.sink ? '수업이 끝나면 다음 일정에 맞춰 다시 이동할 거예요.' :
        '지금은 수업이 없는 시간이라 제 일정대로 움직이고 있어요.'];
  }
  if (period === 'lunch') return [
    `${label} 쪽에서 점심 시간을 보내고 있어요.`,
    slot.location.startsWith('life_back_market_') ? '수업 사이에 후문 쪽으로 잠깐 나온 거예요.' : '다음 일정 전까지 잠깐 쉬는 중이에요.'
  ];
  if (period === 'evening') return [
    `${label} 쪽으로 이동했어요.`,
    slot.location.startsWith('life_dorm_') ? '오늘 일정이 끝나서 생활관으로 돌아왔어요.' : '수업이 끝난 뒤 잠깐 시간을 보내고 있어요.'
  ];
  return [
    `오늘 첫 동선은 ${label} 쪽이에요.`,
    slot.location.startsWith('life_dorm_') ? '생활관에서 나갈 준비를 하고 있어요.' : '첫 일정에 맞춰 움직이고 있어요.'
  ];
}

const HUMANITIES_5 = Object.freeze({
  primary: Object.freeze([L.BUILDING_5]),
  shared: Object.freeze([L.ANNIVERSARY_60, L.JUNGSEOK]),
  scope: 'WEST_CENTRAL'
});
const NATURAL_5 = Object.freeze({
  primary: Object.freeze([L.BUILDING_5]),
  shared: Object.freeze([L.ANNIVERSARY_60, L.JUNGSEOK]),
  scope: 'WEST_CENTRAL'
});
const SOCIAL_9 = Object.freeze({
  primary: Object.freeze([L.BUILDING_9]),
  shared: Object.freeze([L.ANNIVERSARY_60, L.JUNGSEOK]),
  scope: 'CENTRAL'
});
const BUSINESS_6 = Object.freeze({
  primary: Object.freeze([L.BUILDING_6]),
  shared: Object.freeze([L.ANNIVERSARY_60, L.JUNGSEOK]),
  scope: 'CENTRAL'
});
const IT_HITECH = Object.freeze({
  primary: Object.freeze([L.HITECH]),
  shared: Object.freeze([L.BUILDING_4, L.ANNIVERSARY_60, L.JUNGSEOK]),
  scope: 'NORTH_EAST'
});
const ENGINEERING_24 = Object.freeze({
  primary: Object.freeze([L.BUILDING_2, L.BUILDING_4]),
  shared: Object.freeze([L.HITECH, L.ANNIVERSARY_60, L.JUNGSEOK]),
  scope: 'NORTH'
});
const DESIGN_5 = Object.freeze({
  primary: Object.freeze([L.BUILDING_5]),
  shared: Object.freeze([L.ANNIVERSARY_60, L.STUDENT_CENTER, L.JUNGSEOK]),
  scope: 'WEST_CENTRAL'
});
const EDUCATION_SEOHO = Object.freeze({
  primary: Object.freeze([L.SEOHO]),
  shared: Object.freeze([L.BUILDING_5, L.ANNIVERSARY_60, L.JUNGSEOK]),
  scope: 'WEST'
});
const LAW = Object.freeze({
  primary: Object.freeze([L.LAWSCHOOL]),
  shared: Object.freeze([L.ANNIVERSARY_60, L.JUNGSEOK]),
  scope: 'SOUTH_CENTRAL'
});

export const DEPARTMENT_CAMPUS_LIFE = Object.freeze({
  '국어국문학과': HUMANITIES_5,
  '사학과': HUMANITIES_5,
  '영어영문학과': HUMANITIES_5,
  '철학과': HUMANITIES_5,
  '문화콘텐츠문화경영학과': HUMANITIES_5,
  '문화콘텐츠학과': HUMANITIES_5,

  '물리학과': NATURAL_5,
  '화학과': NATURAL_5,
  '생명과학과': NATURAL_5,
  '수학과': NATURAL_5,

  '사회학과': SOCIAL_9,
  '행정학과': SOCIAL_9,
  '정치외교학과': SOCIAL_9,
  '미디어커뮤니케이션학과': SOCIAL_9,
  '아태물류학부': SOCIAL_9,

  '경영학과': BUSINESS_6,
  '경제학과': BUSINESS_6,
  '국제통상학과': BUSINESS_6,

  '컴퓨터공학과': IT_HITECH,
  '전기공학과': IT_HITECH,
  '전기전자공학부': IT_HITECH,
  '정보통신공학과': IT_HITECH,
  '인공지능공학과': Object.freeze({
    primary: Object.freeze([L.BUILDING_4, L.HITECH]),
    shared: Object.freeze([L.ANNIVERSARY_60, L.JUNGSEOK]),
    scope: 'NORTH_EAST'
  }),

  '기계공학과': ENGINEERING_24,
  '신소재공학과': ENGINEERING_24,
  '화학공학과': ENGINEERING_24,
  '항공우주공학과': ENGINEERING_24,
  '조선해양공학과': ENGINEERING_24,
  '공간정보공학과': ENGINEERING_24,
  '스마트모빌리티공학과': Object.freeze({
    primary: Object.freeze([L.HITECH, L.BUILDING_4]),
    shared: Object.freeze([L.ANNIVERSARY_60, L.JUNGSEOK]),
    scope: 'NORTH_EAST'
  }),

  '시각디자인학과': DESIGN_5,
  '산업디자인학과': DESIGN_5,
  '디자인테크놀로지학과': DESIGN_5,

  '교육학과': EDUCATION_SEOHO,
  '국어교육과': EDUCATION_SEOHO,
  '영어교육과': EDUCATION_SEOHO,
  '수학교육과': EDUCATION_SEOHO,

  '법학과': LAW
});

export const DEPARTMENT_TYPE_FALLBACK = Object.freeze({
  humanities: HUMANITIES_5,
  natural_sciences: NATURAL_5,
  social_sciences: SOCIAL_9,
  engineering: ENGINEERING_24,
  arts: DESIGN_5
});

export const NPC_LIFE_COMMON = Object.freeze({
  lunch: Object.freeze([
    L.STUDENT_CENTER,
    L.BACK_MARKET_67,
    L.BACK_MARKET_91,
    L.JUNGSEOK,
    L.BACK_MARKET_WEST
  ]),
  betweenClasses: Object.freeze([
    L.JUNGSEOK,
    L.STUDENT_CENTER,
    L.BACK_MARKET_67,
    L.BACK_MARKET_91,
    L.BACK_MARKET_NORTH
  ]),
  evening: Object.freeze([
    L.BACK_MARKET_67,
    L.BACK_MARKET_91,
    L.BACK_MARKET_WEST,
    L.STUDENT_CENTER
  ])
});

export function departmentCampusLifeFor(department, departmentType = null) {
  return DEPARTMENT_CAMPUS_LIFE[department] ?? DEPARTMENT_TYPE_FALLBACK[departmentType] ?? null;
}

const numericId = id => Number(String(id ?? '').slice(-3)) || 0;

export function residenceLocationFor(entry) {
  if (entry?.residence === 'dorm_1') return L.DORM_1;
  if (entry?.residence === 'dorm_2') return L.DORM_2;
  return null;
}

export function campusLifeScheduleFor(npc, rosterEntry) {
  const policy = departmentCampusLifeFor(rosterEntry?.department, rosterEntry?.department_type ?? npc?.identity?.department_type);
  if (!policy) return null;
  const n = numericId(npc?.npc_id);
  const residence = residenceLocationFor(rosterEntry);
  const primary = policy.primary[n % policy.primary.length];
  const shared = policy.shared[n % policy.shared.length];
  const sharedClass = policy.shared.filter(location => location.startsWith('class_'));
  const classLocation = n % 4 === 0 && sharedClass.length
    ? sharedClass[n % sharedClass.length]
    : primary;
  const choice = campusLifeSeed(npc, rosterEntry, 'activity-v3') % 20;
  const freeLocations = NPC_LIFE_COMMON.betweenClasses;
  const freeLocation = freeLocations[campusLifeSeed(npc, rosterEntry, 'free-place') % freeLocations.length];
  const classSlot = choice < 10
    ? { location: classLocation, activity: 'walk_to_class', sink: true, social_mode: 'low' }
    : choice < 12 ? { location: L.JUNGSEOK, activity: 'read', social_mode: 'low' }
    : choice < 14 ? { location: freeLocation === L.JUNGSEOK ? L.STUDENT_CENTER : freeLocation,
      activity: 'eat_snack', social_mode: 'medium' }
    : choice < 16 ? { location: L.STUDENT_CENTER, activity: 'walk_to_club', social_mode: 'high' }
    : choice < 18 ? { location: freeLocation, activity: 'use_phone', social_mode: 'medium' }
    : { location: freeLocation, activity: 'walk', social_mode: 'medium',
      walkLocation: freeLocations[(freeLocations.indexOf(freeLocation) + 1) % freeLocations.length] };
  const lunchPool = NPC_LIFE_COMMON.lunch;
  const eveningPool = NPC_LIFE_COMMON.evening;
  const lunch = residence && n % 5 === 0 ? residence : lunchPool[n % lunchPool.length];
  const evening = residence ?? eveningPool[n % eveningPool.length];
  // Dorm residents no longer all idle at the residence entrance for the whole morning band.
  // Even-numbered NPCs wait near the dorm while odd-numbered NPCs have already departed
  // toward their primary teaching area. This deterministic split keeps reconnect/replay stable
  // while avoiding a single synchronized residence crowd.
  const morningAtResidence = Boolean(residence) && n % 2 === 0;
  const morningLocation = morningAtResidence ? residence : primary;
  return Object.freeze({
    movementScope: policy.scope,
    primaryClassLocation: primary,
    sharedClassLocation: shared,
    residenceLocation: residence,
    schedule: Object.freeze({
      morning: Object.freeze({
        location: morningLocation,
        activity: morningAtResidence ? 'wait' : 'walk_to_class',
        social_mode: 'low'
      }),
      class_time: Object.freeze({ ...classSlot,
        departureSeconds: 15 + campusLifeSeed(npc, rosterEntry, 'class-departure') % 151 }),
      lunch: Object.freeze({
        location: lunch,
        activity: lunch === L.JUNGSEOK ? 'read' : lunch === residence ? 'wait' : 'walk',
        social_mode: lunch === L.JUNGSEOK || lunch === residence ? 'low' : 'medium'
      }),
      evening: Object.freeze({
        location: evening,
        activity: residence ? 'wait' : 'walk',
        social_mode: residence ? 'low' : 'medium'
      })
    })
  });
}

export function applyCampusLifeSchedule(batch, roster) {
  const rosterById = new Map((roster?.npcs ?? []).map(entry => [entry.npc_id, entry]));
  return {
    ...batch,
    npcs: batch.npcs.map(npc => {
      if (protectedIds.has(npc.npc_id)) return npc;
      const entry = rosterById.get(npc.npc_id);
      const life = campusLifeScheduleFor(npc, entry);
      if (!life) return npc;
      const schedule = { ...npc.schedule, ...life.schedule };
      return {
        ...npc,
        schedule,
        dialogue_hooks: {
          ...npc.dialogue_hooks,
          ...Object.fromEntries(Object.entries(life.schedule).map(([period, slot]) => [period, dialogueFor(period, slot)]))
        }
      };
    })
  };
}
