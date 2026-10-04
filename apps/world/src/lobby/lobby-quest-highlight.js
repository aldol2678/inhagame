import { TOUR_STOPS } from "../campus-layout.js";
import { QUEST_OBJECTIVES } from "../../npc-factory/quest-contract.mjs";
import { MAIN2_QUEST_OBJECTIVES } from "../../npc-factory/main2-quest-contract.mjs";

export const LOBBY_QUEST_SOURCE = Object.freeze({
  WORLD_QUEST: "WORLD_QUEST",
  FIRST_TOUR: "FIRST_TOUR",
  WORLD_QUEST_AVAILABLE: "WORLD_QUEST_AVAILABLE"
});

export function selectLobbyQuest({ tourStage = 0, quest = null, accountSignedIn = false } = {}) {
  const main1 = quest?.quest ?? quest;
  const main2 = quest?.main2Quest ?? null;
  const stage = Number.isInteger(main1?.stage) ? main1.stage : 0;
  const signedIn = accountSignedIn === true || main1?.signedIn === true || main2?.signedIn === true;
  const questUsable = main1?.enabled === true && main1?.signedIn === true && main1?.ready !== false;

  if (questUsable && stage > 0 && stage < 5) {
    return {
      source: LOBBY_QUEST_SOURCE.WORLD_QUEST,
      title: "첫 캠퍼스 탐방",
      objective: QUEST_OBJECTIVES[stage],
      state: "진행 중",
      progress: `${stage} / 5`,
      cta: "탐방 이어가기"
    };
  }

  // CORE-15 C15.1: a signed-in fresh account sees the authoritative quest before the
  // browser-local tour fallback. This keeps the lobby reason aligned with the persistent quest path.
  if (questUsable && stage === 0) {
    return {
      source: LOBBY_QUEST_SOURCE.WORLD_QUEST_AVAILABLE,
      title: "첫 캠퍼스 탐방",
      objective: "정문에서 나나율과 대화",
      state: "시작 가능",
      progress: "0 / 5",
      cta: "첫 탐방 시작하기"
    };
  }

  if (questUsable && stage === 5 && main2?.enabled === true && main2?.signedIn === true &&
      main2?.available === true && main2?.stage < 9) {
    const main2Stage = Number.isInteger(main2.stage) ? main2.stage : 0;
    return {
      source: LOBBY_QUEST_SOURCE.WORLD_QUEST,
      title: "길은 기억해 둘게",
      objective: main2Stage === 0 ? "후문 안쪽 안내 학생과 대화" : MAIN2_QUEST_OBJECTIVES[main2Stage],
      state: main2Stage === 0 ? "시작 가능" : "진행 중",
      progress: `${main2Stage} / 9`,
      cta: "캠퍼스로 들어가기"
    };
  }

  // The browser-local guided tour is guest-only. Signed-in accounts must never
  // resurrect onboarding after their persistent quest chain is complete or unavailable.
  if (!signedIn && Number.isInteger(tourStage) && tourStage >= 0 && tourStage < TOUR_STOPS.length) {
    return {
      source: LOBBY_QUEST_SOURCE.FIRST_TOUR,
      title: "첫 캠퍼스 탐방",
      objective: TOUR_STOPS[tourStage].label,
      state: tourStage === 0 ? "둘러보기" : "진행 중",
      progress: `${tourStage} / ${TOUR_STOPS.length}`,
      cta: tourStage === 0 ? "정문에서 시작하기" : "탐방 이어가기"
    };
  }

  return null;
}

export function createLobbyQuestHighlight({
  root,
  kickerElement,
  stateElement,
  titleElement,
  objectiveElement,
  progressElement,
  ctaElement = globalThis.document?.querySelector?.("#main-gate-start .world-lobby-card-action") ?? null,
  getTourStage = () => 0,
  getQuest = () => null,
  getSignedIn = () => false
} = {}) {
  let current = null;
  let lastKey = null;
  let degraded = false;

  const update = () => {
    let tourStage = TOUR_STOPS.length;
    let questState = null;
    let accountSignedIn = false;
    let readDegraded = false;
    try { tourStage = getTourStage?.(); } catch { readDegraded = true; }
    try { questState = getQuest?.(); } catch { readDegraded = true; }
    try { accountSignedIn = getSignedIn?.() === true; } catch { readDegraded = true; }
    degraded = readDegraded;
    const next = selectLobbyQuest({ tourStage, quest: questState, accountSignedIn });
    const key = JSON.stringify(next);
    if (key === lastKey) return current;
    lastKey = key;
    current = next;

    if (root) root.hidden = !next;
    if (!next) {
      if (ctaElement) ctaElement.textContent = "시작하기 →";
      return null;
    }
    if (kickerElement) kickerElement.textContent = next.state === "진행 중" ? "진행 중인 퀘스트" : "퀘스트";
    if (stateElement) stateElement.textContent = next.state;
    if (titleElement) titleElement.textContent = next.title;
    if (objectiveElement) objectiveElement.textContent = next.objective;
    if (progressElement) progressElement.textContent = next.progress;
    if (ctaElement) ctaElement.textContent = `${next.cta ?? "시작하기"} →`;
    return next;
  };

  update();
  return {
    update,
    status: () => current ? { ...current } : null,
    health: () => ({ degraded })
  };
}
