import { MAIN3_QUEST_OBJECTIVES } from './main3-quest-contract.mjs';

// Rendering only; the existing guide owns the dialog and the Main3 client owns server readback.
export function renderMain3GuideDialogue({ quest, line, clearChoices, addChoice, closeDialogue, isCurrent }) {
  const status = quest?.status?.();
  if (!status?.enabled || !status.signedIn) return false;
  clearChoices();
  if (!status.ready) {
    line.textContent = '캠퍼스룩 퀘스트 상태를 확인하지 못했어요. 다시 확인해 주세요.';
    const retry = addChoice('다시 확인', async () => {
      retry.disabled = true;
      try { await quest.refresh(); } catch { /* keep the retry affordance */ }
      if (isCurrent()) renderMain3GuideDialogue({ quest, line, clearChoices, addChoice, closeDialogue, isCurrent });
    });
    addChoice('닫기', closeDialogue);
  } else if (!status.available) {
    line.textContent = '길찾기 퀘스트 완료 상태를 확인하고 있어요. 잠시 후 다시 이야기해 주세요.';
    addChoice('알겠어요', closeDialogue);
  } else if (status.stage === 0) {
    line.textContent = '이제 길찾기는 할 줄 알겠네요. 아까 받은 인덕코인도 봤죠? 학생회관 굿즈샵에 가면 쓸 수 있어요. 처음이면 인덕 캠퍼스 캡을 한번 봐도 좋아요.';
    const start = addChoice('굿즈샵 가보기', async () => {
      if (start.disabled) return;
      start.disabled = true;
      line.textContent = '진행 상태 확인 중…';
      try {
        const result = await quest.startFromGuide();
        if (!isCurrent()) return;
        line.textContent = result?.stage >= 1
          ? '학생회관 굿즈샵으로 가 보세요. 지도와 퀘스트의 길 안내를 이용할 수 있어요.'
          : '진행 상태를 다시 확인해 주세요.';
      } catch {
        if (!isCurrent()) return;
        line.textContent = '지금은 진행 상태를 저장하지 못했어요. 다시 대화하면 재시도할 수 있어요.';
      }
      clearChoices();
      addChoice('알겠어요', closeDialogue);
    });
    addChoice('다음에 할게요', closeDialogue);
  } else {
    line.textContent = status.stage === 4 ? '나만의 캠퍼스룩을 준비했네요!'
      : status.stage === 2 ? '굿즈샵 방문을 기록했어요. 구매·장착 확인은 다음 단계에서 연결될 예정이에요. 이미 구매한 물건은 다시 살 필요 없어요.'
        : MAIN3_QUEST_OBJECTIVES[status.stage] ?? '캠퍼스룩 퀘스트를 확인해 주세요.';
    addChoice('알겠어요', closeDialogue);
  }
  return true;
}
