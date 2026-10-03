import {
  QUEST_ID_MAIN_FIRST_CAMPUS,
  QUEST_ID_MAIN_NAVIGATION_INTRO,
  QUEST_STATE,
  QUEST_TYPE
} from './quest-registry.js';
import {
  adaptMain1QuestStatus,
  adaptMain2QuestStatus
} from './legacy-quest-adapters.js';

function frozenSnapshot({ signedIn, loading, quests, trackedQuestId, main2StatusState = null }) {
  return Object.freeze({
    signedIn: Boolean(signedIn),
    loading: Boolean(loading),
    main2StatusState,
    trackedQuestId: trackedQuestId ?? null,
    quests: Object.freeze([...quests])
  });
}

function preferredTrack(quests) {
  return quests.find(quest => quest.state === QUEST_STATE.ACTIVE)?.questId
    ?? quests.find(quest => quest.state === QUEST_STATE.AVAILABLE)?.questId
    ?? null;
}

export function createQuestRuntime() {
  let listeners = new Set();
  let trackedQuestId = null;
  let snapshot = frozenSnapshot({ signedIn: false, loading: false, quests: [], trackedQuestId: null });

  const publish = () => {
    for (const listener of listeners) listener(snapshot);
  };

  const update = (legacy = null) => {
    const main1 = legacy?.quest ?? null;
    const main2 = legacy?.main2Quest ?? null;
    const signedIn = main1?.signedIn === true || main2?.signedIn === true;
    const loading = signedIn && !(
      main1?.ready === true || main2?.ready === true
    );
    const quests = [];

    if (main1?.signedIn === true && main1?.ready === true) {
      quests.push(adaptMain1QuestStatus({
        quest_id: 'campus_first_walk_v1',
        stage: main1.stage
      }, { trackedQuestId }));
    }

    if (main2?.signedIn === true && main2?.ready === true) {
      quests.push(adaptMain2QuestStatus({
        quest_id: 'campus_navigation_intro_v1',
        stage: main2.stage,
        available: main2.available === true
      }, {
        main1Complete: main1?.complete === true,
        trackedQuestId
      }));
    }

    if (!signedIn) trackedQuestId = null;
    const tracked = quests.find(quest => quest.questId === trackedQuestId);
    if (!tracked || [QUEST_STATE.COMPLETED, QUEST_STATE.CLAIMED, QUEST_STATE.EXPIRED].includes(tracked.state)) {
      trackedQuestId = preferredTrack(quests);
    }

    snapshot = frozenSnapshot({
      signedIn,
      loading,
      main2StatusState: main2?.enabled === true && main2.signedIn === true ? main2.statusState ?? null : null,
      quests: quests.map(quest => Object.freeze({
        ...quest,
        tracked: quest.questId === trackedQuestId
      })),
      trackedQuestId
    });
    publish();
    return snapshot;
  };

  const setTrackedQuestId = (questId) => {
    const quest = snapshot.quests.find(item => item.questId === questId);
    if (!quest || ![QUEST_STATE.ACTIVE, QUEST_STATE.AVAILABLE].includes(quest.state)) return false;
    if (trackedQuestId === questId) return true;
    trackedQuestId = questId;
    snapshot = frozenSnapshot({
      signedIn: snapshot.signedIn,
      loading: snapshot.loading,
      main2StatusState: snapshot.main2StatusState,
      quests: snapshot.quests.map(item => Object.freeze({ ...item, tracked: item.questId === trackedQuestId })),
      trackedQuestId
    });
    publish();
    return true;
  };

  return {
    update,
    setTrackedQuestId,
    get snapshot() { return snapshot; },
    get trackedQuestId() { return trackedQuestId; },
    list(type = null) {
      return type == null ? [...snapshot.quests] : snapshot.quests.filter(quest => quest.type === type);
    },
    tracked() {
      return snapshot.quests.find(quest => quest.questId === trackedQuestId) ?? null;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      trackedQuestId = null;
      snapshot = frozenSnapshot({ signedIn: false, loading: false, quests: [], trackedQuestId: null });
      publish();
    }
  };
}

export {
  QUEST_ID_MAIN_FIRST_CAMPUS,
  QUEST_ID_MAIN_NAVIGATION_INTRO,
  QUEST_STATE,
  QUEST_TYPE
};
