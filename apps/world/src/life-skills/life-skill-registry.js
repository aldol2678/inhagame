// INHA WORLD P0 Life Skill pure Registry.
// Product-semantic canon only. Player XP/Level state remains server-authoritative.

export const LIFE_SKILL_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  COMING_SOON: 'COMING_SOON',
  DISABLED: 'DISABLED',
  HIDDEN: 'HIDDEN'
});

export const LIFE_SKILL_ID_PATTERN = /^life\.[a-z][a-z0-9_]*$/;
export const LIFE_SKILL_CURVE_ID_PATTERN = /^life\.[a-z][a-z0-9_]*\.v[0-9]+$/;
export const LIFE_SKILL_AVAILABILITY_REF_PATTERN =
  /^availability\.[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){0,3}$/;

const statuses = new Set(Object.values(LIFE_SKILL_STATUS));

export function createLifeSkillDefinition(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Life Skill definition must be an object');
  }
  if (typeof raw.skillId !== 'string' || !LIFE_SKILL_ID_PATTERN.test(raw.skillId) || raw.skillId.length > 80) {
    throw new TypeError('Invalid skillId');
  }
  if (typeof raw.displayName !== 'string' || !raw.displayName.trim()) {
    throw new TypeError(`Invalid displayName for ${raw.skillId}`);
  }
  if (typeof raw.description !== 'string' || !raw.description.trim()) {
    throw new TypeError(`Invalid description for ${raw.skillId}`);
  }
  if (typeof raw.category !== 'string' || !/^[A-Z][A-Z0-9_]{1,31}$/.test(raw.category)) {
    throw new TypeError(`Invalid category for ${raw.skillId}`);
  }
  if (typeof raw.curveId !== 'string' || !LIFE_SKILL_CURVE_ID_PATTERN.test(raw.curveId) || raw.curveId.length > 80) {
    throw new TypeError(`Invalid curveId for ${raw.skillId}`);
  }
  if (typeof raw.availabilityRef !== 'string' ||
      !LIFE_SKILL_AVAILABILITY_REF_PATTERN.test(raw.availabilityRef) ||
      raw.availabilityRef.length > 120) {
    throw new TypeError(`Invalid availabilityRef for ${raw.skillId}`);
  }
  if (!statuses.has(raw.status)) throw new TypeError(`Invalid status for ${raw.skillId}`);
  if (!Array.isArray(raw.tags) || raw.tags.some(tag =>
    typeof tag !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(tag))) {
    throw new TypeError(`Invalid tags for ${raw.skillId}`);
  }
  if (typeof raw.introducedVersion !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,31}$/.test(raw.introducedVersion)) {
    throw new TypeError(`Invalid introducedVersion for ${raw.skillId}`);
  }

  return Object.freeze({
    skillId: raw.skillId,
    displayName: raw.displayName.trim(),
    description: raw.description.trim(),
    category: raw.category,
    curveId: raw.curveId,
    availabilityRef: raw.availabilityRef,
    status: raw.status,
    tags: Object.freeze([...raw.tags]),
    introducedVersion: raw.introducedVersion,
    iconRef: raw.iconRef ?? null,
    shortLabel: raw.shortLabel ?? raw.displayName.trim()
  });
}

const common = ({ skillId, displayName, description, category, tags, availabilityRef }) =>
  createLifeSkillDefinition({
    skillId,
    displayName,
    description,
    category,
    curveId: 'life.common.v1',
    availabilityRef,
    status: LIFE_SKILL_STATUS.COMING_SOON,
    tags,
    introducedVersion: 'life.m5'
  });

export const DEFAULT_LIFE_SKILL_DEFINITIONS = Object.freeze({
  FISHING: common({
    skillId: 'life.fishing',
    displayName: '낚시',
    description: '낚시 활동의 검증된 결과로 성장하는 생활 숙련도.',
    category: 'HARVEST',
    tags: ['life','fishing','p1a'],
    availabilityRef: 'availability.life.fishing'
  }),
  GATHERING: common({
    skillId: 'life.gathering',
    displayName: '채집',
    description: '비파괴 자연 소재 채집 결과로 성장하는 생활 숙련도.',
    category: 'HARVEST',
    tags: ['life','gathering','p1a'],
    availabilityRef: 'availability.life.gathering'
  }),
  ARCHAEOLOGY: common({
    skillId: 'life.archaeology',
    displayName: '고고학',
    description: '조사와 발굴의 검증된 결과로 성장하는 생활 숙련도.',
    category: 'EXPLORATION',
    tags: ['life','archaeology','p1a'],
    availabilityRef: 'availability.life.archaeology'
  }),
  WOODCUTTING: common({
    skillId: 'life.woodcutting',
    displayName: '벌목',
    description: '목재 채취 결과로 성장하는 생활 숙련도.',
    category: 'HARVEST',
    tags: ['life','woodcutting','p1b'],
    availabilityRef: 'availability.life.woodcutting'
  }),
  MINING: common({
    skillId: 'life.mining',
    displayName: '채광',
    description: '암석·광맥 채취 결과로 성장하는 생활 숙련도.',
    category: 'HARVEST',
    tags: ['life','mining','p1b'],
    availabilityRef: 'availability.life.mining'
  }),
  WOODWORKING: common({
    skillId: 'life.woodworking',
    displayName: '목공',
    description: '목재 가공과 가구 제작으로 성장하는 생산 숙련도.',
    category: 'PRODUCTION',
    tags: ['life','woodworking'],
    availabilityRef: 'availability.life.woodworking'
  }),
  COOKING: common({
    skillId: 'life.cooking',
    displayName: '요리',
    description: '검증된 요리 제작 결과로 성장하는 생산 숙련도.',
    category: 'PRODUCTION',
    tags: ['life','cooking'],
    availabilityRef: 'availability.life.cooking'
  }),
  CRAFTING: common({
    skillId: 'life.crafting',
    displayName: '제작',
    description: '일반 제작과 가공 결과로 성장하는 생산 숙련도.',
    category: 'PRODUCTION',
    tags: ['life','crafting'],
    availabilityRef: 'availability.life.crafting'
  }),
  FARMING: common({
    skillId: 'life.farming',
    displayName: '재배',
    description: '캠퍼스 내 허용된 재배 활동 결과로 성장하는 생활 숙련도.',
    category: 'PRODUCTION',
    tags: ['life','farming'],
    availabilityRef: 'availability.life.farming'
  }),
  PHOTOGRAPHY: common({
    skillId: 'life.photography',
    displayName: '사진',
    description: '검증된 사진 챌린지와 기록 활동으로 성장하는 관찰 숙련도.',
    category: 'OBSERVATION',
    tags: ['life','photography'],
    availabilityRef: 'availability.life.photography'
  }),
  RESEARCH: common({
    skillId: 'life.research',
    displayName: '연구',
    description: '검증된 조사·분석·복원 결과로 성장하는 연구 숙련도.',
    category: 'RESEARCH',
    tags: ['life','research'],
    availabilityRef: 'availability.life.research'
  }),
  SAILING: common({
    skillId: 'life.sailing',
    displayName: '항해',
    description: '선박 운용과 수상·원양 이동의 검증된 결과로 성장하는 탐험 숙련도.',
    category: 'EXPLORATION',
    tags: ['life','sailing'],
    availabilityRef: 'availability.life.sailing'
  })
});

export function createLifeSkillRegistry({ definitions = Object.values(DEFAULT_LIFE_SKILL_DEFINITIONS) } = {}) {
  const byId = new Map();
  for (const raw of definitions) {
    const skill = createLifeSkillDefinition(raw);
    if (byId.has(skill.skillId)) throw new Error(`Duplicate skillId: ${skill.skillId}`);
    byId.set(skill.skillId, skill);
  }
  return Object.freeze({
    get: skillId => byId.get(skillId) ?? null,
    has: skillId => byId.has(skillId),
    list: () => Object.freeze([...byId.values()]),
    get size() { return byId.size; }
  });
}

export const LIFE_SKILL_REGISTRY = createLifeSkillRegistry();

export function lifeSkillAuthorityRow(definition) {
  if (!definition) throw new TypeError('Life Skill definition is required');
  return Object.freeze({
    skill_id: definition.skillId,
    curve_id: definition.curveId,
    status: definition.status
  });
}

export function lifeSkillFreshSnapshot(definition) {
  if (!definition) throw new TypeError('Life Skill definition is required');
  return Object.freeze({
    skillId: definition.skillId,
    curveId: definition.curveId,
    status: definition.status,
    totalXp: 0,
    level: 1,
    version: 0
  });
}
