// Browser-side adapter only. Production controllers, presentation source and CSS remain unchanged.
import { createQuestClient } from '/npc-factory/quest-client.mjs';
import { createMain2QuestClient } from '/npc-factory/main2-quest-client.mjs';
import { MAIN_NPC_ID } from '/npc-factory/npc-presence.mjs';
import { MAIN2_GUIDE_NPC } from '/npc-factory/main2-guide-contract.mjs';
import { questReply } from '/npc-factory/quest-contract.mjs';
import { createFirstCampusCompletion, isElementVisible } from '/src/quest/first-campus-completion.js';
import { createCore15FunnelTelemetry } from '/src/core15-funnel-telemetry.js';
import { createProgressionClient } from '/src/progression/progression-client.js';
import { createProgressionHud, levelUpMessage } from '/src/progression/progression-hud.js';
import { createMcm2026EventUi, createStatusAfterReward } from '/src/events/zombie-university-2026/event-ui.js';
import { createNextDiscovery, FIRST_CAMPUS_REWARD_ID } from '/src/next-discovery.js';
import { createQuestRuntime } from '/src/quest/quest-runtime.js';
import { createTrackedQuestHud } from '/src/quest/quest-hud.js';
import { INPUT_FOCUS_POLICY, createInputFocusManager } from '/src/input/input-focus-manager.js';
import { createInputFocusOwner } from '/src/input/input-focus-owner.js';
import { createHudContext } from '/src/hud/hud-context.js';
import { bindHudPresentation } from '/src/hud/hud-presentation.js';
import { MAIN_GATE_SPAWN } from '/src/campus-spawn.js';
import { createCampusNavigation, CAMPUS_NAV_SPACE } from '/src/navigation/campus-navigation.js';
import { createNavigationState } from '/src/navigation/navigation-state.js';
import { createNavigationHud } from '/src/navigation/navigation-hud.js';
import * as seams from '/__fixture/main-seams.mjs';

const el = id => document.getElementById(id);
const params = new URL(location.href).searchParams;
const state = window.fixture = { ready: false, account: null, requests: [], rewards: [], events: [], progressionReads: [], inventoryReads: 0,
  dropCompletionResponseOnce: false, lastCompletionError: null, generation: 0, frameCount: 0, visibilityEvents: [] };
const lobbyWorld = { active: false }, lobbyTransition = { active: false }, photoMode = { active: false };
const inputFocus = createInputFocusManager();
const hudContext = createHudContext();
bindHudPresentation({ context: hudContext, root: document.body });
inputFocus.subscribe(snapshot => hudContext.syncInputFocus(snapshot), { emitCurrent: true });
const npcDialogueInput = createInputFocusOwner({ manager: inputFocus, ownerId: 'npc-dialogue', policy: INPUT_FOCUS_POLICY.BLOCKING_UI });
const panel = seams.addPanel(true, true);
const setDialogue = open => {
  panel.hidden = !open; el('npc-test-conversation').hidden = !open;
  if (open) { npcDialogueInput.acquire(); el('npc-test-speaker').textContent = '나나율'; el('npc-test-line').textContent = questReply('talk_001'); }
  else npcDialogueInput.release();
};
el('npc-test-close').addEventListener('click', () => setDialogue(false));
const showWorldStatus = message => { el('follow-status').textContent = message; el('follow-status').hidden = false; return true; };
const mcmEventUi = createMcm2026EventUi({ client: {
  state: null, preview: false, phase: () => 'DISABLED', presentationNow: () => Date.now(), onChange: () => () => {}
} });
const showWorldStatusAfterReward = createStatusAfterReward({ remainingMs: () => mcmEventUi.toastRemainingMs(), show: showWorldStatus });
let core15Funnel;
const firstCampusCompletion = createFirstCampusCompletion({ getFunnel: () => core15Funnel });
const progression = createProgressionClient({ getClient: () => {
  const account = state.account;
  return account ? { rpc: async name => {
    state.progressionReads.push({ account, name });
    return (await fetch('/__fixture/progression', { headers: { Authorization: `Bearer synthetic:${account}` } })).json();
  } } : null;
} });
const progressionHud = createProgressionHud({
  pill: el('progression-hud'), pillLevel: el('progression-level'), pillExp: el('progression-exp'), pillBar: el('progression-bar'), pillFill: el('progression-fill'),
  badge: el('progression-badge'), badgeLevel: el('progression-badge-level'), badgeBar: el('progression-badge-bar'), badgeFill: el('progression-badge-fill'), menuLine: el('progression-menu-line')
});
progression.onChange(change => {
  progressionHud.render(change.state, change.snapshot);
  firstCampusCompletion.growthReadback(change);
  const message = levelUpMessage(change);
  if (message) showWorldStatusAfterReward(message);
});
const wallet = { refresh() { throw Error('First Campus must not refresh a currency authority'); } };
const inventory = { refresh() { state.inventoryReads++; } };
const campusNavigation = createCampusNavigation();
const navigation = createNavigationState({ solver: campusNavigation.solver, guidanceSpaceId: CAMPUS_NAV_SPACE });
const main2GuideNavigationTarget = () => seams.target(campusNavigation, MAIN2_GUIDE_NPC, CAMPUS_NAV_SPACE);
const setNavigationTarget = target => {
  if (!navigation || !target) return false;
  navigation.setDestination(target, { position: MAIN_GATE_SPAWN, spaceId: CAMPUS_NAV_SPACE }); return true;
};
const navigationHud = createNavigationHud({ root: el('nav-guidance'), arrow: el('nav-guidance-arrow'), title: el('nav-guidance-title'), detail: el('nav-guidance-detail'),
  cancelButton: el('nav-guidance-cancel'), announcer: el('nav-guidance-announcer'), onCancel: () => navigation.clearDestination('cancel') });
const runtime = createQuestRuntime();
state.playerPosition = { ...MAIN_GATE_SPAWN };
const questHud = createTrackedQuestHud({ root: el('quest-hud'), openButton: el('quest-hud-open'), headingElement: el('quest-hud-heading'), objectiveElement: el('quest-hud-objective'), bearingElement: el('quest-hud-bearing'), runtime,
  getTarget: () => ({ ...MAIN2_GUIDE_NPC.position, kind: 'quest-npc' }), getPlayerPosition: () => state.playerPosition });
const nextDiscovery = createNextDiscovery({ root: el('next-discovery'), primaryButton: el('next-discovery-primary'), onProgress: progress => runtime.update(progress),
  onPrimary: discovery => seams.primary(discovery, scope()) });
function scope() { return { firstCampusCompletion, core15Funnel, mcmEventUi, progression, wallet, inventory, FIRST_CAMPUS_REWARD_ID, lobbyWorld, lobbyTransition, photoMode,
  inputFocus, isElementVisible, document, navigation, main2GuideNavigationTarget, nextDiscovery, setNavigationTarget, showWorldStatus }; }
const fetchQuest = async (url, options) => {
  const body = JSON.parse(options.body), account = state.account;
  state.requests.push({ account, ...body });
  const response = await fetch(url, options);
  if (body.event === 'talk_001' && state.dropCompletionResponseOnce) {
    state.dropCompletionResponseOnce = false;
    // Consume the real handler's completing response, then lose it before Quest can inspect it.
    await response.text(); throw Error('SYNTHETIC_LOST_COMPLETION_RESPONSE');
  }
  return response;
};
const quest = createQuestClient({ enabled: true, endpoint: '/__fixture/quest', getSession: async () => `synthetic:${state.account}`,
  fetcher: fetchQuest, completion: firstCampusCompletion,
  onReward: reward => { state.rewards.push({ account: state.account, ...reward }); seams.reward(reward, scope()); }
});
const main2 = createMain2QuestClient({ enabled: true, endpoint: '/__fixture/quest', getSession: async () => `synthetic:${state.account}`, fetcher: fetchQuest });
const sync = () => nextDiscovery.syncProgress({ quest: quest.status(), main2Quest: main2.status() });
quest.onChange(() => { sync(); if (quest.status().complete) void main2.refresh(); });
main2.onChange(sync);
function visible() { return {
  visibilityState: document.visibilityState,
  reward: isElementVisible(document.querySelector('.mcm26-toast')),
  growth: isElementVisible(el('progression-hud')) || isElementVisible(el('progression-badge')),
  nextGoal: isElementVisible(el('next-discovery-primary')),
  worldActionAllowed: inputFocus.can('WORLD_ACTION'), lobby: lobbyWorld.active || lobbyTransition.active, photo: photoMode.active,
  progression: progression.status(), toastText: document.querySelector('.mcm26-toast').textContent
}; }
async function setAccount(account) {
  state.account = account; const generation = ++state.generation;
  core15Funnel = createCore15FunnelTelemetry({ storageKey: `inhagame-core15-funnel-v1:${account ?? 'guest'}`,
    isCurrent: () => generation === state.generation,
    track: async (event, surface, target, { eventId }) => {
      const entry = { account, event, surface, target, eventId, visible: visible() }; state.events.push(entry);
      const response = await fetch('/__fixture/telemetry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) });
      return (await response.json()).eventId;
    }
  });
  firstCampusCompletion.setAccount(account); mcmEventUi.invalidateRewardPresentation();
  await Promise.all([progression.setAccount(account), quest.setSignedIn(Boolean(account)), main2.setSignedIn(Boolean(account))]);
}
state.complete = async () => {
  state.lastCompletionError = null;
  try { return await quest.advanceNpc(MAIN_NPC_ID); }
  catch (error) { state.lastCompletionError = error.message; return null; }
};
state.moveToGuide = () => { state.playerPosition = { ...MAIN2_GUIDE_NPC.position }; };
state.setAccount = setAccount; state.setDialogue = setDialogue; state.visible = visible;
state.setLobby = value => { lobbyWorld.active = value; mcmEventUi.update(0); };
state.setTransition = value => { lobbyTransition.active = value; mcmEventUi.update(0); };
// The real current-main CSS controls visibility; camera/capture runtime is outside this fixture.
state.setPhotoMode = value => {
  photoMode.active = value;
  if (value) document.body.dataset.photoMode = 'active'; else delete document.body.dataset.photoMode;
  mcmEventUi.update(0);
};
state.queueExistingToast = (ms = 1200) => mcmEventUi.say('기존 안내 메시지', ms);
state.status = () => ({ quest: quest.status(), progression: progression.status(), recovery: firstCampusCompletion.needsRecovery(),
  telemetry: core15Funnel.status(), navigation: navigation.getSnapshot(), visible: visible(), main2: main2.status(), dialogue: npcDialogueInput.active });
// Explicitly synthetic only when the hosted headless browser does not expose native tab hiding.
state.injectVisibilityForTest = hidden => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
};
state.restoreNativeVisibility = () => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); };
document.addEventListener('visibilitychange', () => state.visibilityEvents.push({ state: document.visibilityState, at: Date.now() }));
el('zone').textContent = '정문'; el('minimap').hidden = false; el('minimap').removeAttribute('data-minimap-state');
function frame() {
  mcmEventUi.update(1 / 60); questHud.update();
  navigationHud.render(navigation.getSnapshot(), { visible: !lobbyWorld.active && !lobbyTransition.active });
  seams.observe(scope()); state.frameCount++;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
await setAccount(params.get('account'));
state.ready = true;
