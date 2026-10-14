import {findMajor, FOUNDATION_MAJOR_IDS} from './major-registry.mjs';

// Content identity is independent of the engine/save envelope. Missing means legacy.
export const LEGACY_CONTENT_VERSION = 'grow2-content-0.1';
export const FOLLOWUP_CONTENT_VERSION = 'grow2-content-major-stories-1';
const DATA = {
  "cse": [
    [
      "첫 사용자 피드백",
      "해커톤 앱을 써 본 동아리에서 서로 다른 요청이 왔다.",
      [
        "기능은 많지만 오류를 재현하기 어렵다는 피드백이 쌓였다.",
        "안정적이지만 실제 활동에 필요한 기능이 빠져 있었다.",
        "팀 분위기는 좋지만 담당자가 불분명한 요청이 생겼다."
      ],
      [
        [
          "오류 재현 노트를 함께 만든다",
          "analysis",
          "사용자와 재현 절차를 정리해 반복되는 오류의 실마리를 찾았다."
        ],
        [
          "꼭 필요한 기능 하나만 만든다",
          "execution",
          "작은 기능을 끝까지 연결하고 실제 사용자의 확인을 받았다."
        ],
        [
          "담당자와 검토 순서를 정한다",
          "collaboration",
          "요청이 묻히지 않도록 팀의 응답 순서를 합의했다."
        ]
      ]
    ],
    [
      "팀 프로젝트 공개 발표",
      "다른 팀 앞에서 앱의 성과와 남은 한계를 함께 소개할 차례다.",
      [
        "재현 노트 덕분에 오류 원인을 설명할 자료가 생겼다.",
        "추가한 기능의 이용 사례는 있지만 다른 요구는 남아 있다.",
        "담당 체계는 잡혔지만 기술적 근거도 보여 달라는 요청을 받았다."
      ],
      [
        [
          "실패와 수정 과정을 공개한다",
          "expression",
          "완벽한 시연 대신 실패를 고친 과정을 보여 주어 구체적인 질문을 받았다."
        ],
        [
          "사용자가 직접 시연하게 한다",
          "collaboration",
          "사용자의 시연에서 개발자가 놓친 사용 흐름을 발견했다."
        ],
        [
          "측정 가능한 다음 목표를 정한다",
          "analysis",
          "막연한 기능 약속 대신 검증할 목표와 남은 문제를 문서에 남겼다."
        ]
      ]
    ]
  ],
  "culture": [
    [
      "축제 파일럿의 관객 반응",
      "작은 콘텐츠 부스를 열고 관객 의견을 모았다.",
      [
        "방문객은 많았지만 어디서 본 듯하다는 의견이 있었다.",
        "새롭다는 반응과 이해하기 어렵다는 반응이 갈렸다.",
        "예상 수치와 현장 반응이 달라 가설을 다시 볼 필요가 생겼다."
      ],
      [
        [
          "관객 동선을 직접 관찰한다",
          "analysis",
          "설문에 적히지 않은 머뭇거림을 발견하고 관객 동선을 기록했다."
        ],
        [
          "핵심 장면을 다시 연출한다",
          "creative",
          "기획의 개성을 살리면서 처음 온 관객도 들어올 수 있는 장면을 만들었다."
        ],
        [
          "관객과 작은 대화를 연다",
          "expression",
          "서로 다른 취향의 관객에게서 기획 의도 밖의 해석을 들었다."
        ]
      ]
    ],
    [
      "다음 시즌 기획",
      "축제 기록을 바탕으로 다음 시즌의 방향을 정한다.",
      [
        "동선 기록은 명확하지만 관객이 기억할 장면은 더 필요하다.",
        "새 장면의 반응은 좋았지만 제작 부담도 커졌다.",
        "대화에서 다양한 목소리를 얻었지만 모두를 만족시킬 수는 없다."
      ],
      [
        [
          "한 관객층의 경험을 깊게 만든다",
          "analysis",
          "누구를 위한 기획인지 분명히 하고 선택하지 않은 대상도 기록했다."
        ],
        [
          "작은 실험을 두 버전으로 준비한다",
          "creative",
          "큰 제작에 앞서 서로 다른 표현을 시험할 수 있게 설계했다."
        ],
        [
          "관객 참여형 프로그램을 만든다",
          "collaboration",
          "관객을 평가자뿐 아니라 함께 이야기를 만드는 사람으로 초대했다."
        ]
      ]
    ]
  ],
  "ai": [
    [
      "캠퍼스 시연에서 달라진 결과",
      "수업용 모델을 새로운 시연 자료로 평가해 보았다.",
      [
        "전체 정확도는 높았지만 일부 자료에서 오답이 몰렸다.",
        "집단별 차이는 줄었지만 다른 조건의 성능이 흔들렸다.",
        "설명은 읽기 쉬웠지만 실제 예측 근거와 맞는지 의문이 생겼다."
      ],
      [
        [
          "조건별 오류를 다시 나눈다",
          "analysis",
          "평균 하나로 숨겨졌던 조건별 오차를 표로 정리했다."
        ],
        [
          "자료 수집 기준을 함께 검토한다",
          "collaboration",
          "팀과 자료의 누락과 분류 기준을 검토하며 평가 범위를 좁혔다."
        ],
        [
          "설명과 예측을 짝지어 점검한다",
          "expression",
          "그럴듯한 설명과 검증된 근거를 구별해 시연 자료에 표시했다."
        ]
      ]
    ],
    [
      "공동 검증 발표",
      "연구 모임에서 모델의 결과를 다른 팀이 확인할 수 있게 공유한다.",
      [
        "오류 분류표는 생겼지만 새로운 자료에도 유지되는지 궁금하다.",
        "자료 기준을 정리했지만 평가자가 달라져도 같은지 확인해야 한다.",
        "설명의 한계가 드러났고 이를 감추지 않는 발표가 필요하다."
      ],
      [
        [
          "재현 가능한 평가 절차를 공개한다",
          "execution",
          "다른 팀이 같은 조건에서 평가할 수 있도록 절차를 정리했다."
        ],
        [
          "한계와 사용하지 말아야 할 조건을 적는다",
          "expression",
          "모델이 답하지 못하는 조건을 발표의 일부로 남겼다."
        ],
        [
          "반례 찾기 세션을 진행한다",
          "collaboration",
          "좋은 결과만 모으지 않고 서로의 반례를 검토했다."
        ]
      ]
    ]
  ],
  "mech": [
    [
      "반복 구동에서 생긴 소음",
      "수업용 시제품을 여러 번 구동하자 첫 시험에 없던 소음이 들렸다.",
      [
        "성능을 높인 만큼 특정 구간의 떨림이 커졌다.",
        "안정성은 좋아졌지만 무게 때문에 다루기 어렵다는 의견이 나왔다.",
        "제작비는 줄었지만 교체 부품의 편차를 확인해야 한다."
      ],
      [
        [
          "조건을 나눠 반복 측정한다",
          "analysis",
          "구동 조건과 소음을 함께 기록해 추측과 측정을 구분했다."
        ],
        [
          "조립 구조를 단순하게 바꾼다",
          "creative",
          "부품 수를 줄인 새 구조를 만들어 기존 시제품과 비교했다."
        ],
        [
          "팀원이 교대로 조립해 본다",
          "collaboration",
          "다른 사람이 조립하며 놓치기 쉬운 순서를 찾아냈다."
        ]
      ]
    ],
    [
      "시제품 인수인계 전시",
      "후배가 이어 제작할 수 있는 형태로 시제품을 전시한다.",
      [
        "측정값은 쌓였지만 조립 방법도 이해하기 쉬워야 한다.",
        "구조는 단순해졌지만 바꾼 이유를 남길 필요가 있다.",
        "조립 순서가 정리됐지만 성능 근거를 함께 보여 줘야 한다."
      ],
      [
        [
          "한계가 포함된 시험표를 붙인다",
          "analysis",
          "좋은 수치뿐 아니라 재현하지 못한 조건을 시험표에 남겼다."
        ],
        [
          "교체 과정을 직접 시연한다",
          "execution",
          "부품을 바꾸는 과정을 보여 주고 작업의 어려움을 설명했다."
        ],
        [
          "후배와 설명서를 고친다",
          "expression",
          "처음 읽는 사람이 이해하지 못한 부분을 함께 고쳤다."
        ]
      ]
    ]
  ],
  "aero": [
    [
      "설계 모형의 환경 시험",
      "실제 비행이 아닌 수업용 모형 시험에서 환경 조건을 바꿔 본다.",
      [
        "안정적인 설계였지만 조건을 바꾸자 예상 밖의 흔들림이 나타났다.",
        "속도 중심의 모형은 변화에 민감하게 반응했다.",
        "효율 중심의 설계는 일부 조건에서 여유가 부족했다."
      ],
      [
        [
          "시험 조건의 범위를 명시한다",
          "analysis",
          "안전하다는 단정 대신 확인한 조건과 확인하지 못한 조건을 나눴다."
        ],
        [
          "모형의 형상을 조금 바꾼다",
          "creative",
          "한 번에 한 요소만 바꿔 원인을 비교할 수 있게 했다."
        ],
        [
          "팀별 측정 방식을 맞춘다",
          "collaboration",
          "서로 다른 측정 기준을 통일하니 비교가 쉬워졌다."
        ]
      ]
    ],
    [
      "비행체 설계 포스터 발표",
      "모형 실험의 결과를 포스터로 설명한다.",
      [
        "시험 범위가 분명해져 다른 조건에 대한 질문이 모였다.",
        "형상 변경의 효과는 보였지만 다른 요인도 검토해야 한다.",
        "측정 기준은 맞았지만 왜 그런 결과가 나왔는지 설명이 필요하다."
      ],
      [
        [
          "성공과 실패를 나란히 싣는다",
          "expression",
          "좋은 결과만 고르지 않고 실패 조건까지 포스터에 담았다."
        ],
        [
          "추가 시험의 우선순위를 정한다",
          "analysis",
          "모든 조건을 약속하지 않고 가장 중요한 불확실성부터 골랐다."
        ],
        [
          "팀의 설계 결정을 정리한다",
          "collaboration",
          "다른 역할의 기여와 양보를 함께 기록하며 프로젝트를 마쳤다."
        ]
      ]
    ]
  ],
  "apsl": [
    [
      "축제 물품 도착 지연",
      "가상 공급망 연습에서 축제 물품의 일부가 늦게 도착한다.",
      [
        "저비용 경로에 물량이 몰려 대체 여유가 적었다.",
        "빠른 운송을 선택했지만 다른 물품과 일정이 어긋났다.",
        "경로는 나눴지만 팀마다 정보 형식이 달랐다."
      ],
      [
        [
          "필수 물품의 순서를 다시 정한다",
          "analysis",
          "급한 물품과 나중에 받아도 되는 물품을 구분했다."
        ],
        [
          "작은 단위로 나눠 전달한다",
          "execution",
          "한 번에 끝내기보다 필요한 곳부터 단계적으로 공급했다."
        ],
        [
          "공통 현황판을 만든다",
          "collaboration",
          "팀들이 같은 기준으로 도착 현황을 확인하게 했다."
        ]
      ]
    ],
    [
      "다음 축제 운영 제안",
      "지연 대응 기록을 바탕으로 다음 운영안을 발표한다.",
      [
        "우선순위를 정한 이유를 모두가 이해할 수 있게 설명해야 한다.",
        "분할 전달은 효과가 있었지만 작업 부담도 늘었다.",
        "현황판은 편리했지만 업데이트 책임이 남아 있다."
      ],
      [
        [
          "비용과 지연의 절충을 보여 준다",
          "analysis",
          "가장 싼 안과 가장 빠른 안 사이의 선택 근거를 정리했다."
        ],
        [
          "예외 상황 연습을 제안한다",
          "creative",
          "계획대로 되지 않을 때 대응을 연습하는 작은 시나리오를 만들었다."
        ],
        [
          "역할별 인수인계표를 만든다",
          "collaboration",
          "정보가 사람 한 명에게만 남지 않게 인수인계표를 작성했다."
        ]
      ]
    ]
  ],
  "life": [
    [
      "다른 팀의 재현 결과",
      "수업용 실험 기록을 공유했는데 다른 팀의 결과가 달랐다.",
      [
        "재실험 기록은 많지만 조건 차이를 비교해야 한다.",
        "새 가설을 세웠지만 다른 설명도 남아 있다.",
        "결과를 공개한 덕분에 기록의 빈칸을 지적받았다."
      ],
      [
        [
          "기록의 조건을 나란히 비교한다",
          "analysis",
          "결과를 탓하기 전에 실험 기록의 조건 차이를 정리했다."
        ],
        [
          "가능한 설명을 여럿 적는다",
          "creative",
          "하나의 해석을 고집하지 않고 비교할 가설을 만들었다."
        ],
        [
          "불확실한 항목을 공개한다",
          "expression",
          "알 수 없는 조건을 숨기지 않고 다음 검토 대상으로 남겼다."
        ]
      ]
    ],
    [
      "학부 연구 포스터",
      "수업 프로젝트를 연구 포스터 형식으로 정리한다.",
      [
        "조건 비교표가 생겼지만 결론을 어디까지 말할지 결정해야 한다.",
        "가설은 풍부해졌지만 각각을 구분할 근거가 필요하다.",
        "한계는 분명하지만 배운 점도 구체적으로 전달해야 한다."
      ],
      [
        [
          "결론의 범위를 좁힌다",
          "analysis",
          "자료가 뒷받침하는 범위 안에서만 결론을 제시했다."
        ],
        [
          "다음 관찰 계획을 설계한다",
          "creative",
          "가설을 가를 수 있는 다음 질문을 포스터에 담았다."
        ],
        [
          "반대 해석을 토론한다",
          "collaboration",
          "서로 다른 해석을 비교하면서 설명의 빈틈을 찾았다."
        ]
      ]
    ]
  ],
  "nursing": [
    [
      "역할 교대 모의실습",
      "실제 의료행위가 아닌 교실 모의실습에서 팀 역할을 바꿔 본다.",
      [
        "절차 기록은 꼼꼼하지만 역할을 바꾸니 설명이 끊겼다.",
        "설명은 친절하지만 팀 안의 정보 전달이 빠진 부분이 있었다.",
        "역할은 분명하지만 상대가 이해했는지 확인하는 시간이 필요했다."
      ],
      [
        [
          "모의 인수인계를 다시 연습한다",
          "collaboration",
          "정보를 받는 사람이 질문할 시간을 포함해 역할을 연습했다."
        ],
        [
          "설명 자료의 표현을 고친다",
          "expression",
          "낯선 표현을 쉬운 말로 바꾸고 이해 여부를 확인했다."
        ],
        [
          "관찰 기록을 서로 비교한다",
          "analysis",
          "같은 상황을 다르게 기록한 이유를 팀과 검토했다."
        ]
      ]
    ],
    [
      "모의실습 회고 발표",
      "교실에서 배운 협업 경험을 발표한다. 실제 진료 지침은 다루지 않는다.",
      [
        "인수인계 연습에서 질문의 중요성을 발견했다.",
        "표현을 고치며 듣는 사람의 관점이 달라짐을 보았다.",
        "관찰 기록 차이를 통해 자신의 판단 습관을 돌아봤다."
      ],
      [
        [
          "질문하기 쉬운 팀 규칙을 제안한다",
          "collaboration",
          "모르는 점을 숨기지 않아도 되는 학습 규칙을 정했다."
        ],
        [
          "상대의 관점으로 사례를 다시 쓴다",
          "expression",
          "자신의 설명보다 상대가 어떻게 이해했는지를 중심에 놓았다."
        ],
        [
          "배운 점과 한계를 분리한다",
          "analysis",
          "수업에서 연습한 것과 아직 배우지 못한 것을 구별했다."
        ]
      ]
    ]
  ],
  "business": [
    [
      "축제 부스 단골의 의견",
      "다음 축제 준비 중 이전 부스에 왔던 손님들의 의견이 모였다.",
      [
        "마진은 지켰지만 다시 찾을 이유가 부족하다는 의견이 나왔다.",
        "경험은 좋았지만 준비 부담이 너무 컸다.",
        "재고는 안정됐지만 메뉴 선택의 재미가 적었다."
      ],
      [
        [
          "작은 손익표를 다시 만든다",
          "analysis",
          "숫자에 드러나지 않은 준비 시간까지 비교했다."
        ],
        [
          "단골과 메뉴를 시험한다",
          "expression",
          "손님의 말과 실제 선택이 어떻게 다른지 확인했다."
        ],
        [
          "운영 순서를 단순화한다",
          "execution",
          "바쁜 시간에 반복되는 동선을 줄이는 방식으로 준비했다."
        ]
      ]
    ],
    [
      "부스 운영 경험 공유회",
      "후배에게 부스 운영의 선택과 결과를 공유한다.",
      [
        "비용 근거는 생겼지만 손님 경험도 설명해야 한다.",
        "시험 메뉴는 정했지만 운영 부담을 확인해야 한다.",
        "운영은 편해졌지만 부스만의 개성을 남길 필요가 있다."
      ],
      [
        [
          "포기한 선택도 함께 설명한다",
          "analysis",
          "성공 이야기만 남기지 않고 비용 때문에 포기한 안을 공유했다."
        ],
        [
          "후배와 작은 운영 연습을 한다",
          "collaboration",
          "후배가 직접 맡아 보며 설명서의 빈틈을 찾았다."
        ],
        [
          "부스의 한 문장 약속을 만든다",
          "creative",
          "할 수 없는 약속을 줄이고 손님에게 줄 경험을 분명히 했다."
        ]
      ]
    ]
  ],
  "media": [
    [
      "기사 이후 도착한 정정 요청",
      "교내 수업용 취재물에 다른 설명을 담은 연락이 왔다.",
      [
        "빨리 발표한 내용 중 확인이 부족했던 부분이 지적됐다.",
        "추가 검증을 했지만 새 자료가 들어와 확인 범위가 바뀌었다.",
        "사생활을 가린 덕분에 보호는 됐지만 맥락 설명이 부족했다."
      ],
      [
        [
          "근거와 수정 이력을 공개한다",
          "analysis",
          "확인된 내용과 바뀐 내용을 독자가 구별할 수 있게 정리했다."
        ],
        [
          "관계자의 말을 다시 듣는다",
          "collaboration",
          "반박을 방해로 여기지 않고 서로 다른 설명을 기록했다."
        ],
        [
          "식별 정보를 줄여 다시 설명한다",
          "expression",
          "사람을 불필요하게 드러내지 않으면서 핵심 맥락을 전달했다."
        ]
      ]
    ],
    [
      "취재 과정 발표회",
      "결과물뿐 아니라 취재하며 바뀐 판단을 발표한다.",
      [
        "수정 이력을 남겨 검증 과정 자체가 발표 자료가 됐다.",
        "다양한 목소리를 얻었지만 사실과 의견을 나눌 필요가 있다.",
        "보호한 정보와 공개할 맥락의 경계를 설명해야 한다."
      ],
      [
        [
          "확인 절차를 사례로 보여 준다",
          "analysis",
          "어떤 근거로 판단을 바꿨는지 추적 가능한 사례를 만들었다."
        ],
        [
          "편집 판단의 고민을 설명한다",
          "expression",
          "단순한 정답보다 공개와 보호 사이의 고민을 솔직히 전했다."
        ],
        [
          "동료 검토를 정례화한다",
          "collaboration",
          "발표 전에 서로 확인하는 작은 검토 절차를 만들었다."
        ]
      ]
    ]
  ],
  "theatre": [
    [
      "첫 상영 뒤의 합평",
      "동료들과 수업 작품을 보고 서로 다른 반응을 나눴다.",
      [
        "연기는 생생했지만 장면의 흐름을 이해하기 어렵다는 의견이 있었다.",
        "연출 의도는 분명했지만 배우의 표현 여지가 좁았다.",
        "화면은 인상적이지만 이야기에 집중하기 어렵다는 반응도 있었다."
      ],
      [
        [
          "한 장면을 다시 연습한다",
          "expression",
          "대사를 늘리기보다 한 장면의 감정과 전달을 다듬었다."
        ],
        [
          "역할을 바꿔 의견을 듣는다",
          "collaboration",
          "평소 맡지 않은 역할에서 작품을 보니 다른 문제가 보였다."
        ],
        [
          "편집 순서를 두 가지로 만든다",
          "creative",
          "같은 재료도 순서에 따라 의미가 달라짐을 비교했다."
        ]
      ]
    ],
    [
      "작품 공개와 회고",
      "수정한 수업 작품을 작은 상영회에 올린다.",
      [
        "장면은 깊어졌지만 전체 호흡과 어울리는지 확인해야 한다.",
        "서로의 역할은 이해했지만 최종 결정을 내릴 시간이 왔다.",
        "두 편집안의 장단점이 보여 무엇을 포기할지 고민된다."
      ],
      [
        [
          "관객과 합평 시간을 갖는다",
          "expression",
          "의도를 해명하기 전에 관객이 본 이야기를 들었다."
        ],
        [
          "팀의 선택 기록을 남긴다",
          "collaboration",
          "최종본에 담기지 않은 기여와 시행착오도 함께 기록했다."
        ],
        [
          "다음 작품의 실험을 정한다",
          "creative",
          "이번 작품의 한계를 다음 작품에서 시험할 질문으로 바꿨다."
        ]
      ]
    ]
  ],
  "design": [
    [
      "새 사용자의 낯선 행동",
      "기존 시안을 처음 접하는 사용자가 예상과 다르게 사용한다.",
      [
        "외형은 눈에 띄지만 다음 행동을 찾기 어렵다고 했다.",
        "접근성은 좋아졌지만 일부 흐름이 복잡하다는 반응이 나왔다.",
        "핵심 기능은 작동하지만 무엇을 할 수 있는지 설명이 부족했다."
      ],
      [
        [
          "사용 과정을 말없이 관찰한다",
          "analysis",
          "설명으로 도와주기 전에 실제로 막히는 지점을 기록했다."
        ],
        [
          "다른 입력 방식으로 시험한다",
          "collaboration",
          "익숙한 방식만 가정하지 않고 다양한 사용 조건을 비교했다."
        ],
        [
          "핵심 흐름을 한 단계 줄인다",
          "execution",
          "중요한 행동까지 가는 길을 줄이고 다시 시험했다."
        ]
      ]
    ],
    [
      "디자인 전시의 설명 방식",
      "완성된 화면뿐 아니라 바꾼 이유를 전시한다.",
      [
        "관찰 기록을 어떻게 관객에게 이해시킬지 고민된다.",
        "다양한 입력 조건의 차이를 전시에 드러낼 필요가 있다.",
        "단순해진 흐름에서 사라진 기능도 설명해야 한다."
      ],
      [
        [
          "수정 전후를 함께 전시한다",
          "expression",
          "보기 좋은 최종 화면뿐 아니라 바꾼 이유를 보여 주었다."
        ],
        [
          "관객이 직접 써 보게 한다",
          "collaboration",
          "전시를 일방적인 설명 대신 새로운 사용 관찰의 기회로 만들었다."
        ],
        [
          "남은 문제를 다음 과제로 적는다",
          "creative",
          "완성이라는 말 뒤에 남은 문제를 숨기지 않고 다음 질문을 남겼다."
        ]
      ]
    ]
  ]
};
function freeze(value) {
  if(value && typeof value==='object') {Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
}
export const MAJOR_STORIES = freeze(DATA);
export function contentVersion(life) {
  const value=life.contentVersion===undefined?LEGACY_CONTENT_VERSION:life.contentVersion;
  if(value!==LEGACY_CONTENT_VERSION && value!==FOLLOWUP_CONTENT_VERSION)throw new Error('Unsupported content version');
  return value;
}
const eventId=(majorId,year)=>'grow2.event.followup.'+majorId+'.year'+year;
const choiceId=(majorId,year,index)=>eventId(majorId,year)+'.choice'+(index+1);
const flagId=(majorId,year,index)=>'grow2.outcome.followup.'+majorId+'.year'+year+'.'+(index+1);
function previousChoice(life,year) {
  const major=findMajor(life.majorId);
  if(!major?.signatureEvent || !DATA[life.majorId])throw new Error('Unsupported story major');
  const id=year===2?major.signatureEvent.id:eventId(life.majorId,2);
  const memory=life.memories.find(m=>m.eventId===id);
  const choices=year===2?major.signatureEvent.choices:DATA[life.majorId][0][3].map((c,i)=>({
    id:choiceId(life.majorId,2,i),label:c[0],outcomeFlag:flagId(life.majorId,2,i)
  }));
  const index=choices.findIndex(c=>c.id===memory?.choiceId && life.flags?.[c.outcomeFlag]===true);
  if(index<0)throw new Error('Missing previous story choice');
  return {index,label:choices[index].label,text:memory.text};
}
export function buildFollowupEvent(life) {
  if(contentVersion(life)!==FOLLOWUP_CONTENT_VERSION || ![2,3].includes(life.year) ||
     life.term!==1 || life.week!==6)return null;
  const scene=DATA[life.majorId]?.[life.year-2];
  if(!scene)throw new Error('Missing major story');
  const previous=previousChoice(life,life.year),id=eventId(life.majorId,life.year);
  return {instanceId:id,eventId:id,type:'followup',title:scene[0],
    year:life.year,term:life.term,week:life.week,
    description:scene[1]+' '+scene[2][previous.index],
    recall:'지난 선택: '+previous.label,
    choices:scene[3].map((c,i)=>({id:choiceId(life.majorId,life.year,i),label:c[0]}))};
}
export function applyFollowupChoice(life,choice) {
  const expected=buildFollowupEvent(life),pending=life.pendingEvent;
  if(!expected || JSON.stringify(pending)!==JSON.stringify(expected))throw new Error('Invalid follow-up event');
  if(life.completedEventInstances.includes(expected.instanceId))throw new Error('Follow-up already completed');
  const index=expected.choices.findIndex(c=>c.id===choice);
  if(index<0)throw new Error('Unknown follow-up choice');
  const previous=previousChoice(life,life.year),entry=DATA[life.majorId][life.year-2][3][index];
  // Modest, non-economic effects. The narrative retains differences even at stat caps.
  life.stats[entry[1]]=Math.min(100,life.stats[entry[1]]+3);
  life.stress=Math.max(0,Math.min(100,life.stress+[-1,2,1][index]));
  const summary=expected.description+' 지난 선택은 “'+previous.label+'”였다. 이번에는 “'+entry[0]+'”라는 결정을 내렸다. '+entry[2];
  life.completedEventInstances.push(expected.instanceId);
  life.flags={...life.flags,[flagId(life.majorId,life.year,index)]:true};
  life.memories.push({eventId:expected.instanceId,choiceId:choice,
    memoryTag:'grow2.memory.followup.'+life.majorId+'.year'+life.year+'.'+(index+1),text:summary});
  return summary;
}
export function buildMajorEpilogue(life) {
  if(contentVersion(life)!==FOLLOWUP_CONTENT_VERSION)return null;
  const major=findMajor(life.majorId),ids=[major.signatureEvent.id,eventId(life.majorId,2),eventId(life.majorId,3)];
  const memories=ids.map(id=>life.memories.find(m=>m.eventId===id));
  if(memories.some(m=>!m))throw new Error('Incomplete major story');
  return {title:major.displayName+' · 세 번의 선택이 남긴 이야기',
    chapters:memories.map((m,i)=>({year:i+1,text:m.text})),
    text:'첫 선택을 지키기도, 돌아보며 바꾸기도 했던 네 해. 성적 하나로는 담을 수 없는 전공 이야기가 남았다.'};
}
export function validateStoryState(life) {
  if(contentVersion(life)!==FOLLOWUP_CONTENT_VERSION)return;
  if(!FOUNDATION_MAJOR_IDS.includes(life.majorId) || !life.flags || typeof life.flags!=='object' || Array.isArray(life.flags))
    throw new Error('Invalid story state');
  const major=findMajor(life.majorId);
  for(const year of [1,2,3]) {
    const id=year===1?major.signatureEvent.id:eventId(life.majorId,year),cursor=(year-1)*30+5;
    const completed=life.completedEventInstances.filter(x=>x===id);
    const memories=life.memories.filter(m=>m.eventId===id);
    const flagPrefix=year===1?'grow2.outcome.'+life.majorId+'.':'grow2.outcome.followup.'+life.majorId+'.year'+year+'.';
    const flags=Object.keys(life.flags).filter(k=>k.startsWith(flagPrefix));
    if(completed.length>1 || memories.length!==completed.length ||
       flags.length!==completed.length || (life.weeksCompleted<cursor && completed.length) ||
       (life.weeksCompleted>cursor && !completed.length))throw new Error('Invalid story progress');
    const slot=year+':1:6',slots=life.shownEventSlots.filter(x=>x===slot);
    const pending=life.pendingEvent?.instanceId===id;
    if(slots.length>1 || (life.weeksCompleted<cursor && (slots.length||pending)) ||
       (completed.length && (!slots.length||pending)) ||
       (!completed.length && slots.length && !pending) ||
       (pending && (!slots.length||life.weeksCompleted!==cursor)) ||
       (life.weeksCompleted===cursor && life.pendingEvent && !pending))
      throw new Error('Invalid story slot');
    if(completed.length) {
      const options=year===1?major.signatureEvent.choices:
        DATA[life.majorId][year-2][3].map((c,i)=>({id:choiceId(life.majorId,year,i),outcomeFlag:flagId(life.majorId,year,i)}));
      const index=options.findIndex(c=>c.id===memories[0].choiceId);
      if(index<0 || life.flags[options[index].outcomeFlag]!==true || typeof memories[0].text!=='string')
        throw new Error('Invalid story record');
    }
    if(pending && year===1) {
      const event=major.signatureEvent;
      const expected={instanceId:event.id,eventId:event.id,type:'signature',title:event.title,
        year:1,term:1,week:6,choices:event.choices.map(c=>({id:c.id,label:c.label}))};
      if(JSON.stringify(expected)!==JSON.stringify(life.pendingEvent))throw new Error('Invalid pending signature');
    }
  }
  if(life.pendingEvent?.type==='followup' ||
     life.pendingEvent?.instanceId?.startsWith('grow2.event.followup.') ||
     life.pendingEvent?.eventId?.startsWith('grow2.event.followup.')) {
    const expected=buildFollowupEvent(life);
    if(!expected || JSON.stringify(expected)!==JSON.stringify(life.pendingEvent) ||
       life.completedEventInstances.includes(expected.instanceId))throw new Error('Invalid pending story');
  }
  if(life.status==='complete' && JSON.stringify(life.ending?.epilogue)!==JSON.stringify(buildMajorEpilogue(life)))
    throw new Error('Invalid story epilogue');
}
