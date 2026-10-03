import { INPUT_FOCUS_POLICY, createInputFocusManager } from "./input-focus-manager.js";
import { createInputFocusOwner } from "./input-focus-owner.js";
import { createHudContext } from "../hud/hud-context.js";
import { bindHudPresentation } from "../hud/hud-presentation.js";

export const WORLD_INPUT_OWNER_DEFINITIONS = Object.freeze([
  ["hudMenuInput", "hud-menu", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["keyboardHelpInput", "keyboard-help", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["fullMapInput", "full-map", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["shopInput", "shop", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["backgateTransitInput", "backgate-transit", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["furnitureInput", "room-furniture", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["inventoryInput", "inventory", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["mobilityBookInput", "mobility-book", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["wardrobeInput", "wardrobe", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["dailyQuizInput", "daily-quiz", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["attendanceInput", "attendance", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["questJournalInput", "quest-journal", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["npcDialogueInput", "npc-dialogue", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["mcmDialogueInput", "mcm-dialogue", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["biryongScriptedInput", "biryong-scripted", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["lobbyWorldInput", "lobby-world", INPUT_FOCUS_POLICY.SYSTEM_LOCK],
  ["lobbyTransitionInput", "lobby-transition", INPUT_FOCUS_POLICY.SYSTEM_LOCK],
  ["profileInput", "profile", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["viewSettingsInput", "view-settings", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["friendPanelInput", "friend-panel", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["nearbyPanelInput", "nearby-panel", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["playerCardInput", "player-card", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["guestbookInput", "guestbook", INPUT_FOCUS_POLICY.BLOCKING_UI],
  ["roomTransitionInput", "room-transition", INPUT_FOCUS_POLICY.SYSTEM_LOCK],
  ["backGateArrivalInput", "back-gate-arrival", INPUT_FOCUS_POLICY.SYSTEM_LOCK],
  ["mcmEventInfoInput", "mcm-event-info", INPUT_FOCUS_POLICY.BLOCKING_UI]
]);

export function createWorldInputRuntime({ root = globalThis.document?.body } = {}) {
  const inputFocus = createInputFocusManager();
  const hudContext = createHudContext();
  const hudPresentation = bindHudPresentation({ context: hudContext, root });
  const unsubscribeHudInput = inputFocus.subscribe(
    snapshot => hudContext.syncInputFocus(snapshot),
    { emitCurrent: true }
  );

  const owners = {};
  for (const [name, ownerId, policy] of WORLD_INPUT_OWNER_DEFINITIONS) {
    owners[name] = createInputFocusOwner({ manager: inputFocus, ownerId, policy });
  }

  return Object.freeze({
    inputFocus,
    hudContext,
    hudPresentation,
    unsubscribeHudInput,
    ...owners
  });
}
