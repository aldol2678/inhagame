import { INCOME_CONVENIENCE_LOCATION } from './income-convenience-location.mjs';
// Authored fictional game character. Independent of generated campus population and their jobs.
export const CONVENIENCE_EMPLOYER = Object.freeze({
  id:'BACKGATE-NPC-001', name:'도유진', role:'후문 편의점 담당', fictional:true,
  traits:Object.freeze(['차분함','꼼꼼함']), interests:Object.freeze(['요리','재고 정리']),
  buildingId:INCOME_CONVENIENCE_LOCATION.buildingId,
  greeting:'어서 와요. 물건이 필요한 자리에 잘 놓여 있으면 하루가 한결 편해져요.',
  briefing:'짧은 근무는 진열 확인, 계산, 마무리 정리 순서예요. 지금은 현장 연결을 검토 중이라 출근과 급여 지급은 닫혀 있어요.'
});
