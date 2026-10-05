import { EVENT_ID } from "../event-registry.js";

export const MCM_2026_EVENT_ID = EVENT_ID.MCM_2026;

export const MCM_2026_NPC_IDS = Object.freeze({
  GUIDE: "ZUE-900",
  STAGGERING: "ZUE-901",
  DANCING: "ZUE-902",
  HUNGRY: "ZUE-903"
});

export const MCM_2026_INVESTIGATION_ACTIONS = Object.freeze({
  [MCM_2026_NPC_IDS.STAGGERING]: "investigate_staggering",
  [MCM_2026_NPC_IDS.DANCING]: "investigate_dancing",
  [MCM_2026_NPC_IDS.HUNGRY]: "investigate_hungry"
});

export const MCM_2026_INVESTIGATION_KEYS = Object.freeze({
  [MCM_2026_NPC_IDS.STAGGERING]: "staggering",
  [MCM_2026_NPC_IDS.DANCING]: "dancing",
  [MCM_2026_NPC_IDS.HUNGRY]: "hungry"
});

export const MCM_2026_EVENT = Object.freeze({
  id: MCM_2026_EVENT_ID,
  title: "좀비대학교",
  subtitle: "ep1. 문콘경 좀비사태 in 건물주",
  organizer: "제8대 문화콘텐츠문화경영학과 학생회",
  locationLabel: "인하대 후문 · 건물주",
  externalUrl: "https://www.instagram.com/inha_ccm/",
  programs: Object.freeze([
    "19:00 메빨먹🗡️ · 메딕의 맥주 빨리 먹기",
    "21:00 주인님, 제가 진짜 소주예요🦌🐰",
    "23:00 치어리더의 댄스 타임🕺",
    "상시 · 백어택커🗡️와 참참참",
    "상시 · 좀비와 말싸움 대결🧟",
    "상시 · 좀비를 피해서 인간을 찾아라!🧟👩🧟"
  ])
});

export const MCM_2026_PROGRESS_STAGE = Object.freeze({
  NOT_STARTED: "NOT_STARTED",
  STARTED: "STARTED",
  VENUE_UNLOCKED: "VENUE_UNLOCKED",
  COMPLETED: "COMPLETED"
});

export const MCM_2026_EVENT_STATE = Object.freeze({
  DISABLED: "DISABLED",
  SCHEDULED: "SCHEDULED",
  ACTIVE: "ACTIVE",
  ENDED: "ENDED"
});

// PRELUDE / WARNING atmosphere lines (keys are MCM_2026_PHASE values). They never advance progress.
export const MCM_2026_TEASER_LINES = Object.freeze({
  PRELUDE: Object.freeze({
    [MCM_2026_NPC_IDS.GUIDE]: "요즘 문화의거리 쪽에서 이상한 학생들이 보인다는 소문이 돌아요. 9월 30일 00:00에 정식 조사를 시작해요.",
    [MCM_2026_NPC_IDS.STAGGERING]: "으으... 아무 일도... 없어... 그냥 좀 어지러울 뿐이야...",
    [MCM_2026_NPC_IDS.DANCING]: "리허설... 리허설 중이야... 신경 쓰지 마...",
    [MCM_2026_NPC_IDS.HUNGRY]: "배가... 조금 고픈 것 같기도 하고... 아닌 것 같기도 하고..."
  }),
  WARNING: Object.freeze({
    [MCM_2026_NPC_IDS.GUIDE]: "이상징후가 점점 심해지고 있어요. 오늘 00:00 조사 개시! 그때 저에게 다시 말을 걸어 주세요.",
    [MCM_2026_NPC_IDS.STAGGERING]: "자정... 자정이 되면... 으으... 길이 벌써 두 개로 보여...",
    [MCM_2026_NPC_IDS.DANCING]: "몸이 자꾸 움직여... 자정까지만... 참아야 해...",
    [MCM_2026_NPC_IDS.HUNGRY]: "냄새가 나... 오늘 자정이면... 식량이..."
  })
});
