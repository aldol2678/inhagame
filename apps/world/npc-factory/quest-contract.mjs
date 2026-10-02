import { MAIN_NPC_ID, QUEST_NPC_ID } from './npc-presence.mjs';

export const QUEST_ID = 'campus_first_walk_v1';
export const QUEST_EVENTS = Object.freeze(['status', 'start', 'visit_main_hall', 'visit_inkyung', 'talk_002', 'talk_001']);
export const QUEST_OBJECTIVES = Object.freeze([
  '정문에서 나나율과 대화',
  '본관 앞 방문',
  '인경호 방문',
  '인경호에서 가유담과 대화',
  '정문으로 돌아가 나나율과 대화',
  '첫 캠퍼스 탐방 완료'
]);

export function questEventForNpc(stage, npcId) {
  if (npcId === MAIN_NPC_ID && stage === 0) return 'start';
  if (npcId === QUEST_NPC_ID && stage === 3) return 'talk_002';
  if (npcId === MAIN_NPC_ID && stage === 4) return 'talk_001';
  return null;
}

export function nextQuestStage(stage, event) {
  if (!Number.isInteger(stage) || stage < 0 || stage > 5 || !QUEST_EVENTS.includes(event))
    throw Error('INVALID_QUEST_EVENT');
  if (stage === 0 && event === 'start') return 1;
  if (stage === 1 && event === 'visit_main_hall') return 2;
  if (stage === 2 && event === 'visit_inkyung') return 3;
  if (stage === 3 && event === 'talk_002') return 4;
  if (stage === 4 && event === 'talk_001') return 5;
  return stage;
}

export function questReply(event) {
  return {
    start: '본관 앞을 둘러본 뒤 인경호로 가 봐요. 거기서 가유담을 만나면 다시 정문으로 돌아오세요.',
    talk_002: '나나율에게 이야기를 들었군요. 정문으로 돌아가 오늘 본 캠퍼스 이야기를 전해 주세요.',
    talk_001: '본관과 인경호를 둘러보고 가유담까지 만났군요. 첫 탐방을 마쳤어요! 다음은 후문 안쪽의 안내 학생에게 가 보세요. 지도에 다음 목표가 표시될 거예요.'
  }[event] ?? '';
}
