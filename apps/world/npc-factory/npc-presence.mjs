export const MAIN_NPC_ID = 'INKYUNG-NPC-001';
export const QUEST_NPC_ID = 'INKYUNG-NPC-002';

// Runtime attendance only. The reviewed A-R1 source schedule stays unchanged.
const presentIds = {
  morning: [1, 2, 3, 5, 6, 8, 10, 11, 12, 14, 17, 19],
  class_time: [1, 3, 5, 6, 9, 10, 12, 13, 17, 19],
  lunch: [1, 2, 3, 4, 6, 7, 9, 10, 11, 13, 14, 15, 17, 19],
  evening: [1, 2, 4, 6, 7, 9, 12, 14, 19],
  night: [1, 2, 14, 17, 20]
};
export const PRESENT_NPC_IDS = Object.freeze(Object.fromEntries(
  Object.entries(presentIds).map(([period, ids]) => [period, new Set(ids.map(id => `INKYUNG-NPC-${String(id).padStart(3, '0')}`))])
));

const mainDialogue = Object.freeze({
  morning: ['안녕하세요. 정문에서 오늘의 이야기를 시작해 볼까요?', '아침에는 이곳에서 사람들을 맞이하고 있어요.'],
  class_time: ['수업 시간에도 정문에서 만날 수 있어요.', '잠깐 쉬고 싶다면 여기서 이야기해요.'],
  lunch: ['점심에도 정문에 있어요. 천천히 둘러봐요.', '산책하다가 궁금한 게 생기면 이야기해요.'],
  evening: ['저녁에도 정문에서 만날 수 있어요.', '오늘 캠퍼스에서 있었던 일을 들려줄래요?']
});
const guideDialogue = Object.freeze({
  morning: ['인경호 사진 지점을 둘러보고 있어요.', '아침에는 호수 풍경이 또 다르게 보여요.'],
  class_time: ['수업 시간에도 이 사진 지점에 있어요.', '잠깐 풍경을 보며 쉬어 가도 좋아요.'],
  lunch: ['점심 무렵에는 인경호가 한결 활기차요.', '사진을 찍기 전에 구도를 살펴보고 있어요.'],
  evening: ['저녁에도 이곳에서 만날 수 있어요.', '오늘 본 풍경을 떠올리며 쉬고 있어요.']
});

export function runtimePresence(npc, period) {
  // The reviewed source has four slots; night reuses its evening content.
  const sourcePeriod = period === 'night' ? 'evening' : period;
  if (npc.npc_id === MAIN_NPC_ID) return {
    slot: { location: 'main_gate', activity: 'wait', social_mode: 'high' },
    dialogue: mainDialogue[sourcePeriod]
  };
  if (npc.npc_id === QUEST_NPC_ID) return {
    slot: { location: 'inkyung_photo_point', activity: 'wait', social_mode: 'medium' },
    dialogue: guideDialogue[sourcePeriod]
  };
  const slot = npc.schedule[sourcePeriod];
  const expandedNpc = Number(npc.npc_id.slice(-3)) > 20;
  if (expandedNpc) {
    const visible = period !== 'night' || slot.location?.startsWith('life_dorm_');
    return {
      slot: visible ? slot : { location: 'off_zone', activity: 'leave_zone', social_mode: 'low' },
      dialogue: npc.dialogue_hooks[sourcePeriod]
    };
  }
  const residenceVisible = slot.location?.startsWith('life_dorm_');
  return {
    slot: PRESENT_NPC_IDS[period]?.has(npc.npc_id) || residenceVisible ? slot :
      { location: 'off_zone', activity: 'leave_zone', social_mode: 'low' },
    dialogue: npc.dialogue_hooks[sourcePeriod]
  };
}
