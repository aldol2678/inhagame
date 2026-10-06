import { formatQuestGuidance } from '../../npc-factory/quest-guidance.mjs';
import { QUEST_STATE, QUEST_TYPE } from './quest-runtime.js';

const ACTIONABLE = new Set([QUEST_STATE.AVAILABLE, QUEST_STATE.ACTIVE]);

function headingFor(quest) {
  if (quest.type === QUEST_TYPE.MAIN) {
    return `MAIN ${String(quest.sequence).padStart(2, '0')} · ${quest.title}`;
  }
  return `SIDE · ${quest.title}`;
}

export function createTrackedQuestHud({
  root,
  openButton,
  headingElement,
  objectiveElement,
  bearingElement,
  runtime,
  getTarget = () => null,
  getPlayerPosition = () => null,
  getYaw = () => 0,
  onOpenJournal = () => false
} = {}) {
  if (!root || !openButton || !headingElement || !objectiveElement || !bearingElement || !runtime) {
    throw new Error('Tracked Quest HUD requires DOM elements and Quest Runtime');
  }

  let trackedQuest = null;

  function sync(snapshot = runtime.snapshot) {
    const quest = snapshot.quests.find(item =>
      item.questId === snapshot.trackedQuestId && ACTIONABLE.has(item.state)
    ) ?? null;
    trackedQuest = quest;
    // Keep the existing action slot visible while Main 2 status is unavailable, without
    // turning a failed read into an authoritative quest objective or map target.
    const recovering = !quest && snapshot.quests.some(item => item.sequence === 1 && item.state === QUEST_STATE.COMPLETED) &&
      ['LOADING', 'RETRY', 'UNAVAILABLE'].includes(snapshot.main2StatusState);

    const visible = Boolean(quest?.currentObjective) || recovering;
    root.hidden = !visible;
    openButton.disabled = !quest;
    if (recovering) {
      delete root.dataset.questId;
      root.dataset.state = snapshot.main2StatusState;
      headingElement.textContent = 'MAIN 02 · 퀘스트 확인';
      objectiveElement.textContent = snapshot.main2StatusState === 'UNAVAILABLE'
        ? '퀘스트를 불러오지 못했어요' : '퀘스트 확인 중…';
      bearingElement.textContent = '';
      bearingElement.hidden = true;
      openButton.setAttribute('aria-label', 'Main 2 상태 확인');
      return null;
    }
    if (!visible) {
      delete root.dataset.questId;
      delete root.dataset.state;
      headingElement.textContent = '';
      objectiveElement.textContent = '';
      bearingElement.textContent = '';
      bearingElement.hidden = true;
      return null;
    }

    root.dataset.questId = quest.questId;
    root.dataset.state = quest.state;
    headingElement.textContent = headingFor(quest);
    objectiveElement.textContent = quest.currentObjective.text;
    openButton.setAttribute('aria-label', `퀘스트 열기: ${quest.title}`);
    return quest;
  }

  function update() {
    if (!trackedQuest || root.hidden) return null;
    const target = getTarget(trackedQuest);
    const position = getPlayerPosition();
    const yaw = getYaw();
    const guidance = formatQuestGuidance(target, position, yaw, { interactionHint: true });
    bearingElement.textContent = guidance;
    bearingElement.hidden = !guidance;
    return guidance;
  }

  const onClick = () => {
    if (!trackedQuest) return false;
    return onOpenJournal(trackedQuest) !== false;
  };
  openButton.addEventListener('click', onClick);
  const offRuntime = runtime.onChange(sync);

  sync();
  update();

  return {
    sync,
    update,
    get quest() { return trackedQuest; },
    destroy() {
      offRuntime?.();
      openButton.removeEventListener?.('click', onClick);
    }
  };
}
