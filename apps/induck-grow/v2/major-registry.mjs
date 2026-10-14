// INDUCK-GROW-V2-FOUNDATION-01: isolated design registry; NO v1 imports or runtime wiring.
// Display names are provisional game catalog labels, not an official 2026 curriculum reproduction.
export const CATALOG_VERSION = 'grow2-major-registry-0.1';
export const MAJOR_FAMILIES = Object.freeze(['engineering','software','natural','medical','business','social','humanities','arts']);
export const LEGACY_MAJOR_IDS = Object.freeze(['culture','cse','aero','apsl','nursing','theatre']);
export const FOUNDATION_MAJOR_IDS = Object.freeze(['culture','cse','aero','apsl','nursing','theatre','mech','ai','life','business','media','design']);
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
const CATALOG_DATA = [
  {
    "id": "mech",
    "displayName": "기계공학과",
    "family": "engineering",
    "wave": 1,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [
      "grow2.course.mech.foundation",
      "grow2.course.mech.practice"
    ],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.mech",
      "label": "프로토타입 조립"
    },
    "assessmentProfileId": "grow2.assessment.engineering",
    "eventPackIds": [
      "grow2.event.mech.signature"
    ],
    "careerTrackIds": [
      "grow2.career.mech.general"
    ],
    "worldMemoryTagIds": [
      "location.exhibition"
    ],
    "playability": "foundation",
    "signatureEvent": {
      "id": "grow2.event.mech.signature",
      "year": 1,
      "term": 1,
      "weekWindow": [
        4,
        12
      ],
      "guaranteed": true,
      "title": "시제품 구동 테스트",
      "choices": [
        {
          "id": "grow2.choice.mech.1",
          "label": "성능을 끌어올린다",
          "effects": {
            "competency": "execution",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.mech.1",
          "memoryTag": "grow2.memory.mech.1",
          "memoryText": "기계 제작: 성능을 끌어올린다"
        },
        {
          "id": "grow2.choice.mech.2",
          "label": "신뢰성을 높인다",
          "effects": {
            "competency": "analysis",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.mech.2",
          "memoryTag": "grow2.memory.mech.2",
          "memoryText": "기계 제작: 신뢰성을 높인다"
        },
        {
          "id": "grow2.choice.mech.3",
          "label": "제작비를 낮춘다",
          "effects": {
            "competency": "creative",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.mech.3",
          "memoryTag": "grow2.memory.mech.3",
          "memoryText": "기계 제작: 제작비를 낮춘다"
        }
      ]
    }
  },
  {
    "id": "aero",
    "displayName": "항공우주공학과",
    "family": "engineering",
    "wave": 1,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [
      "grow2.course.aero.foundation",
      "grow2.course.aero.practice"
    ],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.aero",
      "label": "설계 검증"
    },
    "assessmentProfileId": "grow2.assessment.engineering",
    "eventPackIds": [
      "grow2.event.aero.signature"
    ],
    "careerTrackIds": [
      "grow2.career.aero.general"
    ],
    "worldMemoryTagIds": [
      "location.exhibition"
    ],
    "playability": "foundation",
    "signatureEvent": {
      "id": "grow2.event.aero.signature",
      "year": 1,
      "term": 1,
      "weekWindow": [
        4,
        12
      ],
      "guaranteed": true,
      "title": "비행체 설계 체험",
      "choices": [
        {
          "id": "grow2.choice.aero.1",
          "label": "안정성 우선",
          "effects": {
            "competency": "analysis",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.aero.1",
          "memoryTag": "grow2.memory.aero.1",
          "memoryText": "비행체 설계: 안정성 우선"
        },
        {
          "id": "grow2.choice.aero.2",
          "label": "속도 우선",
          "effects": {
            "competency": "execution",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.aero.2",
          "memoryTag": "grow2.memory.aero.2",
          "memoryText": "비행체 설계: 속도 우선"
        },
        {
          "id": "grow2.choice.aero.3",
          "label": "효율 우선",
          "effects": {
            "competency": "creative",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.aero.3",
          "memoryTag": "grow2.memory.aero.3",
          "memoryText": "비행체 설계: 효율 우선"
        }
      ]
    }
  },
  {
    "id": "naval",
    "displayName": "조선해양공학과",
    "family": "engineering",
    "wave": 2,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.naval",
      "label": "선체 안정성 설계"
    },
    "assessmentProfileId": "grow2.assessment.engineering",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.naval.general"
    ],
    "worldMemoryTagIds": [
      "location.lake"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "ie",
    "displayName": "산업경영공학과",
    "family": "engineering",
    "wave": 2,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.ie",
      "label": "공정 개선 실험"
    },
    "assessmentProfileId": "grow2.assessment.engineering",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.ie.general"
    ],
    "worldMemoryTagIds": [
      "location.shop"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "ece",
    "displayName": "전기전자공학부",
    "family": "engineering",
    "wave": 2,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.ece",
      "label": "회로 검증"
    },
    "assessmentProfileId": "grow2.assessment.engineering",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.ece.general"
    ],
    "worldMemoryTagIds": [
      "location.exhibition"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "civil",
    "displayName": "사회인프라공학과",
    "family": "engineering",
    "wave": 3,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.civil",
      "label": "구조 안전 검토"
    },
    "assessmentProfileId": "grow2.assessment.engineering",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.civil.general"
    ],
    "worldMemoryTagIds": [
      "location.campus"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "cse",
    "displayName": "컴퓨터공학과",
    "family": "software",
    "wave": 1,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [
      "grow2.course.cse.foundation",
      "grow2.course.cse.practice"
    ],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.cse",
      "label": "디버깅 랩"
    },
    "assessmentProfileId": "grow2.assessment.software",
    "eventPackIds": [
      "grow2.event.cse.signature"
    ],
    "careerTrackIds": [
      "grow2.career.cse.general"
    ],
    "worldMemoryTagIds": [
      "location.club"
    ],
    "playability": "foundation",
    "signatureEvent": {
      "id": "grow2.event.cse.signature",
      "year": 1,
      "term": 1,
      "weekWindow": [
        4,
        12
      ],
      "guaranteed": true,
      "title": "미니 해커톤",
      "choices": [
        {
          "id": "grow2.choice.cse.1",
          "label": "기능 완성을 택한다",
          "effects": {
            "competency": "execution",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.cse.1",
          "memoryTag": "grow2.memory.cse.1",
          "memoryText": "해커톤: 기능 완성을 택한다"
        },
        {
          "id": "grow2.choice.cse.2",
          "label": "완성도를 높인다",
          "effects": {
            "competency": "analysis",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.cse.2",
          "memoryTag": "grow2.memory.cse.2",
          "memoryText": "해커톤: 완성도를 높인다"
        },
        {
          "id": "grow2.choice.cse.3",
          "label": "팀 빌딩에 집중한다",
          "effects": {
            "competency": "collaboration",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.cse.3",
          "memoryTag": "grow2.memory.cse.3",
          "memoryText": "해커톤: 팀 빌딩에 집중한다"
        }
      ]
    }
  },
  {
    "id": "ai",
    "displayName": "인공지능공학과",
    "family": "software",
    "wave": 1,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [
      "grow2.course.ai.foundation",
      "grow2.course.ai.practice"
    ],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.ai",
      "label": "모델 평가·오류 분석"
    },
    "assessmentProfileId": "grow2.assessment.software",
    "eventPackIds": [
      "grow2.event.ai.signature"
    ],
    "careerTrackIds": [
      "grow2.career.ai.general"
    ],
    "worldMemoryTagIds": [
      "location.exhibition"
    ],
    "playability": "foundation",
    "signatureEvent": {
      "id": "grow2.event.ai.signature",
      "year": 1,
      "term": 1,
      "weekWindow": [
        4,
        12
      ],
      "guaranteed": true,
      "title": "학습 데이터 편향 발견",
      "choices": [
        {
          "id": "grow2.choice.ai.1",
          "label": "정확도 개선",
          "effects": {
            "competency": "analysis",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.ai.1",
          "memoryTag": "grow2.memory.ai.1",
          "memoryText": "AI 연구: 정확도 개선"
        },
        {
          "id": "grow2.choice.ai.2",
          "label": "공정성 점검",
          "effects": {
            "competency": "collaboration",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.ai.2",
          "memoryTag": "grow2.memory.ai.2",
          "memoryText": "AI 연구: 공정성 점검"
        },
        {
          "id": "grow2.choice.ai.3",
          "label": "설명 가능성 검증",
          "effects": {
            "competency": "expression",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.ai.3",
          "memoryTag": "grow2.memory.ai.3",
          "memoryText": "AI 연구: 설명 가능성 검증"
        }
      ]
    }
  },
  {
    "id": "data",
    "displayName": "데이터사이언스학과",
    "family": "software",
    "wave": 2,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.data",
      "label": "가설 검증 분석"
    },
    "assessmentProfileId": "grow2.assessment.software",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.data.general"
    ],
    "worldMemoryTagIds": [
      "location.library"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "mobility",
    "displayName": "스마트모빌리티공학과",
    "family": "software",
    "wave": 3,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.mobility",
      "label": "자율주행 테스트"
    },
    "assessmentProfileId": "grow2.assessment.software",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.mobility.general"
    ],
    "worldMemoryTagIds": [
      "location.campus"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "semicon",
    "displayName": "반도체시스템공학과",
    "family": "software",
    "wave": 3,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.semicon",
      "label": "칩 회로 검증"
    },
    "assessmentProfileId": "grow2.assessment.software",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.semicon.general"
    ],
    "worldMemoryTagIds": [
      "location.exhibition"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "battery",
    "displayName": "이차전지융합학과",
    "family": "software",
    "wave": 3,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.battery",
      "label": "전지 소재 평가"
    },
    "assessmentProfileId": "grow2.assessment.software",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.battery.general"
    ],
    "worldMemoryTagIds": [
      "location.exhibition"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "math",
    "displayName": "수학과",
    "family": "natural",
    "wave": 2,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.math",
      "label": "증명 검토"
    },
    "assessmentProfileId": "grow2.assessment.natural",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.math.general"
    ],
    "worldMemoryTagIds": [
      "location.library"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "stats",
    "displayName": "통계학과",
    "family": "natural",
    "wave": 2,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.stats",
      "label": "표본 설계"
    },
    "assessmentProfileId": "grow2.assessment.natural",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.stats.general"
    ],
    "worldMemoryTagIds": [
      "location.library"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "physics",
    "displayName": "물리학과",
    "family": "natural",
    "wave": 3,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.physics",
      "label": "실험 오차 해석"
    },
    "assessmentProfileId": "grow2.assessment.natural",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.physics.general"
    ],
    "worldMemoryTagIds": [
      "location.library"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "life",
    "displayName": "생명과학과",
    "family": "natural",
    "wave": 1,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [
      "grow2.course.life.foundation",
      "grow2.course.life.practice"
    ],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.life",
      "label": "실험 가설 검증"
    },
    "assessmentProfileId": "grow2.assessment.natural",
    "eventPackIds": [
      "grow2.event.life.signature"
    ],
    "careerTrackIds": [
      "grow2.career.life.general"
    ],
    "worldMemoryTagIds": [
      "location.exhibition"
    ],
    "playability": "foundation",
    "signatureEvent": {
      "id": "grow2.event.life.signature",
      "year": 1,
      "term": 1,
      "weekWindow": [
        4,
        12
      ],
      "guaranteed": true,
      "title": "예상 밖의 실험 결과",
      "choices": [
        {
          "id": "grow2.choice.life.1",
          "label": "재실험한다",
          "effects": {
            "competency": "analysis",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.life.1",
          "memoryTag": "grow2.memory.life.1",
          "memoryText": "생명과학 실험: 재실험한다"
        },
        {
          "id": "grow2.choice.life.2",
          "label": "가설을 수정한다",
          "effects": {
            "competency": "creative",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.life.2",
          "memoryTag": "grow2.memory.life.2",
          "memoryText": "생명과학 실험: 가설을 수정한다"
        },
        {
          "id": "grow2.choice.life.3",
          "label": "결과를 투명하게 보고한다",
          "effects": {
            "competency": "expression",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.life.3",
          "memoryTag": "grow2.memory.life.3",
          "memoryText": "생명과학 실험: 결과를 투명하게 보고한다"
        }
      ]
    }
  },
  {
    "id": "nutrition",
    "displayName": "식품영양학과",
    "family": "natural",
    "wave": 2,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.nutrition",
      "label": "급식 영양 설계"
    },
    "assessmentProfileId": "grow2.assessment.natural",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.nutrition.general"
    ],
    "worldMemoryTagIds": [
      "location.cafeteria"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "nursing",
    "displayName": "간호학과",
    "family": "medical",
    "wave": 1,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [
      "grow2.course.nursing.foundation",
      "grow2.course.nursing.practice"
    ],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.nursing",
      "label": "기초개념 체크"
    },
    "assessmentProfileId": "grow2.assessment.medical",
    "eventPackIds": [
      "grow2.event.nursing.signature"
    ],
    "careerTrackIds": [
      "grow2.career.nursing.general"
    ],
    "worldMemoryTagIds": [
      "location.library"
    ],
    "playability": "foundation",
    "signatureEvent": {
      "id": "grow2.event.nursing.signature",
      "year": 1,
      "term": 1,
      "weekWindow": [
        4,
        12
      ],
      "guaranteed": true,
      "title": "간호 상황 시뮬레이션",
      "choices": [
        {
          "id": "grow2.choice.nursing.1",
          "label": "절차 먼저 확인",
          "effects": {
            "competency": "analysis",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.nursing.1",
          "memoryTag": "grow2.memory.nursing.1",
          "memoryText": "간호 기초: 절차 먼저 확인"
        },
        {
          "id": "grow2.choice.nursing.2",
          "label": "대상자에게 설명",
          "effects": {
            "competency": "expression",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.nursing.2",
          "memoryTag": "grow2.memory.nursing.2",
          "memoryText": "간호 기초: 대상자에게 설명"
        },
        {
          "id": "grow2.choice.nursing.3",
          "label": "팀 역할 확인",
          "effects": {
            "competency": "collaboration",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.nursing.3",
          "memoryTag": "grow2.memory.nursing.3",
          "memoryText": "간호 기초: 팀 역할 확인"
        }
      ]
    }
  },
  {
    "id": "premed",
    "displayName": "의예과",
    "family": "medical",
    "wave": 3,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "six_year_professional",
    "majorAction": {
      "id": "grow2.action.premed",
      "label": "의학 기초 개념 연결"
    },
    "assessmentProfileId": "grow2.assessment.medical",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.premed.general"
    ],
    "worldMemoryTagIds": [
      "location.library"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "biopharma",
    "displayName": "첨단바이오의약학과",
    "family": "medical",
    "wave": 3,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.biopharma",
      "label": "바이오 실험 설계"
    },
    "assessmentProfileId": "grow2.assessment.medical",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.biopharma.general"
    ],
    "worldMemoryTagIds": [
      "location.exhibition"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "business",
    "displayName": "경영학부",
    "family": "business",
    "wave": 1,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [
      "grow2.course.business.foundation",
      "grow2.course.business.practice"
    ],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.business",
      "label": "창업 시장 검증"
    },
    "assessmentProfileId": "grow2.assessment.business",
    "eventPackIds": [
      "grow2.event.business.signature"
    ],
    "careerTrackIds": [
      "grow2.career.business.general"
    ],
    "worldMemoryTagIds": [
      "location.festival"
    ],
    "playability": "foundation",
    "signatureEvent": {
      "id": "grow2.event.business.signature",
      "year": 1,
      "term": 1,
      "weekWindow": [
        4,
        12
      ],
      "guaranteed": true,
      "title": "축제 부스 손익 위기",
      "choices": [
        {
          "id": "grow2.choice.business.1",
          "label": "마진에 집중",
          "effects": {
            "competency": "analysis",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.business.1",
          "memoryTag": "grow2.memory.business.1",
          "memoryText": "축제 창업: 마진에 집중"
        },
        {
          "id": "grow2.choice.business.2",
          "label": "손님 경험에 투자",
          "effects": {
            "competency": "expression",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.business.2",
          "memoryTag": "grow2.memory.business.2",
          "memoryText": "축제 창업: 손님 경험에 투자"
        },
        {
          "id": "grow2.choice.business.3",
          "label": "재고 운영을 개선",
          "effects": {
            "competency": "execution",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.business.3",
          "memoryTag": "grow2.memory.business.3",
          "memoryText": "축제 창업: 재고 운영을 개선"
        }
      ]
    }
  },
  {
    "id": "apsl",
    "displayName": "아태물류학부",
    "family": "business",
    "wave": 1,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [
      "grow2.course.apsl.foundation",
      "grow2.course.apsl.practice"
    ],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.apsl",
      "label": "최적화 케이스"
    },
    "assessmentProfileId": "grow2.assessment.business",
    "eventPackIds": [
      "grow2.event.apsl.signature"
    ],
    "careerTrackIds": [
      "grow2.career.apsl.general"
    ],
    "worldMemoryTagIds": [
      "location.shop"
    ],
    "playability": "foundation",
    "signatureEvent": {
      "id": "grow2.event.apsl.signature",
      "year": 1,
      "term": 1,
      "weekWindow": [
        4,
        12
      ],
      "guaranteed": true,
      "title": "공급망 의사결정 챌린지",
      "choices": [
        {
          "id": "grow2.choice.apsl.1",
          "label": "비용 최소화",
          "effects": {
            "competency": "analysis",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.apsl.1",
          "memoryTag": "grow2.memory.apsl.1",
          "memoryText": "공급망: 비용 최소화"
        },
        {
          "id": "grow2.choice.apsl.2",
          "label": "납기 우선",
          "effects": {
            "competency": "execution",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.apsl.2",
          "memoryTag": "grow2.memory.apsl.2",
          "memoryText": "공급망: 납기 우선"
        },
        {
          "id": "grow2.choice.apsl.3",
          "label": "위험 분산",
          "effects": {
            "competency": "collaboration",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.apsl.3",
          "memoryTag": "grow2.memory.apsl.3",
          "memoryText": "공급망: 위험 분산"
        }
      ]
    }
  },
  {
    "id": "trade",
    "displayName": "국제통상학과",
    "family": "business",
    "wave": 2,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.trade",
      "label": "협상 조건 분석"
    },
    "assessmentProfileId": "grow2.assessment.business",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.trade.general"
    ],
    "worldMemoryTagIds": [
      "location.festival"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "econ",
    "displayName": "경제학과",
    "family": "business",
    "wave": 3,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.econ",
      "label": "경제 현상 모형화"
    },
    "assessmentProfileId": "grow2.assessment.business",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.econ.general"
    ],
    "worldMemoryTagIds": [
      "location.shop"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "media",
    "displayName": "미디어커뮤니케이션학과",
    "family": "social",
    "wave": 1,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [
      "grow2.course.media.foundation",
      "grow2.course.media.practice"
    ],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.media",
      "label": "취재·팩트체크"
    },
    "assessmentProfileId": "grow2.assessment.social",
    "eventPackIds": [
      "grow2.event.media.signature"
    ],
    "careerTrackIds": [
      "grow2.career.media.general"
    ],
    "worldMemoryTagIds": [
      "location.festival"
    ],
    "playability": "foundation",
    "signatureEvent": {
      "id": "grow2.event.media.signature",
      "year": 1,
      "term": 1,
      "weekWindow": [
        4,
        12
      ],
      "guaranteed": true,
      "title": "취재 제보의 진위",
      "choices": [
        {
          "id": "grow2.choice.media.1",
          "label": "바로 발표한다",
          "effects": {
            "competency": "expression",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.media.1",
          "memoryTag": "grow2.memory.media.1",
          "memoryText": "취재: 바로 발표한다"
        },
        {
          "id": "grow2.choice.media.2",
          "label": "사실을 추가 검증한다",
          "effects": {
            "competency": "analysis",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.media.2",
          "memoryTag": "grow2.memory.media.2",
          "memoryText": "취재: 사실을 추가 검증한다"
        },
        {
          "id": "grow2.choice.media.3",
          "label": "사생활을 보호한다",
          "effects": {
            "competency": "collaboration",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.media.3",
          "memoryTag": "grow2.memory.media.3",
          "memoryText": "취재: 사생활을 보호한다"
        }
      ]
    }
  },
  {
    "id": "childpsych",
    "displayName": "아동심리학과",
    "family": "social",
    "wave": 2,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.childpsych",
      "label": "관찰 설계"
    },
    "assessmentProfileId": "grow2.assessment.social",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.childpsych.general"
    ],
    "worldMemoryTagIds": [
      "location.library"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "socialwork",
    "displayName": "사회복지학과",
    "family": "social",
    "wave": 3,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.socialwork",
      "label": "복지 프로그램 기획"
    },
    "assessmentProfileId": "grow2.assessment.social",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.socialwork.general"
    ],
    "worldMemoryTagIds": [
      "location.festival"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "koredu",
    "displayName": "국어교육과",
    "family": "social",
    "wave": 3,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.koredu",
      "label": "수업안 설계"
    },
    "assessmentProfileId": "grow2.assessment.social",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.koredu.general"
    ],
    "worldMemoryTagIds": [
      "location.library"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "culture",
    "displayName": "문화콘텐츠문화경영학과",
    "family": "humanities",
    "wave": 1,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [
      "grow2.course.culture.foundation",
      "grow2.course.culture.practice"
    ],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.culture",
      "label": "콘텐츠 스프린트"
    },
    "assessmentProfileId": "grow2.assessment.humanities",
    "eventPackIds": [
      "grow2.event.culture.signature"
    ],
    "careerTrackIds": [
      "grow2.career.culture.general"
    ],
    "worldMemoryTagIds": [
      "location.festival"
    ],
    "playability": "foundation",
    "signatureEvent": {
      "id": "grow2.event.culture.signature",
      "year": 1,
      "term": 1,
      "weekWindow": [
        4,
        12
      ],
      "guaranteed": true,
      "title": "콘텐츠 기획 피치",
      "choices": [
        {
          "id": "grow2.choice.culture.1",
          "label": "대중성에 집중",
          "effects": {
            "competency": "creative",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.culture.1",
          "memoryTag": "grow2.memory.culture.1",
          "memoryText": "콘텐츠 기획: 대중성에 집중"
        },
        {
          "id": "grow2.choice.culture.2",
          "label": "실험성을 높인다",
          "effects": {
            "competency": "expression",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.culture.2",
          "memoryTag": "grow2.memory.culture.2",
          "memoryText": "콘텐츠 기획: 실험성을 높인다"
        },
        {
          "id": "grow2.choice.culture.3",
          "label": "데이터 근거를 강화한다",
          "effects": {
            "competency": "analysis",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.culture.3",
          "memoryTag": "grow2.memory.culture.3",
          "memoryText": "콘텐츠 기획: 데이터 근거를 강화한다"
        }
      ]
    }
  },
  {
    "id": "history",
    "displayName": "사학과",
    "family": "humanities",
    "wave": 2,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.history",
      "label": "사료 비교 비평"
    },
    "assessmentProfileId": "grow2.assessment.humanities",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.history.general"
    ],
    "worldMemoryTagIds": [
      "location.library"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "philosophy",
    "displayName": "철학과",
    "family": "humanities",
    "wave": 3,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.philosophy",
      "label": "논증 구조 검토"
    },
    "assessmentProfileId": "grow2.assessment.humanities",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.philosophy.general"
    ],
    "worldMemoryTagIds": [
      "location.library"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "theatre",
    "displayName": "연극영화학과",
    "family": "arts",
    "wave": 1,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [
      "grow2.course.theatre.foundation",
      "grow2.course.theatre.practice"
    ],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.theatre",
      "label": "리허설 세션"
    },
    "assessmentProfileId": "grow2.assessment.arts",
    "eventPackIds": [
      "grow2.event.theatre.signature"
    ],
    "careerTrackIds": [
      "grow2.career.theatre.general"
    ],
    "worldMemoryTagIds": [
      "location.festival"
    ],
    "playability": "foundation",
    "signatureEvent": {
      "id": "grow2.event.theatre.signature",
      "year": 1,
      "term": 1,
      "weekWindow": [
        4,
        12
      ],
      "guaranteed": true,
      "title": "오디션·촬영 체험",
      "choices": [
        {
          "id": "grow2.choice.theatre.1",
          "label": "연기에 도전",
          "effects": {
            "competency": "expression",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.theatre.1",
          "memoryTag": "grow2.memory.theatre.1",
          "memoryText": "무대: 연기에 도전"
        },
        {
          "id": "grow2.choice.theatre.2",
          "label": "연출을 맡는다",
          "effects": {
            "competency": "collaboration",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.theatre.2",
          "memoryTag": "grow2.memory.theatre.2",
          "memoryText": "무대: 연출을 맡는다"
        },
        {
          "id": "grow2.choice.theatre.3",
          "label": "촬영을 맡는다",
          "effects": {
            "competency": "creative",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.theatre.3",
          "memoryTag": "grow2.memory.theatre.3",
          "memoryText": "무대: 촬영을 맡는다"
        }
      ]
    }
  },
  {
    "id": "design",
    "displayName": "디자인융합학과",
    "family": "arts",
    "wave": 1,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [
      "grow2.course.design.foundation",
      "grow2.course.design.practice"
    ],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.design",
      "label": "사용성 프로토타이핑"
    },
    "assessmentProfileId": "grow2.assessment.arts",
    "eventPackIds": [
      "grow2.event.design.signature"
    ],
    "careerTrackIds": [
      "grow2.career.design.general"
    ],
    "worldMemoryTagIds": [
      "location.exhibition"
    ],
    "playability": "foundation",
    "signatureEvent": {
      "id": "grow2.event.design.signature",
      "year": 1,
      "term": 1,
      "weekWindow": [
        4,
        12
      ],
      "guaranteed": true,
      "title": "사용자 테스트에서 실패",
      "choices": [
        {
          "id": "grow2.choice.design.1",
          "label": "외형을 개선한다",
          "effects": {
            "competency": "creative",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.design.1",
          "memoryTag": "grow2.memory.design.1",
          "memoryText": "디자인 검증: 외형을 개선한다"
        },
        {
          "id": "grow2.choice.design.2",
          "label": "접근성을 개선한다",
          "effects": {
            "competency": "collaboration",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.design.2",
          "memoryTag": "grow2.memory.design.2",
          "memoryText": "디자인 검증: 접근성을 개선한다"
        },
        {
          "id": "grow2.choice.design.3",
          "label": "핵심 기능을 다시 설계",
          "effects": {
            "competency": "execution",
            "delta": 3
          },
          "outcomeFlag": "grow2.outcome.design.3",
          "memoryTag": "grow2.memory.design.3",
          "memoryText": "디자인 검증: 핵심 기능을 다시 설계"
        }
      ]
    }
  },
  {
    "id": "clothing",
    "displayName": "의류디자인학과",
    "family": "arts",
    "wave": 2,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.clothing",
      "label": "패턴·의상 제작"
    },
    "assessmentProfileId": "grow2.assessment.arts",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.clothing.general"
    ],
    "worldMemoryTagIds": [
      "location.exhibition"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "sports",
    "displayName": "스포츠과학과",
    "family": "arts",
    "wave": 2,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.sports",
      "label": "훈련 데이터 분석"
    },
    "assessmentProfileId": "grow2.assessment.arts",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.sports.general"
    ],
    "worldMemoryTagIds": [
      "location.campus"
    ],
    "playability": "planned",
    "signatureEvent": null
  },
  {
    "id": "sculpture",
    "displayName": "조형예술학과",
    "family": "arts",
    "wave": 3,
    "catalogYear": 2026,
    "sourceStatus": "provisional",
    "coursePool": [],
    "calendarTemplate": "four_year_8_terms",
    "majorAction": {
      "id": "grow2.action.sculpture",
      "label": "작품 제작·비평"
    },
    "assessmentProfileId": "grow2.assessment.arts",
    "eventPackIds": [],
    "careerTrackIds": [
      "grow2.career.sculpture.general"
    ],
    "worldMemoryTagIds": [
      "location.exhibition"
    ],
    "playability": "planned",
    "signatureEvent": null
  }
];
export const MAJOR_CATALOG = deepFreeze(CATALOG_DATA);
const CATALOG_BY_ID = new Map(MAJOR_CATALOG.map(major => [major.id,major]));
export function findMajor(id) { return CATALOG_BY_ID.get(id) ?? null; }
export function listMajors({ wave = null, family = null } = {}) {
  return MAJOR_CATALOG.filter(major => (wave === null || major.wave === wave) && (family === null || major.family === family));
}
