import { renderMain3GuideDialogue } from './main3-guide-dialogue.mjs';
import { createHumanAvatar } from './dev-human-avatar.mjs';
import { roadviewGroundHeight } from '../src/roadview-layout.js';
import { MAIN2_QUEST_OBJECTIVES } from './main2-quest-contract.mjs';
import { MAIN2_GUIDE_APPEARANCE, MAIN2_GUIDE_COPY, MAIN2_GUIDE_NPC } from './main2-guide-contract.mjs';

export const MAIN2_GUIDE_CONTEXT_PRIORITY = 310;

function make(documentLike, tag, className, value) {
  const node = documentLike.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = value;
  return node;
}

function createGuideUi(documentLike) {
  const root = make(documentLike, 'section', 'main2-guide-dialogue');
  root.id = 'main2-guide-dialogue';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', MAIN2_GUIDE_NPC.name + '과의 대화');

  const header = make(documentLike, 'div', 'main2-guide-dialogue-header');
  const portrait = make(documentLike, 'span', 'main2-guide-dialogue-portrait', '길');
  portrait.setAttribute('aria-hidden', 'true');
  const identity = make(documentLike, 'div', 'main2-guide-dialogue-identity');
  identity.append(
    make(documentLike, 'strong', null, MAIN2_GUIDE_NPC.name),
    make(documentLike, 'small', null, MAIN2_GUIDE_NPC.role)
  );
  const close = make(documentLike, 'button', 'main2-guide-dialogue-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', '대화 닫기');
  header.append(portrait, identity, close);

  const line = make(documentLike, 'p', 'main2-guide-dialogue-line');
  line.setAttribute('aria-live', 'polite');
  const choices = make(documentLike, 'div', 'main2-guide-dialogue-choices');
  root.append(header, line, choices);
  documentLike.body.appendChild(root);
  return { root, close, line, choices };
}

export function createMain2GuideRuntime({
  root,
  player,
  quest,
  firstStyleQuest = null,
  documentLike = globalThis.document,
  onConversationOpen = () => {},
  onConversationClose = () => {}
} = {}) {
  if (!root || !player || !quest || !documentLike) throw new Error('Main 2 guide requires root, player, quest and document');

  const visual = createHumanAvatar(root, { id: MAIN2_GUIDE_NPC.id }, MAIN2_GUIDE_APPEARANCE);
  visual.marker.enabled = false;
  visual.identityMarker.enabled = false;
  visual.avatar.setLocalPosition(
    MAIN2_GUIDE_NPC.position.x,
    roadviewGroundHeight(MAIN2_GUIDE_NPC.position.x, MAIN2_GUIDE_NPC.position.z),
    MAIN2_GUIDE_NPC.position.z
  );

  const ui = createGuideUi(documentLike);
  const keyTarget = documentLike.defaultView ?? globalThis;
  let dialogueOpen = false;
  let dialogueRevision = 0;
  let elapsed = 0;
  let yaw = 0;

  const distanceToPlayer = () => {
    const p = player.getLocalPosition();
    return Math.hypot(p.x - MAIN2_GUIDE_NPC.position.x, p.z - MAIN2_GUIDE_NPC.position.z);
  };

  function addChoice(label, onClick) {
    const button = make(documentLike, 'button', 'main2-guide-dialogue-choice', label);
    button.type = 'button';
    button.addEventListener('click', onClick);
    ui.choices.appendChild(button);
    return button;
  }

  function renderDialogue() {
    const status = quest.status();
    const revision = ++dialogueRevision;
    ui.choices.replaceChildren();

    if (!status.enabled) {
      ui.line.textContent = '지금은 길찾기 퀘스트를 불러올 수 없어요.';
      addChoice('닫기', closeDialogue);
      return;
    }
    if (!status.signedIn) {
      ui.line.textContent = MAIN2_GUIDE_COPY.signedOut;
      addChoice('닫기', closeDialogue);
      return;
    }
    if (!status.available) {
      ui.line.textContent = MAIN2_GUIDE_COPY.locked;
      addChoice('알겠어요', closeDialogue);
      return;
    }
    if (status.complete && renderMain3GuideDialogue({
      quest: firstStyleQuest, line: ui.line,
      clearChoices: () => ui.choices.replaceChildren(), addChoice, closeDialogue,
      isCurrent: () => dialogueOpen && revision === dialogueRevision
    })) return;
    if (status.complete) {
      ui.line.textContent = MAIN2_GUIDE_COPY.complete;
      addChoice('고마워요', closeDialogue);
      return;
    }
    if (status.stage === 0) {
      ui.line.textContent = MAIN2_GUIDE_COPY.ready;
      const start = addChoice('길찾기 연습 시작', async () => {
        start.disabled = true;
        ui.line.textContent = '진행 상태 확인 중…';
        try {
          const result = await quest.startFromGuide();
          ui.line.textContent = result?.stage === 1
            ? MAIN2_GUIDE_COPY.started
            : '첫 탐방 완료 상태를 다시 확인해 주세요.';
        } catch {
          ui.line.textContent = '지금은 진행 상태를 저장하지 못했어요. 다시 시도해 주세요.';
        }
        ui.choices.replaceChildren();
        addChoice('출발할게요', closeDialogue);
      });
      addChoice('다음에 할게요', closeDialogue);
      return;
    }

    const objective = MAIN2_QUEST_OBJECTIVES[status.stage] ?? status.objective ?? '길찾기 연습';
    ui.line.textContent = '지금 목표는 “‘' + objective + '’”예요. 막히면 지도와 자동이동 표시를 확인해 보세요.';
    addChoice('알겠어요', closeDialogue);
  }

  function openDialogue() {
    if (dialogueOpen || distanceToPlayer() > MAIN2_GUIDE_NPC.interactionRadius) return false;
    dialogueOpen = true;
    onConversationOpen();
    ui.root.hidden = false;
    renderDialogue();
    ui.choices.firstChild?.focus?.({ preventScroll: true });
    return true;
  }

  function closeDialogue() {
    if (!dialogueOpen) return false;
    dialogueOpen = false;
    dialogueRevision++;
    ui.root.hidden = true;
    onConversationClose();
    return true;
  }

  ui.close.addEventListener('click', closeDialogue);
  const onKey = event => {
    if (!dialogueOpen || event.repeat) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialogue();
    }
  };
  keyTarget.addEventListener?.('keydown', onKey);

  function update(dt) {
    dt = Math.min(Number.isFinite(dt) ? dt : 0, 0.05);
    elapsed += dt;
    const status = quest.status();
    visual.avatar.enabled = status.enabled === true;
    if (!visual.avatar.enabled) {
      closeDialogue();
      return;
    }

    const distance = distanceToPlayer();
    if (dialogueOpen && distance > MAIN2_GUIDE_NPC.releaseRadius) closeDialogue();
    if (distance < 7) {
      const p = player.getLocalPosition();
      const target = Math.atan2(
        p.x - MAIN2_GUIDE_NPC.position.x,
        p.z - MAIN2_GUIDE_NPC.position.z
      ) * 180 / Math.PI;
      const delta = ((target - yaw + 540) % 360) - 180;
      yaw += delta * Math.min(1, dt * 4);
    }
    visual.avatar.setLocalEulerAngles(0, yaw, 0);
    const sway = Math.sin(elapsed * 1.5) * 3.5;
    visual.arms.forEach((arm, index) => arm.setLocalEulerAngles(sway * (index ? 1 : -1), 0, 0));
  }

  function getContextAction() {
    const status = quest.status();
    if (!status.enabled || dialogueOpen) return null;
    const distance = distanceToPlayer();
    if (distance > MAIN2_GUIDE_NPC.interactionRadius) return null;
    return {
      id: 'main2-guide-talk',
      icon: '💬',
      label: MAIN2_GUIDE_NPC.name + '과 대화',
      compactLabel: '대화',
      shortcut: 'F',
      priority: MAIN2_GUIDE_CONTEXT_PRIORITY,
      distance,
      pressed: false,
      trigger: openDialogue
    };
  }

  return Object.freeze({
    update,
    getContextAction,
    isDialogueOpen: () => dialogueOpen,
    closeDialogue,
    status: () => Object.freeze({
      visible: visual.avatar.enabled,
      dialogueOpen,
      distance: distanceToPlayer(),
      quest: quest.status()
    }),
    destroy() {
      keyTarget.removeEventListener?.('keydown', onKey);
      closeDialogue();
      visual.avatar.destroy?.();
      ui.root.remove();
    }
  });
}
