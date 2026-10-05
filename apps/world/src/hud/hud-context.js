import { INPUT_FOCUS_CLASS } from "../input/input-focus-manager.js";

export const HUD_MODE = Object.freeze({
  EXPLORE: "EXPLORE",
  COMBAT: "COMBAT",
  LIFE: "LIFE",
  PET_RIDE: "PET_RIDE"
});

export const LIFE_MODE = Object.freeze({
  NONE: "NONE",
  FISHING: "FISHING",
  GATHERING: "GATHERING",
  COOKING: "COOKING",
  FARMING: "FARMING",
  CRAFTING: "CRAFTING",
  MINING: "MINING"
});

export const PET_CONTEXT = Object.freeze({
  NONE: "NONE",
  FOLLOW: "FOLLOW",
  INTERACTION: "INTERACTION"
});

export const HUD_OVERLAY = Object.freeze({
  NONE: "NONE",
  CHAT: "CHAT",
  HUD_MENU: "HUD_MENU",
  KEYBOARD_HELP: "KEYBOARD_HELP",
  FULL_MAP: "FULL_MAP",
  SHOP: "SHOP",
  INVENTORY: "INVENTORY",
  WARDROBE: "WARDROBE",
  QUEST_JOURNAL: "QUEST_JOURNAL",
  DIALOGUE: "DIALOGUE",
  PROFILE: "PROFILE",
  SETTINGS: "SETTINGS",
  SOCIAL: "SOCIAL",
  GUESTBOOK: "GUESTBOOK",
  DAILY_QUIZ: "DAILY_QUIZ",
  ATTENDANCE: "ATTENDANCE",
  BLOCKING_UI: "BLOCKING_UI",
  SYSTEM_LOCK: "SYSTEM_LOCK"
});

const OWNER_OVERLAY = Object.freeze({
  "hud-menu": HUD_OVERLAY.HUD_MENU,
  "keyboard-help": HUD_OVERLAY.KEYBOARD_HELP,
  "full-map": HUD_OVERLAY.FULL_MAP,
  shop: HUD_OVERLAY.SHOP,
  inventory: HUD_OVERLAY.INVENTORY,
  wardrobe: HUD_OVERLAY.WARDROBE,
  "quest-journal": HUD_OVERLAY.QUEST_JOURNAL,
  "npc-dialogue": HUD_OVERLAY.DIALOGUE,
  "mcm-dialogue": HUD_OVERLAY.DIALOGUE,
  "biryong-scripted": HUD_OVERLAY.DIALOGUE,
  profile: HUD_OVERLAY.PROFILE,
  "view-settings": HUD_OVERLAY.SETTINGS,
  "friend-panel": HUD_OVERLAY.SOCIAL,
  "nearby-panel": HUD_OVERLAY.SOCIAL,
  "player-card": HUD_OVERLAY.SOCIAL,
  guestbook: HUD_OVERLAY.GUESTBOOK,
  "daily-quiz": HUD_OVERLAY.DAILY_QUIZ,
  attendance: HUD_OVERLAY.ATTENDANCE
});

const enumValues = value => new Set(Object.values(value));
const HUD_MODES = enumValues(HUD_MODE);
const LIFE_MODES = enumValues(LIFE_MODE);
const PET_CONTEXTS = enumValues(PET_CONTEXT);

function assertMember(value, values, label) {
  if (!values.has(value)) throw new TypeError(`Unknown ${label}: ${value}`);
  return value;
}

function sameList(a = [], b = []) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function freezeState(state) {
  return Object.freeze({
    ...state,
    overlayOwnerIds: Object.freeze([...(state.overlayOwnerIds ?? [])])
  });
}

export function hudOverlayFromInputFocus(snapshot = {}) {
  const focusClass = snapshot?.focusClass ?? INPUT_FOCUS_CLASS.GAMEPLAY;
  const owners = Array.isArray(snapshot?.topOwners)
    ? [...snapshot.topOwners].filter(Boolean).map(String).sort()
    : [];

  if (focusClass === INPUT_FOCUS_CLASS.GAMEPLAY) {
    return Object.freeze({ overlay: HUD_OVERLAY.NONE, ownerIds: Object.freeze(owners) });
  }
  if (focusClass === INPUT_FOCUS_CLASS.CHAT) {
    return Object.freeze({ overlay: HUD_OVERLAY.CHAT, ownerIds: Object.freeze(owners) });
  }
  if (focusClass === INPUT_FOCUS_CLASS.SYSTEM_LOCK) {
    return Object.freeze({ overlay: HUD_OVERLAY.SYSTEM_LOCK, ownerIds: Object.freeze(owners) });
  }

  if (focusClass === INPUT_FOCUS_CLASS.BLOCKING_UI || focusClass === "MIXED") {
    const mapped = [...new Set(owners.map(owner => OWNER_OVERLAY[owner]).filter(Boolean))];
    const overlay = mapped.length === 1 ? mapped[0] : HUD_OVERLAY.BLOCKING_UI;
    return Object.freeze({ overlay, ownerIds: Object.freeze(owners) });
  }

  return Object.freeze({ overlay: HUD_OVERLAY.BLOCKING_UI, ownerIds: Object.freeze(owners) });
}

export function createHudContext({
  mode = HUD_MODE.EXPLORE,
  lifeMode = LIFE_MODE.NONE,
  petContext = PET_CONTEXT.NONE
} = {}) {
  assertMember(mode, HUD_MODES, "HUD mode");
  assertMember(lifeMode, LIFE_MODES, "Life mode");
  assertMember(petContext, PET_CONTEXTS, "Pet context");

  if (mode !== HUD_MODE.LIFE && lifeMode !== LIFE_MODE.NONE) {
    throw new TypeError("Life mode requires HUD_MODE.LIFE");
  }

  const listeners = new Set();
  let version = 0;
  let state = freezeState({
    mode,
    lifeMode,
    petContext,
    overlay: HUD_OVERLAY.NONE,
    overlayOwnerIds: [],
    inputFocusClass: INPUT_FOCUS_CLASS.GAMEPLAY,
    version
  });

  function publish(next) {
    const ownerIds = next.overlayOwnerIds ?? state.overlayOwnerIds;
    const unchanged =
      next.mode === state.mode &&
      next.lifeMode === state.lifeMode &&
      next.petContext === state.petContext &&
      next.overlay === state.overlay &&
      next.inputFocusClass === state.inputFocusClass &&
      sameList(ownerIds, state.overlayOwnerIds);

    if (unchanged) return state;
    version += 1;
    state = freezeState({ ...next, overlayOwnerIds: ownerIds, version });
    for (const listener of listeners) listener(state);
    return state;
  }

  function setMode(nextMode) {
    assertMember(nextMode, HUD_MODES, "HUD mode");
    return publish({
      ...state,
      mode: nextMode,
      lifeMode: nextMode === HUD_MODE.LIFE ? state.lifeMode : LIFE_MODE.NONE
    });
  }

  function setLifeMode(nextLifeMode) {
    assertMember(nextLifeMode, LIFE_MODES, "Life mode");
    return publish({
      ...state,
      mode: nextLifeMode === LIFE_MODE.NONE ? state.mode : HUD_MODE.LIFE,
      lifeMode: nextLifeMode
    });
  }

  function setPetContext(nextPetContext) {
    assertMember(nextPetContext, PET_CONTEXTS, "Pet context");
    return publish({ ...state, petContext: nextPetContext });
  }

  function syncInputFocus(snapshot = {}) {
    const resolved = hudOverlayFromInputFocus(snapshot);
    return publish({
      ...state,
      overlay: resolved.overlay,
      overlayOwnerIds: resolved.ownerIds,
      inputFocusClass: snapshot?.focusClass ?? INPUT_FOCUS_CLASS.GAMEPLAY
    });
  }

  function subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== "function") throw new TypeError("HUD context listener must be a function");
    listeners.add(listener);
    if (emitCurrent) listener(state);
    return () => listeners.delete(listener);
  }

  return Object.freeze({
    snapshot: () => state,
    setMode,
    setLifeMode,
    setPetContext,
    syncInputFocus,
    subscribe
  });
}
