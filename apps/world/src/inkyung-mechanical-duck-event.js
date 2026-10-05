import { POND_RING } from "./roadview-layout.js";
import { QUEST_NPC_ID } from "../npc-factory/npc-presence.mjs";

export const INKYUNG_MECHANICAL_DUCK_EVENT_ID = "event.inkyung_mechanical_duck";
export const INKYUNG_MECHANICAL_DUCK_LORE_ID = "lore.inkyung_mechanical_duck";
export const INKYUNG_SIDE_EVENT_STORAGE_PREFIX = "inhagame-inkyung-mechanical-duck-event-v1";

export const INKYUNG_SIDE_EVENT_STATE = Object.freeze({
  LOCKED: "LOCKED",
  RUMOR_HEARD: "RUMOR_HEARD",
  SEARCHING: "SEARCHING",
  MECHANICAL_DUCK_FOUND: "MECHANICAL_DUCK_FOUND",
  REPORTED: "REPORTED",
  COMPLETE: "COMPLETE"
});

const VALID_STATES = new Set(Object.values(INKYUNG_SIDE_EVENT_STATE));
const pond = Object.freeze({
  x: POND_RING.reduce((sum, p) => sum + p.x, 0) / POND_RING.length,
  z: POND_RING.reduce((sum, p) => sum + p.z, 0) / POND_RING.length
});

const objectiveFor = state => ({
  [INKYUNG_SIDE_EVENT_STATE.RUMOR_HEARD]: "인경호의 평범한 오리를 관찰해보자",
  [INKYUNG_SIDE_EVENT_STATE.SEARCHING]: "인경호 주변에서 수상한 오리를 찾아보자",
  [INKYUNG_SIDE_EVENT_STATE.MECHANICAL_DUCK_FOUND]: "가유담에게 목격담을 전하자",
  [INKYUNG_SIDE_EVENT_STATE.REPORTED]: "가유담과 이야기를 마무리하자",
  [INKYUNG_SIDE_EVENT_STATE.COMPLETE]: "인경호 기계오리설 조사 완료"
})[state] ?? null;

const safeScope = value => String(value || "guest").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 96) || "guest";
const defaultData = () => ({
  version: 1,
  state: INKYUNG_SIDE_EVENT_STATE.LOCKED,
  unlocked: false,
  prefoundMechanicalDuck: false,
  loreUnlocked: false
});
const normalize = raw => {
  const base = defaultData();
  if (!raw || typeof raw !== "object") return base;
  const state = VALID_STATES.has(raw.state) ? raw.state : base.state;
  return {
    version: 1,
    state,
    unlocked: Boolean(raw.unlocked || state !== INKYUNG_SIDE_EVENT_STATE.LOCKED),
    prefoundMechanicalDuck: Boolean(raw.prefoundMechanicalDuck),
    loreUnlocked: Boolean(raw.loreUnlocked || [
      INKYUNG_SIDE_EVENT_STATE.MECHANICAL_DUCK_FOUND,
      INKYUNG_SIDE_EVENT_STATE.REPORTED,
      INKYUNG_SIDE_EVENT_STATE.COMPLETE
    ].includes(state))
  };
};

export function createInkyungMechanicalDuckEvent({ storage = undefined, scope = "guest" } = {}) {
  if (storage === undefined) {
    try { storage = globalThis.localStorage ?? null; } catch { storage = null; }
  }
  let currentScope = safeScope(scope);
  let data = defaultData();
  const listeners = new Set();

  const key = () => `${INKYUNG_SIDE_EVENT_STORAGE_PREFIX}:${currentScope}`;
  function load() {
    if (!storage?.getItem) return defaultData();
    try {
      const raw = storage.getItem(key());
      return raw ? normalize(JSON.parse(raw)) : defaultData();
    } catch { return defaultData(); }
  }
  function save() {
    if (!storage?.setItem) return false;
    try { storage.setItem(key(), JSON.stringify(data)); return true; }
    catch { return false; }
  }
  function snapshot() {
    return Object.freeze({
      eventId: INKYUNG_MECHANICAL_DUCK_EVENT_ID,
      loreId: INKYUNG_MECHANICAL_DUCK_LORE_ID,
      scope: currentScope,
      state: data.state,
      unlocked: data.unlocked,
      prefoundMechanicalDuck: data.prefoundMechanicalDuck,
      loreUnlocked: data.loreUnlocked,
      complete: data.state === INKYUNG_SIDE_EVENT_STATE.COMPLETE,
      objective: objectiveFor(data.state),
      requiresMechanicalDuck: data.state === INKYUNG_SIDE_EVENT_STATE.SEARCHING
    });
  }
  function publish() {
    save();
    const value = snapshot();
    for (const listener of listeners) listener(value);
    return value;
  }
  function setState(state) {
    if (!VALID_STATES.has(state) || data.state === state) return snapshot();
    data.state = state;
    if (state !== INKYUNG_SIDE_EVENT_STATE.LOCKED) data.unlocked = true;
    return publish();
  }

  data = load();

  return Object.freeze({
    status: snapshot,
    onChange(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setScope(nextScope) {
      const next = safeScope(nextScope);
      if (next === currentScope) return snapshot();
      const previousScope = currentScope;
      const previous = { ...data };
      currentScope = next;
      data = load();
      if (previousScope === "guest" && next !== "guest" &&
          data.state === INKYUNG_SIDE_EVENT_STATE.LOCKED && !data.prefoundMechanicalDuck) {
        data.prefoundMechanicalDuck = previous.prefoundMechanicalDuck;
        data.loreUnlocked = previous.loreUnlocked;
      }
      return publish();
    },
    setUnlocked(value) {
      if (!value || data.unlocked) return snapshot();
      data.unlocked = true;
      return publish();
    },
    canObserveOrdinaryDuck() {
      return data.unlocked && data.state === INKYUNG_SIDE_EVENT_STATE.RUMOR_HEARD;
    },
    requiresMechanicalDuck() {
      return data.state === INKYUNG_SIDE_EVENT_STATE.SEARCHING;
    },
    observeOrdinaryDuck(kind = "duck") {
      if (!this.canObserveOrdinaryDuck()) return { changed: false, snapshot: snapshot() };
      data.state = INKYUNG_SIDE_EVENT_STATE.SEARCHING;
      const value = publish();
      return {
        changed: true,
        snapshot: value,
        line: kind === "mallard"
          ? "다른 오리들과 섞여 조용히 헤엄치고 있다. 수상한 점은 없어 보인다."
          : "물 위를 느긋하게 헤엄치고 있다. 적어도 이 녀석은 평범한 오리 같다."
      };
    },
    observeMechanicalDuck() {
      data.loreUnlocked = true;
      let changed = false, prefound = false, found = false;
      if (data.state === INKYUNG_SIDE_EVENT_STATE.LOCKED) {
        if (!data.prefoundMechanicalDuck) changed = true;
        data.prefoundMechanicalDuck = true;
        prefound = true;
      } else if ([INKYUNG_SIDE_EVENT_STATE.RUMOR_HEARD, INKYUNG_SIDE_EVENT_STATE.SEARCHING].includes(data.state)) {
        data.state = INKYUNG_SIDE_EVENT_STATE.MECHANICAL_DUCK_FOUND;
        changed = true;
        found = true;
      }
      const value = changed ? publish() : (save(), snapshot());
      return { changed, prefound, found, snapshot: value,
        line: "몸체 옆에 가느다란 이음선이 있다. 안쪽에서 희미한 노란빛이 깜빡였다." };
    },
    npcChoice(actorId) {
      if (actorId !== QUEST_NPC_ID || !data.unlocked || data.state === INKYUNG_SIDE_EVENT_STATE.COMPLETE) return null;
      if (data.state === INKYUNG_SIDE_EVENT_STATE.LOCKED) {
        return Object.freeze({
          id: data.prefoundMechanicalDuck ? "ack_prefound" : "start",
          label: data.prefoundMechanicalDuck ? "불빛 나는 오리 이야기하기" : "인경호 오리 소문 묻기"
        });
      }
      if (data.state === INKYUNG_SIDE_EVENT_STATE.MECHANICAL_DUCK_FOUND) {
        return Object.freeze({ id: "report", label: "수상한 오리 목격담 전하기" });
      }
      return null;
    },
    advanceNpc(actorId, choiceId) {
      const choice = this.npcChoice(actorId);
      if (!choice || choice.id !== choiceId) return null;
      if (choiceId === "start") {
        setState(INKYUNG_SIDE_EVENT_STATE.RUMOR_HEARD);
        return {
          line: "인경호 오리들에 관한 소문 들어봤어요? 옛날부터 여기 오리 중에 기계가 섞여 있다는 얘기가 있어요. 물론 그냥 학교 괴담일 수도 있고요.",
          snapshot: snapshot()
        };
      }
      if (choiceId === "ack_prefound") {
        setState(INKYUNG_SIDE_EVENT_STATE.MECHANICAL_DUCK_FOUND);
        return {
          line: "잠깐, 혹시 이미 봤어요? 몸에서 불빛이 나는 오리요? …진짜 먼저 찾아버린 사람이 있네.",
          snapshot: snapshot()
        };
      }
      if (choiceId === "report") {
        data.state = INKYUNG_SIDE_EVENT_STATE.REPORTED;
        publish();
        data.state = INKYUNG_SIDE_EVENT_STATE.COMPLETE;
        const value = publish();
        return {
          line: "설마 진짜 찾았어요? 소문이라는 게 괜히 생기는 건 아니라니까요. 그래도 진짜 기계였는지는… 인경호만 알고 있겠죠.",
          snapshot: value
        };
      }
      return null;
    },
    mapTarget(getNpcPosition = () => null) {
      if (!data.unlocked) return null;
      if ([INKYUNG_SIDE_EVENT_STATE.RUMOR_HEARD, INKYUNG_SIDE_EVENT_STATE.SEARCHING].includes(data.state)) {
        return Object.freeze({
          x: pond.x, z: pond.z, kind: "side-event", stage: data.state,
          label: objectiveFor(data.state), eventId: INKYUNG_MECHANICAL_DUCK_EVENT_ID
        });
      }
      if (data.state === INKYUNG_SIDE_EVENT_STATE.MECHANICAL_DUCK_FOUND) {
        const position = getNpcPosition(QUEST_NPC_ID);
        if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return null;
        return Object.freeze({
          x: position.x, z: position.z, kind: "quest-npc", npcId: QUEST_NPC_ID,
          stage: data.state, label: objectiveFor(data.state), eventId: INKYUNG_MECHANICAL_DUCK_EVENT_ID
        });
      }
      return null;
    },
    reset() {
      data = defaultData();
      return publish();
    }
  });
}
