export const NPC_DIALOGUE_STATE = Object.freeze({
  HOME: 'HOME',
  STATUS: 'STATUS',
  TOPICS: 'TOPICS',
  TOPIC_RESPONSE: 'TOPIC_RESPONSE',
  MEMORY: 'MEMORY',
  QUEST: 'QUEST'
});

export const NPC_DIALOGUE_ACTION = Object.freeze({
  QUEST: 'QUEST',
  STATUS: 'STATUS',
  TOPICS: 'TOPICS',
  MEMORY: 'MEMORY',
  CLOSE: 'CLOSE'
});

const TOPIC_LABELS = Object.freeze({
  architecture: '건축',
  birdwatching: '새 관찰',
  coding: '코딩',
  coffee: '커피',
  cooking: '요리',
  cycling: '자전거',
  design: '디자인',
  film: '영화',
  languages: '언어',
  music: '음악',
  photography: '사진',
  plants: '식물',
  reading: '독서',
  sketching: '스케치',
  walking: '산책'
});

export function npcTopicLabel(topic) {
  if (typeof topic !== 'string' || !topic) return '관심사';
  return TOPIC_LABELS[topic] ?? topic.replaceAll('_', ' ');
}

export function hasNpcDialogueMemory(record) {
  return Boolean(record && ((Number.isInteger(record.encounters) && record.encounters > 0) || record.topic));
}

export function npcDialogueHomeActions({ hasPriority = false, hasMemory = false } = {}) {
  return Object.freeze([
    ...(hasPriority ? [NPC_DIALOGUE_ACTION.QUEST] : []),
    NPC_DIALOGUE_ACTION.STATUS,
    NPC_DIALOGUE_ACTION.TOPICS,
    ...(hasMemory ? [NPC_DIALOGUE_ACTION.MEMORY] : []),
    NPC_DIALOGUE_ACTION.CLOSE
  ]);
}

const ALLOWED = Object.freeze({
  [NPC_DIALOGUE_STATE.HOME]: new Set([
    NPC_DIALOGUE_STATE.STATUS, NPC_DIALOGUE_STATE.TOPICS, NPC_DIALOGUE_STATE.MEMORY, NPC_DIALOGUE_STATE.QUEST
  ]),
  [NPC_DIALOGUE_STATE.STATUS]: new Set([NPC_DIALOGUE_STATE.HOME]),
  [NPC_DIALOGUE_STATE.TOPICS]: new Set([NPC_DIALOGUE_STATE.HOME, NPC_DIALOGUE_STATE.TOPIC_RESPONSE]),
  [NPC_DIALOGUE_STATE.TOPIC_RESPONSE]: new Set([NPC_DIALOGUE_STATE.HOME, NPC_DIALOGUE_STATE.TOPICS]),
  [NPC_DIALOGUE_STATE.MEMORY]: new Set([NPC_DIALOGUE_STATE.HOME]),
  [NPC_DIALOGUE_STATE.QUEST]: new Set([NPC_DIALOGUE_STATE.HOME])
});

export function createNpcDialogueSession({ npcId } = {}) {
  if (typeof npcId !== 'string' || !npcId) throw new Error('NPC dialogue session requires npcId');
  let state = NPC_DIALOGUE_STATE.HOME;
  let topic = null;
  let revision = 0;

  function snapshot() {
    return Object.freeze({ npcId, state, topic, revision });
  }

  function go(next, { selectedTopic = null } = {}) {
    if (!Object.values(NPC_DIALOGUE_STATE).includes(next)) throw new Error('Unknown NPC dialogue state');
    if (next === state) return snapshot();
    if (!ALLOWED[state]?.has(next)) throw new Error(`Invalid NPC dialogue transition: ${state} -> ${next}`);
    if (next === NPC_DIALOGUE_STATE.TOPIC_RESPONSE) {
      if (typeof selectedTopic !== 'string' || !selectedTopic) throw new Error('Topic response requires selected topic');
      topic = selectedTopic;
    } else if (next !== NPC_DIALOGUE_STATE.TOPICS) {
      topic = null;
    }
    state = next;
    revision += 1;
    return snapshot();
  }

  function home() {
    if (state === NPC_DIALOGUE_STATE.HOME) return snapshot();
    if (!ALLOWED[state]?.has(NPC_DIALOGUE_STATE.HOME)) throw new Error('NPC dialogue cannot return home');
    state = NPC_DIALOGUE_STATE.HOME;
    topic = null;
    revision += 1;
    return snapshot();
  }

  return Object.freeze({ snapshot, go, home });
}
