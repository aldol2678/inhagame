export const MAIN2_QUEST_ID = 'campus_navigation_intro_v1';

export const MAIN2_QUEST_EVENTS = Object.freeze([
  'status',
  'start',
  'set_building5_destination',
  'start_auto_building5',
  'pause_auto_building5',
  'resume_auto_building5',
  'visit_building5',
  'set_back_gate_destination',
  'start_auto_back_gate',
  'visit_back_gate'
]);

export const MAIN2_QUEST_OBJECTIVES = Object.freeze([
  '후문 안내 학생과 대화',
  '지도에서 5호관을 목적지로 설정',
  '5호관 자동이동 시작',
  '자동이동을 한 번 일시정지',
  '자동이동 재개 · 끊겼으면 지도에서 다시 시작',
  '자동이동으로 5호관까지 이동',
  '후문을 목적지로 설정',
  '후문 자동이동 시작',
  '자동이동으로 후문까지 돌아가기',
  '길찾기 익히기 완료'
]);

export function nextMain2QuestStage(stage, event, { available = true } = {}) {
  if (!Number.isInteger(stage) || stage < 0 || stage > 9 || !MAIN2_QUEST_EVENTS.includes(event))
    throw Error('INVALID_QUEST_EVENT');
  if (stage === 0 && event === 'start' && available) return 1;
  if (stage === 1 && event === 'set_building5_destination') return 2;
  if (stage === 2 && event === 'start_auto_building5') return 3;
  if (stage === 3 && event === 'pause_auto_building5') return 4;
  if (stage === 4 && event === 'resume_auto_building5') return 5;
  if (stage === 5 && event === 'visit_building5') return 6;
  if (stage === 6 && event === 'set_back_gate_destination') return 7;
  if (stage === 7 && event === 'start_auto_back_gate') return 8;
  if (stage === 8 && event === 'visit_back_gate') return 9;
  return stage;
}
