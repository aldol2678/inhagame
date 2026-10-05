import { QUEST_STATE, QUEST_TYPE } from './quest-runtime.js';

const STATE_TEXT = Object.freeze({
  [QUEST_STATE.LOCKED]: '잠김',
  [QUEST_STATE.AVAILABLE]: '진행 가능',
  [QUEST_STATE.ACTIVE]: '진행 중',
  [QUEST_STATE.COMPLETED]: '완료',
  [QUEST_STATE.CLAIMED]: '완료',
  [QUEST_STATE.EXPIRED]: '종료',
  [QUEST_STATE.COOLDOWN]: '대기 중'
});

function displayTitle(quest) {
  return quest.type === QUEST_TYPE.MAIN && quest.state === QUEST_STATE.LOCKED
    ? '다음 이야기'
    : quest.title;
}

export function createQuestJournal({
  panel,
  runtime,
  onNavigate = () => false,
  onOpenChange = () => {},
  doc = globalThis.document
} = {}) {
  if (!panel || !runtime) throw new Error('Quest Journal requires panel and runtime');

  const el = (tag, className = '', text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  let open = false;
  let tab = QUEST_TYPE.MAIN;
  let selectedQuestId = null;
  let lastTrackedQuestId = null;
  let closeButton = null;

  const chooseSelection = (quests) => {
    const trackedQuestId = quests.find(quest => quest.tracked)?.questId ?? null;
    const selectedStillExists = quests.some(quest => quest.questId === selectedQuestId);

    // Follow an automatic tracking handoff only when the detail was showing the previously tracked
    // quest. A player who deliberately selected a completed record keeps that selection.
    if (selectedQuestId && selectedQuestId === lastTrackedQuestId &&
        trackedQuestId && trackedQuestId !== lastTrackedQuestId) {
      selectedQuestId = trackedQuestId;
    } else if (!selectedStillExists) {
      selectedQuestId = trackedQuestId
        ?? quests.find(quest => quest.state === QUEST_STATE.ACTIVE)?.questId
        ?? quests.find(quest => quest.state === QUEST_STATE.AVAILABLE)?.questId
        ?? quests[0]?.questId
        ?? null;
    }

    lastTrackedQuestId = trackedQuestId;
    return selectedQuestId;
  };

  const renderEmpty = (body, snapshot) => {
    if (!snapshot.signedIn) {
      body.append(el('p', 'quest-journal-empty', '로그인하면 메인·서브 퀘스트 진행도가 계정에 저장돼요.'));
      return;
    }
    if (snapshot.loading) {
      body.append(el('p', 'quest-journal-empty', '퀘스트를 불러오는 중…'));
      return;
    }
    body.append(el('p', 'quest-journal-empty',
      tab === QUEST_TYPE.SIDE ? '아직 받은 서브 퀘스트가 없어요.' : '표시할 메인 퀘스트가 없어요.'));
  };

  const renderDetail = (quest) => {
    const detail = el('section', 'quest-journal-detail');
    if (!quest) {
      detail.append(el('p', 'quest-journal-empty', '퀘스트를 선택해 주세요.'));
      return detail;
    }

    const kicker = el('span', 'quest-journal-kicker',
      quest.type === QUEST_TYPE.MAIN ? `MAIN ${String(quest.sequence).padStart(2, '0')}` : 'SIDE');
    const title = el('h3', '', displayTitle(quest));
    const status = el('span', 'quest-journal-state', STATE_TEXT[quest.state] ?? quest.state);
    status.dataset.state = quest.state;
    detail.append(kicker, title, status);

    if (quest.state === QUEST_STATE.LOCKED) {
      detail.append(el('p', 'quest-journal-description', '이전 메인 퀘스트를 완료하면 다음 이야기가 열립니다.'));
      return detail;
    }

    const definitionDescription = quest.description ?? null;
    if (definitionDescription) detail.append(el('p', 'quest-journal-description', definitionDescription));

    if (quest.currentObjective) {
      const objectiveBox = el('div', 'quest-journal-objective');
      objectiveBox.append(el('span', 'quest-journal-objective-label', '현재 목표'));
      objectiveBox.append(el('strong', '', quest.currentObjective.text));
      detail.append(objectiveBox);
    } else if ([QUEST_STATE.COMPLETED, QUEST_STATE.CLAIMED].includes(quest.state)) {
      detail.append(el('p', 'quest-journal-complete', '✓ 이 퀘스트를 완료했어요.'));
    }

    const progress = el('div', 'quest-journal-progress');
    const progressText = el('span', '', `${quest.progress.completed} / ${quest.progress.total}`);
    const meter = el('progress', '');
    meter.max = Math.max(1, quest.progress.total);
    meter.value = Math.min(quest.progress.completed, quest.progress.total);
    progress.append(el('span', '', '진행도'), progressText, meter);
    detail.append(progress);

    if ([QUEST_STATE.ACTIVE, QUEST_STATE.AVAILABLE].includes(quest.state)) {
      const actions = el('div', 'quest-journal-actions');
      if (quest.currentObjective?.navigationTarget) {
        const navigate = el('button', 'quest-journal-primary', '길 안내 시작');
        navigate.type = 'button';
        navigate.addEventListener('click', () => onNavigate(quest.currentObjective.navigationTarget, quest));
        actions.append(navigate);
      }
      const track = el('button', 'quest-journal-secondary', quest.tracked ? 'HUD 추적 중' : 'HUD에서 추적');
      track.type = 'button';
      track.disabled = quest.tracked;
      track.addEventListener('click', () => {
        runtime.setTrackedQuestId(quest.questId);
        render();
      });
      actions.append(track);
      detail.append(actions);
    }

    return detail;
  };

  function render() {
    if (!open) return;
    const snapshot = runtime.snapshot;

    const head = el('div', 'shop-panel-head');
    const titles = el('div', 'shop-panel-titles');
    const title = el('h2', '', '📜 퀘스트');
    title.id = 'quest-journal-title';
    titles.append(title, el('p', 'quest-journal-summary', '진행 중인 목표와 완료 기록을 한곳에서 확인합니다.'));
    closeButton = el('button', 'profile-close', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', '퀘스트 닫기');
    closeButton.addEventListener('click', () => setOpen(false));
    head.append(titles, closeButton);

    const tabs = el('div', 'quest-journal-tabs');
    for (const [type, label] of [[QUEST_TYPE.MAIN, '메인'], [QUEST_TYPE.SIDE, '서브']]) {
      const button = el('button', 'quest-journal-tab', label);
      button.type = 'button';
      button.dataset.type = type;
      button.setAttribute('aria-pressed', String(tab === type));
      button.addEventListener('click', () => {
        tab = type;
        selectedQuestId = null;
        render();
      });
      tabs.append(button);
    }

    const body = el('div', 'quest-journal-body');
    const quests = snapshot.quests.filter(quest => quest.type === tab);
    if (!quests.length) {
      renderEmpty(body, snapshot);
    } else {
      chooseSelection(quests);
      const list = el('div', 'quest-journal-list');
      for (const quest of quests) {
        const button = el('button', 'quest-journal-item');
        button.type = 'button';
        button.dataset.questId = quest.questId;
        button.dataset.state = quest.state;
        button.setAttribute('aria-pressed', String(quest.questId === selectedQuestId));
        const name = el('strong', '', displayTitle(quest));
        const meta = el('span', '', `${STATE_TEXT[quest.state] ?? quest.state} · ${quest.progress.completed}/${quest.progress.total}`);
        button.append(name, meta);
        if (quest.tracked) button.append(el('small', 'quest-journal-tracked', '추적 중'));
        button.addEventListener('click', () => {
          selectedQuestId = quest.questId;
          render();
        });
        list.append(button);
      }
      const selected = quests.find(quest => quest.questId === selectedQuestId) ?? null;
      body.append(list, renderDetail(selected));
    }

    panel.replaceChildren(head, tabs, body);
  }

  function setOpen(next) {
    const value = Boolean(next);
    if (value === open) return open;
    open = value;
    panel.hidden = !open;
    if (open) {
      render();
      onOpenChange(true);
      closeButton?.focus?.();
    } else {
      panel.replaceChildren();
      onOpenChange(false);
    }
    return open;
  }

  runtime.onChange(() => render());
  panel.addEventListener('pointerdown', event => event.stopPropagation());
  doc.addEventListener('keydown', event => {
    if (open && event.code === 'Escape') setOpen(false);
  });

  return {
    get open() { return open; },
    get tab() { return tab; },
    get selectedQuestId() { return selectedQuestId; },
    setOpen,
    render
  };
}
