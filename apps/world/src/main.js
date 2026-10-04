import { busyNpcIds } from './network/npc-talk-presence.js';
import {CAMPUS_BALLOON_ID,setCampusBalloonPropRoot} from "./mounts/campus-balloon-world.js";
import {createCampusBalloon} from "./mounts/campus-balloon-render.js";
import {setCampusShuttlePropRoot} from "./mounts/campus-shuttle-world.js";
import {createCampusShuttle,createShuttleStations} from "./mounts/campus-shuttle-render.js";
import { DUCK_BOAT_ID,setDuckBoatPropRoot } from "./mounts/duck-boat-world.js";
import { createDuckBoat,createInkyungDockMarker } from "./mounts/duck-boat-render.js";
import { CAMPUS_KART_ID, setCampusKartPropRoot } from "./mounts/campus-kart-world.js";
import { createCampusKart } from "./mounts/campus-kart-render.js";
import { CAMPUS_KICKBOARD_ID, setCampusKickboardPropRoot } from "./mounts/campus-kickboard-world.js";
import { createCampusKickboard } from "./mounts/campus-kickboard-render.js";
import * as pc from "playcanvas";
import { PlayerController } from "./player-controller.js";
import { OrbitCameraController } from "./orbit-camera-controller.js";
import { PlaceZoneRegistry } from './place-zone-registry.js';
import { createWorldAudio } from './audio/world-audio.js';
import { bindAudioVolumeSettings } from './audio/audio-volume-settings.js';
import { loadRuntimeMusicProject } from './audio/music-runtime-config.js';
import { RenderChunkRegistry } from './render-chunk-registry.js';
import { RenderChunkStreaming } from './render-chunk-streaming.js';
import { CampusChunkRenderer } from './campus-chunk-renderer.js';
import { legacyTelemetryTarget } from './legacy-zone-compat.js';
import { createViewDistanceSettings } from './view-distance-settings.js';
import { createGraphicsPresetController } from './graphics-presets.js';
import { createEnvironmentDirector } from './environment/environment-director.js';
import { resolveEnvironmentRuntimeTime, resolveEnvironmentRuntimeWeather } from './environment/environment-clock.js';
import { createNightStreetLights } from './environment/night-street-lights.js';
import { createNightBuildingWindows } from './environment/night-building-windows.js';
import { createRainWeatherEffects } from './environment/rain-weather-effects.js';
import { createSnowWeatherEffects } from './environment/snow-weather-effects.js';
import { createSkyVisuals } from './environment/sky-visuals.js';
import { createInkyungDuckSystem } from './ambient-ducks.js';
import { createInkyungMechanicalDuckEvent } from './inkyung-mechanical-duck-event.js';
import { createBiryongSystem } from './biryong/biryong-system.js';
import { BIRYONG_PLACE_ID, isNearBiryong } from './biryong/biryong-layout.js';
import { createBackGateArrivalEvent } from './back-gate-arrival-event.js';
import { createAssetOptimizationShadow } from './asset-optimization-shadow.js';
import { createProductionAssetCanary } from './asset-production-canary.js';
import { createAssetCanaryRemoteControl } from './asset-canary-remote-control.js';
import { createAssetCanaryTelemetry } from './asset-canary-telemetry.js';
import { createWorldGraphicsDevice, GraphicsUnavailableError } from './webgpu-device.js';
import { createCharacter } from "./character-model.js";
import { createCampusProfile } from "./campus-profile.js";
import { createCampusTour } from "./campus-tour.js";
import { LANDMARKS, TOUR_STOPS } from "./campus-layout.js";
import { worldToMeters } from "./world-scale.js";
import { startWorldOnline, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./online/world-online.js";
import { startWorldPopulationCount, startWorldPopulationHeartbeat } from "./online/world-population-heartbeat.js";
import { createRemoteAvatarFactory } from "./online/remote-avatar.js";
import { EmoteController } from "./online/emotes.js";
import { createEmoteMenu } from "./online/emote-menu.js";
import { createChatPanel } from "./online/chat-panel.js";
import { createSeatInteraction } from "./seat-interaction.js";
import { campusSpawn } from './campus-spawn.js';
import { createContextActionController } from "./context-action.js";
import { createInkyungLivingMoment, INKYUNG_LIVING_ZONE_ID } from "./inkyung-living-moment.js";
import { createNextDiscovery, FIRST_CAMPUS_REWARD_ID } from "./next-discovery.js";
import { createCore15FunnelTelemetry } from "./core15-funnel-telemetry.js";
import { createCampusHudMenu } from "./campus-hud.js";
import { createKeyboardShortcutsPanel } from "./keyboard-shortcuts-panel.js";
import { SocialClient } from "./social/social-client.js";
import { createPlayerCard } from "./social/player-card.js";
import { createFriendPanel } from "./social/friend-panel.js";
import { createNearbyPanel } from "./social/nearby-panel.js";
import { AccompanyClient } from "./social/accompany-client.js";
import { AccompanyController } from "./social/accompany-controller.js";
import { createAccompanyPanel } from "./social/accompany-panel.js";
import { GuestbookClient } from "./guestbook/guestbook-client.js";
import { createGuestbookPanel } from "./guestbook/guestbook-panel.js";
import { createGuestbookInteraction } from "./guestbook/guestbook-interaction.js";
import { createMainGateGuestbookObject } from "./guestbook/guestbook-renderer.js";
import { createGuestbookWorldLabel } from "./guestbook/guestbook-world-label.js";
import { MAIN_GATE_GUESTBOOK } from "./guestbook/guestbook-world.js";
import { Relationship } from "./social/social-client.js";
import { FollowController, FollowStopReason, FOLLOW_CONTEXT_PRIORITY, FOLLOW_STOP_MESSAGES, followEligibility } from "./social/follow-controller.js";
import { locomotionIntent } from "./seat-anchors.js";
import { createClubRoomScene } from "./rooms/club-room-renderer.js";
import { createRoomTransition, ROOM_TRANSITION_COOLDOWN_MS } from "./rooms/room-transition.js";
import { DORM_1_LOBBY_MY_ROOM_RETURN } from "./rooms/dorm1-lobby-layout.js";
import { createRoomWorldAdapter } from "./rooms/room-world-adapter.js";
import { createDorm1LobbyScene } from "./rooms/dorm1-lobby-renderer.js";
import { createPersonalRoomScene } from "./rooms/personal-room-renderer.js";
import { PersonalRoomClient } from "./rooms/personal-room-client.js";
import { createPersonalRoomInteraction } from "./rooms/personal-room-interaction.js";
import { FriendRoomVisitClient, FRIEND_ROOM_VISIT_TEXT, createFriendRoomVisitController } from "./rooms/friend-room-visit.js";
import { createPersonalRoomSession } from "./rooms/room-session.js";
import { createRoomHud } from "./rooms/room-hud.js";
import { DORM_1_CAMPUS_RETURN } from "./dorm1-layout.js";
import { RoomKnockClient, createOwnerKnockWatcher, diffRoomVisitors } from "./rooms/room-knock.js";
import { createKnockPrompt } from "./rooms/knock-prompt.js";
import { createFurnitureClient } from "./rooms/furniture-client.js";
import { createFurnitureEditor } from "./rooms/furniture-editor.js";
import { PERSONAL_ROOM_BASIC_SPAWN } from "./rooms/personal-room-layout.js";
import { isLobbyShellRequested } from "./lobby/lobby-shell.js";
import { createLobbyWorldMode } from "./lobby/lobby-world.js";
import { bindMainGateEntry, enterMainGate } from "./lobby/lobby-main-gate.js";
import { createWorldResumeStore } from "./lobby/world-resume.js";
import { bindResumeEntry } from "./lobby/lobby-resume.js";
import { bindLockedBackGate } from "./lobby/lobby-back-gate.js";
import { createLobbyTransition } from "./lobby/lobby-transition.js";
import { createLobbyMenu } from "./lobby/lobby-menu.js";
import { createLobbyPlayerSummary } from "./lobby/lobby-player-summary.js";
import { createLobbyPresenceSummary } from "./lobby/lobby-presence-summary.js";
import { createLobbyQuestHighlight } from "./lobby/lobby-quest-highlight.js";
import { createLobbyDailyLoop } from "./lobby/lobby-daily-loop.js";
import { createSpawnRegistry, markSpawnElement, SPAWN_ID } from "./lobby/spawn-registry.js";
import { getWorldLoading } from "./lobby/lobby-loading.js";
import { createMiniMapDataSource } from "./minimap/minimap-data.js";
import { createMiniMapRenderer } from "./minimap/minimap-renderer.js";
import { createMiniMapController } from "./minimap/minimap-controller.js";
import { createFullMapController } from "./minimap/full-map-controller.js";
import { createRoomMapDataSource, setPersonalRoomMapFurniture } from "./minimap/room-map-data.js";
import { CAMPUS_NAV_SPACE, createCampusNavigation } from "./navigation/campus-navigation.js";
import { createNavigationState } from "./navigation/navigation-state.js";
import { createNavigationHud } from "./navigation/navigation-hud.js";
import { AUTO_MOVE_CANCEL_REASON, bindAutoMoveManualCancellation, createPlayerAutoMove } from "./navigation/player-auto-move.js";
import { QUEST_ID } from "../npc-factory/quest-contract.mjs";
import { createQuestRuntime } from "./quest/quest-runtime.js";
import { createQuestJournal } from "./quest/quest-journal.js";
import { createTrackedQuestHud } from "./quest/quest-hud.js";
import { MAIN2_GUIDE_NPC } from "../npc-factory/main2-guide-contract.mjs";
import { isMcm2026PreviewRequest, mcm2026PreviewStartMs } from "./events/zombie-university-2026/event-route.js";
import { mcm2026CanEnterVenue } from "./events/zombie-university-2026/event-phase.js";
import { createMcm2026EventClient } from "./events/zombie-university-2026/event-client.js";
import { createMcm2026EventUi, createStatusAfterReward, rewardLine } from "./events/zombie-university-2026/event-ui.js";
import { createMcm2026EventRuntime } from "./events/zombie-university-2026/event-runtime.js";
import { createMcm2026RoomScene } from "./events/zombie-university-2026/minigame-room-renderer.js";
import { MCM_2026_ROOM_ID } from "./events/zombie-university-2026/minigame-room-layout.js";
import { createMcm2026MinigameRuntime } from "./events/zombie-university-2026/minigame-room-runtime.js";
import { createProgressionClient, PROGRESSION_STATE } from "./progression/progression-client.js";
import { createProgressionHud, formatProgression, levelUpMessage } from "./progression/progression-hud.js";
import { createShopClient } from "./shop/shop-client.js";
import { createShopPanel } from "./shop/shop-panel.js";
import { createWalletClient } from "./wallet/wallet-client.js";
import { createInventoryClient } from "./inventory/inventory-client.js";
import { createInventoryPanel } from "./inventory/inventory-panel.js";
import { createDailyQuizClient } from "./daily-quiz/daily-quiz-client.js";
import { createDailyQuizPanel } from "./daily-quiz/daily-quiz-panel.js";
import { createAttendanceClient } from "./attendance/attendance-client.js";
import { createAttendancePanel } from "./attendance/attendance-panel.js";
import { createLoadoutClient } from "./appearance/loadout-client.js";
import { createEquipmentProjection } from "./appearance/equipment-projection.js";
import { createEquipmentModelLoader } from "./appearance/equipment-asset-loader.js";
import { publicEquipmentFor } from "./appearance/equipment-presence.js";
import { createWardrobePanel } from "./appearance/wardrobe-panel.js";
import { STUDENT_CENTER_SHOP_ENTRY, createShopWorldInteraction } from "./shop/shop-world-interaction.js";
import { createShopWorldLabel } from "./shop/shop-world-label.js";
import { roadviewGroundHeight } from "./roadview-layout.js";
import { createBackgateTransitInteraction } from "./transit/backgate-transit-interaction.js";
import { createBackgateTransitPanel } from "./transit/backgate-transit-panel.js";
import { BACKGATE_TRANSIT } from "./transit/backgate-transit-layout.js";
import { createBiryongRealmScene } from "./biryong/biryong-realm-renderer.js";
import { createBiryongRealmWorldAdapter } from "./biryong/biryong-realm-world-adapter.js";
import { createBiryongRealmTransition } from "./biryong/biryong-realm-transition.js";
import { createBiryongStationTransitInteraction } from "./biryong/biryong-station-transit-interaction.js";
import { WORLD_REGION_ID } from "./regions/world-region-registry.js";
import { INPUT_FOCUS_POLICY, createInputFocusManager } from "./input/input-focus-manager.js";
import { bindInputFocusRuntime } from "./input/input-focus-runtime.js";
import { bindPointerLockRuntime } from "./input/pointer-lock-runtime.js";
import { bindPointerLockHint } from "./input/pointer-lock-hint.js";
import { bindCameraInputSettings } from "./input/camera-input-settings.js";
import { createInputFocusOwner } from "./input/input-focus-owner.js";
import { createHudContext } from "./hud/hud-context.js";
import { bindHudPresentation } from "./hud/hud-presentation.js";
import { createHelicopterFlightHud } from "./mounts/helicopter-flight-hud.js";
import { createMobilityBook } from "./mobility/mobility-book.js";
import { FLAG_DISABLED, FLAG_ENABLED, FLAG_UNAVAILABLE, probeFeatureFlag, retryFeatureFlag } from "./npc-feature-flags.js";

const canvas = document.getElementById("application");
const worldLoading = getWorldLoading();
worldLoading?.setPhase("BOOT");
const startupParams = new URLSearchParams(location.search);
const editorWorldRequested = startupParams.get('editorWorld') === '1';
const previewHost = location.hostname.endsWith('.vercel.app') || ['localhost','127.0.0.1'].includes(location.hostname);
const roomPreviewStart = previewHost &&
  (startupParams.get('start') === 'club-room' || location.hash === '#club-room-preview');
const dormLobbyPreviewStart = previewHost && startupParams.get('start') === 'dorm-lobby';
const personalRoomPreviewStart = previewHost && startupParams.get('start') === 'personal-room';
const mcmEventPreviewMode = isMcm2026PreviewRequest(location);
const mcmMinigamePreviewStart = mcmEventPreviewMode &&
  ['zombie-minigame-preview','zombie-minigame'].includes(startupParams.get('start'));
const lobbyPreview = !roomPreviewStart && !dormLobbyPreviewStart && !personalRoomPreviewStart &&
  !mcmMinigamePreviewStart && isLobbyShellRequested(location);
const rendererEl = document.getElementById("renderer");
const zoneEl = document.getElementById("zone");
const npcTestMode = ['localhost', '127.0.0.1'].includes(location.hostname) &&
  startupParams.get('npcTest') === 'a-r1';
const npcAiPilotMode = npcTestMode && startupParams.get('npcAiPilot') === '1';
// Normal deployments start campus NPCs without a domain allowlist. Local and Vercel
// preview hosts retain the explicit selectors below; API flags still own AI/quest access.
const npcProductionMode = !previewHost;
const npcPreviewMode = location.hostname.endsWith('.vercel.app') &&
  startupParams.get('npcTest') === 'a-r1';
// Production shares server time and deterministic NPC routes across clients.
const npcSharedScheduleMode = npcProductionMode || (previewHost && startupParams.get('npcSync') === 'ng2');
const npcRosterPreviewMode = previewHost && startupParams.get('campusLife') === 'roster';
const npcSocialPreviewLevel = previewHost ? startupParams.get('npcSocial') : null;
const npcObservedConversationPreview = previewHost && startupParams.get('npcConversation') === 'p0';
// Ambient observed conversations are presentation-only and safe to enable on normal deployments.
const npcObservedConversationMode = npcProductionMode || npcObservedConversationPreview;
const npcSocialBehaviorPreviewMode = npcSocialPreviewLevel === 'ng15';
const npcSocialPreviewMode = npcSocialPreviewLevel === 'ng1' || npcSocialBehaviorPreviewMode;
const npcSocialProductionMode = npcProductionMode;
const npcSocialMode = npcSocialProductionMode || npcSocialPreviewMode || npcObservedConversationMode;
const npcEnabled = npcSharedScheduleMode || npcTestMode || npcProductionMode || npcPreviewMode || npcRosterPreviewMode || npcSocialMode;
const campusLifePreview = previewHost && startupParams.get('campusLife') === 'p0a';
let lastTrackedZone = null;

async function boot() {
worldLoading?.setPhase("RENDERER");
const device = await createWorldGraphicsDevice(pc, canvas);
const rendererName = device.isWebGPU ? "WebGPU" : "WebGL2";

const options = new pc.AppOptions();
options.graphicsDevice = device;
options.componentSystems = [
  pc.RenderComponentSystem,
  pc.CameraComponentSystem,
  pc.LightComponentSystem
];
// AppBase has no model loaders unless the relevant handlers are registered.
options.resourceHandlers = [pc.TextureHandler, pc.ContainerHandler];

const app = new pc.AppBase(canvas);
app.init(options);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.scene.ambientLight = new pc.Color(0.48, 0.54, 0.61);
app.scene.exposure = 1.05;
app.start();

const assetOptimizationShadow = createAssetOptimizationShadow({
  app,
  enabled: previewHost && startupParams.get("assetShadow") === "1"
});
if (assetOptimizationShadow.enabled) {
  window.__ASSET_OPTIMIZATION_SHADOW__ = Object.freeze({
    status: () => assetOptimizationShadow.status(),
    whenIdle: () => assetOptimizationShadow.whenIdle()
  });
}

const assetCanaryRemoteControl = createAssetCanaryRemoteControl();
const assetCanaryRemoteInitial = previewHost
  ? Promise.resolve(FLAG_DISABLED)
  : assetCanaryRemoteControl.start();
const assetCanaryRemoteState = await assetCanaryRemoteInitial;
const assetProductionCanary = createProductionAssetCanary({
  app,
  enabled: !previewHost && assetCanaryRemoteState === FLAG_ENABLED,
  activationGuard: () => assetCanaryRemoteControl.enabled
});
const assetCanaryTelemetry = createAssetCanaryTelemetry();
if (assetProductionCanary.selected) assetCanaryTelemetry.selected();

worldLoading?.setPhase("WORLD");

window.addEventListener("resize", () => app.resizeCanvas());
rendererEl.textContent = rendererName;

const light = new pc.Entity("Sun");
light.addComponent("light", {
  type: "directional",
  color: new pc.Color(1, 0.94, 0.81),
  intensity: 1.15,
  castShadows: true,
  shadowIntensity: 0.48,
  shadowBias: 0.3,
  normalOffsetBias: 0.2,
  shadowResolution: 1024,
  shadowDistance: 75
});
light.setEulerAngles(55, 30, 0);
app.root.addChild(light);
const graphics = createGraphicsPresetController({
  app, device, light: light.light,
  viewport: {
    width: window.innerWidth, height: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
    mobile: matchMedia("(pointer: coarse)").matches,
    maxTextureSize: device.maxTextureSize || 0
  }
});

const camera = new pc.Entity("Camera");
camera.addComponent("camera", {
  clearColor: new pc.Color(0.52, 0.71, 0.84),
  // Preserve depth precision across the expanded campus, including thin roof caps.
  nearClip: 0.3,
  farClip: 700,
  fov: 62
});
camera.camera.toneMapping = pc.TONEMAP_NEUTRAL;
app.root.addChild(camera);

const environment = createEnvironmentDirector({
  scene: app.scene,
  lightEntity: light,
  camera,
  initialTime: resolveEnvironmentRuntimeTime(startupParams, { previewHost }),
  initialWeather: resolveEnvironmentRuntimeWeather(startupParams, { previewHost })
});
app.on("update", dt => environment.update(dt));
window.__INHAGAME_ENVIRONMENT__ = Object.freeze({
  status: () => environment.status(),
  ...(previewHost ? {
    setTimeOfDay: (value, options) => environment.setTimeOfDay(value, options),
    setWeather: (value, options) => environment.setWeather(value, options)
  } : {})
});

const skyVisuals = createSkyVisuals({
  app,
  camera,
  lightEntity: light,
  copyEnvironmentSkyState: out => environment.copySkyVisualState(out),
  getGraphicsTier: () => graphics.tier
});
app.on("update", dt => skyVisuals.update(dt));
window.__INHAGAME_SKY__ = Object.freeze({
  status: () => skyVisuals.status()
});

const player = new pc.Entity("Player");
// Keep canonical east/north coordinates for gameplay; PlayCanvas renders north as -Z.
// Reflect the entire campus together so no landmark is shifted independently.
const campusRoot = new pc.Entity("CampusCoordinateFrame");
campusRoot.setLocalScale(1, 1, -1);
app.root.addChild(campusRoot);
const guestbookObject = createMainGateGuestbookObject(campusRoot);
const guestbookWorldLabel = createGuestbookWorldLabel({
  element: document.getElementById("guestbook-world-label"),
  camera,
  canvas,
  getWorldPosition: () => guestbookObject.labelAnchor.getPosition()
});
let firstPlayerMovement = false;
// Keep the default camera north of the newly mapped first-dormitory facade.
const spawn=campusSpawn(location);
player.setLocalPosition(spawn.x,spawn.y,spawn.z);
campusRoot.addChild(player);

const nightStreetLights = createNightStreetLights({
  root: campusRoot,
  app,
  getPlayerPosition: () => player.getLocalPosition(),
  getArtificialLightFactor: () => environment.artificialLightFactor(),
  getGraphicsTier: () => graphics.tier
});
app.on("update", dt => nightStreetLights.update(dt));
window.__INHAGAME_NIGHT_LIGHTS__ = Object.freeze({
  status: () => nightStreetLights.status()
});

const nightBuildingWindows = createNightBuildingWindows({
  root: campusRoot,
  app,
  getArtificialLightFactor: () => environment.artificialLightFactor(),
  getGraphicsTier: () => graphics.tier
});
app.on("update", () => nightBuildingWindows.update());
window.__INHAGAME_NIGHT_WINDOWS__ = Object.freeze({
  status: () => nightBuildingWindows.status()
});

const rainWeatherEffects = createRainWeatherEffects({
  root: campusRoot,
  app,
  getPlayerPosition: () => player.getLocalPosition(),
  getRainIntensity: () => environment.rainIntensity(),
  getWetnessFactor: () => environment.wetnessFactor(),
  getGraphicsTier: () => graphics.tier
});
app.on("update", dt => rainWeatherEffects.update(dt));
window.__INHAGAME_RAIN__ = Object.freeze({
  status: () => rainWeatherEffects.status()
});

const snowWeatherEffects = createSnowWeatherEffects({
  root: campusRoot,
  app,
  getPlayerPosition: () => player.getLocalPosition(),
  getSnowIntensity: () => environment.snowIntensity(),
  getGraphicsTier: () => graphics.tier
});
app.on("update", dt => snowWeatherEffects.update(dt));
window.__INHAGAME_SNOW__ = Object.freeze({
  status: () => snowWeatherEffects.status()
});

const controller = new PlayerController(player);
const helicopterFlightHud = createHelicopterFlightHud({
  root: document.getElementById("helicopter-flight-hud"),
  toggle: document.getElementById("helicopter-flight-hud-toggle"),
  controller,
  getPosition: () => player.getLocalPosition(),
  getGroundHeight: (x, z) => controller.groundY + roadviewGroundHeight(x, z)
});
const inputFocus = createInputFocusManager();
const hudContext = createHudContext();
bindHudPresentation({ context: hudContext, root: document.body });
// InputFocus remains the single input authority. HUD Context observes its resolved snapshot only
// to expose presentation state for current/future Explore, Combat, Life and Pet layouts.
inputFocus.subscribe(snapshot => hudContext.syncInputFocus(snapshot), { emitCurrent: true });
const hudMenuInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "hud-menu", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const keyboardHelpInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "keyboard-help", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const fullMapInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "full-map", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const shopInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "shop", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const backgateTransitInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "backgate-transit", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const biryongRegionTransitionInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "biryong-region-transition", policy: INPUT_FOCUS_POLICY.SYSTEM_LOCK
});
const furnitureInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "room-furniture", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const inventoryInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "inventory", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const mobilityBookInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "mobility-book", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const wardrobeInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "wardrobe", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const dailyQuizInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "daily-quiz", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const attendanceInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "attendance", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const questJournalInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "quest-journal", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const npcDialogueInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "npc-dialogue", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const mcmDialogueInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "mcm-dialogue", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const biryongScriptedInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "biryong-scripted", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const lobbyWorldInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "lobby-world", policy: INPUT_FOCUS_POLICY.SYSTEM_LOCK
});
const lobbyTransitionInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "lobby-transition", policy: INPUT_FOCUS_POLICY.SYSTEM_LOCK
});
const profileInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "profile", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const viewSettingsInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "view-settings", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const friendPanelInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "friend-panel", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const nearbyPanelInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "nearby-panel", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const playerCardInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "player-card", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const guestbookInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "guestbook", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
const roomTransitionInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "room-transition", policy: INPUT_FOCUS_POLICY.SYSTEM_LOCK
});
const backGateArrivalInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "back-gate-arrival", policy: INPUT_FOCUS_POLICY.SYSTEM_LOCK
});
const mcmEventInfoInput = createInputFocusOwner({
  manager: inputFocus, ownerId: "mcm-event-info", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
});
// Input contract: E = emotion, F = interaction, M = transport. Each key and its mobile button
// are two entrances to one slot, so PC and mobile always run the same gameplay action.
let inkyungLivingMoment = createInkyungLivingMoment({
  root: document.getElementById("inkyung-living-moment"),
  actionsElement: document.getElementById("inkyung-living-actions")
});
const core15Funnel = npcTestMode ? null : createCore15FunnelTelemetry();
core15Funnel?.startSession();
const contextActions = createContextActionController({
  button: document.getElementById("context-action"),
  shortcut: "F",
  onTriggered: action => {
    const actionId = action?.id ?? null;
    const livingComplete = inkyungLivingMoment?.recordAction(actionId) === true;
    if (actionId === "npc-talk" || actionId === "main2-guide-talk") core15Funnel?.firstNpcInteraction();
    if (livingComplete) core15Funnel?.firstActivityComplete();
  }
});
const transportActions = createContextActionController({ button: document.getElementById("transport-action"), shortcut: "M" });
const orbit = new OrbitCameraController(camera, canvas, {
  canUseGameplayShortcut: () => inputFocus.can("GAMEPLAY_SHORTCUT")
});
bindInputFocusRuntime({ manager: inputFocus, controller, orbit });
const pointerLockHint = bindPointerLockHint(document.getElementById("pointer-lock-hint"));
const pointerLock = bindPointerLockRuntime({
  manager: inputFocus,
  canvas,
  orbit,
  onStatusChange: status => pointerLockHint.update(status)
});
const cameraInputSettings = bindCameraInputSettings({
  orbit,
  sensitivitySelect: document.getElementById("mouse-sensitivity"),
  invertCheckbox: document.getElementById("invert-mouse-y"),
  status: document.getElementById("view-settings-status")
});
orbit.yaw=spawn.yaw;
const character = createCharacter(app, player, {
  assetShadow: assetOptimizationShadow,
  assetCanary: assetProductionCanary.canary,
  assetCanarySubjectKey: assetProductionCanary.subjectKey
});
let assetCanaryRemoteStateCurrent = assetCanaryRemoteState;
const unbindAssetCanaryRemote = assetCanaryRemoteControl.subscribe(next => {
  assetCanaryRemoteStateCurrent = next;
  if (next === FLAG_ENABLED || character.assetCanary?.authority !== "OPTIMIZED_CANARY") return;
  const receipt = character.rollbackAssetCanary(`REMOTE_KILL_${next}`);
  if (receipt?.authority === "CANONICAL") assetCanaryTelemetry.rollback();
});

void character.ready.then(() => {
  if (!assetProductionCanary.selected) return;
  let receipt = character.assetCanary;
  if (assetCanaryRemoteStateCurrent !== FLAG_ENABLED && receipt?.authority === "OPTIMIZED_CANARY") {
    receipt = character.rollbackAssetCanary("REMOTE_KILL_" + assetCanaryRemoteStateCurrent);
    if (receipt?.authority === "CANONICAL") assetCanaryTelemetry.rollback();
    return;
  }
  if (receipt?.authority === "OPTIMIZED_CANARY") assetCanaryTelemetry.active();
  else assetCanaryTelemetry.failure();
});

window.addEventListener("pagehide", () => {
  unbindAssetCanaryRemote();
  assetCanaryRemoteControl.stop();
}, { once: true });

window.__INHAGAME_ASSET_PRODUCTION_CANARY__ = Object.freeze({
  status: () => Object.freeze({
    ...assetProductionCanary.status(),
    remote: assetCanaryRemoteControl.status(),
    remoteState: assetCanaryRemoteStateCurrent,
    telemetry: assetCanaryTelemetry.status(),
    character: character.assetCanary ?? null
  }),
  rollback: reason => {
    const before = character.assetCanary?.authority;
    const receipt = character.rollbackAssetCanary(reason || "OPERATOR_ROLLBACK");
    if (before === "OPTIMIZED_CANARY" && receipt?.authority === "CANONICAL") {
      assetCanaryTelemetry.rollback();
    }
    return receipt;
  }
});
worldLoading?.setPhase("CHARACTER");
const lobbyWorld = createLobbyWorldMode({
  player, controller, orbit, character, root: document.body,
  onActiveChange: (active) => {
    if (active) lobbyWorldInput.acquire();
    else lobbyWorldInput.release();
  }
});
if (lobbyPreview) lobbyWorld.enter();
const lobbyMenu = createLobbyMenu({
  toggle: document.getElementById("lobby-menu-toggle"),
  panel: document.getElementById("lobby-menu"),
  profileButton: document.getElementById("lobby-open-profile"),
  settingsButton: document.getElementById("lobby-open-settings"),
  existingProfileButton: document.getElementById("open-profile"),
  existingSettingsButton: document.getElementById("open-settings")
});
const lobbyTransition = createLobbyTransition({
  player,
  controller,
  orbit,
  character,
  lobbyWorld,
  overlay: document.getElementById("lobby-transition-fade"),
  onActiveChange: (active) => {
    if (active) lobbyTransitionInput.acquire();
    else lobbyTransitionInput.release();
  }
});
let npcTest = null;
const questRuntime = createQuestRuntime();
let questJournal = null;
let questHud = null;
let nextDiscovery = null;
// 비룡탑 · 울림돌 · BR01 (created once the audio layer exists; read lazily by earlier hooks).
let biryong = null;
let backGateArrival = null;
let biryongCloudGeneration = 0;
let biryongCloudSaveTimer = null;
let biryongResolvedAccountId = null;
const lobbySpawnRegistry = createSpawnRegistry();
const spawnProgressContext = () => ({
  completedQuestIds: npcTest?.getStatus?.().quest?.complete === true ? [QUEST_ID] : []
});
const mainGateSpawn = lobbySpawnRegistry.get(SPAWN_ID.MAIN_GATE, spawnProgressContext());
const backGateSpawn = lobbySpawnRegistry.get(SPAWN_ID.BACK_GATE, spawnProgressContext());
markSpawnElement(document.getElementById("main-gate-start"), mainGateSpawn);
markSpawnElement(document.getElementById("back-gate-locked"), backGateSpawn);
const mainGateEntry = bindMainGateEntry({
  button: document.getElementById("main-gate-start"),
  player,
  lobbyWorld,
  spawnDefinition: mainGateSpawn,
  transition: lobbyTransition
});
const resumeStore = createWorldResumeStore();
const resumeEntry = bindResumeEntry({
  button: document.getElementById("resume-last-location"),
  locationElement: document.getElementById("resume-location"),
  ageElement: document.getElementById("resume-age"),
  resume: resumeStore.read(),
  player,
  orbit,
  lobbyWorld,
  transition: lobbyTransition
});
const backGateLock = bindLockedBackGate({
  button: document.getElementById("back-gate-locked"),
  dialog: document.getElementById("back-gate-lock-dialog"),
  closeButton: document.getElementById("back-gate-lock-close"),
  confirmButton: document.getElementById("back-gate-lock-confirm"),
  definition: backGateSpawn,
  getDefinition: () => lobbySpawnRegistry.get(SPAWN_ID.BACK_GATE, spawnProgressContext()),
  onStart: definition => enterMainGate({
    player, lobbyWorld, spawnDefinition: definition, transition: lobbyTransition
  })
});
const profile = createCampusProfile(player, camera, canvas, {
  onOpenChange: (open) => {
    if (open) profileInput.acquire();
    else profileInput.release();
  }
});
const lobbyPlayerSummary = createLobbyPlayerSummary({
  nameElement: document.getElementById("lobby-player-name"),
  lookElement: document.getElementById("lobby-player-look"),
  progressionElement: document.getElementById("lobby-player-progression"),
  walletElement: document.getElementById("lobby-player-wallet"),
  accountElement: document.getElementById("lobby-player-account"),
  profile,
  character
});
const tour = createCampusTour();
// Social S1-B1: local expression plays at once; members also broadcast it (guests stay local).
let online = null;
let accompany = null;
let populationHeartbeat = null;
let populationCount = null;
let fullMap = null;
let guestbookInteraction = null;
let personalRoomInteraction = null;
let lastPersonalRoomUserId = null;
// Social S1-D2: the Personal Room Session (private world:room:<uuid> channel) and friend visits.
let roomSession = null;
let roomFurniture = null;
let furnitureEditor = null;
let furnitureRefreshSeconds = 0;
let friendRoomVisit = null;
const lobbyQuestHighlight = createLobbyQuestHighlight({
  root: document.getElementById("lobby-quest-highlight"),
  kickerElement: document.getElementById("lobby-quest-kicker"),
  stateElement: document.getElementById("lobby-quest-state"),
  titleElement: document.getElementById("lobby-quest-title"),
  objectiveElement: document.getElementById("lobby-quest-objective"),
  progressElement: document.getElementById("lobby-quest-progress"),
  getTourStage: () => tour.stage,
  getQuest: () => npcTest?.getStatus?.() ?? null
});
let rooms = null;
let biryongRealm = null;
let biryongStationTransit = null;
let keyboardHelp = null;
// Declared before input handlers so an early F/M event during boot can safely observe null.
let playerAutoMove = null;
let unbindAutoMoveManual = null;
// Inside a Personal Room the expression goes to the room channel; the campus session is paused there.
const emotes = new EmoteController({ clock: { now: () => Date.now() },
  send: (id) => roomSession?.active ? roomSession.reportEmote(id) : online?.reportEmote(id) === true });
// Social S1-B sit: explicit seat anchors; while seated PlayerController does not translate the player.
const seating = createSeatInteraction({ player, controller, emotes, places: { getCurrentPlaceZone: () => places.getCurrentPlaceZone() }, getOnline: () => online });
const seats = seating.seats;
const locomotion = () => ({ moving: !seats.isSeated && controller.moving, grounded: controller.grounded, mounted: controller.mounted });
// Social S1-C2 같이 가기: a local assist toward an accepted friend's current session. The
// controller only requests world-space movement; PlayerController keeps collision authority.
const followZone = () => online?.network?.placeZoneId ?? null;
const follow = new FollowController({
  getTarget: (userId) => online?.remoteByUser(userId) ?? null,
  getLocalPosition: () => player.getLocalPosition(),
  getLocalPlaceZoneId: followZone,
  isNetworkOnline: () => online?.network?.isOnline === true && online.network.zoneSynced === true,
  canFollow: (userId) => followEligibility({
    userId, selfUserId: online?.userId ?? null, signedIn: social.available,
    relationship: social.relationshipOf(userId), mounted: controller.mounted,
    target: online?.remoteByUser(userId) ?? null, localPlaceZoneId: followZone()
  }),
  manualIntent: () => locomotionIntent(controller),
  isSeated: () => seats.isSeated,
  assist: { set: (intent) => controller.setAssistedMovement(intent), clear: () => controller.clearAssistedMovement() },
  checkRelationship: async (userId) => (await social.relationship(userId)) === Relationship.FRIENDS
});
// Sitting ends Follow first (no following while seated).
const toggleSeat = () => {
  if (fullMap?.openState || rooms?.insideRoom) return false;
  if (!seats.isSeated && seating.nearby) follow.stop(FollowStopReason.SIT);
  return seating.toggle();
};
// An emote ends Follow, then plays as if standing still (no walking emotes in S1).
const requestEmote = (id) => {
  const loco = locomotion();
  if (follow.stop(FollowStopReason.EMOTE)) loco.moving = locomotionIntent(controller).move;
  return seating.requestEmote(id, loco);
};
const emoteMenu = createEmoteMenu({
  toggle: document.getElementById("emote-toggle"),
  menu: document.getElementById("emote-menu"),
  status: document.getElementById("emote-status"),
  // E is emotion only: interaction moved to F, so nearby NPCs or the guestbook never take E.
  shouldIgnoreShortcut: () => !inputFocus.can("GAMEPLAY_SHORTCUT"),
  // S1 rule: an emote while seated stands the player up first (no seated emote variants yet).
  onSelect: (id) => requestEmote(id)
});
// Social S1-B2 local chat. Opening the input releases held movement keys; the input itself is a
// real <input>, which every gameplay key handler already ignores.
let chatFocusClaim = null;
const chatPanel = createChatPanel({
  toggle: document.getElementById("chat-toggle"),
  form: document.getElementById("chat-form"),
  input: document.getElementById("chat-input"),
  feedList: document.getElementById("chat-feed"),
  hint: document.getElementById("chat-hint"),
  getChat: () => online?.chat,
  shouldIgnoreShortcut: () => !inputFocus.can("WORLD_ACTION"),
  onOpenChange: (open) => {
    if (open) {
      if (!chatFocusClaim) chatFocusClaim = inputFocus.claim("chat", INPUT_FOCUS_POLICY.CHAT);
      return;
    }
    if (chatFocusClaim) {
      inputFocus.release(chatFocusClaim);
      chatFocusClaim = null;
    }
  },
  onFocusChat: () => { emoteMenu.setOpen(false); }
});
// Social S1-C1: Player Inspect, friends, block and report. The database is authoritative;
// targets are user ids from Presence, never nicknames. Guests have no social layer.
const social = new SocialClient({ getClient: () => online?.supabase ?? null, getSelfUserId: () => online?.userId ?? null });
const friendRoomVisitClient = new FriendRoomVisitClient({
  getClient: () => online?.supabase ?? null,
  getSelfUserId: () => online?.userId ?? null
});
// Housing H3: visitors knock at the Dorm Lobby corridor door; owners answer from inside their room.
const roomKnockClient = new RoomKnockClient({
  getClient: () => online?.supabase ?? null,
  getSelfUserId: () => online?.userId ?? null
});
// Player Card and Friends panel share one visit entry; the controller exists once rooms do.
const roomVisitEntry = Object.freeze({
  canVisit: () => friendRoomVisit?.canVisit() ?? { ok: false, reason: "busy" },
  onVisit: (userId, displayName = null) =>
    friendRoomVisit?.visit(userId, { displayName }) ?? Promise.resolve({ ok: false, reason: "busy" }),
  reasonText: (reason) => FRIEND_ROOM_VISIT_TEXT[reason] ?? ""
});
const playerCard = createPlayerCard({
  panel: document.getElementById("player-card"),
  social,
  getRemote: (sessionId) => online?.remotePlayer(sessionId) ?? null,
  getSelfUserId: () => online?.userId ?? null,
  getPlaceZoneId: () => online?.status().placeZone ?? null,
  onOpenChange: (open) => {
    if (open) playerCardInput.acquire();
    else playerCardInput.release();
  },
  onMessage: (userId) => {
    try {
      sessionStorage.setItem("inhagame-hub-message-draft-v1", JSON.stringify({ userId, createdAt: Date.now() }));
      window.location.assign("/#messages");
      return true;
    } catch {
      return false;
    }
  },
  accompany: { canPropose: (userId) => accompany?.canPropose(userId) === true,
    propose: (userId, poiId) => accompany?.propose(userId, poiId) ?? false,
    isActive: () => accompany?.active === true },
  roomVisit: roomVisitEntry,
  follow: {
    canFollow: (userId) => follow.canFollow(userId),
    isFollowing: (userId) => follow.isFollowing(userId),
    isFollowingAnyone: () => follow.active,
    // Seated: stand up first, then follow.
    onFollow: (userId) => {
      if (seats.isSeated) seating.standUp("follow");
      return follow.start(userId);
    },
    onStopFollow: () => follow.stop(FollowStopReason.EXPLICIT)
  }
});
const nearbyPanel = createNearbyPanel({
  toggle: document.getElementById("nearby-toggle"), panel: document.getElementById("nearby-panel"),
  getRemotes: () => online?.nearbyRemotes?.() ?? [],
  getPosition: () => player.getLocalPosition(),
  getZoneId: () => online?.network?.placeZoneId ?? null,
  getSelfUserId: () => online?.userId ?? null,
  isBlocked: userId => social.isBlocked(userId),
  relationshipOf: userId => social.relationshipOf(userId),
  getAvailability: () => !online?.userId ? "guest" : rooms?.insideRoom ? "indoor"
    : online.network?.zoneSynced ? "online" : online.network?.state === "OFFLINE" ? "offline" : "connecting",
  onInspect: sessionId => playerCard.open(sessionId),
  onWave: () => requestEmote("wave"),
  onOpenChange: (open) => {
    if (open) nearbyPanelInput.acquire();
    else nearbyPanelInput.release();
  },
  onOpen: () => { playerCard.close(); chatPanel.setOpen(false, { focus: false }); emoteMenu.setOpen(false); }
});
const followStatus = document.getElementById("follow-status");
let followStatusTimer = null;
const showWorldStatus = (message) => {
  if (!followStatus || !message) return false;
  followStatus.textContent = message;
  followStatus.hidden = false;
  clearTimeout(followStatusTimer);
  followStatusTimer = setTimeout(() => { followStatus.hidden = true; }, 3000);
  return true;
};
// P1a / P1c0: the MCM reward toasts and this status line share the bottom-centre column. A status raised
// while the reward lane is busy (LEVEL UP after the reward re-read, the retry hint) waits until the
// whole lane (current + queued toasts) is idle, re-checking right before it shows. The lane is
// assigned once the event UI exists.
let rewardToastRemainingMs = () => 0;
const showWorldStatusAfterReward = createStatusAfterReward({
  remainingMs: () => rewardToastRemainingMs(),
  show: showWorldStatus
});
// P0-F3a: read-only server progression on the signed-in member client (never a new client).
const progression = createProgressionClient({ getClient: () => online?.supabase ?? null });
const progressionHud = createProgressionHud({
  pill: document.getElementById("progression-hud"),
  pillLevel: document.getElementById("progression-level"),
  pillExp: document.getElementById("progression-exp"),
  pillBar: document.getElementById("progression-bar"),
  pillFill: document.getElementById("progression-fill"),
  badge: document.getElementById("progression-badge"),
  badgeLevel: document.getElementById("progression-badge-level"),
  badgeBar: document.getElementById("progression-badge-bar"),
  badgeFill: document.getElementById("progression-badge-fill"),
  menuLine: document.getElementById("progression-menu-line")
});
progression.onChange((change) => {
  progressionHud.render(change.state, change.snapshot);
  lobbyPlayerSummary.setProgression(formatProgression(change.snapshot));
  if (change.reason === "core15-first-campus-reward" && change.state === PROGRESSION_STATE.READY) {
    core15Funnel?.growthSeen();
  }
  const message = levelUpMessage(change);
  if (message) showWorldStatusAfterReward(message);
  npcTest?.observeTmlShadowEconomicState?.({
    walletBalance: wallet?.balance?.() ?? null,
    totalExp: change.snapshot?.totalExp ?? progression.snapshot?.totalExp ?? null
  });
});
// Read-only server wallet balance on the same member client (never a new client, never computed).
const wallet = createWalletClient({ getClient: () => online?.supabase ?? null });
wallet.onChange(() => {
  lobbyPlayerSummary.setWalletBalance(wallet.balance());
  npcTest?.observeTmlShadowEconomicState?.({
    walletBalance: wallet.balance(),
    totalExp: progression.snapshot?.totalExp ?? null
  });
});
// Inventory P0: read-only owned items on the same member client (never a new client, never inferred).
const inventory = createInventoryClient({ getClient: () => online?.supabase ?? null });
// P1e: Campus Daily Quiz on the same member client. The server owns the day (Asia/Seoul), the run, the
// answers and the reward; a PASSED answer's reward is shown through the existing reward toast lane and
// the authorities it touched are re-read (never computed here). LEVEL UP follows the toast.
const dailyQuiz = createDailyQuizClient({
  getClient: () => online?.supabase ?? null,
  onReward: reward => {
    mcmEventUi.showReward({ status: reward.replayed ? "ALREADY_CLAIMED" : "CLAIMED", replayed: reward.replayed,
      rewardResult: { status: reward.status, entries: reward.entries } });
    void progression.refresh("reward");
    if (reward.entries.some(entry => entry.grantType === "CURRENCY")) void wallet.refresh("reward");
    if (reward.entries.some(entry => entry.grantType === "ITEM")) void inventory.refresh("reward");
  }
});// P1f: 캠퍼스 출석부 on the same member client. Only the explicit panel button claims; a claim that
// paid shows its server rewards through the existing toast lane (daily first, then the monthly
// milestone), then only the Wallet is re-read (coin only: no EXP, no items).
const attendance = createAttendanceClient({
  getClient: () => online?.supabase ?? null,
  onRewards: (rewards) => {
    const [daily, ...milestones] = rewards;
    if (daily) mcmEventUi.showReward({ status: "CLAIMED", replayed: false, rewardResult: { status: daily.status, entries: daily.entries } });
    for (const milestone of milestones) {
      const lines = milestone.entries.map(rewardLine).filter(Boolean);
      if (lines.length) mcmEventUi.say(["누적 출석 보상", ...lines].join("\n"), 4500);
    }
    void wallet.refresh("reward");
  }
});

// Wardrobe P0: the server appearance loadout on the same member client (never a new client, never inferred).
const loadout = createLoadoutClient({ getClient: () => online?.supabase ?? null });
// Local Equipment Projection P0: the loadout snapshot (via onChange) is the only equipped authority; the
// catalog modelAssetId is the asset binding (only the models in EQUIPMENT_MODEL_REGISTRY load and render).
const equipmentProjection = createEquipmentProjection({
  loadout,
  getAnchor: (slot) => character.getEquipmentAnchor(slot),
  loadModel: createEquipmentModelLoader({ app, assetShadow: assetOptimizationShadow })
});
window.addEventListener("pagehide", event => { if (!event.persisted) equipmentProjection.destroy(); });
// Multiplayer Equipment Projection P0: other players see the same READY server loadout through a sparse,
// visual-only Presence field. Only the loadout client's server read feeds it (never the Wardrobe UI,
// the Inventory or storage); world-online republishes Presence only when the value changes.
loadout.onChange((change) => online?.setLocalEquipment(change.accountId, publicEquipmentFor(change, change.accountId)));
// Personal Room Session carries the same public equipment on the room channel.
loadout.onChange((change) => {
  if (change.accountId && change.accountId === online?.userId) roomSession?.setEquipment(publicEquipmentFor(change, change.accountId));
});
// A page restored from the back/forward cache may have missed progression / wallet / inventory changes.
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  void progression.refresh("resume");
  void wallet.refresh("resume");
  void inventory.refresh("resume");
  void loadout.refresh("resume");
});
const mcmPreviewStartMs = mcm2026PreviewStartMs(location);
const mcmPreviewClockOffsetMs = mcmPreviewStartMs === null ? 0 : mcmPreviewStartMs - Date.now();
const mcmEvent = createMcm2026EventClient({
  preview: mcmEventPreviewMode,
  previewTimed: mcmPreviewStartMs !== null,
  clock: { now: () => Date.now() + mcmPreviewClockOffsetMs },
  getClient: () => online?.supabase ?? null,
  getSessionToken: async () => {
    const client = online?.supabase;
    if (!client || !online?.userId) return null;
    const { data, error } = await client.auth.getSession();
    const session = data?.session;
    return !error && session?.user?.id === online.userId && session.user.is_anonymous !== true
      ? session.access_token : null;
  }
});
let mcmEventRuntime = null;
const mcmEventUi = createMcm2026EventUi({
  client: mcmEvent,
  getGuidance: () => rooms?.insideRoom ? "" : mcmEventRuntime?.guidance() ?? "",
  onOpenChange: (open) => {
    if (open) mcmEventInfoInput.acquire();
    else mcmEventInfoInput.release();
  }
});
rewardToastRemainingMs = () => mcmEventUi.toastRemainingMs();
mcmEventRuntime = createMcm2026EventRuntime({
  app, campusRoot, player, orbit, client: mcmEvent,
  onInfo: () => mcmEventUi.openInfo(),
  onStatus: showWorldStatus,
  onDialogueChange: (open) => {
    if (open) mcmDialogueInput.acquire();
    else mcmDialogueInput.release();
  }
});
if (mcmEventPreviewMode) void mcmEvent.setSignedIn(true);
follow.onChange((_status, reason) => {
  if (follow.active && playerAutoMove?.active) playerAutoMove.pause(AUTO_MOVE_CANCEL_REASON.ASSIST_CONFLICT);
  playerCard.refresh();
  showWorldStatus(FOLLOW_STOP_MESSAGES[reason]);
});
// Friendship ended or a block (either way): stop at once.
social.onRelationshipChange((userId, state) => {
  if (!follow.isFollowing(userId) || state === Relationship.FRIENDS) return;
  follow.stop(state === Relationship.BLOCKED_BY_ME ? FollowStopReason.BLOCKED : FollowStopReason.RELATIONSHIP);
});
social.onRelationshipChange((userId, state) => {
  if (accompany?.peerId === userId && state !== Relationship.FRIENDS) void accompany.end("relationship");
});
const friendPanel = createFriendPanel({
  toggle: document.getElementById("open-friends"),
  panel: document.getElementById("friend-panel"),
  social,
  onOpenChange: (open) => {
    if (open) friendPanelInput.acquire();
    else friendPanelInput.release();
  },
  fallbackFocus: () => document.body?.dataset?.lobbyShell === "true"
    ? document.getElementById("lobby-friends-summary")
    : document.getElementById("open-friends"),
  roomVisit: roomVisitEntry
});
// Unfriend / block from any panel: a live room visit re-asks the server at once (not in 15 s).
social.onRelationshipChange(() => { void roomSession?.revalidateNow(); });
const guestbook = new GuestbookClient({
  getClient: () => online?.supabase ?? null,
  getSelfUserId: () => online?.userId ?? null
});
const personalRoom = new PersonalRoomClient({
  getClient: () => online?.supabase ?? null,
  getSelfUserId: () => online?.userId ?? null
});
const guestbookPanel = createGuestbookPanel({
  panel: document.getElementById("guestbook-panel"),
  guestbook,
  onOpenChange: (open) => {
    if (open) guestbookInput.acquire();
    else guestbookInput.release();
  },
  onOpenProfile: async (entry) => {
    if (entry.mine) {
      document.getElementById("open-profile")?.click();
      await guestbookPanel.setOpen(false);
      return true;
    }
    const opening = playerCard.openUser(entry.userId, entry.nickname);
    await guestbookPanel.setOpen(false);
    return opening;
  }
});
const lobbyPresenceSummary = createLobbyPresenceSummary({
  zoneElement: document.getElementById("lobby-zone-presence"),
  friendsButton: document.getElementById("lobby-friends-summary"),
  getOnline: () => online,
  getPopulation: () => populationCount,
  social,
  friendPanel
});
// P0-F3b: Student Center shop on the signed-in member client (never a new client). The server decides
// price, Level lock and purchasability; the panel only shows them and forwards purchases.
const shop = createShopClient({ getClient: () => online?.supabase ?? null });
// Inventory panel (☰ → 🎒 인벤토리). One modal at a time with the shop; same input gate as the shop.
const inventoryButton = document.getElementById("open-inventory");
const inventoryPanel = createInventoryPanel({
  panel: document.getElementById("inventory-panel"),
  inventory,
  onOpenChange: (open) => {
    inventoryButton?.setAttribute("aria-expanded", String(open));
    if (open) {
      inventoryInput.acquire();
      questJournal?.setOpen(false);
      shopPanel.setOpen(false);
      mobilityBook.setOpen(false);
      wardrobePanel.setOpen(false);
      dailyQuizPanel.setOpen(false);
      attendancePanel.setOpen(false);
      emoteMenu.setOpen(false);
      chatPanel.setOpen(false, { focus: false });
      playerCard.close();
      void guestbookPanel.setOpen(false);
      return;
    }
    inventoryInput.release();
  }
});
inventoryButton?.addEventListener("click", () => inventoryPanel.setOpen(true));
const shopButton = document.getElementById("open-shop");
const shopPanel = createShopPanel({
  panel: document.getElementById("shop-panel"),
  shop,
  wallet,
  onStatus: showWorldStatus,
  // A purchase may grant an item: re-read the inventory and loadout authorities (never from the response).
  onPurchase: () => {
    void inventory.refresh("purchase");
    void loadout.refresh("purchase");
  },
  onOpenChange: (open) => {
    shopButton?.setAttribute("aria-expanded", String(open));
    if (open) {
      shopInput.acquire();
      questJournal?.setOpen(false);
      inventoryPanel.setOpen(false);
      mobilityBook.setOpen(false);
      wardrobePanel.setOpen(false);
      dailyQuizPanel.setOpen(false);
      attendancePanel.setOpen(false);
      emoteMenu.setOpen(false);
      chatPanel.setOpen(false, { focus: false });
      playerCard.close();
      void guestbookPanel.setOpen(false);
      return;
    }
    shopInput.release();
  }
});
shopButton?.addEventListener("click", () => shopPanel.setOpen(true));
// Wardrobe panel (☰ → 👕 옷장): equip / unequip owned wearables through the loadout authority.
// One modal at a time with the shop and the inventory; same input gate. No avatar change (projection
// is a follow-up).
const wardrobeButton = document.getElementById("open-wardrobe");
const wardrobePanel = createWardrobePanel({
  panel: document.getElementById("wardrobe-panel"),
  loadout,
  inventory,
  onStatus: showWorldStatus,
  // A refusal such as ITEM_NOT_OWNED means the shown ownership may be old: re-read the inventory.
  onChange: (result) => { if (result.outcome === "REFUSED") void inventory.refresh("wardrobe"); },
  onOpenChange: (open) => {
    wardrobeButton?.setAttribute("aria-expanded", String(open));
    if (open) {
      wardrobeInput.acquire();
      questJournal?.setOpen(false);
      shopPanel.setOpen(false);
      inventoryPanel.setOpen(false);
      mobilityBook.setOpen(false);
      dailyQuizPanel.setOpen(false);
      attendancePanel.setOpen(false);
      emoteMenu.setOpen(false);
      chatPanel.setOpen(false, { focus: false });
      playerCard.close();
      void guestbookPanel.setOpen(false);
      return;
    }
    wardrobeInput.release();
  }
});
wardrobeButton?.addEventListener("click", () => wardrobePanel.setOpen(true));
// Mobility Book P0.8 (☰ → 🛞 탈것). Registry metadata is presentation/runtime policy only:
// it never grants ownership. Current bike/helicopter remain EXPERIMENTAL / TEST_ONLY.
setCampusKickboardPropRoot(createCampusKickboard(campusRoot));
setCampusKartPropRoot(createCampusKart(campusRoot));
setDuckBoatPropRoot(createDuckBoat(campusRoot));
createInkyungDockMarker(campusRoot);
setCampusShuttlePropRoot(createCampusShuttle(campusRoot));
createShuttleStations(campusRoot,controller.shuttle.stations);
setCampusBalloonPropRoot(createCampusBalloon(campusRoot));
const mobilityBookButton = document.getElementById("open-mobility-book");
const mobilityBook = createMobilityBook({
  panel: document.getElementById("mobility-book-panel"),
  onStatus: showWorldStatus,
  onSummon: (definition) => {
    if (rooms?.insideRoom || lobbyWorld.active || lobbyTransition.active || controller.mounted) {
      showWorldStatus("지금은 탈것을 소환할 수 없어요");
      return false;
    }
    if (definition.primaryAction !== "SUMMON_TEST") return false;
    mobilityBook.setOpen(false); // Release the blocking UI owner before the controller checks input.
    const summonActions = {
      [CAMPUS_KICKBOARD_ID]: () => controller.summonKickboardInstant(),
      [CAMPUS_KART_ID]: () => controller.summonKartNearby(),
      [DUCK_BOAT_ID]: () => controller.summonDuckBoat(),
      [CAMPUS_BALLOON_ID]: () => controller.summonBalloonNearPlayer(),
      "mount.campus_helicopter.prototype": () => controller.summonHelicopterWithPadFallback()
    };
    const summoned = summonActions[definition.mountId]?.() ?? false;
    const placement = controller.lastSummonPlacement;
    const meters = placement?.mountId === definition.mountId && Number.isFinite(placement.distance)
      ? Math.max(1, Math.round(worldToMeters(placement.distance))) : null;
    let successMessage = `${definition.emoji} 주변 안전한 곳에 ${definition.displayName} 소환 완료`;
    if (definition.mountId === CAMPUS_KICKBOARD_ID) successMessage = "🛴 전동 킥보드를 꺼내 바로 탑승했어요.";
    else if (definition.mountId === CAMPUS_KART_ID) successMessage = meters
      ? `🛺 캠퍼스 카트를 호출했어요. 약 ${meters}m 거리에 배치했습니다.`
      : "🛺 캠퍼스 카트를 가까운 안전 지점에 배치했어요.";
    else if (definition.mountId === "mount.campus_helicopter.prototype") successMessage = placement?.mode === "PAD"
      ? `🚁 주변 착륙 공간이 부족해 ${placement.label ?? "안전 패드"}에 배치했어요${meters ? ` · 약 ${meters}m` : ""}.`
      : `🚁 가까운 착륙 가능 지점에 헬리콥터를 배치했어요${meters ? ` · 약 ${meters}m` : ""}.`;
    let failureMessage = "주변에 탈것을 놓을 안전한 공간이 없어요";
    if (definition.mountId === CAMPUS_KICKBOARD_ID) failureMessage = "🛴 실외의 마른 지상에 서 있을 때 바로 탈 수 있어요.";
    else if (definition.mountId === CAMPUS_KART_ID) failureMessage = "🛺 주변 약 50m 안에서 카트를 놓을 수 있는 평탄한 공간을 찾지 못했어요.";
    else if (definition.mountId === "mount.campus_helicopter.prototype") failureMessage = "🚁 주변 착륙지와 대운동장 안전 패드를 모두 사용할 수 없어요.";
    else if (definition.mountId === DUCK_BOAT_ID) failureMessage = "인경호 남쪽 선착장 가까이에서 이용해 주세요.";
    showWorldStatus(summoned ? successMessage : failureMessage);
    return summoned;
  },
  onLocate: (definition) => {
    if(definition.mobilityId==="transit.campus_shuttle"){showWorldStatus("🚌 정문 승강장의 파란 표식에서 셔틀을 기다려 주세요. 정차 중에 탑승할 수 있어요.");return true;}
    if (definition.primaryAction !== "LOCATE_TEST") return false;
    showWorldStatus("🚲 자전거는 현재 정문 실험 위치에서 테스트할 수 있어요");
    return true;
  },
  onOpenChange: (open) => {
    mobilityBookButton?.setAttribute("aria-expanded", String(open));
    if (open) {
      mobilityBookInput.acquire();
      questJournal?.setOpen(false);
      shopPanel.setOpen(false);
      inventoryPanel.setOpen(false);
      wardrobePanel.setOpen(false);
      dailyQuizPanel.setOpen(false);
      attendancePanel.setOpen(false);
      emoteMenu.setOpen(false);
      chatPanel.setOpen(false, { focus: false });
      playerCard.close();
      void guestbookPanel.setOpen(false);
      return;
    }
    mobilityBookInput.release();
  }
});
mobilityBookButton?.addEventListener("click", () => mobilityBook.setOpen(true));
// Daily Quiz panel (☰ → 📚 오늘의 퀴즈): its own modal, same input gate and one-modal-at-a-time rule.
const dailyQuizButton = document.getElementById("open-daily-quiz");
const dailyQuizPanel = createDailyQuizPanel({
  panel: document.getElementById("daily-quiz-panel"),
  quiz: dailyQuiz,
  onOpenChange: (open) => {
    dailyQuizButton?.setAttribute("aria-expanded", String(open));
    lobbyDailyLoop.setPanelOpen("quiz", open);
    if (open) {
      dailyQuizInput.acquire();
      questJournal?.setOpen(false);
      attendancePanel.setOpen(false);
      shopPanel.setOpen(false);
      inventoryPanel.setOpen(false);
      mobilityBook.setOpen(false);
      wardrobePanel.setOpen(false);
      emoteMenu.setOpen(false);
      chatPanel.setOpen(false, { focus: false });
      playerCard.close();
      void guestbookPanel.setOpen(false);
      return;
    }
    dailyQuizInput.release();
  }
});
dailyQuizButton?.addEventListener("click", () => dailyQuizPanel.setOpen(true));
// Attendance panel (☰ → 📅 출석부): its own modal, same input gate and one-modal-at-a-time rule.
const attendanceButton = document.getElementById("open-attendance");
const attendancePanel = createAttendancePanel({
  panel: document.getElementById("attendance-panel"),
  attendance,
  onOpenChange: (open) => {
    attendanceButton?.setAttribute("aria-expanded", String(open));
    lobbyDailyLoop.setPanelOpen("attendance", open);
    if (open) {
      attendanceInput.acquire();
      questJournal?.setOpen(false);
      dailyQuizPanel.setOpen(false);
      shopPanel.setOpen(false);
      inventoryPanel.setOpen(false);
      mobilityBook.setOpen(false);
      wardrobePanel.setOpen(false);
      emoteMenu.setOpen(false);
      chatPanel.setOpen(false, { focus: false });
      playerCard.close();
      void guestbookPanel.setOpen(false);
      return;
    }
    attendanceInput.release();
  }
});
attendanceButton?.addEventListener("click", () => attendancePanel.setOpen(true));
// Main Lobby P2 "오늘의 캠퍼스": a read-only summary of the two clients above. It re-renders on their own change
// events (account switches included) and only opens the existing panels; the panels keep the explicit claim / start.
const lobbyDailyLoop = createLobbyDailyLoop({
  root: document.getElementById("lobby-daily-loop"),
  noteElement: document.getElementById("lobby-daily-loop-note"),
  attendanceButton: document.getElementById("lobby-daily-attendance"),
  quizButton: document.getElementById("lobby-daily-quiz"),
  attendance,
  quiz: dailyQuiz,
  onOpenAttendance: () => attendancePanel.setOpen(true),
  onOpenQuiz: () => dailyQuizPanel.setOpen(true)
});
// Student Center shop world entry: the same panel from the terrace in front of 학생회관 (F / mobile
// context button). Availability is the bound member account only; being near makes no RPC.
const shopWorldAvailable = () => shop.accountId !== null && online?.supabase != null;
const shopWorld = createShopWorldInteraction({
  getAvailable: shopWorldAvailable,
  openPanel: () => shopPanel.setOpen(true)
});
// A transform-only marker point (no mesh) above the entry for the floating label, about head
// height so it reads from the pond path and stays on screen next to the player.
const shopWorldMarker = new pc.Entity("StudentCenterShopMarker");
shopWorldMarker.setLocalPosition(STUDENT_CENTER_SHOP_ENTRY.x,
  (roadviewGroundHeight(STUDENT_CENTER_SHOP_ENTRY.x, STUDENT_CENTER_SHOP_ENTRY.z) ?? 0) + 2.4, STUDENT_CENTER_SHOP_ENTRY.z);
campusRoot.addChild(shopWorldMarker);
const shopWorldLabel = createShopWorldLabel({
  element: document.getElementById("shop-world-label"),
  camera,
  canvas,
  getWorldPosition: () => shopWorldMarker.getPosition()
});
// Informational back-gate stop. The shared F/touch slot opens one static panel; F1 stays disabled.
const backgateTransitPanel = createBackgateTransitPanel({
  panel: document.getElementById("backgate-transit-panel"),
  fallbackFocus: canvas,
  onBoard: () => biryongRealm?.enter() === true,
  onOpenChange: open => {
    if (open) {
      backgateTransitInput.acquire();
      playerAutoMove?.pause(AUTO_MOVE_CANCEL_REASON.INTERACTION);
      hudMenu?.setOpen(false, { focus: false });
      emoteMenu.setOpen(false);
      chatPanel.setOpen(false, { focus: false });
    } else backgateTransitInput.release();
  }
});
const backgateTransitState = () => ({
  grounded: controller.grounded,
  blocked: rooms.insideRoom || biryongRealm?.inCampus === false || controller.mounted || seats.isSeated || backgateTransitPanel.open ||
    lobbyWorld.active || lobbyTransition.active || !inputFocus.can("WORLD_ACTION")
});
const backgateTransit = createBackgateTransitInteraction({
  getPosition: () => player.getLocalPosition(), getState: backgateTransitState,
  getGroundHeight: roadviewGroundHeight,
  openPanel: () => backgateTransitPanel.setOpen(true)
});
// Another modal or a system transition takes over; release our claim without restoring gameplay.
const unbindBackgateTransitFocus = inputFocus.subscribe(state => {
  if (backgateTransitPanel.open && state.topOwners.some(id => id !== "backgate-transit"))
    backgateTransitPanel.setOpen(false, { restoreFocus: false });
});
window.addEventListener("pagehide", event => {
  backgateTransitPanel.setOpen(false, { restoreFocus: false });
  if (!event.persisted) { unbindBackgateTransitFocus(); backgateTransitPanel.destroy(); }
});
social.onRelationshipChange((userId, state) => lobbyPresenceSummary.applyRelationship(userId, state));
social.onRelationshipChange(() => nearbyPanel.render());
// A block hides that user's local chat immediately (feed entries and bubbles).
social.onBlockedChange((userId, blocked) => {
  if (blocked) online?.chat.removeSender(userId);
  nearbyPanel.render();
});
const hudMenu = createCampusHudMenu({
  toggle: document.getElementById("hud-menu-toggle"),
  panel: document.getElementById("hud-menu"),
  onOpen: () => {
    hudMenuInput.acquire();
    emoteMenu.setOpen(false);
    chatPanel.setOpen(false, { focus: false });
  },
  onClose: () => { hudMenuInput.release(); }
});
keyboardHelp = createKeyboardShortcutsPanel({
  open: document.getElementById("open-keyboard-help"),
  close: document.getElementById("close-keyboard-help"),
  panel: document.getElementById("keyboard-shortcuts-panel"),
  fallbackFocus: document.getElementById("hud-menu-toggle"),
  onOpen: () => {
    keyboardHelpInput.acquire();
    emoteMenu.setOpen(false);
    chatPanel.setOpen(false, { focus: false });
  },
  onClose: () => { keyboardHelpInput.release(); }
});
// Single input authority: migrated owners resolve WORLD_ACTION through InputFocusManager.
const worldActionsSuspended = () => !inputFocus.can("WORLD_ACTION");
// F: the interaction slot's current action (NPC talk, seat, guestbook, doors, Follow stop).
// While an NPC dialogue is open, F closes it (the slot itself is suspended then).
const interactionAction = () => {
  if (playerAutoMove?.active) playerAutoMove.pause(AUTO_MOVE_CANCEL_REASON.INTERACTION);
  if (mcmEventRuntime.isDialogueOpen() === true) return mcmEventRuntime.closeDialogue() !== false;
  if (npcTest?.isConversationOpen?.() === true) return npcTest.closeConversation?.() !== false;
  if (!inputFocus.can("WORLD_ACTION")) return false;
  return contextActions.trigger();
};
// M: PlayerController owns the key and the mount state; the World only adds the panel block.
controller.setTransportGate(() => !worldActionsSuspended());
const transportAction = () => {
  if (playerAutoMove?.active) playerAutoMove.pause(AUTO_MOVE_CANCEL_REASON.TRANSPORT);
  return controller.transportAction();
};
window.addEventListener("keydown", (event) => {
  if (event.code !== "KeyF" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
  interactionAction();
});
guestbookInteraction = createGuestbookInteraction({
  anchor: MAIN_GATE_GUESTBOOK,
  radius: MAIN_GATE_GUESTBOOK.interactionRadius,
  getAvailable: () => guestbook.available,
  openPanel: () => {
    const opening = guestbookPanel.setOpen(true);
    emoteMenu.setOpen(false);
    chatPanel.setOpen(false, { focus: false });
    playerCard.close();
    return opening;
  }
});
const localBubble = document.getElementById("local-chat-bubble");
const nameplateEl = document.getElementById("nameplate");
// Keep the chat input above a phone's on-screen keyboard.
window.visualViewport?.addEventListener("resize", () => {
  const v = window.visualViewport;
  const inset = Math.max(0, window.innerHeight - v.height - v.offsetTop);
  document.documentElement.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
});
let tourWasIncomplete = tour.stage < TOUR_STOPS.length;
let tourResultSent = false;
document.getElementById('tour-restart')?.addEventListener('click', () => {
  tourWasIncomplete=true; tourResultSent=false; window.InhaGameEntry?.retry();
});

const places = new PlaceZoneRegistry();
inkyungLivingMoment?.setZone(places.getCurrentPlaceZone?.()?.id ?? null);
// Club Room P0: the main-hall entrance leads to a separate interior scene in this same app.
// Only one space is active; the room is local-only (no Realtime) and nothing is stored.
const clubRoom = createClubRoomScene(app);
const dorm1Lobby = createDorm1LobbyScene(app);
const personalRoomScene = createPersonalRoomScene(app);
const mcmRoomScene = createMcm2026RoomScene(app);
const roomScenes = new Map([
  ["ROOM_CLUBHOUSE_01", clubRoom],
  ["ROOM_DORM1_LOBBY", dorm1Lobby],
  ["ROOM_PERSONAL_BASIC", personalRoomScene],
  [MCM_2026_ROOM_ID, mcmRoomScene]
]);
const spaceFade = document.getElementById("space-fade");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
// 150 ms to black, switch, then fade back in; instant with reduced motion.
const fadeSwitch = (run) => {
  if (!spaceFade || reducedMotion.matches) { run(); return; }
  spaceFade.hidden = false;
  requestAnimationFrame(() => spaceFade.classList.add("on"));
  setTimeout(() => {
    run();
    spaceFade.classList.remove("on");
    setTimeout(() => { if (!spaceFade.classList.contains("on")) spaceFade.hidden = true; }, 180);
  }, 160);
};
rooms = createRoomTransition({
  fade: fadeSwitch,
  onBusyChange: (busy) => {
    if (busy) roomTransitionInput.acquire();
    else roomTransitionInput.release();
  },
  canEnter: (_entrance, room) => room?.id !== MCM_2026_ROOM_ID ||
    (mcmEventPreviewMode && mcmEvent.state?.eventState === "ACTIVE") || mcm2026CanEnterVenue(mcmEvent.state),
  world: createRoomWorldAdapter({
    player, controller, orbit, campusRoot, getRoomScene: (room) => roomScenes.get(room.id) ?? null, sun: light,
    lighting: {
      save: () => ({ ambient: app.scene.ambientLight.clone(), clearColor: camera.camera.clearColor.clone() }),
      apply: ({ ambient, clearColor }) => { app.scene.ambientLight = ambient; camera.camera.clearColor = clearColor; }
    },
    follow, stopFollowReason: FollowStopReason.ROOM, seating, seats, emotes,
    getOnline: () => online, places, streaming: { update: (dt, p) => streaming.update(dt, p) },
    closePanels: () => {
      furnitureEditor?.forceClose();
      emoteMenu.setOpen(false);
      chatPanel.setOpen(false, { focus: false });
      playerCard.close();
      void guestbookPanel.setOpen(false);
      shopPanel.setOpen(false);
      inventoryPanel.setOpen(false);
      mobilityBook.setOpen(false);
      wardrobePanel.setOpen(false);
      dailyQuizPanel.setOpen(false);
      attendancePanel.setOpen(false);
      questJournal?.setOpen(false);
    },
    setLocationLabel: (text) => { zoneEl.textContent = text; },
    markSpace: (id) => { if (id) document.body.dataset.space = id; else delete document.body.dataset.space; }
  })
});
const biryongRealmScene = createBiryongRealmScene(app);
const biryongCampusReturnAnchor = Object.freeze({
  x: BACKGATE_TRANSIT.wait.x,
  y: controller.groundY + roadviewGroundHeight(BACKGATE_TRANSIT.wait.x, BACKGATE_TRANSIT.wait.z),
  z: BACKGATE_TRANSIT.wait.z,
  yaw: 0
});
biryongRealm = createBiryongRealmTransition({
  fade: fadeSwitch,
  campusReturnAnchor: biryongCampusReturnAnchor,
  onBusyChange: busy => {
    if (busy) biryongRegionTransitionInput.acquire();
    else biryongRegionTransitionInput.release();
  },
  world: createBiryongRealmWorldAdapter({
    player, controller, orbit, campusRoot, biryongRoot: biryongRealmScene.root,
    follow, stopFollowReason: FollowStopReason.ROOM, seating, seats, emotes,
    getOnline: () => online, places, getStreaming: () => streaming,
    closePanels: () => {
      playerAutoMove?.pause(AUTO_MOVE_CANCEL_REASON.TRANSPORT);
      backgateTransitPanel.setOpen(false, { restoreFocus: false });
      fullMap?.close?.();
      furnitureEditor?.forceClose();
      emoteMenu.setOpen(false);
      chatPanel.setOpen(false, { focus: false });
      playerCard.close();
      void guestbookPanel.setOpen(false);
      shopPanel.setOpen(false);
      inventoryPanel.setOpen(false);
      mobilityBook.setOpen(false);
      wardrobePanel.setOpen(false);
      dailyQuizPanel.setOpen(false);
      attendancePanel.setOpen(false);
      questJournal?.setOpen(false);
    },
    setLocationLabel: text => { zoneEl.textContent = text; },
    markRegion: id => {
      document.body.dataset.worldRegion = id;
      const minimapRoot = document.getElementById("minimap");
      if (minimapRoot) minimapRoot.hidden = id !== WORLD_REGION_ID.CAMPUS;
      if (id !== WORLD_REGION_ID.CAMPUS) fullMap?.close?.();
    }
  })
});
biryongStationTransit = createBiryongStationTransitInteraction({
  getPosition: () => player.getLocalPosition(),
  getState: () => ({
    grounded: controller.grounded,
    blocked: !biryongRealm?.inBiryong || biryongRealm.busy || rooms.insideRoom ||
      controller.mounted || seats.isSeated || !inputFocus.can("WORLD_ACTION")
  }),
  returnToCampus: () => biryongRealm?.returnToCampus() === true
});
// Soundscape P0-A consumes the existing Place Zone and room state. Audio remains optional.
let worldAudio = null;
try { worldAudio = createWorldAudio(); }
catch (error) { console.warn("World audio unavailable; continuing without sound:", error); }
if (worldAudio) {
  void loadRuntimeMusicProject()
    .then(project => worldAudio?.setMusicProject(project))
    .catch(error => {
      console.warn("World music config unavailable; continuing with ambience only:", error);
      void worldAudio?.setMusicConfigError(error);
    });
}
const audioVolume = document.getElementById("audio-volume");
const unbindAudioVolume = bindAudioVolumeSettings(worldAudio, audioVolume);
let lastAudioState = "";
const syncAudio = () => {
  if (!worldAudio) return;
  const space = lobbyWorld.active || lobbyTransition.active ? "lobby"
    : biryongRealm?.inBiryong ? "biryong-realm" : rooms.currentSpace;
  const placeZoneId = space === "campus" ? places.getCurrentPlaceZone()?.id ?? null : null;
  const placeId = space === "campus" && isNearBiryong(player.getLocalPosition()) ? BIRYONG_PLACE_ID : null;
  const key = `${space}:${placeZoneId ?? ""}:${placeId ?? ""}`;
  if (key === lastAudioState) return;
  lastAudioState = key;
  worldAudio.setState({ space, placeZoneId, placeId });
};
rooms.onChange(syncAudio);
biryongRealm.onChange(syncAudio);
window.addEventListener("pagehide", event => { if (!event.persisted) { unbindAudioVolume(); worldAudio?.dispose(); } });
syncAudio();
const audioDebug = previewHost && startupParams.get("audioDebug") === "1"
  ? document.createElement("pre") : null;
if (audioDebug) {
  audioDebug.id = "audio-debug";
  audioDebug.setAttribute("aria-label", "Audio debug");
  Object.assign(audioDebug.style, {
    position: "fixed", left: "8px", bottom: "8px", zIndex: "9999",
    margin: "0", padding: "6px 8px", color: "#fff", background: "#14202cdd",
    font: "12px/1.4 monospace", pointerEvents: "none"
  });
  document.body.append(audioDebug);
}
let lastAudioDebugAt = 0;
personalRoomInteraction = createPersonalRoomInteraction({
  client: personalRoom,
  rooms,
  onStatus: showWorldStatus
});
// Social S1-D2 · Room Session. Remote room avatars live under the shared personal room scene;
// tapping one opens the same Player Card (friends, block, report) as on the campus.
// Housing H3: the owner's knock prompt lives inside the owner Room HUD (same slot, same layout).
const knockPromptRoot = document.createElement("div");
knockPromptRoot.className = "room-knock-prompt";
knockPromptRoot.hidden = true;
const roomHud = createRoomHud({
  root: document.getElementById("room-hud"),
  footer: knockPromptRoot,
  onLeave: () => furnitureEditor?.open ? furnitureEditor.requestClose(() => rooms.exit()) : rooms.exit(),
  onEdit: () => {
    if (!furnitureEditor?.openEditor()) {
      showWorldStatus("저장된 방 배치를 확인 중이에요. 잠시 후 다시 눌러 주세요.");
      void roomFurniture?.refresh();
    }
  },
  onSetVisibility: async (visibility) => {
    const room = await personalRoom.setVisibility(visibility);
    roomSession?.setVisibility(room.visibility);
    return room;
  }
});
// Housing H3 · owner side: the knock prompt, the knock/presence poll while home, and visitor notices.
const knockPrompt = createKnockPrompt({
  root: knockPromptRoot,
  respond: (knock, accept) => roomKnockClient.respond(knock.knockId, accept)
});
const ownerKnocks = createOwnerKnockWatcher({
  client: roomKnockClient,
  isOwnerInRoom: () => rooms?.currentSpace === "ROOM_PERSONAL_BASIC" && roomSession?.status?.().role === "owner",
  onKnock: (knock) => knockPrompt.push(knock),
  onPolled: (knocks) => knockPrompt.retain(knocks.map(knock => knock.knockId))
});
const syncOwnerKnocks = (state) => {
  const home = state.active && state.role === "owner";
  if (home && !ownerKnocks.running) ownerKnocks.start();
  else if (!home && ownerKnocks.running) { ownerKnocks.stop(); knockPrompt.clear(); }
  if (home) knockPrompt.prune();
};
let lastRoomVisitors = null;
const announceRoomVisitors = (state) => {
  const ready = state.active && state.phase === "READY";
  // The first READY snapshot of a stay is the baseline: only later arrivals and departures are news.
  if (!ready || lastRoomVisitors?.roomId !== state.roomId) {
    lastRoomVisitors = ready ? state : (state.active ? lastRoomVisitors : null);
    return;
  }
  const { joined, left } = diffRoomVisitors(lastRoomVisitors, state);
  lastRoomVisitors = state;
  if (joined.length) showWorldStatus(`${joined.join(", ")}님이 놀러 왔어요 👋`);
  else if (left.length) showWorldStatus(`${left.join(", ")}님이 돌아갔어요`);
};
const roomLocationLabel = (state) => state.role === "owner"
  ? `🏠 제1생활관 · 내 방 · ${state.count}명`
  : `🏠 제1생활관 · ${state.ownerDisplayName ?? "친구"}의 방 · ${state.count}명`;
roomSession = createPersonalRoomSession({
  player, controller,
  createAvatar: createRemoteAvatarFactory({ app, parent: personalRoomScene.root, camera, canvas,
    onInspect: (sessionId) => {
      const remote = roomSession?.remotePlayer(sessionId);
      if (remote && !chatPanel.open) void playerCard.openUser(remote.userId, remote.displayName);
    } }),
  getClient: () => online?.supabase ?? null,
  getIdentity: () => online?.userId ? { userId: online.userId, displayName: online.identity?.displayName ?? null } : null,
  getEquipment: () => publicEquipmentFor(loadout, online?.userId ?? null),
  onAccessLost: ({ role, reason }) => {
    if (rooms.currentSpace !== "ROOM_PERSONAL_BASIC") return;
    rooms.exit({ force: true });
    showWorldStatus(role === "owner" || reason === "IDENTITY" || reason === "SIGNED_OUT"
      ? "개인방 연결이 끊겨 생활관 로비로 돌아왔어요."
      : reason === "ROOM_PRIVATE" ? "친구가 방을 비공개로 바꿔 생활관 로비로 돌아왔어요."
        : "방 방문 권한이 바뀌어 생활관 로비로 돌아왔어요.");
  },
  onChange: (state) => {
    roomHud.update(state);
    announceRoomVisitors(state);
    syncOwnerKnocks(state);
    if (state.active && rooms.currentSpace === "ROOM_PERSONAL_BASIC") zoneEl.textContent = roomLocationLabel(state);
  }
});
friendRoomVisit = createFriendRoomVisitController({
  client: friendRoomVisitClient,
  knockClient: roomKnockClient,
  rooms,
  // From the campus a visit walks to 제1생활관 (route + auto-move); nothing teleports into the room.
  guideToDorm: () => guideToDorm1(),
  isMounted: () => controller.mounted,
  isSeated: () => seats.isSeated,
  standUp: () => seating.standUp("room-visit"),
  stopFollow: () => follow.stop(FollowStopReason.ROOM),
  isLobbyShell: () => lobbyWorld.active || lobbyTransition.active,
  onStatus: showWorldStatus
});
// Housing D3: drafts stay account/room-scoped; visitors only receive server-authorized saved layouts.
const moveOutOfFurniture = () => {
  if (rooms.currentSpace !== "ROOM_PERSONAL_BASIC") return;
  const pos = player.getLocalPosition();
  const blocked = personalRoomScene.ownedFurniture.obstacles.some(box => box.id && !box.id.startsWith("personal_") &&
    pos.x > box.minX - .24 && pos.x < box.maxX + .24 && pos.z > box.minZ - .24 && pos.z < box.maxZ + .24);
  if (blocked) {
    const spawn = PERSONAL_ROOM_BASIC_SPAWN.position;
    controller.velocityY = 0; player.setLocalPosition(spawn.x,spawn.y,spawn.z);
  }
};
let furnitureSceneSignature = "";
roomFurniture = createFurnitureClient({
  getClient: () => online?.supabase ?? null,
  getUserId: () => online?.userId ?? null,
  onChange: state => {
    const signature = JSON.stringify(state.objects);
    if (signature !== furnitureSceneSignature) {
      furnitureSceneSignature = signature;
      personalRoomScene.ownedFurniture.setObjects(state.objects);
      setPersonalRoomMapFurniture(state.objects);
      if (rooms.currentSpace === "ROOM_PERSONAL_BASIC") {
        const map = createRoomMapDataSource("ROOM_PERSONAL_BASIC");
        minimap?.setDataSource(map,{ id:map.id,indoor:true,radiusWorld:map.radiusWorld });
        fullMap?.setDataSource(map,{ id:map.id,label:map.label });
        if (!state.editing) moveOutOfFurniture();
      }
    }
    furnitureEditor?.update(state);
  }
});
furnitureEditor = createFurnitureEditor({
  client:roomFurniture, inventory,
  onOpenChange: open => {
    if (open) {
      furnitureInput.acquire();
      inventoryPanel.setOpen(false); shopPanel.setOpen(false); wardrobePanel.setOpen(false);
      dailyQuizPanel.setOpen(false); attendancePanel.setOpen(false); questJournal?.setOpen(false);
      emoteMenu.setOpen(false); chatPanel.setOpen(false,{ focus:false }); playerCard.close();
      void guestbookPanel.setOpen(false);
    } else {
      furnitureInput.release(); moveOutOfFurniture();
      // Closing a conflicting draft must read the latest revision before the next edit session.
      if (rooms.currentSpace === "ROOM_PERSONAL_BASIC" && roomFurniture?.state().roomId) void roomFurniture.refresh();
    }
  }
});
window.addEventListener("beforeunload", event => {
  const state = roomFurniture.state();
  if (state.editing && (state.dirty || state.pending)) { event.preventDefault(); event.returnValue = ""; }
});

// The room scene is shared; the session (who is here, which channel) follows the room metadata.
rooms.onChange((status) => {
  const meta = status.roomId === "ROOM_PERSONAL_BASIC" ? status.metadata : null;
  if (!meta?.personalRoomId || !meta?.ownerUserId) { roomSession.stop(); roomFurniture.reset(); return; }
  void roomFurniture.bind(meta.personalRoomId.toLowerCase());
  const current = roomSession.status();
  if (current.active && current.roomId === meta.personalRoomId.toLowerCase()) return;
  void roomSession.enter({
    roomId: meta.personalRoomId, ownerUserId: meta.ownerUserId,
    role: meta.visitRole === "visitor" ? "visitor" : "owner",
    ownerDisplayName: meta.ownerDisplayName ?? null
  });
});
const mcmMinigame = createMcm2026MinigameRuntime({
  roomScene: mcmRoomScene,
  player,
  client: mcmEvent,
  getRoomId: () => rooms.currentSpace,
  onInfo: () => mcmEventUi.openInfo(),
  onReward: result => {
    mcmEventUi.showReward(result);
    // The reward may have granted EXP server-side; re-read the authority (never computed here).
    if (result && result.status !== "PREVIEW") {
      void progression.refresh("reward");
      void wallet.refresh("reward");
      void inventory.refresh("reward");
      void loadout.refresh("reward");
    }
    if (result?.status === "REWARD_FAILED") showWorldStatusAfterReward("보상 정산을 다시 시도할 수 있어요.");
  }
});
const registry = new RenderChunkRegistry();
const chunkRenderer = new CampusChunkRenderer(app,campusRoot,registry,{
  getRainIntensity: () => environment.rainIntensity(),
  getArtificialLightFactor: () => environment.artificialLightFactor()
});
window.__INHAGAME_POND_WEATHER__ = Object.freeze({
  status: () => chunkRenderer.getPondWeatherStatus()
});
const streaming = new RenderChunkStreaming(registry,chunkRenderer,{intervalMs:250});
const inkyungSideEvent = createInkyungMechanicalDuckEvent();
if (previewHost && startupParams.get("inkyungDuckEvent") === "1") inkyungSideEvent.setUnlocked(true);
const inkyungDucks = createInkyungDuckSystem({
  app,
  root: campusRoot,
  player,
  forceMechanical: previewHost && startupParams.get("mechanicalDuck") === "1",
  canObserveOrdinary: () => inkyungSideEvent.canObserveOrdinaryDuck(),
  onOrdinaryObserved: duck => {
    const result = inkyungSideEvent.observeOrdinaryDuck(duck.kind);
    if (result.changed) showWorldStatus(`🦆 ${result.line} · 이제 수상한 오리를 찾아보자.`);
    return result;
  },
  onLoreFound: lore => {
    const eventResult = inkyungSideEvent.observeMechanicalDuck();
    showWorldStatus(eventResult.found
      ? `🔎 ${lore.title} 발견 · 가유담에게 돌아가자.`
      : `🦆 ${lore.title} 발견 · ${lore.detail}`);
  }
});
inkyungSideEvent.onChange(status => {
  if (status.requiresMechanicalDuck) inkyungDucks.ensureMechanicalDuck();
});
if (inkyungSideEvent.requiresMechanicalDuck()) inkyungDucks.ensureMechanicalDuck();
window.addEventListener("pagehide", event => { if (!event.persisted) inkyungDucks.destroy(); });
// Preview hosts can replay first discovery and BR01 with ?biryong=reset (progress kept in memory).
biryong = createBiryongSystem({
  app, root: campusRoot, player, camera, worldAudio,
  persist: !(previewHost && startupParams.get("biryong") === "reset"),
  onDiscovered: () => { minimap?.refreshPois?.(); fullMap?.refreshPois?.(); },
  onStatus: showWorldStatus,
  onProgress: snapshot => queueBiryongCloudSave(snapshot),
  onInputLockChange: (locked) => {
    if (locked) biryongScriptedInput.acquire();
    else biryongScriptedInput.release();
  }
});

async function mergeBiryongCloud(client, snapshot, migratedFromLocal = false) {
  const { data, error } = await client.rpc("merge_my_biryong_progress_v1", {
    p_progress: snapshot,
    p_migrated_from_local: Boolean(migratedFromLocal)
  });
  if (error) throw error;
  return data ?? null;
}

function queueBiryongCloudSave(snapshot) {
  const client = online?.supabase;
  if (!client || !snapshot) return false;
  const generation = biryongCloudGeneration;
  clearTimeout(biryongCloudSaveTimer);
  biryongCloudSaveTimer = setTimeout(() => {
    if (generation !== biryongCloudGeneration || client !== online?.supabase) return;
    void mergeBiryongCloud(client, snapshot).catch(error =>
      console.warn("Biryong account progress save failed; local cache retained:", error));
  }, 250);
  return true;
}

async function syncBiryongAccount(identity) {
  const userId = identity?.userId ?? null;
  const client = online?.supabase ?? null;

  if (!userId || !client) {
    // The first null identity is emitted before Auth resolution. Only reset to guest after a
    // previously resolved permanent account actually signs out.
    if (biryongResolvedAccountId !== null) {
      biryongCloudGeneration += 1;
      clearTimeout(biryongCloudSaveTimer);
      biryongCloudSaveTimer = null;
      biryongResolvedAccountId = null;
      biryong?.setLocalScope("guest");
      biryong?.setAccountSyncing(false);
      minimap?.refreshPois?.();
      fullMap?.refreshPois?.();
    }
    return null;
  }

  const generation = ++biryongCloudGeneration;
  clearTimeout(biryongCloudSaveTimer);
  biryongCloudSaveTimer = null;
  biryongResolvedAccountId = userId;
  biryong?.setAccountSyncing(true);
  const scope = biryong?.setLocalScope(`account:${userId}`, { adoptLegacy: true }) ??
    { migrated: false, reset: false };

  try {
    const { data, error } = await client.rpc("get_my_biryong_progress_v1");
    if (error) throw error;
    if (generation !== biryongCloudGeneration || userId !== biryongResolvedAccountId) return null;

    if (data) biryong?.mergeProgress(data, { notify: false });
    const merged = await mergeBiryongCloud(client, biryong?.progressSnapshot?.() ?? {}, scope.migrated);
    if (generation !== biryongCloudGeneration || userId !== biryongResolvedAccountId) return null;
    if (merged) biryong?.mergeProgress(merged, { notify: false });
    return merged;
  } catch (error) {
    console.warn("Biryong account progress sync failed; local cache retained:", error);
    return null;
  } finally {
    if (generation === biryongCloudGeneration && userId === biryongResolvedAccountId) {
      biryong?.setAccountSyncing(false);
      minimap?.refreshPois?.();
      fullMap?.refreshPois?.();
    }
  }
}
window.addEventListener("pagehide", event => { if (!event.persisted) biryong?.destroy(); });
worldLoading?.setPhase("STREAMING");
const viewSettings = createViewDistanceSettings(streaming,camera,graphics,{
  onOpenChange: (open) => {
    if (open) viewSettingsInput.acquire();
    else viewSettingsInput.release();
  }
});

// M3 navigation (graph → solver → guidance) is its own best-effort layer, independent of the
// quest/tour objective. Indoors it pauses; the campus destination survives room switches.
let navigation = null;
let campusNavigation = null;
let navigationHud = null;
const navigationSpaceId = () => lobbyWorld.active || lobbyTransition.active ? "lobby"
  : biryongRealm?.inBiryong ? WORLD_REGION_ID.BIRYONG_REALM
    : rooms?.insideRoom ? (rooms.status().roomId ?? "room") : CAMPUS_NAV_SPACE;
try {
  campusNavigation = createCampusNavigation();
  navigation = createNavigationState({ solver: campusNavigation.solver, guidanceSpaceId: CAMPUS_NAV_SPACE });
  navigationHud = createNavigationHud({
    root: document.getElementById("nav-guidance"),
    arrow: document.getElementById("nav-guidance-arrow"),
    title: document.getElementById("nav-guidance-title"),
    detail: document.getElementById("nav-guidance-detail"),
    cancelButton: document.getElementById("nav-guidance-cancel"),
    announcer: document.getElementById("nav-guidance-announcer"),
    onCancel: () => navigation?.clearDestination("cancel")
  });
} catch (error) {
  console.warn("INHAGAME Campus navigation unavailable; maps continue without routes:", error);
  navigation = null;
  navigationHud = null;
}

const autoMoveHud = document.getElementById("auto-move-hud");
const autoMoveHudTitle = document.getElementById("auto-move-title");
const autoMoveHudDetail = document.getElementById("auto-move-detail");
const autoMoveCancel = document.getElementById("auto-move-cancel");
const autoMoveResume = document.getElementById("auto-move-resume");
const canUseAutoMove = () => (!controller.mounted || controller.onGroundMount) && !seats.isSeated && !rooms?.insideRoom &&
  (biryongRealm?.inCampus ?? true) && !follow.active && !lobbyWorld.active && !lobbyTransition.active;
const renderPlayerAutoMoveHud = () => {
  if (!autoMoveHud) return false;
  const state = playerAutoMove?.snapshot?.() ?? null;
  const active = state?.active === true;
  const paused = state?.status === "PAUSED";
  const visible = active || paused;
  autoMoveHud.hidden = !visible;
  autoMoveHud.dataset.status = state?.status ?? "IDLE";
  if (visible) {
    if (autoMoveHudTitle) autoMoveHudTitle.textContent = `${state.destinationTitle} 자동이동`;
    if (autoMoveHudDetail) autoMoveHudDetail.textContent = paused ? "일시정지됨 · 현재 위치에서 재개"
      : state.status === "MOVING" ? (controller.onGroundMount ? "탈것으로 자동이동 중" : "자동으로 걷는 중") : "경로 준비 중";
    if (autoMoveCancel) autoMoveCancel.hidden = !active;
    if (autoMoveResume) autoMoveResume.hidden = !paused;
  }
  return visible;
};
const resumePlayerAutoMove = () => {
  if (!playerAutoMove?.paused || !navigation) return false;
  if (!canUseAutoMove()) {
    showWorldStatus(controller.mounted && !controller.onGroundMount
      ? "비행 탈것 자동이동은 아직 지원하지 않아요"
      : "지금은 자동이동을 재개할 수 없어요");
    return false;
  }
  const snapshot = navigation.getSnapshot();
  const target = snapshot?.destination;
  if (!target) return false;
  navigation.setDestination(target, { position: player.getLocalPosition(), spaceId: navigationSpaceId() });
  const resumed = playerAutoMove.resume(navigation.getSnapshot());
  if (!resumed) showWorldStatus("자동이동 경로를 다시 준비하지 못했어요");
  return resumed;
};
if (navigation) {
  playerAutoMove = createPlayerAutoMove({
    setAssist: intent => controller.setAssistedMovement(intent),
    clearAssist: () => controller.clearAssistedMovement(),
    requestReroute: target => {
      if (!navigation || !target) return false;
      navigation.setDestination(target, { position: player.getLocalPosition(), spaceId: navigationSpaceId() });
      return true;
    }
  });
  playerAutoMove.onChange((state, event) => {
    renderPlayerAutoMoveHud();
    npcTest?.observeAutoMove?.(state, event);
    if (event === "reroute") showWorldStatus("길이 막혀 경로를 다시 찾고 있어요");
    else if (event === "pause") showWorldStatus("자동이동을 일시정지했어요");
    else if (event === "resume") showWorldStatus("현재 위치에서 자동이동을 재개했어요");
    else if (event === "cancel" && state.cancelReason === AUTO_MOVE_CANCEL_REASON.STUCK) {
      showWorldStatus("길이 막혀 자동이동을 멈췄어요");
    }
  });
  navigation.onChange(snapshot => {
    playerAutoMove?.syncNavigation(snapshot);
    npcTest?.observeNavigation?.(snapshot);
    renderPlayerAutoMoveHud();
  });
  unbindAutoMoveManual = bindAutoMoveManualCancellation({
    autoMove: playerAutoMove,
    windowTarget: window,
    joystick: document.getElementById("joystick"),
    jumpButton: document.getElementById("jump"),
    descendButton: document.getElementById("descend"),
    shouldIgnoreEscape: () => worldActionsSuspended()
  });
  autoMoveCancel?.addEventListener("click", () => playerAutoMove?.pause(AUTO_MOVE_CANCEL_REASON.USER_CANCEL));
  autoMoveResume?.addEventListener("click", () => resumePlayerAutoMove());
  window.addEventListener("pagehide", event => { if (!event.persisted) unbindAutoMoveManual?.(); });
}
const renderNavigationHud = () => {
  try {
    navigationHud?.render(navigation?.getSnapshot() ?? null, {
      visible: !lobbyWorld.active && !lobbyTransition.active && (biryongRealm?.inCampus ?? true) && fullMap?.openState !== true
    });
  } catch (error) { console.warn("Navigation HUD render failed:", error); }
};
const setNavigationTarget = target => {
  if (!navigation || !target) return false;
  navigation.setDestination(target, { position: player.getLocalPosition(), spaceId: navigationSpaceId() });
  return true;
};
// Housing H3: a friend visit from the campus routes to 제1생활관 and starts auto-move when allowed.
const guideToDorm1 = () => {
  const target = campusNavigation?.poiTarget({
    poiId: "poi.dorm-1", title: "제1생활관",
    x: DORM_1_CAMPUS_RETURN.position.x, z: DORM_1_CAMPUS_RETURN.position.z
  }, CAMPUS_NAV_SPACE) ?? null;
  if (!setNavigationTarget(target)) return false;
  if (playerAutoMove && canUseAutoMove()) playerAutoMove.start(navigation.getSnapshot());
  return true;
};

const main2GuideNavigationTarget = () => campusNavigation?.poiTarget({
  poiId: "core15.main2-guide",
  title: MAIN2_GUIDE_NPC.name,
  x: MAIN2_GUIDE_NPC.position.x,
  z: MAIN2_GUIDE_NPC.position.z
}, CAMPUS_NAV_SPACE) ?? null;
nextDiscovery = createNextDiscovery({
  root: document.getElementById("next-discovery"),
  primaryButton: document.getElementById("next-discovery-primary"),
  onProgress: progress => questRuntime.update(progress),
  onPrimary: discovery => {
    if (discovery?.id !== "main2_back_gate_guide") return false;
    const started = setNavigationTarget(main2GuideNavigationTarget());
    if (!started) return false;
    core15Funnel?.nextDiscoveryClick();
    showWorldStatus("후문 안내 학생까지 길을 표시했어요.");
    return true;
  }
});

backGateArrival = createBackGateArrivalEvent({
  player, camera, controller, orbit,
  getQuestState: () => {
    const status = npcTest?.getStatus?.() ?? null;
    return status ? {
      main1Complete: status.quest?.complete === true,
      main2Available: status.main2Quest?.available === true,
      main2Stage: status.main2Quest?.stage ?? null
    } : null;
  },
  preview: previewHost && startupParams.get("backGateArrival") === "preview",
  onInputLockChange: (locked) => {
    if (locked) backGateArrivalInput.acquire();
    else backGateArrivalInput.release();
  },
  onStart: () => {
    if (playerAutoMove?.active) playerAutoMove.pause(AUTO_MOVE_CANCEL_REASON.INTERACTION);
    emoteMenu.setOpen(false);
    chatPanel.setOpen(false, { focus: false });
    hudMenu.setOpen(false, { focus: false });
    playerCard.close();
  }
});
window.addEventListener("pagehide", event => { if (!event.persisted) backGateArrival?.destroy(); });

const fullMapNavigation = navigation && campusNavigation ? {
  snapshot: () => navigation.getSnapshot(),
  canNavigate: mapSourceId => mapSourceId === CAMPUS_NAV_SPACE,
  setPoi: (poi, mapSourceId) => setNavigationTarget(campusNavigation.poiTarget(poi, mapSourceId)),
  setTarget: target => setNavigationTarget(target),
  resolveMapPoint: (point, mapSourceId) => campusNavigation.mapPointTarget(point, mapSourceId),
  clear: () => navigation.clearDestination("cancel"),
  onChange: listener => navigation.onChange(listener)
} : null;

// Mini-map / Full Map are best-effort HUD layers. Map failures must never block the 3D World.
let minimap = null;
let minimapReady = false;
let campusMapDataSource = null;
const getMapObjectiveMarker = () => {
  if (rooms?.insideRoom) return null;
  const eventTarget = mcmEventRuntime.mapTarget();
  const eventMarker = eventTarget ? {
    objectiveId: `event.${eventTarget.stage}`,
    x: eventTarget.x, z: eventTarget.z, kind: eventTarget.kind, label: eventTarget.label
  } : null;
  // An investigation the player started leads; an unstarted event invite yields to the main quest.
  if (eventMarker && eventTarget.stage !== "mcm.guide") return eventMarker;
  const questTarget = npcTest?.getMapObjective?.() ?? null;
  if (questTarget) return {
    objectiveId: `quest.${questTarget.stage}`,
    x: questTarget.x, z: questTarget.z, kind: questTarget.kind, label: questTarget.label
  };
  if (eventMarker) return eventMarker;
  const biryongTarget = biryong?.getMapObjective() ?? null;
  if (biryongTarget) return biryongTarget;
  const target = tour.target;
  return target ? {
    objectiveId: `tour.${target.id}`,
    x: target.x, z: target.z, kind: "destination", label: target.label
  } : null;
};
const getMapSocialMarkers = () => (rooms?.insideRoom || biryongRealm?.inBiryong) ? [] : (online?.miniMapRemotes?.() ?? [])
  .filter(remote => remote?.userId && remote?.pose && !social.isBlocked(remote.userId))
  .map(remote => ({
    markerId: `remote.${remote.sessionId}`,
    x: remote.pose.x, z: remote.pose.z,
    kind: social.relationshipOf(remote.userId) === Relationship.FRIENDS ? "friend" : "player"
  }));
try {
  campusMapDataSource = createMiniMapDataSource({
    spawnRegistry: lobbySpawnRegistry,
    getContext: spawnProgressContext,
    isPlaceDiscovered: id => biryong?.isPlaceDiscovered(id) === true
  });
  const minimapDataSource = campusMapDataSource;
  const minimapRenderer = createMiniMapRenderer({
    root: document.getElementById("minimap"),
    geometryLayer: document.getElementById("minimap-geometry"),
    poiLayer: document.getElementById("minimap-pois"),
    objectiveLayer: document.getElementById("minimap-objective"),
    socialLayer: document.getElementById("minimap-social"),
    playerLayer: document.getElementById("minimap-player"),
    compassLayer: document.getElementById("minimap-compass"),
    routeLayer: document.getElementById("minimap-route"),
    navigationLayer: document.getElementById("minimap-navigation"),
    documentLike: document
  });
  minimap = createMiniMapController({
    player, orbit,
    getReady: () => minimapReady,
    getLobbyState: () => ({ active: lobbyWorld.active, transitioning: lobbyTransition.active }),
    getRoomState: () => biryongRealm?.inBiryong
      ? { insideRoom: true, roomId: null }
      : rooms?.status?.() ?? { insideRoom: false },
    getOverlayState: () => ({
      hudMenu: hudMenu.open, keyboardHelp: keyboardHelp?.open === true, friends: friendPanel.open,
      playerCard: playerCard.current != null, guestbook: guestbookPanel.open, shop: shopPanel.open, inventory: inventoryPanel.open, wardrobe: wardrobePanel.open,
      blocking: furnitureEditor?.open === true || dailyQuizPanel.open || attendancePanel.open || questJournal?.open === true,
      npcConversation: npcTest?.isConversationOpen?.() === true,
      mcmEvent: mcmEventUi.openState || mcmEventRuntime.isDialogueOpen() === true,
      profile: document.getElementById("profile-panel")?.hidden === false,
      settings: document.getElementById("view-settings")?.hidden === false,
      fullMap: fullMap?.openState === true
    }),
    getObjectiveMarker: getMapObjectiveMarker,
    getSocialMarkers: getMapSocialMarkers,
    getNavigation: () => {
      const snapshot = navigation?.getSnapshot();
      return snapshot?.active && snapshot.destination?.mapSourceId === CAMPUS_NAV_SPACE ? snapshot : null;
    },
    dataSource: minimapDataSource, renderer: minimapRenderer,
    documentLike: document, windowTarget: window
  });
  fullMap = createFullMapController({
    root: document.getElementById("full-map-panel"),
    openButton: document.getElementById("minimap-open-map"),
    closeButton: document.getElementById("full-map-close"),
    surface: document.getElementById("full-map-surface"),
    svg: document.getElementById("full-map-svg"),
    markerLayer: document.getElementById("full-map-marker-layer"),
    geometryLayer: document.getElementById("full-map-geometry"),
    poiLayer: document.getElementById("full-map-pois"),
    playerMarker: document.getElementById("full-map-player"),
    objectiveMarker: document.getElementById("full-map-objective"),
    destinationMarker: document.getElementById("full-map-destination"),
    socialLayer: document.getElementById("full-map-social"),
    titleElement: document.getElementById("full-map-title"),
    infoPanel: document.getElementById("full-map-info"),
    infoTitle: document.getElementById("full-map-info-title"),
    infoMeta: document.getElementById("full-map-info-meta"),
    destinationButton: document.getElementById("full-map-set-destination"),
    clearDestinationButton: document.getElementById("full-map-clear-destination"),
    autoMoveButton: document.getElementById("full-map-auto-move"),
    canAutoMove: () => canUseAutoMove(),
    onAutoMove: snapshot => {
      const state = playerAutoMove?.snapshot?.();
      const samePausedDestination = playerAutoMove?.paused && state?.destinationId === snapshot?.destination?.id;
      const started = samePausedDestination ? playerAutoMove.resume(snapshot) : playerAutoMove?.start(snapshot) === true;
      if (!started) showWorldStatus("자동이동 경로를 준비하지 못했어요");
      return started;
    },
    isAutoMoveActive: selected => {
      const state = playerAutoMove?.snapshot?.();
      if (!state?.active) return false;
      const id = selected?.mapPoint ? selected.target?.id
        : selected?.poiId ? `poi:${selected.poiId}` : null;
      return state.destinationId === id;
    },
    isAutoMovePaused: selected => {
      const state = playerAutoMove?.snapshot?.();
      if (!playerAutoMove?.paused) return false;
      const id = selected?.mapPoint ? selected.target?.id
        : selected?.poiId ? `poi:${selected.poiId}` : null;
      return state?.destinationId === id;
    },
    zoomInButton: document.getElementById("full-map-zoom-in"),
    zoomOutButton: document.getElementById("full-map-zoom-out"),
    locateButton: document.getElementById("full-map-locate"),
    resetViewButton: document.getElementById("full-map-reset-view"),
    zoomLabel: document.getElementById("full-map-zoom-label"),
    routePath: document.getElementById("full-map-route"),
    pickMarker: document.getElementById("full-map-pick"),
    navBar: document.getElementById("full-map-nav"),
    navBarText: document.getElementById("full-map-nav-text"),
    navBarClear: document.getElementById("full-map-nav-clear"),
    navigation: fullMapNavigation,
    dataSource: minimapDataSource,
    getPlayerPosition: () => player.getLocalPosition(),
    getObjectiveMarker: getMapObjectiveMarker,
    getSocialMarkers: getMapSocialMarkers,
    onOpen: () => {
      fullMapInput.acquire();
      hudMenu.setOpen(false, { focus: false }); emoteMenu.setOpen(false);
      chatPanel.setOpen(false, { focus: false }); playerCard.close();
      void guestbookPanel.setOpen(false);
      shopPanel.setOpen(false);
      inventoryPanel.setOpen(false);
      wardrobePanel.setOpen(false);
      dailyQuizPanel.setOpen(false);
      attendancePanel.setOpen(false);
      questJournal?.setOpen(false);
    },
    onClose: () => { fullMapInput.release(); },
    documentLike: document, windowTarget: window
  });
  rooms.onChange((status) => {
    if (status.insideRoom && status.roomId) {
      const roomMap = createRoomMapDataSource(status.roomId);
      if (!roomMap) return;
      minimap?.setDataSource(roomMap, { id: roomMap.id, indoor: true, radiusWorld: roomMap.radiusWorld });
      fullMap?.setDataSource(roomMap, { id: roomMap.id, label: roomMap.label });
      return;
    }
    if (campusMapDataSource) {
      minimap?.setDataSource(campusMapDataSource, { id: "campus", indoor: false });
      fullMap?.setDataSource(campusMapDataSource, { id: "campus", label: "캠퍼스 전체 지도" });
    }
  });
  biryongRealm.onChange((status) => {
    if (status.inBiryong) {
      fullMap?.close?.();
      const minimapRoot = document.getElementById("minimap");
      if (minimapRoot) minimapRoot.hidden = true;
      return;
    }
    const minimapRoot = document.getElementById("minimap");
    if (minimapRoot) minimapRoot.hidden = false;
    if (campusMapDataSource) {
      minimap?.setDataSource(campusMapDataSource, { id: "campus", indoor: false });
      fullMap?.setDataSource(campusMapDataSource, { id: "campus", label: "캠퍼스 전체 지도" });
    }
  });
} catch (error) {
  console.warn("INHAGAME Campus map layer unavailable; continuing without it:", error);
}

// Quest Journal P1 consumes the shared Quest Runtime only. Existing quest clients remain the progress
// authorities; the journal never writes quest stages or rewards.
const questJournalButton = document.getElementById("open-quest-journal");
const navigateQuestObjective = (navigationTarget, quest) => {
  const poi = campusMapDataSource?.poiRegistry?.().get?.(navigationTarget) ?? null;
  const target = poi?.validPosition && campusNavigation
    ? campusNavigation.poiTarget(poi, CAMPUS_NAV_SPACE)
    : null;
  if (!target || !setNavigationTarget(target)) {
    showWorldStatus("이 목표의 길 안내를 시작하지 못했어요.");
    return false;
  }
  questJournal?.setOpen(false);
  showWorldStatus(`${quest?.title ?? "퀘스트"} 목표까지 길을 표시했어요.`);
  return true;
};
questJournal = createQuestJournal({
  panel: document.getElementById("quest-journal-panel"),
  runtime: questRuntime,
  onNavigate: navigateQuestObjective,
  onOpenChange: (open) => {
    questJournalButton?.setAttribute("aria-expanded", String(open));
    if (open) {
      questJournalInput.acquire();
      fullMap?.close?.();
      hudMenu.setOpen(false, { focus: false });
      shopPanel.setOpen(false);
      inventoryPanel.setOpen(false);
      wardrobePanel.setOpen(false);
      dailyQuizPanel.setOpen(false);
      attendancePanel.setOpen(false);
      emoteMenu.setOpen(false);
      chatPanel.setOpen(false, { focus: false });
      playerCard.close();
      void guestbookPanel.setOpen(false);
      return;
    }
    questJournalInput.release();
  }
});
questJournalButton?.addEventListener("click", () => questJournal.setOpen(true));

questHud = createTrackedQuestHud({
  root: document.getElementById("quest-hud"),
  openButton: document.getElementById("quest-hud-open"),
  headingElement: document.getElementById("quest-hud-heading"),
  objectiveElement: document.getElementById("quest-hud-objective"),
  bearingElement: document.getElementById("quest-hud-bearing"),
  runtime: questRuntime,
  getTarget: quest => npcTest?.getQuestMapObjective?.(quest.legacyProgressId) ?? null,
  getPlayerPosition: () => player.getLocalPosition(),
  getYaw: () => Number.isFinite(orbit?.yaw) ? orbit.yaw : 0,
  onOpenJournal: () => questJournal.setOpen(true)
});

window.addEventListener("keydown", (event) => {
  if (event.code !== "KeyQ" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
  if (lobbyWorld.active || lobbyTransition.active) return;
  event.preventDefault();
  questJournal.setOpen(!questJournal.open);
});

const accompanyClient = new AccompanyClient({
  getClient: () => online?.supabase ?? null, getSelfUserId: () => online?.userId ?? null
});
accompany = new AccompanyController({
  client: accompanyClient,
  getSelfUserId: () => online?.userId ?? null,
  getZoneId: () => rooms?.insideRoom ? null : online?.network?.placeZoneId ?? null,
  getRemote: userId => online?.remoteByUser(userId) ?? null,
  getPosition: () => player.getLocalPosition(),
  getMounted: () => controller.mounted,
  getSeated: () => seats.isSeated,
  relationshipOf: userId => social.relationshipOf(userId),
  verifyFriend: async userId => (await social.relationship(userId)) === Relationship.FRIENDS,
  follow,
  prepareFollow: () => { if (seats.isSeated) seating.standUp("accompany"); },
  resolveTarget: poiId => {
    const poi = campusMapDataSource?.poiRegistry().get(poiId);
    if (!campusNavigation || !navigation || !poi?.validPosition || poi.presentation !== "NORMAL") return null;
    return campusNavigation.poiTarget(poi);
  },
  navigation: {
    snapshot: () => navigation?.getSnapshot() ?? null,
    set: target => setNavigationTarget(target),
    clear: () => navigation?.clearDestination("accompany-end")
  },
  notify: showWorldStatus
});
const accompanyPanel = createAccompanyPanel({
  panel: document.getElementById("accompany-panel"), controller: accompany,
  getSelfUserId: () => online?.userId ?? null
});
accompany.onChange(() => playerCard.refresh());
rooms.onChange(status => { if (status.insideRoom && accompany.session) void accompany.end("room"); });
let npcAiSignedIn = false;
async function loadOptionalNpcRuntime() {
  if (!npcEnabled) return null;
  let npcAiEnabled = npcAiPilotMode;
  let npcJevEnabled = false;
  let npcQuestEnabled = npcTestMode || (npcPreviewMode && startupParams.get('backGateArrival') === 'preview');
  // CORE-15: each flag probe is bounded, so a slow AI flag never holds the NPCs or the first quest.
  // A transient quest-flag failure starts the NPCs with the quest off and turns it on once it resolves.
  let questFlagPending = false;
  if (npcProductionMode) {
    const [aiResult, questResult, jevResult] = await Promise.all([
      probeFeatureFlag('/api/npc-ai'),
      probeFeatureFlag('/api/world-quest'),
      probeFeatureFlag('/api/npc-dialogue-route')
    ]);
    npcAiEnabled = aiResult === FLAG_ENABLED;
    npcJevEnabled = jevResult === FLAG_ENABLED;
    npcQuestEnabled = questResult === FLAG_ENABLED;
    questFlagPending = questResult === FLAG_UNAVAILABLE;
  }
  try {
    const module = await import('../npc-factory/dev-runtime.mjs');
    const runtime = await module.createNpcDevRuntime({
      app, campusRoot, player, orbit,
      sharedSchedulePreview: npcSharedScheduleMode,
      onNpcTalk: (id, now) => online?.network?.setNpcTalk(id, now),
      getBusyNpcIds: now => busyNpcIds(online?.network?.remotes.inZone(online.network.placeZoneId) ?? [], now),
      production: npcSharedScheduleMode || npcProductionMode || npcPreviewMode || npcRosterPreviewMode || npcSocialPreviewMode || npcObservedConversationMode,
      socialEnabled: npcSocialMode,
      socialPreview: npcSocialPreviewMode,
      socialBehaviorPreview: npcSocialBehaviorPreviewMode,
      observedConversationEnabled: npcObservedConversationMode,
      isObservedConversationBlocked: () => !inputFocus.can('WORLD_ACTION') ||
        hudContext.snapshot().mode === 'COMBAT' || lobbyWorld.active || lobbyTransition.active ||
        rooms?.insideRoom === true || mcmEventUi.openState || mcmEventRuntime.isDialogueOpen() ||
        fullMap?.openState === true,
      externalContextAction: true,
      aiPilot: npcAiEnabled,
      aiEndpoint: npcAiPilotMode ? '/npc-ai/decide' : '/api/npc-ai',
      jevEnabled: npcJevEnabled,
      jevEndpoint: '/api/npc-dialogue-route',
      questEnabled: npcQuestEnabled,
      questEndpoint: npcTestMode ? '/npc-quest' : '/api/world-quest',
      sideEvent: inkyungSideEvent,
      // P9: TML observes accepted Main 2 server results and existing Wallet/Progression readbacks only.
      // It sends no request, owns no write and cannot block the legacy quest path.
      tmlShadowEnabled: true,
      getTmlShadowEconomicState: () => ({
        walletBalance: wallet.balance(),
        totalExp: progression.snapshot?.totalExp ?? null
      }),
      getDialogueWorldContext: () => {
        const env = environment.status();
        return {
          weather: env.targetWeather,
          environmentTime: env.targetTime,
          placeZoneId: online?.network?.placeZoneId ?? null
        };
      },
      // P1c / P1d: First Campus (badge + EXP) and Main2 (coin + EXP) completions carry the server Reward
      // result. Shown through the existing reward toast lane, then the authorities the entries touched
      // are re-read (never computed here); LEVEL UP follows the toast.
      onQuestStateChange: progress => {
        const next = nextDiscovery?.syncProgress(progress) ?? null;
        const main1 = progress?.quest ?? null;
        if (main1?.enabled === true && main1.signedIn === true && main1.ready === true &&
            Number.isInteger(main1.stage) && main1.stage >= 0 && main1.stage < 5) {
          core15Funnel?.firstGoalSeen();
          if (main1.stage > 0) core15Funnel?.questStarted();
        }
        if (next) core15Funnel?.nextGoalSeen();
      },
      onQuestReward: reward => {
        const firstCampusReward = reward.rewardId === FIRST_CAMPUS_REWARD_ID;
        const freshFirstCampusReward = firstCampusReward && reward.status === "SUCCESS" && reward.replayed !== true;
        if (firstCampusReward) core15Funnel?.firstReward();
        mcmEventUi.showReward(
          { status: reward.replayed ? "ALREADY_CLAIMED" : "CLAIMED", replayed: reward.replayed,
            rewardResult: { status: reward.status, entries: reward.entries } },
          freshFirstCampusReward ? { onShown: () => core15Funnel?.rewardSeen() } : undefined
        );
        void progression.refresh(freshFirstCampusReward ? "core15-first-campus-reward" : "reward");
        if (reward.entries.some(entry => entry.grantType === "CURRENCY")) void wallet.refresh("reward");
        if (reward.entries.some(entry => entry.grantType === "ITEM")) void inventory.refresh("reward");
        // Historical metric remains at settlement for continuity. Product CORE-15 completion is
        // emitted by core15-funnel-telemetry only after reward + growth + next-goal presentation.
        if (freshFirstCampusReward) core15Funnel?.coreLoopComplete();
      },
      getAiSession: async () => {
        const client = online?.supabase;
        if (!client || !online?.userId) return null;
        const { data, error } = await client.auth.getSession();
        const session = data?.session;
        return !error && session?.user?.id === online.userId && session.user.is_anonymous !== true
          ? session.access_token : null;
      },
      onConversationOpen: () => {
        npcDialogueInput.acquire();
        emoteMenu.setOpen(false);
        if (accompany?.active && accompany.session.inviteeId === online?.userId) void accompany.end("npc_dialogue");
      },
      onConversationClose: () => { npcDialogueInput.release(); }
    });
    npcTest = runtime;
    const initialQuestStatus = runtime.getStatus?.() ?? null;
    questRuntime.update(initialQuestStatus ? {
      quest: initialQuestStatus.quest,
      main2Quest: initialQuestStatus.main2Quest
    } : null);
    inkyungLivingMoment?.setNpcAvailable(true);
    npcTest?.setAiSignedIn?.(npcAiSignedIn);
    if (questFlagPending) {
      retryFeatureFlag('/api/world-quest', {
        onResolved: enabled => { if (enabled && npcTest === runtime) void runtime.setQuestEnabled(true); }
      });
    }
    npcTest?.observeNavigation?.(navigation?.getSnapshot?.() ?? null);
    const autoMoveSnapshot = playerAutoMove?.snapshot?.();
    if (autoMoveSnapshot) npcTest?.observeAutoMove?.(autoMoveSnapshot, autoMoveSnapshot.active ? 'ready' : 'sync');
    lobbyQuestHighlight.update();
    backGateLock.refresh();
    return runtime;
  } catch (error) {
    inkyungLivingMoment?.setNpcAvailable(false);
    console.warn('Campus NPC unavailable; continuing without NPCs:', error);
    return null;
  }
}
places.onPlaceZoneChanged((previous,next)=>{
  syncAudio();
  inkyungLivingMoment?.setZone(next?.id ?? null);
  if (!lobbyWorld.active && !lobbyTransition.active && next?.id) core15Funnel?.firstZoneArrival();
  if (!lobbyWorld.active && !lobbyTransition.active && next?.id === INKYUNG_LIVING_ZONE_ID) core15Funnel?.firstActivityStart();
  zoneEl.textContent=next?.displayName??'캠퍼스 외곽';
  app.fire('placeZoneChanged',previous,next);
  // Deployed analytics accepts only C01/C02/C03. Never send RC IDs to it.
  const legacy=legacyTelemetryTarget(next);
  if(!npcTestMode&&legacy&&legacy!==lastTrackedZone){
    lastTrackedZone=legacy;
    window.InhaHubTelemetry?.track('campus_zone_enter','campus',legacy);
  }
});

app.on("update", (dt) => {
  syncAudio();
  roomSession?.update(dt);
  if (rooms.currentSpace === "ROOM_PERSONAL_BASIC") {
    furnitureRefreshSeconds += dt;
    if (furnitureRefreshSeconds >= 15) { furnitureRefreshSeconds = 0; void roomFurniture?.refresh(); }
  } else furnitureRefreshSeconds = 0;
  if (audioDebug && performance.now() - lastAudioDebugAt > 250) {
    lastAudioDebugAt = performance.now();
    audioDebug.textContent = JSON.stringify(worldAudio?.status() ?? { degraded: true }, null, 2);
  }
  if (lobbyWorld.active || lobbyTransition.active) {
    inkyungLivingMoment?.setSuppressed(true);
    guestbookWorldLabel.hide();
    shopWorldLabel.hide();
    contextActions.set("student-center-shop", null);
    contextActions.set("backgate-transit", null);
    backgateTransitPanel.setOpen(false, { restoreFocus: false });
    lobbyPresenceSummary.update();
    lobbyQuestHighlight.update();
    backGateLock.refresh();
  }
  if (lobbyTransition.active) {
    helicopterFlightHud.update({ suppressed: true });
    const pos = player.getLocalPosition();
    lobbyTransition.update(Math.min(dt, 0.05));
    streaming.update(dt, pos);
    places.update(pos);
    minimap?.update();
    fullMap?.update();
    renderNavigationHud();
    return;
  }
  if (lobbyWorld.active) {
    helicopterFlightHud.update({ suppressed: true });
    const pos = player.getLocalPosition();
    lobbyWorld.update(Math.min(dt, 0.05));
    streaming.update(dt, pos);
    places.update(pos);
    minimap?.update();
    fullMap?.update();
    renderNavigationHud();
    return;
  }
  // Locomotion input and zone changes stand a seated player up before the controller moves.
  const inBiryong = biryongRealm?.inBiryong === true;
  const inside = rooms.insideRoom || inBiryong;
  inkyungLivingMoment?.setSuppressed(inside);
  // Follow reads human input first. Auto Move then contributes the same world-space assist contract;
  // neither system writes transforms, so PlayerController keeps all collision and existing motion.
  follow.update();
  playerAutoMove?.update(navigation?.getSnapshot() ?? null, player.getLocalPosition());
  if (!seating.beforeController()) controller.update(Math.min(dt, 0.05), orbit.yaw);
  helicopterFlightHud.update();
  orbit.setMounted(controller.mounted);
  character.setMounted(controller.mounted);
  character.setFirstPerson(orbit.firstPerson);
  // Locomotion outranks expression: moving, mounting or an incompatible jump ends the emote.
  const emote = emotes.update(locomotion());
  emoteMenu.setAvailable(!controller.mounted);
  character.update(Math.min(dt, 0.05), { ...locomotion(), emote, seated: seats.isSeated, poseOffsets: biryong?.poseOffsets() ?? null });

  const pos = player.getLocalPosition();
  if (!inside) {
    if (inkyungSideEvent.requiresMechanicalDuck()) inkyungDucks.ensureMechanicalDuck();
    inkyungDucks.update(Math.min(dt, 0.05), pos);
  }
  biryong?.update(dt, pos, { inside });
  backGateArrival?.update(dt, { inside });
  mcmEventRuntime.update(dt);
  mcmEventUi.update(dt);
  mcmMinigame.update(dt);
  // Inside a room the campus Place Zone, streaming and tour stay where the player left them.
  const place=inside?null:places.update(pos);
  accompany?.update();
  if (!inside) npcTest?.observePlace?.(place?.id, pos);
  if (!inside) core15Funnel?.observePlayerEncounter(getMapSocialMarkers(), pos);
  // P1 unified interaction contract: dialogue > seated/seat > mount.
  // Keyboard shortcuts remain active, but the mobile-visible label never leaks E/F/M hints.
  const nearbySeat = inside ? null : seating.refreshNearby();
  const guestbookAction = guestbookInteraction?.observe(pos, { blocked: inside || controller.mounted }) ?? null;
  guestbookWorldLabel.update({
    visible: !inside && !guestbookPanel.open,
    nearby: guestbookInteraction?.nearby === true && !controller.mounted,
    available: guestbook.available
  });
  contextActions.set("seat", seats.isSeated ? {
    icon: "🧍", label: "일어나기", shortcut: "F", priority: 280, pressed: true,
    trigger: () => toggleSeat()
  } : nearbySeat ? {
    icon: "🪑", label: "앉기", shortcut: "F", priority: 260, distance: nearbySeat.distance ?? 0,
    pressed: false, trigger: () => toggleSeat()
  } : null);
  contextActions.set("guestbook", guestbookAction);
  // Student Center shop entry: campus only, on foot, not while the shop is already open.
  const shopWorldAction = shopWorld.observe(pos, {
    blocked: inside || controller.mounted || shopPanel.open || lobbyWorld.active || lobbyTransition.active,
    placeZoneId: place?.id ?? null
  });
  shopWorldLabel.update({
    visible: !inside && !shopPanel.open && place?.id === STUDENT_CENTER_SHOP_ENTRY.placeZoneId,
    nearby: shopWorld.nearby,
    available: shopWorldAvailable()
  });
  contextActions.set("student-center-shop", shopWorldAction);
  if (inside || controller.mounted) backgateTransitPanel.setOpen(false, { restoreFocus: false });
  contextActions.set("backgate-transit", inBiryong ? null : backgateTransit.observe(pos, backgateTransitState()));
  contextActions.set("biryong-station-transit", inBiryong
    ? biryongStationTransit?.observe(pos, {
      grounded: controller.grounded,
      blocked: biryongRealm.busy || controller.mounted || seats.isSeated || !inputFocus.can("WORLD_ACTION")
    }) ?? null
    : null);
  contextActions.set("inkyung-duck", inside ? null : inkyungDucks.getContextAction(pos));
  contextActions.set("biryong", inside ? null : biryong?.getContextAction(pos, { blocked: controller.mounted || seats.isSeated }) ?? null);
  contextActions.set("mcm-event", inside ? null : mcmEventRuntime.contextAction());
  contextActions.set("mcm-minigame", rooms.currentSpace === MCM_2026_ROOM_ID ? mcmMinigame.contextAction() : null);
  // S1-C2: while following, the shared slot offers the stop (no separate Follow button).
  contextActions.set("follow", follow.active ? {
    icon: "👣", label: "친구 따라가기 중지", priority: FOLLOW_CONTEXT_PRIORITY, pressed: true,
    trigger: () => follow.stop(FollowStopReason.EXPLICIT)
  } : null);
  // Club Room P0 door: 🚪 동아리방 들어가기 outside, 🚪 본관으로 나가기 inside.
  if (inBiryong) {
    contextActions.set("room-door", null);
    contextActions.set("personal-room-door", null);
    contextActions.set("friend-room-knock", null);
  } else {
    contextActions.set("room-door", rooms.contextAction({ position: pos, grounded: controller.grounded, mounted: controller.mounted }));
    contextActions.set("personal-room-door", personalRoomInteraction?.contextAction({
      position: pos, grounded: controller.grounded, mounted: controller.mounted
    }) ?? null);
    contextActions.set("friend-room-knock", friendRoomVisit?.contextAction({
      position: pos, grounded: controller.grounded, mounted: controller.mounted
    }) ?? null);
  }
  contextActions.set("npc", inside ? null : npcTest?.getContextAction?.() ?? null);
  // Transport has its own slot: a nearby NPC and the bike are offered together (F and M).
  transportActions.set("mount", controller.getMountContextAction());
  const suspended = worldActionsSuspended();
  contextActions.setSuspended(suspended);
  transportActions.setSuspended(suspended);
  contextActions.refresh();
  transportActions.refresh();
  if (!inside && !npcTestMode && !firstPlayerMovement && ((pos.x-spawn.x)**2+(pos.z-spawn.z)**2) > 4) {
    firstPlayerMovement = true;
    core15Funnel?.firstMove();
    window.InhaGameEntry?.play();
  }
  resumeStore.maybeSave({
    position: pos,
    yawDeg: player.getLocalEulerAngles().y,
    cameraYaw: orbit.yaw,
    place,
    grounded: controller.grounded,
    mounted: controller.mounted,
    insideRoom: inside,
    regionId: biryongRealm?.regionId ?? WORLD_REGION_ID.CAMPUS,
    enabled: firstPlayerMovement && !npcTestMode
  });
  if (!inside) streaming.update(dt, pos);
  if (!inside && !npcTestMode) tour.update(pos, place?.id, orbit.yaw);
  if (!npcTestMode && tourWasIncomplete && !tourResultSent && tour.stage === TOUR_STOPS.length) {
    tourResultSent = true;
    if (window.InhaGameEntry?.result()) window.InhaGameEntry.clear();
  }
  orbit.apply(pos, character.eyeHeight);
  character.setCameraOccluded(orbit.localVisualOccluded);
  if (!inside) {
    biryong?.applyCamera();
    backGateArrival?.applyCamera();
  }
  profile.update(controller.mounted, character.nameplateHeight, orbit.firstPerson);
  try {
    navigation?.update({ position: pos, yaw: orbit.yaw, spaceId: navigationSpaceId() });
  } catch (error) { console.warn("Navigation update failed:", error); }
  minimap?.update();
  fullMap?.update();
  questHud?.update();
  renderNavigationHud();
  // Own chat bubble above the local nameplate; hidden in first person (the feed shows it).
  const say = online?.chat.ownBubble() ?? null;
  const showBubble = !!say && !orbit.firstPerson && !nameplateEl.hidden;
  if (showBubble) {
    if (localBubble.textContent !== say) localBubble.textContent = say;
    localBubble.style.left = nameplateEl.style.left;
    localBubble.style.top = `calc(${nameplateEl.style.top} - 26px)`;
  }
  localBubble.hidden = !showBubble;
});

// Online P0 observes the local player after it moves; any failure leaves the World offline.
worldLoading?.setPhase("ONLINE");
try {
  online = startWorldOnline({
    app, places, player, controller,
    createAvatar: createRemoteAvatarFactory({ app, parent: campusRoot, camera, canvas,
      // Tapping a nameplate inspects that player; never while typing a chat message.
      onInspect: (sessionId) => { if (!chatPanel.open) void playerCard.open(sessionId); } }),
    moderation: { check: () => ({ ok: true }), isBlocked: (userId) => social.isBlocked(userId) },
    hudElement: document.getElementById("online-status"),
    isSeated: () => seats.isSeated
  });
  online.setLocalEquipment(loadout.accountId, publicEquipmentFor(loadout, loadout.accountId));
  // Nickname authority: the INHAGAME profile via the online identity; guests show 인덕이.
  online.onIdentity((identity) => {
    void syncBiryongAccount(identity);
    void progression.setAccount(identity ? online?.userId ?? null : null);
    shop.setAccount(identity ? online?.userId ?? null : null);
    void wallet.setAccount(identity ? online?.userId ?? null : null);
    void inventory.setAccount(identity ? online?.userId ?? null : null);
    void dailyQuiz.setAccount(identity ? online?.userId ?? null : null);
    void attendance.setAccount(identity ? online?.userId ?? null : null);
    void loadout.setAccount(identity ? online?.userId ?? null : null);
    const nextRoomUserId = online?.userId ?? null;
    inkyungSideEvent.setScope(nextRoomUserId ?? "guest");
    const roomIdentityChanged = lastPersonalRoomUserId !== null && nextRoomUserId !== lastPersonalRoomUserId;
    if (!identity || roomIdentityChanged) roomSession?.stop();
    if (!identity || roomIdentityChanged) roomFurniture?.reset();
    if ((!identity || roomIdentityChanged) && rooms?.currentSpace === "ROOM_PERSONAL_BASIC") {
      rooms.exit({ force: true });
    }
    personalRoom.reset();
    lastPersonalRoomUserId = nextRoomUserId;
    npcAiSignedIn = !!identity;
    void mcmEvent.setSignedIn(npcAiSignedIn || mcmEventPreviewMode);
    npcTest?.setAiSignedIn(npcAiSignedIn);
    profile.setIdentity(identity);
    lobbyPlayerSummary.render();
    chatPanel.refreshAvailability();
    friendPanel.setAvailable(!!identity);
    nearbyPanel.render();
    guestbookPanel.setAvailable(!!identity);
    if (identity) {
      void accompany.refresh();
      void social.mine()
        .then(data => lobbyPresenceSummary.setFriends(data.friends))
        .catch(() => lobbyPresenceSummary.setFriends(null));
    } else {
      accompany.reset();
      nearbyPanel.setOpen(false);
      lobbyPresenceSummary.setFriends(null);
      follow.stop(FollowStopReason.OFFLINE);
      social.reset();
      playerCard.close();
    }
    lobbyPresenceSummary.update();
  });
  online.chat.feed.onChange((entries) => chatPanel.renderFeed(entries));
  online.onRemoteTeleport((userId) => {
    follow.notifyTeleport(userId);
    if (accompany?.peerId === userId) void accompany.end("teleport");
  });
} catch (error) {
  console.warn("INHAGAME Campus online layer unavailable; continuing offline:", error);
}

// World-wide population telemetry is independent from signed-in Realtime Presence so guests count too.
// It never affects gameplay; if telemetry is unavailable the World continues normally.
try {
  const populationClient = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  populationHeartbeat = startWorldPopulationHeartbeat({
    client: populationClient,
    getSnapshot: () => ({
      placeZoneId: rooms.insideRoom ? null : places.getCurrentPlaceZone()?.id ?? null,
      space: rooms.insideRoom
        ? rooms.room?.type === "housing_lobby" ? "housing_lobby"
          : rooms.room?.type === "personal" ? "personal_room"
          : "club_room"
        : lobbyWorld.active ? "lobby" : "campus"
    })
  });
  const startPopulationCount = () => {
    if (populationCount) return populationCount;
    populationCount = startWorldPopulationCount({
      client: populationClient,
      onChange: () => lobbyPresenceSummary.update()
    });
    lobbyPresenceSummary.update();
    return populationCount;
  };
  if (populationHeartbeat?.initialPulse?.finally) {
    void populationHeartbeat.initialPulse.finally(startPopulationCount);
  } else {
    startPopulationCount();
  }
} catch (error) {
  console.warn("INHAGAME Campus population heartbeat unavailable:", error);
}
window.addEventListener("pagehide", event => {
  if (!event.persisted) populationCount?.stop();
});

streaming.update(1, player.getLocalPosition());
worldLoading?.setEssentialReady(true);
minimapReady = true;
minimap?.update({ force: true });
if (roomPreviewStart) rooms.enter("ROOM_CLUBHOUSE_01");
if (dormLobbyPreviewStart) rooms.enter("ROOM_DORM1_LOBBY");
if (mcmMinigamePreviewStart) rooms.enter(MCM_2026_ROOM_ID);
if (personalRoomPreviewStart) {
  const off = rooms.onChange((state, event) => {
    if (event !== "enter" || state.roomId !== "ROOM_DORM1_LOBBY") return;
    off();
    setTimeout(() => rooms.enterNested("ROOM_PERSONAL_BASIC", {
      fromRoomId: "ROOM_DORM1_LOBBY",
      returnPosition: DORM_1_LOBBY_MY_ROOM_RETURN.position,
      returnYaw: DORM_1_LOBBY_MY_ROOM_RETURN.yaw
    }), ROOM_TRANSITION_COOLDOWN_MS + 20);
  });
  rooms.enter("ROOM_DORM1_LOBBY");
}
if (lobbyWorld.active) {
  places.update(player.getLocalPosition());
  lobbyWorld.update(0);
} else {
  if (!npcTestMode) tour.update(player.getLocalPosition(), places.update(player.getLocalPosition())?.id, orbit.yaw);
  else places.update(player.getLocalPosition());
  orbit.apply(player.getLocalPosition(), character.eyeHeight);
  character.setCameraOccluded(orbit.localVisualOccluded);
  profile.update(false, character.nameplateHeight);
}

const bootDegraded = !online;
worldLoading?.finish({ degraded: bootDegraded });
void loadOptionalNpcRuntime();
if (campusLifePreview) {
  import('../npc-factory/purposeful-student-runtime.mjs')
    .then(module => module.createPurposefulStudentRuntime({
      app, campusRoot, player, orbit, isInsideRoom: () => rooms.insideRoom
    }))
    .catch(error => console.warn('Campus student prototype unavailable:', error));
}

let editorWorldStatus = editorWorldRequested ? { state: 'loading' } : null;
const editorWorldLabel = editorWorldRequested ? document.createElement('output') : null;
if (editorWorldLabel) {
  editorWorldLabel.className = 'editor-world-runtime-status';
  editorWorldLabel.setAttribute('role', 'status');
  editorWorldLabel.textContent = 'Saved Editor World · loading';
  document.body.append(editorWorldLabel);
}
if (editorWorldRequested) {
  void (async () => {
    const [
      { EditorBrowserStore },
      { loadWorldDocument },
      { createPlayCanvasRuntimeContext, createSceneRegistries },
      { createEditorAssetResolver, revokeEditorAssetUrls }
    ] = await Promise.all([
      import('./editor/editor-browser-store.js'),
      import('./runtime-adapter/load-world.js'),
      import('./runtime-adapter/playcanvas-context.js'),
      import('./editor/editor-model-import.js')
    ]);
    const store = await EditorBrowserStore.open();
    const text = await store.readLatestCanonical();
    if (!text) throw new Error('R_EDITOR_WORLD_NOT_SAVED');
    const parsed = JSON.parse(text);
    const registries = createSceneRegistries();
    const objectUrls = new Set();
    const context = createPlayCanvasRuntimeContext({
      app,
      parent: campusRoot,
      registries,
      assetShadow: assetOptimizationShadow,
      resolveAssetUri: createEditorAssetResolver({ store, worldId: parsed.worldId, objectUrls })
    });
    const runtime = await loadWorldDocument(text, context);
    if (runtime.state === 'fatal') { context.dispose(); throw new Error(runtime.diagnostics[0]?.code || 'R_WORLD_FATAL'); }
    editorWorldStatus = { state: runtime.state, worldId: runtime.worldId, entities: runtime.bindings.size, diagnostics: runtime.diagnostics, registries, runtime };
    editorWorldLabel.textContent = `Saved Editor World · ${runtime.state} · ${runtime.bindings.size} entities · ${runtime.diagnostics.length} diagnostics`;
    window.addEventListener('pagehide', () => {
      void runtime.dispose().finally(() => {
        context.dispose();
        revokeEditorAssetUrls(objectUrls);
      });
    }, { once: true });
  })().catch(error => {
    editorWorldStatus = { state: 'fatal', error: String(error) };
    editorWorldLabel.textContent = `Saved Editor World · fatal · ${error.message}`;
    console.warn('Saved Editor World could not be loaded:', error);
  });
}

if (!npcTestMode) {
  core15Funnel?.startSession();
  window.InhaHubTelemetry?.track("campus_boot_ready", "campus");
  window.InhaGameEntry?.landing();
}
window.__INHAGAME_P0__ = {
  app,
  player,
  equipmentProjection: Object.freeze({ status: () => equipmentProjection.status() }),
  controller,
  orbit,
  registry,
  places,
  getPlaceZoneAt:position=>(biryongRealm?.inCampus ?? true)?places.getPlaceZoneAt(position):null,
  getCurrentPlaceZone:()=>(biryongRealm?.inCampus ?? true)?places.getCurrentPlaceZone():null,
  onPlaceZoneChanged:listener=>places.onPlaceZoneChanged(listener),
  streaming,
  viewSettings,
  graphics,
  minimap,
  fullMap,
  navigation,
  campusNavigation,
  online,
  emotes,
  emoteMenu,
  chatPanel,
  hudMenu,
  keyboardHelp,
  social,
  playerCard,
  friendPanel,
  nearbyPanel,
  accompany,
  accompanyPanel,
  guestbook,
  guestbookPanel,
  guestbookInteraction,
  guestbookObject,
  guestbookWorldLabel,
  shopPanel,
  inventoryPanel,
  wardrobePanel,
  dailyQuiz,
  dailyQuizPanel,
  attendance,
  attendancePanel,
  shopWorld,
  shopWorldLabel,
  backgateTransit,
  backgateTransitPanel,
  biryongRealm,
  biryongStationTransit,
  seats,
  seating,
  follow,
  rooms,
  personalRoom,
  personalRoomInteraction,
  roomSession,
  friendRoomVisit,
  knockPrompt,
  friendRoomVisitClient,
  roomHud,
  roomFurniture,
  furnitureEditor,
  worldAudio,
  clubRoom,
  mcmEvent,
  mcmEventUi,
  mcmEventRuntime,
  mcmRoomScene,
  mcmMinigame,
  contextActions,
  transportActions,
  interactionAction,
  transportAction,
  character,
  lobbyWorld,
  mainGateEntry,
  resumeStore,
  resumeEntry,
  backGateLock,
  lobbyTransition,
  lobbyMenu,
  lobbyPlayerSummary,
  lobbyPresenceSummary,
  lobbyQuestHighlight,
  lobbyDailyLoop,
  lobbySpawnRegistry,
  worldLoading,
  getStatus: () => ({
    renderer: rendererName,
    graphics: graphics.status(),
    editorWorld: editorWorldStatus && {
      state: editorWorldStatus.state,
      worldId: editorWorldStatus.worldId ?? null,
      entities: editorWorldStatus.entities ?? 0,
      diagnostics: editorWorldStatus.diagnostics ?? [],
      error: editorWorldStatus.error ?? null
    },
    loading: worldLoading?.status?.() ?? null,
    lobby: lobbyWorld.status(),
    resume: resumeStore.read(),
    backGateLock: { open: backGateLock.open, ...backGateLock.definition },
    lobbyTransition: lobbyTransition.status(),
    lobbyMenuOpen: lobbyMenu.open,
    lobbyPlayer: lobbyPlayerSummary.status(),
    lobbyPresence: lobbyPresenceSummary.status(),
    lobbyQuest: lobbyQuestHighlight.status(),
    lobbyDailyLoop: lobbyDailyLoop.status(),
    lobbyReadiness: {
      state: lobbyPresenceSummary.status().degraded || lobbyQuestHighlight.health().degraded
        ? "DEGRADED_READY" : "READY",
      presenceDegraded: lobbyPresenceSummary.status().degraded,
      questDegraded: lobbyQuestHighlight.health().degraded
    },
    lobbySpawns: lobbySpawnRegistry.status(spawnProgressContext()),
    activeZone: places.getCurrentPlaceZone()?.id ?? null, // Transitional debug alias only.
    placeZone: places.getCurrentPlaceZone()?.id ?? null,
    audio: worldAudio?.status() ?? { context: "unavailable", degraded: true },
    renderChunks: streaming.snapshot(),
    streamingMetrics: streaming.getMetrics(),
    viewDistance: viewSettings.current.id,
    minimap: (() => { try { return minimap?.status() ?? null; } catch { return null; } })(),
    fullMap: (() => { try { return fullMap?.status() ?? null; } catch { return null; } })(),
    navigation: (() => {
      try {
        const s = navigation?.getSnapshot();
        return s ? {
          status: s.status, destinationId: s.destination?.id ?? null, title: s.destination?.title ?? null,
          mapSourceId: s.destination?.mapSourceId ?? null, routeMode: s.routeMode, routeVersion: s.routeVersion,
          waypointIndex: s.waypointIndex, waypointCount: s.waypointCount, remainingDistance: s.remainingDistance,
          guidanceBearing: s.guidanceBearing, offRoute: s.offRoute, rerouteCount: s.rerouteCount,
          hudVisible: navigationHud?.visible ?? false
        } : null;
      } catch { return null; }
    })(),
    online: (() => { try { return online?.status() ?? null; } catch { return null; } })(),
    populationHeartbeat: (() => { try { return populationHeartbeat?.status() ?? null; } catch { return null; } })(),
    populationCount: (() => { try { return populationCount?.status() ?? null; } catch { return null; } })(),
    emote: emotes.active,
    seat: seats.seated?.id ?? null,
    follow: follow.status(),
    space: rooms.currentSpace,
    contextAction: contextActions.active?.id ?? null,
    transportAction: transportActions.active?.id ?? null,
    guestbook: {
      nearby: guestbookInteraction?.nearby ?? false,
      open: guestbookPanel.open,
      available: guestbook.available
    },
    personalRoom: rooms.currentSpace === "ROOM_PERSONAL_BASIC"
      ? { active: true, session: roomSession?.status() ?? null, sessionStats: roomSession?.stats ?? null, furniture: roomFurniture?.state() ?? null }
      : { active: false, sessionStats: roomSession?.stats ?? null },
    mcm2026: {
      preview: mcmEventPreviewMode,
      client: mcmEvent.status(),
      runtime: mcmEventRuntime.status(),
      minigame: mcmMinigame.status()
    },
    movementHud: controller.hudState ?? null,
    progression: progression.status(),
    shop: { ...shop.status(), ...shopPanel.status(), world: shopWorld.status() },
    backgateTransit: { ...backgateTransit.status(), ...backgateTransitPanel.status() },
    worldRegion: biryongRealm?.status() ?? { regionId: WORLD_REGION_ID.CAMPUS },
    biryongStationTransit: biryongStationTransit?.status() ?? null,
    wallet: wallet.status(),
    inventory: { ...inventory.status(), ...inventoryPanel.status() },
    dailyQuiz: { ...dailyQuiz.status(), panel: dailyQuizPanel.status() },
    attendance: { ...attendance.status(), panel: attendancePanel.status() },
    wardrobe: { ...loadout.status(), ...wardrobePanel.status() },
    equipment: equipmentProjection.status(),
    hudMenuOpen: hudMenu.open,
    keyboardHelpOpen: keyboardHelp?.open ?? false,
    pointerLock: pointerLock.status(),
    pointerLockHint: pointerLockHint.status(),
    cameraInput: cameraInputSettings.current,
    inputFocus: {
      ...inputFocus.snapshot(),
      owners: {
        chat: chatFocusClaim != null,
        hudMenu: hudMenuInput.active,
        keyboardHelp: keyboardHelpInput.active,
        fullMap: fullMapInput.active,
        shop: shopInput.active,
        backgateTransit: backgateTransitInput.active,
        biryongRegionTransition: biryongRegionTransitionInput.active,
        inventory: inventoryInput.active,
        wardrobe: wardrobeInput.active,
        dailyQuiz: dailyQuizInput.active,
        attendance: attendanceInput.active,
        npcDialogue: npcDialogueInput.active,
        mcmDialogue: mcmDialogueInput.active,
        biryongScripted: biryongScriptedInput.active,
        lobbyWorld: lobbyWorldInput.active,
        lobbyTransition: lobbyTransitionInput.active,
        profile: profileInput.active,
        viewSettings: viewSettingsInput.active,
        friendPanel: friendPanelInput.active,
        nearbyPanel: nearbyPanelInput.active,
        playerCard: playerCardInput.active,
        guestbook: guestbookInput.active,
        roomTransition: roomTransitionInput.active,
        backGateArrival: backGateArrivalInput.active,
        mcmEventInfo: mcmEventInfoInput.active
      }
    },
    position: player.getLocalPosition().toString(),
    nickname: profile.nickname,
    mounted: controller.mounted,
    characterModel: character.modelState,
    assetProductionCanary: {
      ...assetProductionCanary.status(),
      remote: assetCanaryRemoteControl.status(),
      remoteState: assetCanaryRemoteStateCurrent,
      telemetry: assetCanaryTelemetry.status(),
      character: character.assetCanary ?? null
    },
    landing: controller.landing,
    tourStage: tour.stage,
    npcTest: (() => { try { return npcTest?.getStatus?.() ?? null; } catch { return null; } })(),
    campusLife: window.__CAMPUS_LIFE_P0A__?.getStatus?.() ?? null,
    landmarks: LANDMARKS,
    camera: { yaw: orbit.yaw, pitch: orbit.pitch, distance: orbit.distance, firstPerson: orbit.firstPerson, zoomLimits: orbit.zoomLimits }
  })
};

}

boot().catch((error) => {
  const unsupported = error instanceof GraphicsUnavailableError;
  worldLoading?.fail(
    unsupported ? "이 환경에서는 INHA WORLD 3D 렌더링을 사용할 수 없습니다." : "월드를 시작하지 못했습니다.",
    unsupported ? "브라우저와 그래픽 드라이버를 최신 상태로 업데이트한 뒤 다시 시도해 주세요." : undefined
  );
  window.InhaHubTelemetry?.track("campus_boot_error", "campus");
  window.InhaGameEntry?.error();
  rendererEl.textContent = "사용 불가";
  zoneEl.textContent = "초기화 실패";
  const hint = document.querySelector("#hud .hint");
  hint.textContent = unsupported
    ? "이 환경에서는 INHA WORLD 3D 렌더링을 사용할 수 없습니다. 브라우저와 그래픽 드라이버를 최신 상태로 업데이트한 뒤 다시 시도해 주세요."
    : "3D 화면을 시작하지 못했습니다. 네트워크 연결을 확인해 주세요.";
  hint.setAttribute("role", "alert");
  hint.style.display = "block";
  hint.style.opacity = "1";
  hint.style.color = "#ffcece";
  hint.style.maxWidth = "320px";
  window.__INHAGAME_P0__ = {
    getStatus: () => ({
      renderer: "UNAVAILABLE",
      activeZone: null,
      zones: null,
      position: null,
      error: String(error)
    })
  };
  if (unsupported) console.warn("INHAGAME Campus WebGPU unavailable:", error);
  else console.error("INHAGAME Campus initialization failed:", error);
});



