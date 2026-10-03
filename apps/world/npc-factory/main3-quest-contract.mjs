export const MAIN3_QUEST_ID = 'campus_first_style_v1';

export const MAIN3_QUEST_EVENTS = Object.freeze([
  'status',
  'start'
]);

export const MAIN3_QUEST_OBJECTIVES = Object.freeze([
  '후문 안내 학생과 대화',
  '학생회관 굿즈샵으로 가 보자',
  '굿즈샵에서 마음에 드는 물건을 하나 골라 보자',
  '옷장에서 보유한 착용 아이템을 장착해 보자',
  '내 첫 캠퍼스룩 완료'
]);

export function nextMain3QuestStage(stage, event, { available = true } = {}) {
  if (!Number.isInteger(stage) || stage < 0 || stage > 4 || !MAIN3_QUEST_EVENTS.includes(event))
    throw Error('INVALID_QUEST_EVENT');
  if (stage === 0 && event === 'start' && available) return 1;
  return stage;
}
