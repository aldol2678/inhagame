// Biryong Village NPC dialogue/knowledge P0.
// IMPORTANT: only Stage-1/public facts ship to the browser. Stage-2/3 secret text is intentionally
// absent from this client bundle until Relationship/Quest authority can project unlocked facts.
import { BIRYONG_VILLAGE_NPC_BY_ID } from "./biryong-village-npc-contract.js";

export const BIRYONG_DIALOGUE_STAGE = Object.freeze({
  ACQUAINTED: 1,
  TRUSTED: 2,
  SHARED_RESPONSIBILITY: 3
});

const publicTopic = (id, label, facts, lines, { generativeSafe = true } = {}) => Object.freeze({
  id, label, minStage: 1, facts: Object.freeze(facts), lines: Object.freeze(lines), generativeSafe
});
const relation = (npcId, name, kind) => Object.freeze({ npcId, name, kind, strength: "FAMILIAR" });
const profile = ({ traits, greeting, status, topics, relations = [], locked = [] }) => Object.freeze({
  traits: Object.freeze(traits),
  greeting,
  status,
  topics: Object.freeze(topics),
  relations: Object.freeze(relations),
  // Opaque ids only. No Stage-2/3 spoiler text may be placed in this browser-side field.
  locked: Object.freeze(locked)
});

export const BIRYONG_DIALOGUE_PROFILES = Object.freeze({
  BR_NPC_001: profile({
    traits: ["빠름", "유쾌함", "현장형"],
    greeting: "역 너머에서 오셨죠? 화물 길 막히기 전에 인사부터 해요.",
    status: "역과 시장 사이를 오가느라 오늘도 발이 바빠요.",
    topics: [
      publicTopic("work", "화물 일", [
        "강소라는 비룡역 화물과 마을 배송을 맡는다.",
        "역과 시장을 잇는 운송 동선이 강소라의 주된 일터다."
      ], [
        "역에서 들어온 짐은 먼저 수량을 맞추고 시장으로 보내요. 한 번 꼬이면 마을 여기저기가 같이 늦어지거든요.",
        "화물은 무거운 것보다 순서가 더 골치 아파요. 어디로 먼저 보내느냐가 중요해요."
      ]),
      publicTopic("outside", "역 너머", [
        "강소라는 비룡권 바깥 세계에 호기심이 많다.",
        "비룡역은 외부 세계와 마을을 잇는 중요한 관문이다."
      ], [
        "역 너머가 궁금하지 않다면 이 일을 오래 못 해요. 지나가는 물건마다 밖의 냄새가 조금씩 다르거든요.",
        "비룡역이 계속 열려 있으면 마을도 조금씩 달라질 거예요. 좋은 쪽만 있는 건 아니겠지만요."
      ]),
      publicTopic("people", "역 사람들", [
        "강소라는 한여울과 역 물류 장비를 함께 다룬다.",
        "강소라는 윤하린과 남이솔과 가까운 또래 친구다."
      ], [
        "여울이는 장비 쪽, 저는 화물 쪽이에요. 둘 다 바쁘면 말보다 손이 먼저 움직여요.",
        "하린이랑 이솔이는 역에서 자주 마주쳐요. 넷이 항상 붙어 다니는 건 아니고요."
      ])
    ],
    relations: [
      relation("BR_NPC_002","한여울","역 실무 협업"),
      relation("BR_NPC_003","남이솔","친구"),
      relation("BR_NPC_004","윤하린","친구")
    ],
    locked: ["S2_A","S3_A"]
  }),
  BR_NPC_002: profile({
    traits: ["사람 좋아함", "손재주", "현실적"],
    greeting: "역 설비는 조용할 때가 제일 바쁜 법이에요. 그래도 잠깐은 괜찮아요.",
    status: "오늘도 비룡역 설비 상태를 훑고 공방 쪽 수리까지 보고 있어요.",
    topics: [
      publicTopic("work","역 정비",[
        "한여울은 비룡역 설비를 담당하는 정비사다.",
        "한여울은 신맥공방과 비룡역을 오가며 수리 업무를 한다."
      ],[
        "역은 멀쩡해 보일 때 점검해야 오래 버텨요. 소리가 달라지기 전에 잡는 게 제 일이죠.",
        "공방에서 만든 장비도 결국 현장에서 버텨야 해요. 역이 꽤 좋은 시험장이에요."
      ]),
      publicTopic("safety","안전",[
        "한여울은 비룡역을 안전한 상시 교통로로 만드는 일을 중요하게 여긴다.",
        "한여울은 기술보다 운용 안전을 먼저 확인하는 편이다."
      ],[
        "잘 돌아가는 것보다 안전하게 멈출 수 있는 게 더 중요할 때가 있어요.",
        "역은 한 사람 실수로 끝나는 곳이 아니니까, 안전장치는 늘 한 번 더 봐요."
      ]),
      publicTopic("people","공방 사람들",[
        "한여울은 한세온의 동생이다.",
        "한여울은 강소라와 역 물류 장비를 함께 다룬다."
      ],[
        "세온 누나는 아이디어가 빠르고, 저는 그게 현장에서 견딜지 먼저 봐요. 역할이 다른 거죠.",
        "소라랑은 역에서 자주 부딪혀요. 진짜로 부딪힌다는 뜻은 아니고, 일이 자꾸 겹친다는 뜻이에요."
      ])
    ],
    relations: [
      relation("BR_NPC_001","강소라","역 실무 협업"),
      relation("BR_NPC_006","한세온","남매")
    ],
    locked:["S2_A","S3_A"]
  }),
  BR_NPC_003: profile({
    traits:["관찰력","호기심","낯가림 적음"],
    greeting:"처음 보는 길이면 제 지도도 너무 믿지는 마세요. 아직 빈칸이 많거든요.",
    status:"역에서 일하다가 틈만 나면 마을 길을 다시 그리고 있어요.",
    topics:[
      publicTopic("map","지도",[
        "남이솔은 손그림 지도를 만드는 젊은 주민이다.",
        "남이솔은 역과 마을 주변을 직접 걸으며 지형을 기록한다."
      ],[
        "지도는 맞는 선보다 틀린 선이 더 잘 보여요. 직접 걸어보면 금방 들키거든요.",
        "마을은 매일 같은 자리에 있는데도 사람 흐름은 계속 달라져요. 그래서 자꾸 다시 그리게 돼요."
      ]),
      publicTopic("station","비룡역",[
        "남이솔은 비룡역 찻집 일을 돕는다.",
        "비룡역은 남이솔이 외부 세계를 관찰하는 창구이기도 하다."
      ],[
        "역 찻집에 있으면 사람보다 짐이 먼저 이야기를 해요. 어디서 왔는지 티가 나거든요.",
        "비룡역은 마을에서 제일 바깥을 많이 상상하게 되는 곳이에요."
      ]),
      publicTopic("people","친구들",[
        "남이솔은 강소라·윤하린과 친구다.",
        "조태경은 남이솔의 지도 재능을 눈여겨본다."
      ],[
        "소라랑 하린이는 서로 보는 게 달라서 같이 걸으면 재밌어요. 저는 그 사이에서 지도를 그리고요.",
        "태경 씨는 제 지도에서 틀린 걸 찾으면 바로 말해요. 덕분에 다음 장은 좀 더 나아지죠."
      ])
    ],
    relations:[
      relation("BR_NPC_001","강소라","친구"),
      relation("BR_NPC_004","윤하린","친구")
    ],
    locked:["S2_A","S3_A"]
  }),
  BR_NPC_004: profile({
    traits:["호기심","사교적","기록 지향"],
    greeting:"역 너머에서 온 분이죠? 마을 안내가 필요하면 아는 만큼은 알려드릴게요.",
    status:"수로 기록과 시장 심부름을 오가면서 하루가 금방 지나가요.",
    topics:[
      publicTopic("records","기록 일",[
        "윤하린은 청우원 수로기록관 견습이다.",
        "윤하린은 마을 수로와 생활 기록을 정리하는 일을 배운다."
      ],[
        "물은 숫자로 적어도 계속 움직여요. 그래서 기록은 한 번 쓰고 끝나는 일이 아니에요.",
        "예전 기록은 표현이 달라서 해석하는 데 시간이 걸려요. 그래도 이어 붙이다 보면 마을이 보여요."
      ]),
      publicTopic("village","마을 생활",[
        "윤하린은 외부인에게 비룡마을의 생활 규칙을 알려주는 데 비교적 적극적이다.",
        "윤하린은 젊은 주민들과 시장·역을 자주 오간다."
      ],[
        "처음엔 시장이 제일 쉬워요. 사람들 따라 움직이면 마을 흐름이 대충 보이거든요.",
        "여긴 길보다 물길을 먼저 보면 방향 잡기가 쉬워요. 오래된 골목이 수로를 따라 생겼거든요."
      ]),
      publicTopic("people","또래 사람들",[
        "윤하린은 한여울과 절친하다.",
        "윤하린은 강소라·남이솔과도 자주 어울린다."
      ],[
        "여울이는 말보다 손이 빠르고, 소라는 발이 빠르고, 이솔이는 눈이 빨라요. 같이 있으면 정신없지만 좋아요.",
        "역에 가면 아는 얼굴을 하나쯤은 만나게 돼요. 마을이 크진 않으니까요."
      ])
    ],
    relations:[
      relation("BR_NPC_002","한여울","절친"),
      relation("BR_NPC_001","강소라","친구"),
      relation("BR_NPC_003","남이솔","친구")
    ],
    locked:["S2_A","S3_A"]
  }),
  BR_NPC_005: profile({
    traits:["합리적","생활 중심","독립적"],
    greeting:"마을 일은 결국 밥상으로 돌아와요. 궁금한 게 있으면 생활 얘기부터 하죠.",
    status:"들판과 시장, 평의회 사이에서 오늘 필요한 일을 챙기고 있어요.",
    topics:[
      publicTopic("farm","농사",[
        "오미래는 비룡들판 농부다.",
        "오미래는 농업을 생활과 생계의 문제로 본다."
      ],[
        "농사는 거창한 말보다 물과 흙이 먼저예요. 오늘 상태가 내일 수확을 만들죠.",
        "좋은 작물은 혼자 자라지 않아요. 물길, 사람 손, 시장 사정이 다 엮여 있어요."
      ]),
      publicTopic("council","주민대표",[
        "오미래는 평의회 주민대표 역할을 맡는다.",
        "오미래는 정책이 평범한 주민 생활에 미치는 비용을 중요하게 본다."
      ],[
        "회의에서 어려운 말을 많이 해도 결국 누가 얼마를 내고 누가 일을 더 하는지 물어봐야 해요.",
        "좋은 계획도 생활비를 못 견디면 오래 못 가요. 주민대표라면 그걸 먼저 따져야죠."
      ]),
      publicTopic("technology","새 기술",[
        "오미래는 신기술 자체를 반대하지 않는다.",
        "오미래는 생산성뿐 아니라 유지비와 노동 변화도 함께 본다."
      ],[
        "새 도구가 일을 줄여주면 좋죠. 대신 고장 났을 때 누가 고치고 비용은 누가 내는지도 봐야 해요.",
        "기술은 좋고 나쁨보다 누구에게 어떤 부담이 생기는지가 중요해요."
      ])
    ],
    relations:[
      relation("BR_NPC_006","한세온","농기구 시험 협력")
    ],
    locked:["S2_A","S3_A"]
  }),
  BR_NPC_006: profile({
    traits:["빠른 사고","낙관적","호기심 강함"],
    greeting:"새 장치 얘기라면 환영이에요. 다만 지금 공방은 조금 어수선해요.",
    status:"공방 수리와 설계를 번갈아 보면서 오늘도 이것저것 시험 중이에요.",
    topics:[
      publicTopic("craft","공방",[
        "한세온은 신맥공방 공방장이다.",
        "한세온은 제작·수리·연구를 함께 한다."
      ],[
        "공방 일은 새로 만드는 것보다 고치는 일이 더 많아요. 고장 난 물건은 왜 틀렸는지 먼저 알려주거든요.",
        "잘 만든 도구는 쓰는 사람이 구조를 몰라도 안전하게 쓸 수 있어야 해요."
      ]),
      publicTopic("oldtech","옛 기술",[
        "한세온은 고대 맥공학과 현대 공학을 함께 연구한다.",
        "한세온은 과거 기술을 더 안전하게 이해하고 싶어 한다."
      ],[
        "옛 기술이라고 무조건 신비한 건 아니에요. 원리를 알면 비교하고 시험할 수 있어요.",
        "과거에 실패했다는 이유만으로 기술을 버리면 배울 것도 같이 버리게 돼요."
      ]),
      publicTopic("people","현장 사람들",[
        "한세온은 한여울의 누나다.",
        "한세온은 류가람과 측정 데이터를 공유하지만 해석은 자주 다르다."
      ],[
        "여울이는 제가 너무 빨리 간다고 하고, 저는 여울이가 너무 오래 확인한다고 해요. 둘 다 필요한 거겠죠.",
        "가람 씨와는 데이터는 잘 맞는데 결론에서 자주 갈려요. 그래도 수치를 같이 보는 건 중요해요."
      ])
    ],
    relations:[
      relation("BR_NPC_002","한여울","남매"),
      relation("BR_NPC_007","류가람","데이터 협력·해석 갈등")
    ],
    locked:["S2_A","S3_A"]
  }),
  BR_NPC_007: profile({
    traits:["침착","증거 중심","고집 있음"],
    greeting:"숲 이야기를 하려면 먼저 본 것과 추측한 걸 나눠서 말해 주세요.",
    status:"청림 쪽 관찰값을 정리하고 평의회에 보고할 내용을 추리고 있어요.",
    topics:[
      publicTopic("forest","청림",[
        "류가람은 청림회 숲지기 대표다.",
        "류가람은 산림·수질·동물 흔적을 통해 환경 변화를 관찰한다."
      ],[
        "숲은 조용해 보여도 변화가 빨라요. 나무보다 물과 동물 이동이 먼저 신호를 줄 때도 있고요.",
        "청림은 보호구역이면서 생활 자원이기도 해요. 둘 중 하나만 보면 답이 안 나옵니다."
      ]),
      publicTopic("development","개발 기준",[
        "류가람은 모든 개발을 무조건 반대하지 않는다.",
        "류가람은 회복 가능한 채취·개발 기준을 만들고 싶어 한다."
      ],[
        "안 쓰는 게 답이라면 쉬웠겠죠. 문제는 얼마나 써도 회복되는지 아는 거예요.",
        "측정할 수 있다는 것과 통제할 수 있다는 건 다릅니다. 그래서 기준을 보수적으로 잡는 편이에요."
      ]),
      publicTopic("technology","공방과 데이터",[
        "류가람은 한세온과 환경 데이터를 공유한다.",
        "류가람과 한세온은 같은 데이터를 보고도 위험 해석이 다를 때가 있다."
      ],[
        "세온 씨와 수치는 자주 공유해요. 같은 숫자를 보고도 결론이 달라질 수 있다는 게 문제지만요.",
        "공방 기술이 도움이 될 때도 많아요. 다만 실험이 자연보다 빨라지면 경고부터 하게 됩니다."
      ])
    ],
    relations:[
      relation("BR_NPC_006","한세온","데이터 협력·해석 갈등")
    ],
    locked:["S2_A","S3_A"]
  }),
  BR_NPC_008: profile({
    traits:["수다스러움","사람을 잘 읽음","중재적"],
    greeting:"서서 얘기하면 다리가 먼저 삐쳐요. 그래도 지금은 여기서 잠깐 이야기하죠.",
    status:"장보고 밥하고 사람들 얘기 듣는 게 제 하루 대부분이에요.",
    topics:[
      publicTopic("inn","여관",[
        "이담은 여관 겸 식당 주인이다.",
        "이담의 여관은 여러 세력 사람들이 자연스럽게 마주치는 생활 공간이다."
      ],[
        "여관은 방보다 식탁이 더 중요해요. 얼굴 붉힌 사람도 배고프면 결국 같은 솥을 보게 되거든요.",
        "여기선 소문도 밥처럼 돌아요. 다만 들었다고 전부 사실은 아니죠."
      ]),
      publicTopic("village","마을 사람들",[
        "이담은 세대와 세력을 가리지 않고 여러 주민과 오래 알고 지냈다.",
        "이담은 공동체가 완전히 갈라지지 않는 것을 중요하게 여긴다."
      ],[
        "마을은 의견이 같아서 유지되는 게 아니에요. 싫어도 다음 날 또 얼굴 볼 사람들이라 유지되는 거죠.",
        "사람들 생각은 달라도 같이 먹고사는 건 같아요. 그걸 잊으면 싸움이 오래 갑니다."
      ]),
      publicTopic("rumor","소문",[
        "이담은 주민들의 생활사와 관계를 많이 알고 있다.",
        "이담은 소문과 사실을 구분하려고 한다."
      ],[
        "소문은 방향을 알려줄 순 있어도 증거는 아니에요. 궁금하면 결국 직접 확인해야죠.",
        "누가 무슨 말을 했는지보다 왜 그런 말을 했는지를 보면 마을 사정이 좀 보여요."
      ])
    ],
    relations:[
      relation("BR_NPC_005","오미래","생활권 주민"),
      relation("BR_NPC_001","강소라","오래 봐온 젊은 주민")
    ],
    locked:["S2_A","S3_A"]
  })
});

const clampStage = value => Math.min(3, Math.max(1, Number.isInteger(value) ? value : 1));

export function getBiryongDialogueProfile(npcId) {
  return BIRYONG_DIALOGUE_PROFILES[npcId] ?? null;
}

export function biryongDialogueTopics(npcId, relationshipStage = 1) {
  const profile = getBiryongDialogueProfile(npcId);
  if (!profile) return Object.freeze([]);
  const stage = clampStage(relationshipStage);
  return Object.freeze(profile.topics.filter(topic => topic.minStage <= stage));
}

// This intentionally returns only browser-safe Stage-1 facts.
// A future server Relationship projection can append unlocked facts after authority verification.
export function compileBiryongClientKnowledge(npcId, relationshipStage = 1) {
  const profile = getBiryongDialogueProfile(npcId);
  if (!profile) throw new Error("Unknown Biryong dialogue NPC");
  const npc = BIRYONG_VILLAGE_NPC_BY_ID.get(npcId);
  if (!npc) throw new Error("Biryong dialogue profile without NPC runtime identity");
  const stage = clampStage(relationshipStage);
  const topics = biryongDialogueTopics(npcId, stage);
  return Object.freeze({
    npcId,
    name: npc.name,
    role: npc.publicRole,
    faction: npc.faction,
    relationshipStage: stage,
    facts: Object.freeze(topics.flatMap(topic => topic.facts)),
    topicIds: Object.freeze(topics.map(topic => topic.id)),
    relations: profile.relations,
    lockedFactCount: profile.locked.length,
    secretTextShipped: false
  });
}

export function authoredBiryongDialogueLine(npcId, { relationshipStage = 1, topicId = null, mode = "GREETING", salt = 0 } = {}) {
  const profile = getBiryongDialogueProfile(npcId);
  if (!profile) throw new Error("Unknown Biryong dialogue NPC");
  if (mode === "GREETING") return profile.greeting;
  if (mode === "STATUS") return profile.status;
  const topic = biryongDialogueTopics(npcId, relationshipStage).find(item => item.id === topicId);
  if (!topic) throw new Error("Biryong dialogue topic is locked or unknown");
  return topic.lines[Math.abs(Number(salt) || 0) % topic.lines.length];
}

// Safe packet for a future grounded Gemini adapter.
// The packet contains only facts that compileBiryongClientKnowledge has already admitted.
export function buildBiryongGeminiGroundedPacket(npcId, {
  relationshipStage = 1,
  topicId,
  current = null,
  world = null
} = {}) {
  const knowledge = compileBiryongClientKnowledge(npcId, relationshipStage);
  const profile = getBiryongDialogueProfile(npcId);
  const topic = biryongDialogueTopics(npcId, relationshipStage).find(item => item.id === topicId);
  if (!topic || topic.generativeSafe !== true) throw new Error("Biryong topic is not generation-safe");
  return Object.freeze({
    schemaVersion: "biryong-grounded-dialogue-p0",
    npc: Object.freeze({
      id: npcId,
      name: knowledge.name,
      role: knowledge.role,
      faction: knowledge.faction,
      traits: profile.traits
    }),
    topic: Object.freeze({ id: topic.id, label: topic.label }),
    allowedFacts: topic.facts,
    relations: knowledge.relations,
    current: current ? Object.freeze({ ...current }) : null,
    world: world ? Object.freeze({ ...world }) : null,
    constraints: Object.freeze([
      "한국어 1~2문장",
      "allowedFacts 밖의 사실을 만들지 않기",
      "퀘스트·보상·관계 단계·세계 상태를 변경하거나 약속하지 않기",
      "잠긴 비밀을 추측하거나 암시하지 않기",
      "다른 NPC의 비공개 정보를 대신 말하지 않기",
      "행동 제안은 현재 장소에서의 대화 범위를 넘지 않기"
    ]),
    relationshipStage: knowledge.relationshipStage,
    secretTextShipped: false
  });
}
