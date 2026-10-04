import * as pc from 'playcanvas';
import { roadviewGroundHeight } from '../src/roadview-layout.js';
import { findSeat, SEAT_TOP_Y } from '../src/seat-anchors.js';
import { metersToWorld } from '../src/world-scale.js';
import { PULSE_PERIODS, PERIOD_SECONDS, CYCLE_SECONDS, periodAt, snapshotForPeriod, validateDevCandidate, inspectionPointFor } from './dev-runtime-state.mjs';
import { appearanceFor } from './dev-appearance.mjs';
import { createHumanAvatar } from './dev-human-avatar.mjs';
import { npcNameplateOffset, npcSeatAnchorHeight } from './npc-dimensions.mjs';
import { createNpcNavigator, advanceRoute } from './dev-navigation.mjs';
import { createNpcMemory, createEncounterTracker } from './dev-memory.mjs';
import { NPC_DIALOGUE_ACTION, NPC_DIALOGUE_STATE, createNpcDialogueSession, hasNpcDialogueMemory, npcDialogueHomeActions, npcTopicLabel } from './npc-dialogue-session.mjs';
import { buildNpcDialogueCandidates, buildNpcDialogueContext, resolveNpcDialogueBaseline } from './npc-dialogue-context.mjs';
import { createNpcJevDialogueRouter } from './npc-dialogue-jev-client.mjs';
import { createNpcSocialNg1Model, mountNpcSocialNg1Panel } from './npc-social-ng1.mjs';
import { createPersistentNpcSocialGraph } from './npc-social-graph.mjs';
import { createNpcSocialGroupFeasibility } from './npc-social-group-feasibility.mjs';
import { createNpcSocialNg15Bridge } from './npc-social-ng15-bridge.mjs';
import { createObservedConversation } from './npc-observed-conversation.mjs';
import { createObservedBubble } from './npc-observed-bubble.mjs';
import { MAIN_NPC_ID, QUEST_NPC_ID, runtimePresence } from './npc-presence.mjs';
import { createNpcWorldClock } from './npc-world-clock.mjs';
import { createSharedMeetings, createSharedMeetingObserver } from './npc-shared-meetings.mjs';
import { bindSharedSchedule } from './npc-shared-schedule.mjs';
import { worldScheduleAt, NPC_SCHEDULE_REVISION } from './npc-world-time-contract.mjs';
import { createPurposefulRoster } from './purposeful-roster.mjs';
import { loadNpcPopulation } from './npc-population-loader.mjs';
import { createPurposefulSocialMotion } from './purposeful-social-motion.mjs';
import { purposefulActivityPose } from './purposeful-activity-motion.mjs';
import { createQuestClient } from './quest-client.mjs';
import { QUEST_ID } from './quest-contract.mjs';
import { createMain2QuestClient } from './main2-quest-client.mjs';
import { MAIN2_QUEST_ID } from './main2-quest-contract.mjs';
import { createMain2GuideRuntime } from './main2-guide-runtime.mjs';
import { createTmlMain2Shadow } from '../tml/runtime/main2-shadow.mjs';
import { createTmlFirstCampusGyeolShadow } from '../tml/runtime/first-campus-gyeol-shadow.mjs';

const aiPilotIds = new Set([MAIN_NPC_ID, QUEST_NPC_ID]);
const NPC_TALK_RADIUS = metersToWorld(3);
const NPC_CONVERSATION_RELEASE_RADIUS = metersToWorld(5);
const NPC_NAMEPLATE_RADIUS = metersToWorld(8);
const periodLabels = { morning: '아침', class_time: '수업시간', lunch: '점심', evening: '저녁', night: '밤' };
const socialPhaseLabels = { WAIT: '기다림', JOIN: '합류', WALK_TOGETHER: '이동', SEPARATE: '해산', COMPLETE: '완료', INACTIVE: '없음', FAILED: '중단' };
const walking = new Set(['walk', 'walk_to_class', 'walk_to_club', 'leave_zone']);
const roaming = new Set([...walking, 'idle', 'wait']);
const hairLabels = { long: '긴 머리', bob: '단발', ponytail: '묶은 머리', bun: '올림머리', short: '짧은 머리', sidepart: '옆가르마', curly: '곱슬머리', medium: '중간 길이 머리' };
const accessoryLabels = { sketchbook: '스케치북', glasses: '안경', apron: '앞치마', badge: '명찰', backpack: '배낭', headphones: '헤드폰', book: '책', messenger: '크로스백', scarf: '목도리' };
function addPanel(production = false, externalContextAction = false) {
  const style = document.createElement('style');
  style.textContent = `
    #npc-test-panel{position:fixed;right:12px;top:12px;z-index:100;width:min(340px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;background:#11232cea;color:#f4f8f7;border:1px solid #73bdb4;border-radius:12px;padding:12px;font:14px/1.42 system-ui,sans-serif;box-shadow:0 8px 28px #0008}
    #npc-test-panel h2{font-size:16px;margin:0 0 5px}#npc-test-panel p{margin:6px 0}
    #npc-test-panel .minor{color:#bfd2d0;font-size:12px}#npc-test-panel .row{display:flex;gap:5px;flex-wrap:wrap;margin:8px 0}
    #npc-test-panel button,#npc-test-panel select{font:inherit;color:#f4f8f7;background:#24424b;border:1px solid #7aa8a4;border-radius:6px;padding:4px 7px}
    #npc-test-panel button[aria-pressed=true]{background:#196d65;border-color:#b3ebc9}
    #npc-test-panel button:disabled{opacity:.5}
    #npc-test-conversation{padding:8px;margin:7px 0;background:#203c45;border:1px solid #77a8a1;border-radius:8px}
    #npc-test-conversation[hidden]{display:none}#npc-test-conversation .row{margin:5px 0}
    #npc-test-panel select{width:100%;margin:3px 0 7px}#npc-test-panel .dialogue{padding:7px;background:#1d343b;border-radius:6px}
    #npc-test-panel .dialogue p{margin:3px 0}#npc-test-panel .near{color:#f9d98a}
    #npc-test-panel [hidden]{display:none}
    #npc-test-panel[hidden]{display:none}
    #npc-test-panel summary{cursor:pointer;margin:7px 0;font-weight:700}
    #npc-test-panel.npc-live-panel{left:50%;right:auto;top:auto;bottom:115px;transform:translateX(-50%);width:min(420px,calc(100vw - 16px));max-height:min(60vh,540px);background:#102632f5;padding:10px 12px}
    .npc-live-panel #npc-test-talk{display:block;width:100%;min-height:48px;border-radius:11px;font-weight:800;background:#277a71;border-color:#9de4cf}
    .npc-live-panel #npc-test-talk[hidden]{display:none}
    .npc-live-panel #npc-test-talk:disabled{background:#29414a;border-color:#5f777a;opacity:.7;cursor:not-allowed}
    .npc-live-panel #npc-test-near{text-align:center;font-size:12px;margin:6px 0 0}
    .npc-live-panel #npc-test-conversation{margin:0;padding:0;border:0;background:transparent}
    .npc-live-panel .npc-dialogue-header{display:flex;align-items:center;gap:10px}
    .npc-live-panel .npc-dialogue-portrait{display:grid;place-items:center;flex:none;width:48px;height:48px;border-radius:50%;background:var(--npc-accent,#487b83);border:2px solid #def6e9;color:#102632;font-weight:900}
    .npc-live-panel .npc-dialogue-identity{min-width:0;flex:1}
    .npc-live-panel .npc-dialogue-identity strong{display:block;font-size:17px}
    .npc-live-panel .npc-dialogue-identity small{display:block;color:#c2d6d3;line-height:1.35}
    .npc-live-panel #npc-test-close{align-self:flex-start;min-width:32px;min-height:32px;border-radius:50%}
    .npc-live-panel #npc-test-player-line{max-width:88%;margin:12px 0 7px auto;padding:8px 11px;border-radius:12px 12px 2px 12px;background:#255c68;text-align:right}
    .npc-live-panel #npc-test-line{margin:10px 0;padding:12px;border-radius:3px 12px 12px 12px;background:#e7f2e9;color:#152d32;font-size:15px;line-height:1.5}
    .npc-live-panel #npc-test-choices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:10px}
    .npc-live-panel #npc-test-choices button{min-height:42px;border-radius:9px;background:#244955;text-align:left}
    #npc-test-labels{position:fixed;inset:0;z-index:60;pointer-events:none}
    .npc-test-tag{position:absolute;transform:translate(-50%,-100%) scale(.88);transform-origin:50% 100%;padding:3px 7px 4px;border:2px solid;border-radius:8px;background:#14242de8;color:#fff;font:700 12px/1.15 system-ui,sans-serif;white-space:nowrap;text-align:center;text-shadow:0 1px 2px #000}
    .npc-test-tag::after{content:attr(data-status);display:block;margin-top:2px;color:#c9d9e2;font:650 9px/1.1 system-ui,sans-serif;letter-spacing:.01em;text-shadow:0 1px 2px #000}
    .npc-test-tag[data-status=""]::after{display:none}
    .npc-test-tag.npc-ai-tag{background:#263052f0;border-color:#a9a2ff!important;color:#f2efff}
    @media(max-width:650px){#npc-test-panel:not(.npc-live-panel){top:auto;bottom:8px;right:8px;max-height:48vh;width:min(340px,calc(100vw - 16px))}}
  `;
  document.head.appendChild(style);
  const panel = document.createElement('section');
  panel.id = 'npc-test-panel';
  if (production) panel.classList.add('npc-live-panel');
  panel.hidden = production;
  panel.setAttribute('aria-label', production ? '인경호 NPC' : 'NPC 개발용 테스트');
  const developmentContent = `
    <h2>${production ? '인경호 NPC' : 'NPC Test Mode · A-R1'}</h2>
    <p class="minor">${production ? '캠퍼스를 생활하는 48명 · 이름과 학적 정보는 가상입니다.' : '로컬 개발용 · 48명 개별 외형/명부 · 학번·학과·성별은 가상 후보'}</p>
    <p id="npc-test-status" role="status"></p>
    <button type="button" id="npc-test-talk" disabled>근처 NPC와 대화 (F)</button>
    <p id="npc-test-memory-status" class="minor"></p>
    <p id="npc-ai-pilot-status" class="minor"></p>
    <div id="npc-test-conversation" hidden aria-label="NPC 대화">
      <strong id="npc-test-speaker"></strong>
      <p id="npc-test-line" aria-live="polite"></p>
      <div id="npc-test-choices" class="row"></div>
      <button type="button" id="npc-test-close">대화 닫기</button>
    </div>
    <p id="npc-test-near" class="near"></p>
    <details ${production ? '' : 'open'}>
    <summary>NPC 명부와 정보</summary>
    <div id="npc-test-periods" class="row" aria-label="시간대 선택"></div>
    <button type="button" id="npc-test-play" aria-pressed="true">일시정지</button>
    <label for="npc-test-select">NPC 선택</label>
    <select id="npc-test-select"></select>
    <button type="button" id="npc-test-focus">선택 NPC 가까이 보기</button>
    <div id="npc-test-detail" class="dialogue"></div>
    <button type="button" id="npc-test-memory-clear">로컬 대화 기억 지우기</button>
    <p class="minor">${production ? '기억은 이 브라우저에만 저장됩니다.' : 'WASD로 접근 · 목록에서 모든 NPC 확인 · 선택 NPC는 노란 원으로 표시'}</p>
    </details>
  `;
  panel.innerHTML = production ? `
    <button type="button" id="npc-test-talk" disabled aria-keyshortcuts="F">F · NPC와 대화</button>
    <section id="npc-test-conversation" role="dialog" aria-label="NPC 대화" hidden>
      <div class="npc-dialogue-header">
        <span id="npc-test-portrait" class="npc-dialogue-portrait" aria-hidden="true"></span>
        <div class="npc-dialogue-identity"><strong id="npc-test-speaker"></strong><small id="npc-social-profile"></small></div>
        <button type="button" id="npc-test-close" aria-label="대화 닫기">×</button>
      </div>
      <p id="npc-test-player-line" hidden></p>
      <p id="npc-test-line" aria-live="polite"></p>
      <p id="npc-ai-login-hint" class="minor" hidden>로그인하면 더 다양한 대화를 이어갈 수 있어요.</p>
      <div id="npc-test-choices" class="row" aria-label="대답 선택"></div>
    </section>
  ` : developmentContent;
  document.body.appendChild(panel);
  if (production && externalContextAction) panel.querySelector('#npc-test-talk').hidden = true;
  if (!production) document.getElementById('tour').hidden = true;
  return panel;
}
export async function createNpcDevRuntime({ app, campusRoot, player, orbit, production = false, aiPilot = false,
  sharedSchedulePreview = false, worldClock = null,
  socialEnabled = false, socialPreview = false, socialBehaviorPreview = false,
  observedConversationEnabled = false, isObservedConversationBlocked = () => true,
  getBusyNpcIds = () => [], onNpcTalk = () => {},
  externalContextAction = false, aiEndpoint = '/npc-ai/decide', getAiSession = async () => null,
  questEnabled = false, questEndpoint = '/npc-quest',
  sideEvent = null,
  onQuestReward = () => {},
  onQuestStateChange = () => {},
  tmlShadowEnabled = false,
  getTmlShadowEconomicState = () => ({}),
  getDialogueWorldContext = () => ({}),
  jevEnabled = false, jevEndpoint = '/api/npc-dialogue-route',
  onConversationOpen = () => {},
  onConversationClose = () => {} }) {
  // Shared schedules own physical movement. Local-only scenes must not override it.
  if (sharedSchedulePreview) {
    socialEnabled = false; socialPreview = false;
    socialBehaviorPreview = false;
  }
  // CORE-15: the base 20 carries both first-walk quest NPCs; the campus expansion is optional.
  const { batch, roster, hash, expansion: populationExpansion } = await loadNpcPopulation({
    onExpansionError: error => console.warn('Campus NPC expansion unavailable; continuing with the base roster:', error)
  });
  worldClock = sharedSchedulePreview ? (worldClock ?? createNpcWorldClock()) : null;
  if (worldClock) {
    if (worldClock.status().state !== 'SYNCED') await worldClock.sync();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void worldClock.sync();
    });
    window.addEventListener('pageshow', () => { void worldClock.sync(); });
  }
  let sharedFrameNow = worldClock?.now() ?? null;
  const panel = addPanel(production, externalContextAction);
  let browserStorage = null;
  try { browserStorage = aiPilot ? sessionStorage : localStorage; } catch { /* Session-only memory. */ }
  const memory = createNpcMemory(batch, hash, browserStorage);
  const encounters = createEncounterTracker();
  const npcById = new Map(batch.npcs.map(npc => [npc.npc_id, npc]));
  const rosterById = new Map(roster.npcs.map(entry => [entry.npc_id, entry]));
  const socialGraph = createPersistentNpcSocialGraph(batch, roster, hash, browserStorage);
  const first = snapshotForPeriod(batch, sharedFrameNow === null ? PULSE_PERIODS[0] : worldScheduleAt(sharedFrameNow).period);
  const navigator = createNpcNavigator(batch);
  const purposefulRoster = createPurposefulRoster(batch, navigator);
  if (worldClock) bindSharedSchedule(purposefulRoster, navigator, () => sharedFrameNow);
  const sharedMeetings = worldClock ? createSharedMeetings({ batch, profiles: roster,
    roster: purposefulRoster, navigator, now: () => sharedFrameNow }) : null;
  const sharedObserver = worldClock ? createSharedMeetingObserver() : null;
  const socialMotion = worldClock ? {
    status: () => ({ phase: 'SHARED_SCHEDULE', pairIds: [] }),
    setPeriod() {}, tick() { return this.status(); },
    shouldPauseForConversation: () => false, shouldHoldForJoin: () => false
  } : createPurposefulSocialMotion(batch, purposefulRoster, navigator);
  const avatars = new Map(first.actors.map(actor => {
    const visual = createHumanAvatar(campusRoot, actor, appearanceFor(rosterById.get(actor.id), npcById.get(actor.id)));
    visual.motion = { position: actor.position && { ...actor.position }, route: [], moving: false,
      heading: 0, wait: Number(actor.id.slice(-3)) % 4, leg: 0 };
    return [actor.id, visual];
  }));
  const labelLayer = document.createElement('div');
  labelLayer.id = 'npc-test-labels';
  document.body.appendChild(labelLayer);
  const nameplates = new Map(first.actors.map(actor => {
    const label = document.createElement('span');
    label.className = 'npc-test-tag';
    label.textContent = production ? actor.name : `${actor.id.slice(-3)} · ${actor.name}`;
    label.dataset.status = '';
    label.style.borderColor = avatars.get(actor.id).appearance.accent_color;
    labelLayer.appendChild(label);
    return [actor.id, label];
  }));
  const projectedPoint = new pc.Vec3();
  const status = panel.querySelector('#npc-test-status');
  const detail = panel.querySelector('#npc-test-detail');
  const near = panel.querySelector('#npc-test-near');
  const select = panel.querySelector('#npc-test-select');
  const focusButton = panel.querySelector('#npc-test-focus');
  const periodRow = panel.querySelector('#npc-test-periods');
  const playButton = panel.querySelector('#npc-test-play');
  const talkButton = panel.querySelector('#npc-test-talk');
  const conversation = panel.querySelector('#npc-test-conversation');
  const speaker = panel.querySelector('#npc-test-speaker');
  const portrait = panel.querySelector('#npc-test-portrait');
  const playerLine = panel.querySelector('#npc-test-player-line');
  const line = panel.querySelector('#npc-test-line');
  const choices = panel.querySelector('#npc-test-choices');
  const memoryStatus = panel.querySelector('#npc-test-memory-status');
  const pilotStatus = panel.querySelector('#npc-ai-pilot-status');
  const aiLoginHint = panel.querySelector('#npc-ai-login-hint');
  const socialProfile = panel.querySelector('#npc-social-profile');
  let elapsed = 0, running = true, snapshot = first, selectedId = first.actors[0].id, uiClock = 0;
  let activeConversation = null, dialogueSession = null, aiSignedIn = false, conversationAiUsed = false;
  let socialPreviewFastForward = false;
  let socialNg1 = null, socialNg1Panel = null, socialNg15Bridge = null;
  let main2Guide = null;
  let conversationLifecycleOpen = false;
  const observedConversation = observedConversationEnabled ? createObservedConversation() : null;
  const observedBubble = (observedConversationEnabled || sharedMeetings) ? createObservedBubble() : null;
  let observedFrame = null;
  const OBSERVED_RUNTIME_SCAN_SECONDS = .25;
  const OBSERVED_OBSTACLE_CACHE_SECONDS = .25;
  let observedNextScan = -Infinity, observedObstacleAt = -Infinity, observedObstacles = [], observedCanvasRect = null;
  let observedSocial = { groups: [], relations: {} }, observedSocialAt = -Infinity;
  function stopObservedConversation() {
    observedConversation?.stop();
    sharedObserver?.stop();
    observedBubble?.hide();
    observedFrame = null;
  }
  function syncConversationLifecycle() {
    const next = Boolean(activeConversation) || main2Guide?.isDialogueOpen?.() === true;
    onNpcTalk(activeConversation?.id ?? null, sharedFrameNow);
    if (next === conversationLifecycleOpen) return next;
    conversationLifecycleOpen = next;
    if (next) { stopObservedConversation(); onConversationOpen(); }
    else onConversationClose();
    return next;
  }
  if (socialEnabled) {
    const socialGroupFeasibility = createNpcSocialGroupFeasibility({
      roster: purposefulRoster,
      navigator
    });
    socialNg1 = createNpcSocialNg1Model(batch, {
      relationshipGraph: socialGraph,
      groupCandidateValidator: socialGroupFeasibility,
      observationProvider: ({ npc, period }) => {
        const sourcePeriod = period === 'night' ? 'evening' : period;
        const behaviorObservation = socialNg15Bridge?.observationFor(npc.npc_id);
        if (behaviorObservation) return behaviorObservation;
        const presence = runtimePresence(npc, sourcePeriod).slot;
        const motion = socialMotion.status();
        if (motion.period === sourcePeriod && motion.pairIds.includes(npc.npc_id) &&
            ['JOIN', 'WALK_TOGETHER', 'SEPARATE'].includes(motion.phase)) {
          return { location: `social.${motion.sharedDestination}`, activity: 'talk_with_friend', socialMode: 'high' };
        }
        return { location: presence.location, activity: presence.activity, socialMode: presence.social_mode };
      }
    });
    if (socialBehaviorPreview) {
      socialNg15Bridge = createNpcSocialNg15Bridge({
        roster: purposefulRoster,
        navigator,
        onRegularMeetingOutcome: ({ groupId, outcome, attendance = null }) => {
          if (socialNg1?.recordGroupMeetingOutcome(groupId, outcome, attendance)) socialNg1Panel?.render();
        }
      });
    }
    if (socialPreview) socialNg1Panel = mountNpcSocialNg1Panel({ model: socialNg1, batch });
  }
  let pendingPilotAction = null, pilotAvailable = aiPilot, pilotConversationRequest = 0, dialogueRouteRequest = 0;
  const pilotTopics = new Map(), pilotInFlight = new Set();
  const dialogueRouter = createNpcJevDialogueRouter({ enabled: jevEnabled, endpoint: jevEndpoint, getSession: getAiSession });
  const aiEnabled = id => aiPilot && aiSignedIn && pilotAvailable && aiPilotIds.has(id);
  function purposefulStatus(id) {
    const state = purposefulRoster.get(id).controller.status(false);
    return !worldClock && activeConversation?.id === id
      ? { ...state, phase: 'TALKING', interruptedPhase: state.phase, moving: false }
      : state;
  }
  const tmlMain2Shadow = createTmlMain2Shadow({ enabled: tmlShadowEnabled });
  const tmlFirstCampusGyeolShadow = createTmlFirstCampusGyeolShadow({ enabled: tmlShadowEnabled });
  const quest = createQuestClient({ enabled: questEnabled, endpoint: questEndpoint,
    getSession: getAiSession,
    getNpcPosition: id => avatars.get(id)?.motion?.position ? { ...avatars.get(id).motion.position } : null,
    tour: document.getElementById('tour'),
    onReward: onQuestReward,
    onServerResult: observation => {
      void tmlFirstCampusGyeolShadow.observeQuestResult(observation)
        .catch(() => {});
    } });
  const main2Quest = createMain2QuestClient({
    enabled: questEnabled,
    endpoint: questEndpoint,
    getSession: getAiSession,
    onReward: onQuestReward,
    onServerResult: observation => {
      try {
        tmlMain2Shadow.observeQuestResult({
          ...observation,
          economicBefore: getTmlShadowEconomicState?.() ?? {}
        });
      } catch { /* TML shadow is diagnostic-only and cannot block gameplay. */ }
    }
  });
  main2Guide = createMain2GuideRuntime({
    root: campusRoot,
    player,
    quest: main2Quest,
    onConversationOpen: syncConversationLifecycle,
    onConversationClose: syncConversationLifecycle
  });
  const publishQuestState = () => {
    try { onQuestStateChange({ quest: quest.status(), main2Quest: main2Quest.status() }); }
    catch { /* HUD consumers cannot block quest progress. */ }
  };
  const syncSideEventUnlock = () => sideEvent?.setUnlocked?.(quest.status().complete === true);
  quest.onChange(stage => {
    syncSideEventUnlock();
    if (stage === 5) void main2Quest.refresh().catch(() => {});
    publishQuestState();
    renderQuestChoice();
  });
  main2Quest.onChange(() => { publishQuestState(); renderQuestChoice(); });
  sideEvent?.onChange?.(() => renderQuestChoice());
  syncSideEventUnlock();
  function setAiSignedIn(signedIn) {
    aiSignedIn = Boolean(signedIn);
    try {
      tmlMain2Shadow.resetScope(aiSignedIn ? 'SIGNED_IN_OR_SWITCHED' : 'SIGNED_OUT');
      tmlFirstCampusGyeolShadow.resetScope();
    } catch { /* shadow scope reset is diagnostic-only */ }
    quest.setSignedIn(aiSignedIn);
    main2Quest.setSignedIn(aiSignedIn);
    for (const [id, label] of nameplates) {
      const actor = first.actors.find(item => item.id === id);
      const ai = aiEnabled(id);
      label.textContent = production ? actor.name : `${ai ? '✦ AI · ' : ''}${id.slice(-3)} · ${actor.name}`;
      label.dataset.status = '';
      label.classList.toggle('npc-ai-tag', !production && ai);
    }
    if (!aiSignedIn) {
      pendingPilotAction = null;
      if (activeConversation && aiPilotIds.has(activeConversation.id)) closeConversation(false);
    }
    if (pilotStatus && aiPilot) pilotStatus.textContent = aiSignedIn
      ? '나나율·가유담 AI 대화 · 주제와 추가 질문에 대화당 최대 2회 호출'
      : '로그인하면 나나율·가유담의 AI 대화가 열립니다.';
    if (aiLoginHint) aiLoginHint.hidden = !aiPilot || aiSignedIn || !aiPilotIds.has(activeConversation?.id);
  }
  setAiSignedIn(false);
  const memoryScopeText = () => memory.persistent
    ? aiPilot ? '기억: 이 탭의 파일럿 세션에만 저장 · 계정 저장 아님'
      : '기억: 이 브라우저의 게스트 닉네임끼리 공유 · 계정 저장 아님'
    : '기억: 현재 화면에서만 유지 · 계정 저장 아님';
  if (memoryStatus) memoryStatus.textContent = memoryScopeText();
  for (const actor of production ? [] : first.actors) {
    const option = document.createElement('option');
    option.value = actor.id;
    const entry = rosterById.get(actor.id);
    option.textContent = `${actor.id.slice(-3)} · ${actor.name} · ${entry.department ?? entry.affiliation}`;
    select.appendChild(option);
  }
  for (const period of production ? [] : PULSE_PERIODS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = periodLabels[period];
    button.dataset.period = period;
    button.addEventListener('click', () => setPeriod(period));
    periodRow.appendChild(button);
  }
  playButton?.addEventListener('click', () => {
    running = !running;
    playButton.textContent = running ? '일시정지' : '재생';
    playButton.setAttribute('aria-pressed', String(running));
  });
  select?.addEventListener('change', () => { closeConversation(false); selectedId = select.value; drawDetail(); });
  focusButton?.addEventListener('click', focusSelected);
  talkButton.addEventListener('click', openConversation);
  panel.querySelector('#npc-test-close').addEventListener('click', () => closeConversation());
  panel.querySelector('#npc-test-memory-clear')?.addEventListener('click', () => {
    const memoryCleared = memory.clear();
    const graphCleared = socialGraph.clear();
    if (memoryCleared && graphCleared) {
      pilotTopics.clear();
      encounters.clear();
      closeConversation(false);
      memoryStatus.textContent = `로컬 기억과 NPC 관계망을 지웠습니다. ${memoryScopeText()}`;
    } else memoryStatus.textContent = `브라우저 저장소의 일부 기억을 지우지 못했습니다. ${memoryScopeText()}`;
  });
  // Talking is the World's interaction key (F) through getContextAction(); E stays emotion-only.
  // Only Escape is handled here, to close an open dialogue.
  window.addEventListener('keydown', event => {
    if (event.repeat || event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]')) return;
    if (event.code === 'Escape' && activeConversation) closeConversation();
  });

  function nearestVisible() {
    const playerPos = player.getLocalPosition();
    return snapshot.actors.filter(actor => avatars.get(actor.id).motion.position)
      .map(actor => ({ actor, distance: Math.hypot(avatars.get(actor.id).motion.position.x - playerPos.x,
        avatars.get(actor.id).motion.position.z - playerPos.z) }))
      .sort((a, b) => a.distance - b.distance)[0];
  }
  function interactionTarget() {
    if (production) return nearestVisible();
    const actor = snapshot.actors.find(item => item.id === selectedId);
    const position = avatars.get(selectedId).motion.position;
    const playerPos = player.getLocalPosition();
    if (actor && position) {
      const distance = Math.hypot(position.x - playerPos.x, position.z - playerPos.z);
      if (distance <= NPC_TALK_RADIUS) return { actor, distance };
    }
    return nearestVisible();
  }
  function handlesTalkKey() {
    return Boolean(activeConversation || main2Guide.isDialogueOpen() ||
      main2Guide.getContextAction() || interactionTarget()?.distance <= NPC_TALK_RADIUS);
  }
  function closeConversation(applyAction = true, { sync = true } = {}) {
    activeConversation = null;
    dialogueSession = null;
    conversation.hidden = true;
    if (sync) syncConversationLifecycle();
    pilotConversationRequest++;
    if (applyAction && pendingPilotAction) {
      if (!applyPilotAction(pendingPilotAction.id, pendingPilotAction.action) && pilotStatus)
        pilotStatus.textContent = '현재 위치에서 해당 행동을 실행할 수 없어 기존 일정으로 돌아갑니다.';
    }
    pendingPilotAction = null;
    if (production) {
      panel.classList.remove('npc-conversation-open');
      talkButton.hidden = externalContextAction;
      playerLine.hidden = true;
      panel.hidden = externalContextAction ? true : !(interactionTarget()?.distance <= NPC_TALK_RADIUS);
    }
  }

  function activeDialogueActor() {
    return activeConversation ? snapshot.actors.find(item => item.id === activeConversation.id) ?? null : null;
  }

  function captureDialogueContract(actor, { followUp = false } = {}) {
    if (!activeConversation || !dialogueSession || !actor) return null;
    const state = purposefulRoster.get(actor.id)?.controller.status(false);
    const context = buildNpcDialogueContext({
      npc: npcById.get(actor.id),
      actor: { ...actor, period: snapshot.period, moving: state?.moving ?? avatars.get(actor.id)?.motion?.moving ?? false },
      rosterEntry: rosterById.get(actor.id),
      session: dialogueSession.snapshot(),
      memoryRecord: memory.read(actor.id),
      socialProfile: socialNg1?.profile(actor.id) ?? null,
      questState: quest.status(),
      priority: {
        quest: Boolean(quest.eventForNpc(actor.id)),
        sideEvent: Boolean(sideEvent?.npcChoice?.(actor.id))
      },
      world: getDialogueWorldContext?.() ?? {},
      generationAllowed: aiEnabled(actor.id),
      followUp
    });
    const candidates = buildNpcDialogueCandidates(context);
    const baseline = resolveNpcDialogueBaseline(context);
    activeConversation.dialogueContext = context;
    activeConversation.dialogueCandidates = candidates;
    activeConversation.dialogueBaseline = baseline;
    activeConversation.dialogueDecision = {
      responseSource: baseline.responseSource,
      intent: baseline.intent,
      contextPriority: baseline.contextPriorities?.[0] ?? null,
      provider: 'DETERMINISTIC_BASELINE',
      role: 'EXPERIMENT_ONLY',
      authorityEffect: 'NONE',
      fallbackReason: jevEnabled ? 'PENDING' : 'DISABLED'
    };
    const routeId = ++dialogueRouteRequest;
    const sessionRevision = dialogueSession.snapshot().revision;
    void dialogueRouter.route({ context, candidates, baseline }).then(decision => {
      if (activeConversation?.id !== actor.id || routeId !== dialogueRouteRequest ||
          dialogueSession?.snapshot().revision !== sessionRevision) return;
      activeConversation.dialogueDecision = decision;
    });
    return { context, candidates, baseline };
  }

  function setPlayerDialogueLine(text = null) {
    if (!production || !playerLine) return;
    playerLine.textContent = text ?? '';
    playerLine.hidden = !text;
  }

  function addDialogueChoice(label, onClick, { className = '' } = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    if (className) button.className = className;
    button.textContent = label;
    button.addEventListener('click', onClick);
    choices.appendChild(button);
    return button;
  }

  function dialoguePriorityAvailable(actorId) {
    return Boolean(quest.eventForNpc(actorId) || sideEvent?.npcChoice?.(actorId));
  }

  function homeGreeting(actor) {
    const before = activeConversation?.memoryBefore ?? memory.read(actor.id);
    const newEncounter = activeConversation?.newEncounter === true;
    const relationshipContext = socialNg1?.relationshipLine(actor.id) ?? '';
    const greeting = !newEncounter ? `계속 이야기해요. ${actor.dialogue[0]}` : before.encounters
      ? `또 만났네요. ${before.topic ? `지난번 ${npcTopicLabel(before.topic)} 이야기를 기억해요. ` : ''}${actor.dialogue[0]}`
      : `처음 뵙네요. ${actor.dialogue[0]}`;
    return relationshipContext ? `${greeting} ${relationshipContext}` : greeting;
  }

  function showDialogueHome({ keepLine = false } = {}) {
    const actor = activeDialogueActor();
    if (!actor || !dialogueSession) return;
    pilotConversationRequest++;
    dialogueSession.home();
    captureDialogueContract(actor);
    setPlayerDialogueLine(null);
    if (!keepLine) line.textContent = homeGreeting(actor);
    choices.replaceChildren();
    const remembered = activeConversation?.memoryBefore ?? memory.read(actor.id);
    const actions = npcDialogueHomeActions({
      hasPriority: dialoguePriorityAvailable(actor.id),
      hasMemory: hasNpcDialogueMemory(remembered)
    });
    for (const action of actions) {
      if (action === NPC_DIALOGUE_ACTION.QUEST) {
        addDialogueChoice('📌 부탁·이벤트', () => {
          dialogueSession.go(NPC_DIALOGUE_STATE.QUEST);
          renderDialogueState();
        }, { className: 'npc-quest-choice' });
      } else if (action === NPC_DIALOGUE_ACTION.STATUS) {
        addDialogueChoice('근황 묻기', () => {
          dialogueSession.go(NPC_DIALOGUE_STATE.STATUS);
          renderDialogueState();
        });
      } else if (action === NPC_DIALOGUE_ACTION.TOPICS) {
        addDialogueChoice('관심사 이야기', () => {
          dialogueSession.go(NPC_DIALOGUE_STATE.TOPICS);
          renderDialogueState();
        });
      } else if (action === NPC_DIALOGUE_ACTION.MEMORY) {
        addDialogueChoice('지난번 이야기', () => {
          dialogueSession.go(NPC_DIALOGUE_STATE.MEMORY);
          renderDialogueState();
        });
      } else if (action === NPC_DIALOGUE_ACTION.CLOSE) {
        addDialogueChoice('대화 마치기', () => closeConversation());
      }
    }
  }

  function renderStatusDialogue(actor) {
    captureDialogueContract(actor);
    setPlayerDialogueLine('요즘 어떻게 지내요?');
    line.textContent = actor.dialogue[1] ?? actor.dialogue[0];
    choices.replaceChildren();
    if (aiEnabled(actor.id)) {
      addDialogueChoice('함께 할 거리 물어보기', () => requestSocialSuggestion(actor));
    }
    addDialogueChoice('처음으로', () => showDialogueHome());
    addDialogueChoice('대화 마치기', () => closeConversation());
  }

  function requestSocialSuggestion(actor) {
    if (pilotInFlight.has(actor.id)) return;
    captureDialogueContract(actor);
    const fallback = actor.id === MAIN_NPC_ID
      ? '친구와 인경호 동쪽 벤치에서 잠깐 쉬어 봐요.'
      : '친구와 인경호 사진 지점에서 사진 한 장 남겨 봐요.';
    pendingPilotAction = null;
    const requestId = ++pilotConversationRequest;
    setPlayerDialogueLine('친구와 함께 할 만한 일이 있을까요?');
    choices.replaceChildren();
    addDialogueChoice('처음으로', () => showDialogueHome());
    addDialogueChoice('대화 마치기', () => closeConversation());
    if (conversationAiUsed) { line.textContent = fallback; return; }
    line.textContent = '잠시 생각 중…';
    requestPilot(actor.id, null, 'social').then(result => {
      if (activeConversation?.id !== actor.id || requestId !== pilotConversationRequest) return;
      line.textContent = result?.line ?? fallback;
      if (result && aiEnabled(actor.id)) pendingPilotAction = { id: actor.id, action: result.action };
    }).catch(() => {
      if (activeConversation?.id === actor.id && requestId === pilotConversationRequest) line.textContent = fallback;
    });
  }

  function renderTopicMenu(actor) {
    captureDialogueContract(actor);
    setPlayerDialogueLine(null);
    line.textContent = '어떤 이야기를 나눌까요?';
    choices.replaceChildren();
    for (const topic of (npcById.get(actor.id)?.interests ?? []).slice(0, 3)) {
      addDialogueChoice(npcTopicLabel(topic), () => beginTopicDialogue(actor, topic));
    }
    addDialogueChoice('← 처음으로', () => showDialogueHome());
    addDialogueChoice('대화 마치기', () => closeConversation());
  }

  function renderTopicResponseChoices(actor, topic, { allowFollowUp = false } = {}) {
    choices.replaceChildren();
    if (allowFollowUp && aiEnabled(actor.id)) {
      addDialogueChoice('조금 더 물어보기', () => requestTopicFollowUp(actor, topic), { className: 'npc-ai-follow-up' });
    }
    addDialogueChoice('다른 관심사', () => {
      dialogueSession.go(NPC_DIALOGUE_STATE.TOPICS);
      renderDialogueState();
    });
    addDialogueChoice('처음으로', () => showDialogueHome());
    addDialogueChoice('대화 마치기', () => closeConversation());
  }

  function beginTopicDialogue(actor, topic) {
    if (pilotInFlight.has(actor.id)) return;
    dialogueSession.go(NPC_DIALOGUE_STATE.TOPIC_RESPONSE, { selectedTopic: topic });
    captureDialogueContract(actor);
    pendingPilotAction = null;
    const requestId = ++pilotConversationRequest;
    memory.rememberTopic(actor.id, topic);
    setPlayerDialogueLine(`${npcTopicLabel(topic)} 이야기를 해요.`);
    choices.replaceChildren();
    if (aiEnabled(actor.id) && !conversationAiUsed) {
      conversationAiUsed = true;
      line.textContent = '잠시 생각 중…';
      requestPilot(actor.id, topic).then(result => {
        if (activeConversation?.id !== actor.id || requestId !== pilotConversationRequest) return;
        if (!result) line.textContent = `${npcTopicLabel(topic)} 이야기는 저도 좋아해요. ${actor.dialogue[0]}`;
        else {
          line.textContent = result.line;
          pendingPilotAction = { id: actor.id, action: result.action };
          pilotTopics.set(actor.id, topic);
        }
        renderTopicResponseChoices(actor, topic, { allowFollowUp: Boolean(result) });
      }).catch(() => {
        if (activeConversation?.id !== actor.id || requestId !== pilotConversationRequest) return;
        line.textContent = `${npcTopicLabel(topic)} 이야기는 저도 좋아해요. ${actor.dialogue[0]}`;
        renderTopicResponseChoices(actor, topic);
      });
    } else {
      line.textContent = `${npcTopicLabel(topic)} 이야기는 저도 좋아해요. ${actor.dialogue[0]}`;
      renderTopicResponseChoices(actor, topic);
    }
    if (memoryStatus) memoryStatus.textContent = memoryScopeText();
  }

  function requestTopicFollowUp(actor, topic) {
    if (pilotInFlight.has(actor.id) || !aiEnabled(actor.id)) return;
    captureDialogueContract(actor, { followUp: true });
    const requestId = ++pilotConversationRequest;
    setPlayerDialogueLine(`${npcTopicLabel(topic)} 이야기를 조금 더 들려주세요.`);
    line.textContent = '잠시 생각 중…';
    choices.replaceChildren();
    requestPilot(actor.id, topic, 'topic', true).then(result => {
      if (activeConversation?.id !== actor.id || requestId !== pilotConversationRequest) return;
      line.textContent = result?.line ?? `${npcTopicLabel(topic)} 이야기는 다음에 이어가요.`;
      if (result) pendingPilotAction = { id: actor.id, action: result.action };
      renderTopicResponseChoices(actor, topic, { allowFollowUp: false });
    }).catch(() => {
      if (activeConversation?.id !== actor.id || requestId !== pilotConversationRequest) return;
      line.textContent = `${npcTopicLabel(topic)} 이야기는 다음에 이어가요.`;
      renderTopicResponseChoices(actor, topic, { allowFollowUp: false });
    });
  }

  function renderMemoryDialogue(actor) {
    captureDialogueContract(actor);
    const remembered = memory.read(actor.id);
    setPlayerDialogueLine('전에 무슨 얘기 했었죠?');
    line.textContent = remembered.topic
      ? `지난번에는 ${npcTopicLabel(remembered.topic)} 이야기를 했었죠. ${actor.dialogue[0]}`
      : `전에 인사한 적 있죠. ${actor.dialogue[0]}`;
    choices.replaceChildren();
    addDialogueChoice('처음으로', () => showDialogueHome());
    addDialogueChoice('대화 마치기', () => closeConversation());
  }

  function questChoiceLabel(event) {
    return event === 'start' ? '첫 탐방 시작' :
      event === 'talk_002' ? '가유담의 부탁 듣기' : '탐방 마쳤다고 알리기';
  }

  function renderQuestMenu(actor, { keepLine = false } = {}) {
    captureDialogueContract(actor);
    if (!keepLine) {
      setPlayerDialogueLine(null);
      line.textContent = '지금 이어갈 이야기를 골라 주세요.';
    }
    choices.replaceChildren();
    const actorId = actor.id;
    const event = quest.eventForNpc(actorId);
    if (event) {
      const button = addDialogueChoice(questChoiceLabel(event), async () => {
        button.disabled = true;
        line.textContent = '진행 상태 확인 중…';
        setPlayerDialogueLine(button.textContent);
        try {
          const result = await quest.advanceNpc(actorId);
          if (activeConversation?.id === actorId &&
              dialogueSession?.snapshot().state === NPC_DIALOGUE_STATE.QUEST)
            line.textContent = result?.line ?? '로그인 상태를 확인한 뒤 다시 시도해 주세요.';
        } catch {
          if (activeConversation?.id === actorId &&
              dialogueSession?.snapshot().state === NPC_DIALOGUE_STATE.QUEST)
            line.textContent = '지금은 진행 상태를 저장하지 못했어요. 다시 시도해 주세요.';
        } finally {
          if (activeConversation?.id === actorId && dialogueSession?.snapshot().state === NPC_DIALOGUE_STATE.QUEST)
            renderQuestMenu(actor, { keepLine: true });
        }
      }, { className: 'npc-quest-choice' });
    }
    const sideChoice = sideEvent?.npcChoice?.(actorId);
    if (sideChoice) {
      addDialogueChoice(sideChoice.label, () => {
        setPlayerDialogueLine(sideChoice.label);
        const result = sideEvent.advanceNpc?.(actorId, sideChoice.id);
        if (activeConversation?.id === actorId) {
          line.textContent = result?.line ?? '지금은 이 이야기를 이어갈 수 없어요.';
          if (dialogueSession?.snapshot().state === NPC_DIALOGUE_STATE.QUEST) renderQuestMenu(actor, { keepLine: true });
        }
      }, { className: 'npc-side-event-choice' });
    }
    if (!event && !sideChoice) line.textContent = '지금은 따로 부탁할 일은 없어요.';
    addDialogueChoice('← 처음으로', () => showDialogueHome());
    addDialogueChoice('대화 마치기', () => closeConversation());
  }

  function renderDialogueState() {
    const actor = activeDialogueActor();
    if (!actor || !dialogueSession) return;
    const state = dialogueSession.snapshot().state;
    if (state === NPC_DIALOGUE_STATE.HOME) showDialogueHome();
    else if (state === NPC_DIALOGUE_STATE.STATUS) renderStatusDialogue(actor);
    else if (state === NPC_DIALOGUE_STATE.TOPICS) renderTopicMenu(actor);
    else if (state === NPC_DIALOGUE_STATE.MEMORY) renderMemoryDialogue(actor);
    else if (state === NPC_DIALOGUE_STATE.QUEST) renderQuestMenu(actor);
  }

  function openConversation() {
    if (activeConversation) closeConversation(false, { sync: false });
    const closest = interactionTarget();
    if (!closest || closest.distance > NPC_TALK_RADIUS) return;
    const actor = closest.actor;
    const before = memory.read(actor.id);
    const newEncounter = encounters.begin(actor.id);
    if (newEncounter) memory.encounter(actor.id, snapshot.period === 'night' ? 'evening' : snapshot.period);
    activeConversation = { id: actor.id, memoryBefore: before, newEncounter };
    dialogueSession = createNpcDialogueSession({ npcId: actor.id });
    syncConversationLifecycle();
    if (aiLoginHint) aiLoginHint.hidden = !aiPilot || aiSignedIn || !aiPilotIds.has(actor.id);
    avatars.get(actor.id).motion.moving = false;
    conversationAiUsed = false;
    selectedId = actor.id;
    if (select) select.value = actor.id;
    speaker.textContent = production
      ? actor.name
      : `${aiEnabled(actor.id) ? '✦ AI · ' : ''}${actor.name} · ${periodLabels[snapshot.period]}`;
    socialNg1?.setSelectedNpc(actor.id);
    socialNg1Panel?.render();
    if (socialProfile) socialProfile.textContent = socialNg1?.profileLine(actor.id) ?? '';
    if (production) {
      const entry = rosterById.get(actor.id);
      portrait.textContent = actor.name.slice(0, 1);
      portrait.style.setProperty('--npc-accent', avatars.get(actor.id)?.appearance?.accent_color ?? entry.visual.accent_color);
      playerLine.hidden = true;
      talkButton.hidden = true;
      panel.hidden = false;
      panel.classList.add('npc-conversation-open');
    }
    conversation.hidden = false;
    showDialogueHome();
    drawDetail();
  }

  function renderQuestChoice() {
    if (!activeConversation || !dialogueSession) return;
    const state = dialogueSession.snapshot().state;
    if (state === NPC_DIALOGUE_STATE.QUEST) renderQuestMenu(activeDialogueActor());
    else if (state === NPC_DIALOGUE_STATE.HOME) showDialogueHome({ keepLine: true });
  }

  function drawDetail() {
    socialNg1?.setSelectedNpc(selectedId);
    socialNg1Panel?.render();
    if (socialProfile && activeConversation) socialProfile.textContent = socialNg1?.profileLine(activeConversation.id) ?? '';
    if (production) {
      for (const visual of avatars.values()) visual.marker.enabled = false;
      return;
    }
    const actor = snapshot.actors.find(item => item.id === selectedId);
    const entry = rosterById.get(selectedId);
    const appearance = avatars.get(selectedId).appearance;
    const hook = actor.dialogue[Math.floor(elapsed / 20) % actor.dialogue.length];
    detail.replaceChildren();
    for (const line of [
      `${actor.id.slice(-3)} · ${actor.name} · ${actor.archetype}`,
      `성별 ${appearance.label} · ${entry.department ? `학과 ${entry.department}` : `소속 ${entry.affiliation}`}`,
      `모의 학번 ${entry.student_number ?? '해당 없음'}`,
      `외형 ${hairLabels[appearance.hair_style]} · ${accessoryLabels[appearance.accessory]}`,
      `${actor.location} · ${actor.activity} · social ${actor.social_mode}`,
      `현장 이동 ${avatars.get(selectedId).motion.moving ? '중' : '대기'} · 좌표 ${avatars.get(selectedId).motion.position ? `${avatars.get(selectedId).motion.position.x.toFixed(1)}, ${avatars.get(selectedId).motion.position.z.toFixed(1)}` : '외부'}`,
      `“${hook}”`
    ]) {
      const p = document.createElement('p'); p.textContent = line; detail.appendChild(p);
    }
    for (const [id, visual] of avatars) visual.marker.enabled = id === selectedId && visual.avatar.enabled;
    focusButton.disabled = !actor.position;
  }
  function focusSelected() {
    const actor = snapshot.actors.find(item => item.id === selectedId);
    const position = avatars.get(selectedId).motion.position;
    const point = inspectionPointFor({ ...actor, position });
    if (!point) return;
    player.setLocalPosition(point.x, 1.15 + roadviewGroundHeight(point.x, point.z), point.z);
    orbit.yaw = Math.atan2(point.x - position.x, position.z - point.z) - .5;
    orbit.pitch = .24;
    orbit.distance = 12;
  }
  function applySnapshot(next, instant = false) {
    if (instant && activeConversation) closeConversation(false);
    if (next.period !== snapshot.period) {
      encounters.clear();
      socialMotion.setPeriod(next.period);
      const index = PULSE_PERIODS.indexOf(next.period);
      for (const { controller } of purposefulRoster.values()) controller.setScheduleIndex(index);
    }
    snapshot = next;
    for (const actor of next.actors) {
      const visual = avatars.get(actor.id);
      visual.actor = actor;
      const purpose = purposefulRoster.get(actor.id);
      if (purpose) {
        const state = purpose.controller.status(false);
        actor.position = state.visible ? { ...state.position } : null;
        actor.location = state.destination;
        actor.activity = state.activity ?? state.currentGoal;
        visual.seat = null;
        visual.avatar.enabled = state.visible;
        visual.motion.position = state.visible ? { ...state.position } : null;
        visual.motion.route = [];
        visual.motion.moving = state.moving;
        continue;
      }
      visual.seat = actor.activity === 'sit' && actor.position ? findSeat(actor.position, { range: 1 }) : null;
      visual.avatar.enabled = Boolean(actor.position);
      const motion = visual.motion;
      motion.moving = false;
      if (!actor.position) {
        motion.position = null; motion.route = [];
      } else if (!motion.position || instant) {
        motion.position = { ...actor.position }; motion.route = [];
        motion.wait = Number(actor.id.slice(-3)) % 4;
      } else {
        motion.route = navigator.route(motion.position, actor.position);
        if (!motion.route) throw new Error(`No safe NPC route for ${actor.id}/${next.period}`);
        motion.wait = 0;
      }
    }
    for (const button of periodRow?.children ?? []) button.setAttribute('aria-pressed', String(button.dataset.period === next.period));
    drawDetail();
  }
  function setPeriod(period) {
    if (worldClock) return false;
    const index = PULSE_PERIODS.indexOf(period);
    if (index < 0) throw new Error(`Unknown period: ${period}`);
    elapsed = index * PERIOD_SECONDS;
    applySnapshot(snapshotForPeriod(batch, period), true);
    drawStatus();
  }
  function drawStatus() {
    if (production) return;
    const remaining = Math.ceil(CYCLE_SECONDS - elapsed);
    const movingCount = [...avatars.values()].filter(visual => visual.motion.moving).length;
    const localCount = [...avatars.values()].filter(visual => visual.motion.position).length;
    status.textContent = `${periodLabels[snapshot.period]} · 현장 ${localCount}/20 (목표 ${snapshot.localCount}) · 목적 이동 ${movingCount} · 외부 ${20 - localCount} · 동행 ${socialPhaseLabels[socialMotion.status().phase]} · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  }
  function advanceMotion(visual, dt) {
    const motion = visual.motion, actor = visual.actor;
    motion.moving = false;
    const purpose = purposefulRoster.get(actor.id);
    if (purpose) {
      if (!worldClock && (activeConversation?.id === actor.id || socialMotion.shouldPauseForConversation(actor.id, activeConversation?.id) ||
          socialNg15Bridge?.shouldPauseForConversation(actor.id, activeConversation?.id) ||
          socialMotion.shouldHoldForJoin(actor.id)))
        purpose.controller.pause();
      else purpose.controller.resume();
      const state = purpose.controller.tick(dt);
      motion.position = state.visible ? { ...state.position } : null;
      motion.heading = state.heading;
      motion.sharedMeeting = Boolean(state.meetingId);
      motion.moving = state.moving;
      actor.position = state.visible ? { ...state.position } : null;
      actor.location = state.destination;
      actor.activity = state.activity ?? state.currentGoal;
      visual.avatar.enabled = state.visible;
      visual.seat = state.phase === 'ACTING' && state.activity === 'RESTING'
        ? findSeat(state.position, { range: 2 }) : null;
      return;
    }
    if (activeConversation?.id === actor.id) return;
    if (!dt || !motion.position || !actor.position) return;
    if (!motion.route.length) {
      motion.wait -= dt;
      if (motion.wait > 0 || !roaming.has(actor.activity) || aiPilotIds.has(actor.id)) return;
      motion.route = navigator.wanderRoute(motion.position, actor.position, actor.id, motion.leg++, walking.has(actor.activity) ? 12 : 5) ?? [];
      if (!motion.route.length) { motion.wait = 4; return; }
    }
    const step = advanceRoute(motion.position, motion.route, dt * (walking.has(actor.activity) ? 1.15 : .85));
    motion.position = step.position;
    if (step.moved > 0) { motion.heading = step.heading; motion.moving = true; }
    if (!motion.route.length) motion.wait = walking.has(actor.activity) ? 1 + Number(actor.id.slice(-3)) % 3 : 4;
  }
  function pilotActions(id) {
    const visual = avatars.get(id);
    const allowed = ['stay', 'look_at_player', 'walk_nearby'];
    if (visual.seat) allowed.push('stand');
    else if (visual.motion.position && findSeat(visual.motion.position, { range: 1 })) allowed.push('sit_at_bench');
    return allowed;
  }
  async function requestPilot(id, topic, trigger = 'topic', followUp = false) {
    if (!aiEnabled(id) || pilotInFlight.has(id)) return null;
    pilotInFlight.add(id);
    try {
      const token = await getAiSession();
      if (!token || !aiEnabled(id)) return null;
      const availableActions = production ? ['stay'] : trigger === 'social' ? ['stay', 'look_at_player'] : pilotActions(id);
      const response = await fetch(aiEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ npc_id: id, period: snapshot.period === 'night' ? 'evening' : snapshot.period, trigger, topic,
          prior_topic: pilotTopics.get(id) ?? null, follow_up: followUp, available_actions: availableActions })
      });
      if (response.status === 429) {
        const error = await response.json();
        if (error.error === 'PILOT_CALL_LIMIT') { pilotAvailable = false; setAiSignedIn(aiSignedIn); }
        if (pilotStatus) pilotStatus.textContent = error.error === 'PILOT_CALL_LIMIT'
          ? '오늘 AI 대화 호출 상한에 도달했습니다.'
          : error.error === 'PILOT_USER_DAILY_LIMIT' ? '오늘의 AI 대화 3회를 모두 사용했습니다.'
            : error.error === 'PILOT_GLOBAL_DAILY_LIMIT' ? '오늘의 전체 AI 대화 상한에 도달했습니다.'
              : '잠시 뒤 다시 대화해 주세요.';
        return null;
      }
      if (response.status === 401) return null;
      if (!response.ok) throw Error(`NPC AI HTTP ${response.status}`);
      const result = await response.json();
      if (result.npc_id !== id || !availableActions.includes(result.action)) throw Error('NPC AI action mismatch');
      if (pilotStatus) pilotStatus.textContent = `${id.slice(-3)} AI 결정: ${result.action}`;
      return result;
    } catch {
      if (pilotStatus) pilotStatus.textContent = 'AI 답변을 받지 못했습니다. 다음 대화에서 다시 시도해 주세요.';
      return null;
    } finally { pilotInFlight.delete(id); }
  }
  function applyPilotAction(id, action) {
    const visual = avatars.get(id), motion = visual?.motion;
    if (!motion?.position || !pilotActions(id).includes(action)) return false;
    if (action === 'walk_nearby') {
      const route = navigator.wanderRoute(motion.position, visual.actor.position, id, motion.leg++, 5);
      if (!route?.length) return false;
      visual.seat = null;
      motion.route = route;
      motion.wait = 0;
    } else if (action === 'sit_at_bench') {
      const seat = findSeat(motion.position, { range: 1 });
      if (!seat) return false;
      visual.seat = seat; motion.route = []; motion.wait = 8;
    } else if (action === 'stand') {
      visual.seat = null; motion.route = []; motion.wait = 8;
    } else if (action === 'look_at_player') {
      visual.pilotFacingUntil = performance.now() + 8000; motion.route = []; motion.wait = 8;
    } else { motion.route = []; motion.wait = 8; }
    return true;
  }
  function drawNameplates(playerPos) {
    const nearby = snapshot.actors.filter(actor => actor.position)
      .map(actor => ({ actor, distance: Math.hypot(avatars.get(actor.id).motion.position.x - playerPos.x,
        avatars.get(actor.id).motion.position.z - playerPos.z) }))
      .filter(item => item.distance <= NPC_NAMEPLATE_RADIUS)
      .sort((a, b) => a.distance - b.distance).slice(0, 4);
    const shown = new Set(nearby.map(item => item.actor.id));
    if (!production) shown.add(selectedId);
    const canvasRect = app.graphicsDevice.canvas.getBoundingClientRect();
    const placed = [...document.querySelectorAll('#minimap, #quest-hud, #world-topbar, #npc-observed-bubble')]
      .filter(node => !node.hidden && node.getClientRects().length).map(node => node.getBoundingClientRect());
    const ordered = [...nameplates].sort(([a],[b]) => (a===selectedId?-1:b===selectedId?1:
      nearby.findIndex(n=>n.actor.id===a)-nearby.findIndex(n=>n.actor.id===b)));
    for (const [id, label] of ordered) {
      const visual = avatars.get(id);
      if (!shown.has(id) || !visual.avatar.enabled || observedFrame?.members.includes(id)) { label.hidden = true; continue; }
      const purpose = purposefulRoster.get(id);
      const ai = aiEnabled(id);
      label.textContent = `${ai ? '✦ AI · ' : ''}${production ? visual.actor.name : `${id.slice(-3)} · ${visual.actor.name}`}`;
      label.classList.toggle('npc-ai-tag', ai);
      label.dataset.status = '';
      if (purpose) {
        const state = purposefulStatus(id);
        const action = state.phase === 'TALKING' ? '대화 중' :
          state.phase === 'MOVING' && state.interrupted ? '함께 이동 중' :
          state.phase === 'MOVING' ? `${purpose.destinations[state.destination]?.label ?? '다음 장소'}로 이동 중` :
          state.phase === 'WAITING' ? '다음 일정 준비 중' :
          ({ ACADEMIC: state.scheduleIndex === 0 ? '수업 준비 중' : '수업 중', CLUB: '동아리 활동 중', RESTING: '휴식 중',
            READING: '독서 중', COFFEE: '커피 마시는 중', EATING: '식사 중',
            PHOTO: '사진 찍는 중', MUSIC: '음악 듣는 중', PHONE: '휴대전화 보는 중',
            TRANSIT: '잠시 머무는 중', WALK_BREAK: '산책 중', WAITING: '대기 중',
            WALK_TOGETHER: '동행 중', SOCIAL_MEETUP: '모임 중' })[state.activity] ?? '잠시 머무는 중';
        label.dataset.status = action;
      }
      const world = visual.avatar.getPosition();
      projectedPoint.set(world.x, world.y + npcNameplateOffset(visual.appearance.height), world.z);
      const point = orbit.camera.camera.worldToScreen(projectedPoint);
      label.hidden = point.x < 0 || point.x > canvasRect.width || point.y < 0 || point.y > canvasRect.height;
      if (!label.hidden) {
        label.style.left = `${point.x + canvasRect.left}px`;
        label.style.top = `${point.y + canvasRect.top}px`;
        const rect = label.getBoundingClientRect();
        if (rect.left < 6 || rect.top < 6 || rect.right > window.innerWidth-6 || rect.bottom > window.innerHeight-6 ||
          placed.some(r => rect.left < r.right+4 && rect.right > r.left-4 && rect.top < r.bottom+4 && rect.bottom > r.top-4)) label.hidden = true;
        else placed.push(rect);
      }
    }
  }
  function updateObservedConversation(playerPos) {
    if (!observedConversation && !sharedMeetings) return;
    const now = performance.now() / 1000;
    const blocked = !running || socialPreviewFastForward || document.hidden ||
      Boolean(activeConversation) || main2Guide.isDialogueOpen() || isObservedConversationBlocked();
    if (blocked) {
      observedConversation?.update({ now, blocked: true });
      sharedObserver?.update({ now: sharedFrameNow === null ? null : sharedFrameNow/1000, player: playerPos, blocked: true });
      observedNextScan = now + OBSERVED_RUNTIME_SCAN_SECONDS;
      observedBubble.hide(); observedFrame = null; return;
    }
    const forward = orbit.camera.forward;
    if (now >= observedNextScan) {
      observedNextScan = now + OBSERVED_RUNTIME_SCAN_SECONDS;
      observedFrame = sharedMeetings
        ? sharedObserver.update({ now: sharedFrameNow === null ? null : sharedFrameNow/1000,
            events: sharedMeetings.events(), player: playerPos, forward, busyIds: getBusyNpcIds(sharedFrameNow) })
        : null;
      // Shared deterministic meeting scenes win. When none is nearby, the local
      // observation layer may surface a non-authoritative ambient conversation.
      if (!observedFrame && observedConversation) {
        if (now-observedSocialAt >= .5) {
          observedSocial = socialNg1?.snapshot() ?? { groups: [], relations: {} };
          observedSocialAt = now;
        }
        const bridge = socialNg15Bridge?.status();
        const meeting = bridge?.phase === 'MEETING' ? bridge.active : null;
        const npcs = [...purposefulRoster].map(([id, purpose]) => {
          const state = purpose.controller.status(false), visual = avatars.get(id);
          const meetingId = meeting?.memberNpcIds.includes(id) ? meeting.groupId : null;
          const destination = state.destination ?? '';
          const location = meetingId ? meeting.meetingLocation : destination.replace(/^c04\./,'').replace(`.${id}`,'');
          return { ...state, id, name: visual.actor.name, location, meetingId,
            position: visual.motion.position, visible: visual.avatar.enabled && state.visible,
            busy: activeConversation?.id === id || visual.pilotFacingUntil > performance.now(),
            department: rosterById.get(id)?.department, residence: rosterById.get(id)?.residence,
            interests: npcById.get(id)?.interests ?? [] };
        });
        observedFrame = observedConversation.update({ now, npcs, player: playerPos, forward,
          period: snapshot.period, groups: observedSocial.groups,
          pairInfo: (a,b) => ({ ...socialGraph.describePair(a,b),
            affinity: observedSocial.relations[[a,b].sort().join('|')]?.affinity ?? 0 }) });
      }
    }
    if (!observedFrame) { observedBubble.hide(); return; }
    // Renderer-only yaw. Never pause a controller, change a route or write a social fact.
    for (const id of sharedMeetings ? [] : observedFrame.members) {
      const visual = avatars.get(id);
      if (visual.seat) continue;
      const other = avatars.get(observedFrame.members.find(otherId=>otherId!==id));
      const a = visual.motion.position, b = other.motion.position;
      const yaw = visual.avatar.getLocalEulerAngles().y;
      const target = Math.atan2(b.x-a.x,b.z-a.z)*180/Math.PI;
      visual.avatar.setLocalEulerAngles(0,yaw+Math.max(-35,Math.min(35,((target-yaw+540)%360)-180)),0);
    }
    const visual = avatars.get(observedFrame.line.npcId), world = visual.avatar.getPosition();
    projectedPoint.set(world.x,world.y+npcNameplateOffset(visual.appearance.height)+.12,world.z);
    const cameraPosition = orbit.camera.getPosition();
    const inFront = (projectedPoint.x-cameraPosition.x)*forward.x +
      (projectedPoint.y-cameraPosition.y)*forward.y + (projectedPoint.z-cameraPosition.z)*forward.z > 0;
    const point = orbit.camera.camera.worldToScreen(projectedPoint);
    // Group nameplates must yield before measuring bubble obstacles, otherwise a
    // neighboring participant can hide the bubble indefinitely.
    for (const id of observedFrame.members) nameplates.get(id).hidden = true;
    if (!observedCanvasRect || now-observedObstacleAt >= OBSERVED_OBSTACLE_CACHE_SECONDS) {
      observedObstacleAt = now;
      observedCanvasRect = app.graphicsDevice.canvas.getBoundingClientRect();
      observedObstacles = [...document.querySelectorAll('#minimap, #quest-hud, #tour, #context-action, #world-topbar, .npc-test-tag')]
        .filter(node=>!node.hidden && node.getClientRects().length)
        .map(node=>node.getBoundingClientRect());
    }
    const canvasRect = observedCanvasRect;
    observedBubble.render(observedFrame,{ name:visual.actor.name,
      point:{x:point.x+canvasRect.left,y:point.y+canvasRect.top,visible:inFront &&
        point.x>=0 && point.y>=0 && point.x<=canvasRect.width && point.y<=canvasRect.height},obstacles:observedObstacles });
  }
  function update(dt) {
    if (!socialPreviewFastForward) main2Guide.update(dt);
    if (worldClock) {
      worldClock.refreshIfDue();
      sharedFrameNow = worldClock.now();
      onNpcTalk(activeConversation?.id ?? null, sharedFrameNow);
      if (sharedFrameNow !== null) {
        const time = worldScheduleAt(sharedFrameNow);
        elapsed = time.cycleSeconds;
        if (time.period !== snapshot.period) applySnapshot(snapshotForPeriod(batch, time.period));
      }
      const state = activeConversation && purposefulRoster.get(activeConversation.id)?.controller.status(false);
      // Shared schedule movement stays authoritative, but walking alone must not cancel player dialogue.
      // The normal 5 m release-radius check below closes the conversation once the NPC actually leaves.
      if (state && !state.visible) closeConversation(false);
    } else if (running) {
      elapsed = (elapsed + dt) % CYCLE_SECONDS;
      const period = periodAt(elapsed);
      if (period !== snapshot.period) applySnapshot(snapshotForPeriod(batch, period));
    }
    const playerPos = socialPreviewFastForward ? null : player.getLocalPosition();
    if (!socialPreviewFastForward) {
      encounters.retain(snapshot.actors.filter(actor => {
        const position = avatars.get(actor.id).motion.position;
        return position && Math.hypot(position.x - playerPos.x, position.z - playerPos.z) <= NPC_CONVERSATION_RELEASE_RADIUS;
      }).map(actor => actor.id));
      if (activeConversation) {
        const position = avatars.get(activeConversation.id).motion.position;
        if (!position || Math.hypot(position.x - playerPos.x, position.z - playerPos.z) > NPC_CONVERSATION_RELEASE_RADIUS) closeConversation(false);
      }
    }
    for (const visual of avatars.values()) {
      const actor = visual.actor, motion = visual.motion;
      advanceMotion(visual, running ? dt : 0);
      if (!motion.position || socialPreviewFastForward) continue;
      const moving = motion.moving;
      const purposeful = purposefulRoster.get(actor.id);
      const behavior = purposeful?.behavior;
      const animationPace = behavior?.animationPace ?? 1;
      const motionEnergy = behavior?.motionEnergy ?? 1;
      const phase = elapsed * 6 * animationPace + Number(actor.id.slice(-3));
      const bob = moving ? Math.abs(Math.sin(phase)) * .035 * motionEnergy :
        Math.sin(elapsed * 2 * animationPace + Number(actor.id.slice(-3))) * .015 * motionEnergy;
      const sitting = Boolean(visual.seat && !moving && !motion.route.length);
      const purposefulActivity = purposeful?.controller.status(false).activity;
      const activityPose = purposefulActivityPose(purposefulActivity, { phase, motionEnergy, sitting });
      const renderPosition = sitting ? visual.seat.position : motion.position;
      const y = roadviewGroundHeight(renderPosition.x, renderPosition.z) +
        (sitting ? SEAT_TOP_Y - npcSeatAnchorHeight(visual.appearance.height) : bob);
      visual.avatar.setLocalPosition(renderPosition.x, y, renderPosition.z);
      visual.arms.forEach((arm, index) => arm.setLocalEulerAngles(
        moving ? Math.sin(phase) * (index ? -23 : 23) : activityPose.armPitch[index],
        moving ? 0 : activityPose.armYaw[index],
        moving ? 0 : activityPose.armRoll[index]
      ));
      visual.legs.forEach((leg, index) => leg.setLocalEulerAngles(
        moving ? Math.sin(phase) * (index ? 27 : -27) : activityPose.legPitch[index], 0, 0));
      const nearSelected = actor.id === selectedId && (!aiEnabled(actor.id) || activeConversation?.id === actor.id) &&
        Math.hypot(playerPos.x - motion.position.x, playerPos.z - motion.position.z) < NPC_CONVERSATION_RELEASE_RADIUS;
      const pilotFacing = visual.pilotFacingUntil > performance.now() && Math.hypot(playerPos.x - motion.position.x, playerPos.z - motion.position.z) < NPC_NAMEPLATE_RADIUS;
      const observing = observedFrame?.members.includes(actor.id);
      const facing = sitting ? visual.seat.yaw : moving ? motion.heading : motion.sharedMeeting && activeConversation?.id !== actor.id ? motion.heading : observing ? visual.avatar.getLocalEulerAngles().y : nearSelected || pilotFacing
        ? Math.atan2(playerPos.x - motion.position.x, playerPos.z - motion.position.z) * 180 / Math.PI : motion.heading;
      visual.avatar.setLocalEulerAngles(0, facing, 0);
    }
    const socialMotionState = socialMotion.tick(running ? dt : 0, activeConversation?.id);
    const socialChanged = socialNg1?.update(running ? dt : 0) ?? false;
    if (socialNg15Bridge && socialNg1) {
      const scriptedBusy = ['WAIT', 'JOIN', 'WALK_TOGETHER', 'SEPARATE'].includes(socialMotionState.phase)
        ? socialMotionState.pairIds : [];
      socialNg15Bridge.tick(running ? dt : 0, socialNg1.viewSnapshot(), {
        blockedNpcIds: scriptedBusy,
        conversationId: activeConversation?.id ?? null
      });
    }
    if (socialChanged && !socialPreviewFastForward) socialNg1Panel?.render();
    if (socialPreviewFastForward) { stopObservedConversation(); return; }
    updateObservedConversation(playerPos);
    uiClock += dt;
    if (uiClock < .3) return;
    uiClock = 0;
    drawStatus();
    drawDetail();
    drawNameplates(playerPos);
    const closest = nearestVisible();
    const target = interactionTarget();
    talkButton.disabled = !target || target.distance > NPC_TALK_RADIUS;
    if (production) {
      panel.hidden = externalContextAction ? !activeConversation : !activeConversation && talkButton.disabled;
      talkButton.hidden = externalContextAction || Boolean(activeConversation);
    }
    talkButton.textContent = production
      ? talkButton.disabled ? 'F · 가까운 NPC와 대화' : `F · ${withAnd(target.actor.name)} 대화`
      : talkButton.disabled ? '근처 NPC와 대화 (F)' : `${withAnd(target.actor.name)} 대화 (F)`;
    if (near) near.textContent = closest?.distance <= NPC_TALK_RADIUS
      ? `근처: ${closest.actor.name} · ${closest.actor.dialogue[Math.floor(elapsed / 20) % closest.actor.dialogue.length]}`
      : '근처에 NPC가 없습니다.';
  }

  applySnapshot(first, true);
  if (!production) focusSelected();
  drawStatus();
  app.on('update', update);
  function getContextAction() {
    if (activeConversation || main2Guide.isDialogueOpen()) return null;
    const guideAction = main2Guide.getContextAction();
    const target = interactionTarget();
    const npcAction = !target || target.distance > NPC_TALK_RADIUS ? null : {
      id: 'npc-talk',
      icon: '💬',
      label: `${withAnd(target.actor.name)} 대화`,
      compactLabel: '대화',
      shortcut: 'F',
      priority: 300,
      distance: target.distance,
      trigger: openConversation
    };
    if (!guideAction) return npcAction;
    if (!npcAction) return guideAction;
    return guideAction.priority > npcAction.priority ||
      guideAction.priority === npcAction.priority && guideAction.distance <= npcAction.distance
      ? guideAction : npcAction;
  }

  const api = {
    handlesTalkKey,
    setAiSignedIn,
    // CORE-15: the quest flag may resolve after the NPCs are up; turning it on re-reads progress.
    setQuestEnabled: enabled => Promise.all([quest.setEnabled(enabled), main2Quest.setEnabled(enabled)]),
    observePlace: (placeId, position) => {
      quest.observePlace(placeId, position);
      main2Quest.observePlace(placeId, position);
    },
    observeNavigation: snapshot => main2Quest.observeNavigation(snapshot),
    observeAutoMove: (state, event) => main2Quest.observeAutoMove(state, event),
    observeTmlShadowEconomicState: snapshot => {
      try { return tmlMain2Shadow.observeEconomicState(snapshot); }
      catch { return null; }
    },
    getContextAction,
    getQuestMapObjective: legacyProgressId =>
      legacyProgressId === QUEST_ID ? quest.mapTarget()
        : legacyProgressId === MAIN2_QUEST_ID ? main2Quest.mapTarget()
          : null,
    getMapObjective: () => main2Quest.mapTarget() ?? quest.mapTarget() ??
      sideEvent?.mapTarget?.(id => avatars.get(id)?.motion?.position ? { ...avatars.get(id).motion.position } : null) ?? null,
    isConversationOpen: () => Boolean(activeConversation) || main2Guide.isDialogueOpen(),
    closeConversation: () => {
      let closed = false;
      if (activeConversation) { closeConversation(); closed = true; }
      if (main2Guide.closeDialogue()) closed = true;
      return closed;
    },
    getStatus: () => ({ status: 'READY', candidate_sha256: hash, npc_count: batch.npcs.length,
      population: { batch_id: batch.batch_id, expansion: populationExpansion },
      period: snapshot.period, local_count: [...avatars.values()].filter(v => v.motion.position).length,
      off_zone_count: [...avatars.values()].filter(v => !v.motion.position).length,
      largest_crowd: snapshot.largestCrowd, visible_entities: [...avatars.values()].filter(v => v.avatar.enabled).length,
      purposeful_count: purposefulRoster.size,
      purposeful_behavior: Object.fromEntries([...purposefulRoster].map(([id, { behavior }]) => [id, behavior.id])),
      shared_meetings: sharedMeetings?.status() ?? null,
      shared_schedule: worldClock ? { ...worldClock.status(), revision: NPC_SCHEDULE_REVISION,
        frameServerNowMs: sharedFrameNow } : null,
      social_motion: socialMotion.status(),
      purposeful: Object.fromEntries([...purposefulRoster].map(([id]) => [id, purposefulStatus(id)])),
      selected_id: selectedId, selected_activity: snapshot.actors.find(a => a.id === selectedId).activity,
      selected_gender: rosterById.get(selectedId).gender,
      selected_student_number: rosterById.get(selectedId).student_number,
      selected_department: rosterById.get(selectedId).department,
      moving_count: [...avatars.values()].filter(visual => visual.motion.moving).length,
      selected_position: avatars.get(selectedId).motion.position && { ...avatars.get(selectedId).motion.position },
      conversation_active: activeConversation?.id ?? null, selected_memory: memory.read(selectedId),
      dialogue_context: activeConversation?.dialogueContext ?? null,
      dialogue_candidates: activeConversation?.dialogueCandidates ?? null,
      dialogue_baseline: activeConversation?.dialogueBaseline ?? null,
      dialogue_decision: activeConversation?.dialogueDecision ?? null,
      dialogue_jev: dialogueRouter.status(),
      ai_signed_in: aiSignedIn, ai_npc_ids: [...aiPilotIds].filter(aiEnabled),
      quest_stage: quest.stage, quest: quest.status(),
      main2_quest_stage: main2Quest.stage, main2Quest: main2Quest.status(),
      tml_first_campus_gyeol_shadow: tmlFirstCampusGyeolShadow.status(),
      tml_main2_shadow: tmlMain2Shadow.status(),
      tml_main2_promotion_review: tmlMain2Shadow.promotionReview(),
      main2_guide: main2Guide.status(),
      side_event: sideEvent?.status?.() ?? null,
      social_graph: socialGraph.status(),
      social_ng1: socialNg1?.status() ?? null,
      social_ng15: socialNg15Bridge?.status() ?? null,
      observed_conversation: observedConversation?.status() ?? null,
      selected_dialogue: snapshot.actors.find(a => a.id === selectedId).dialogue }),
    setPeriod, selectNpc: id => { if (!avatars.has(id)) throw new Error('Unknown NPC'); closeConversation(false); selectedId = id; socialNg1?.setSelectedNpc(id); if (select) select.value = id; drawDetail(); },
    pause: () => { if (worldClock) return false; running = false; if (playButton) { playButton.textContent = '재생'; playButton.setAttribute('aria-pressed', 'false'); } },
    play: () => { running = true; if (playButton) { playButton.textContent = '일시정지'; playButton.setAttribute('aria-pressed', 'true'); } }
  };
  if (!production) window.__NPC_TEST__ = api;
  if (socialPreview) {
    const socialPreviewApi = {
      status: () => socialNg1?.status(),
      selectNpc: id => { socialNg1?.setSelectedNpc(id); socialNg1Panel?.render(); }
    };
    // NG1-only previews may inspect the social model in isolation. NG1.5 must never
    // advance that clock separately from physical NPC movement.
    if (!socialBehaviorPreview && !worldClock) socialPreviewApi.advanceTicks = count => {
      const result = socialNg1?.advanceTicks(count);
      socialNg1Panel?.render();
      return result;
    };
    window.__NPC_SOCIAL_NG1__ = socialPreviewApi;
  }
  if (socialBehaviorPreview) window.__NPC_SOCIAL_NG15__ = {
    status: () => socialNg15Bridge?.status() ?? null,
    // Preview-only deterministic stepping uses the exact NPC runtime update path so
    // schedules, physical movement, NG1 and NG1.5 all consume the same game-time dt.
    advanceSeconds: (seconds, stepSeconds = .1, { render = true, includeSocial = true } = {}) => {
      if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid NG1.5 preview seconds');
      if (!Number.isFinite(stepSeconds) || stepSeconds <= 0 || stepSeconds > .1)
        throw new Error('Invalid NG1.5 preview step');
      let remaining = seconds;
      socialPreviewFastForward = true;
      try {
        while (remaining > 1e-9) {
          const dt = Math.min(stepSeconds, remaining);
          update(dt);
          remaining -= dt;
        }
      } finally {
        socialPreviewFastForward = false;
      }
      if (render) socialNg1Panel?.render();
      return {
        social: includeSocial ? socialNg1?.status() ?? null : null,
        bridge: socialNg15Bridge?.status() ?? null
      };
    }
  };
  return api;
}
