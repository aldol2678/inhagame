import assert from "node:assert/strict";
import { BUILDINGS, MAIN_ENTRANCE, HALL_FRONT } from "./src/basic-campus.js";
import { LANDMARKS, OBSTACLES, TOUR_STOPS } from "./src/campus-layout.js";
import { ZoneRegistry } from "./src/zone-registry.js";
import { getPlaceZoneAt } from './src/place-zone-registry.js';
import { moveAroundObstacles, resolveHeight, cameraSafeFraction } from "./src/world-collision.js";
import { createCampusTour } from "./src/campus-tour.js";
import { selectContextAction } from "./src/context-action.js";
import { movementHudState, MOVEMENT_HUD_STATES } from "./src/player-controller.js";
import { createHelicopterFlightState, HELICOPTER_FLIGHT_LIMITS, stepHelicopterFlight } from "./src/mounts/helicopter-flight.js";
import { createLobbyPresenceSummary } from "./src/lobby/lobby-presence-summary.js";
import { createLobbyQuestHighlight } from "./src/lobby/lobby-quest-highlight.js";
import { createSpawnRegistry, SPAWN_ID } from "./src/lobby/spawn-registry.js";
import { enterMainGate } from "./src/lobby/lobby-main-gate.js";
import { DORM_1_CAMPUS_RETURN, DORM_1_ENTRANCE } from "./src/dorm1-layout.js";
import { DORM_1_LOBBY_ENTRANCE, ROOMS } from "./src/rooms/room-registry.js";
import { createRoomTransition } from "./src/rooms/room-transition.js";
import { DORM_1_LOBBY_MY_ROOM_RETURN } from "./src/rooms/dorm1-lobby-layout.js";
import { readFileSync } from "node:fs";
import "./npc-factory/tests-purposeful-student.mjs";
import "./npc-factory/tests-purposeful-roster.mjs";
import "./npc-factory/tests-npc-campus-life.mjs";

const playerControllerSource = readFileSync(new URL("./src/player-controller.js", import.meta.url), "utf8");
assert.ok(Math.hypot(DORM_1_CAMPUS_RETURN.position.x - DORM_1_ENTRANCE.position.x,
  DORM_1_CAMPUS_RETURN.position.z - DORM_1_ENTRANCE.position.z) > DORM_1_ENTRANCE.radius);
assert.equal(ROOMS.ROOM_DORM1_LOBBY.type, "housing_lobby");
assert.equal(ROOMS.ROOM_PERSONAL_BASIC.type, "personal");
const dormRoomsQa = createRoomTransition({ world: {} });
assert.equal(dormRoomsQa.contextAction({ position: DORM_1_LOBBY_ENTRANCE.position, mounted: true }), null);
assert.equal(dormRoomsQa.contextAction({ position: DORM_1_LOBBY_ENTRANCE.position })?.label, "제1생활관 들어가기");
assert.ok(Number.isFinite(DORM_1_LOBBY_MY_ROOM_RETURN.position.x));
const campusBikeWorldSource = readFileSync(new URL("./src/mounts/campus-bike-world.js", import.meta.url), "utf8");
const campusBikeRiderSource = readFileSync(new URL("./src/mounts/campus-bike-rider.js", import.meta.url), "utf8");
const campusHelicopterWorldSource = readFileSync(new URL("./src/mounts/campus-helicopter-world.js", import.meta.url), "utf8");
const campusHelicopterRiderSource = readFileSync(new URL("./src/mounts/campus-helicopter-rider.js", import.meta.url), "utf8");
const mountKindsSource = readFileSync(new URL("./src/mounts/mount-kinds.js", import.meta.url), "utf8");
const protocolSourceForMounts = readFileSync(new URL("./src/network/protocol.js", import.meta.url), "utf8");
const campusChunkRendererSource = readFileSync(new URL("./src/campus-chunk-renderer.js", import.meta.url), "utf8");
const gateBlockoutSource = readFileSync(new URL("./src/gate-blockout.js", import.meta.url), "utf8");
const npcRuntimeSource = readFileSync(new URL("./npc-factory/dev-runtime.mjs", import.meta.url), "utf8");
const npcDimensionsSource = readFileSync(new URL("./npc-factory/npc-dimensions.mjs", import.meta.url), "utf8");
assert.match(npcRuntimeSource, /\.npc-test-tag\{[^}]*scale\(\.88\)[^}]*transform-origin:50% 100%/, "NPC nameplates stay 12% visually reduced and bottom-anchored");
assert.match(npcRuntimeSource, /\.npc-test-tag::after\{[^}]*content:attr\(data-status\)[^}]*font:650 9px/s,
  "NPC activity is a subordinate status line instead of duplicating the name in one long pill");
assert.match(npcRuntimeSource, /label\.dataset\.status = action;/,
  "purposeful NPC activity is projected through the status line");
assert.match(npcRuntimeSource, /id: 'npc-talk'[\s\S]{0,160}compactLabel: '대화'[\s\S]{0,80}shortcut: 'F'/,
  "mobile NPC interaction uses the compact 대화 action while preserving the F authority");
assert.match(npcDimensionsSource, /NPC_NAMEPLATE_MODEL_Y = 2\.46;/, "NPC nameplates keep the tightened head gap");
assert.match(playerControllerSource, /label:\s*this\.mountBlocked\s*\?\s*"넓은 곳에서 탑승하세요"\s*:\s*"탈것 탑승"/,
  "mount prompt uses generic 탈것 탑승 copy");
assert.doesNotMatch(playerControllerSource, /"비룡 탑승"/, "generic mount prompt does not hard-code the current dragon");
assert.match(campusBikeWorldSource, /rideable:\s*true/,
  "campus bike remains a rideable ground mount");
assert.match(campusBikeWorldSource, /export function setCampusBikePropVisible/,
  "campus bike exposes parked-prop visibility control");
assert.match(gateBlockoutSource, /setCampusBikePropRoot\(holder\)/,
  "gate blockout registers the parked bike root for hide-on-board");
assert.match(campusBikeRiderSource, /export function attachRiderBike/,
  "rider bike visual module remains available to character-model");
assert.match(campusBikeRiderSource, /root\.setLocalPosition\(0, -PLAYER_ORIGIN_Y, 0\)/,
  "rider bike is ground-anchored relative to the player origin");
assert.match(campusBikeRiderSource, /WHEEL_SEGMENTS = 18/,
  "rider bike wheels use smoother segmented rings");
assert.match(campusBikeRiderSource, /AXLE_Y = 0\.22/,
  "rider bike wheel axle keeps a small visual ground-clearance margin");
assert.match(campusBikeRiderSource, /rear_wheel[\s\S]*spoke|name}_spoke_/,
  "rider bike wheels expose spokes instead of filled wheel discs");
assert.match(campusBikeRiderSource, /function wireBasket/,
  "rider bike uses an open wire basket instead of a solid cube");
assert.match(playerControllerSource, /CAMPUS_OBSTACLES_WITHOUT_BIKE/,
  "bike movement excludes the parked bike collider after boarding");

// Helicopter P0: stadium prop, assisted flight dynamics, mount wire and player integration.
assert.match(campusHelicopterWorldSource, /fac_stadium/,
  "helicopter spawn derives from the authoritative stadium facility");
assert.match(campusHelicopterWorldSource, /rideable:\s*true/,
  "stadium helicopter is a rideable mount");
assert.match(campusHelicopterWorldSource, /export function parkCampusHelicopterAt/,
  "dismount can park the shared helicopter at its landing site");
assert.match(campusHelicopterRiderSource, /mainAngle = \(mainAngle \+ step \* 900\) % 360/,
  "helicopter rider visual spins the main rotor");
assert.match(campusChunkRendererSource, /buildCampusHelicopter\(base\)/,
  "persistent campus base renders the parked helicopter");
assert.match(protocolSourceForMounts, /HELICOPTER:\s*"helicopter"/,
  "helicopter is an optional protocol-v1 mount kind");
assert.match(mountKindsSource, /Mount\.HELICOPTER/,
  "local and remote mount mapping understands the helicopter");
assert.match(playerControllerSource, /HELICOPTER_CONTEXT_PRIORITY = 330/,
  "parked helicopter wins the shared interaction slot at close range");
assert.match(playerControllerSource, /label:\s*this\.grounded \? "헬리콥터에서 내리기" : "자동 착륙"/,
  "helicopter context action distinguishes ground dismount from airborne landing");
assert.match(playerControllerSource, /pitch:\s*z,[\s\S]*roll:\s*x,[\s\S]*yaw:\s*yawInput,[\s\S]*collective,/s,
  "helicopter cyclic, pedals and collective feed the pure flight model");

const hover = stepHelicopterFlight(createHelicopterFlightState(), {}, 1 / 60);
assert.equal(hover.vy, 0, "neutral collective holds altitude in assisted mode");
const climb = stepHelicopterFlight(createHelicopterFlightState(), { collective: 1 }, 0.05);
assert.ok(climb.vy > 0, "positive collective climbs");
let forwardFlight = createHelicopterFlightState({ yaw: 0 });
for (let i = 0; i < 60; i++) {
  forwardFlight = stepHelicopterFlight(forwardFlight, { pitch: 1 }, 1 / 60);
}
assert.ok(forwardFlight.vz > 0.5, "forward cyclic accelerates along helicopter heading");
assert.ok(Math.abs(forwardFlight.pitch) <= HELICOPTER_FLIGHT_LIMITS.maxPitchDeg + 1e-6,
  "helicopter pitch remains bounded");
let rollFlight = createHelicopterFlightState({ yaw: 0 });
for (let i = 0; i < 60; i++) {
  rollFlight = stepHelicopterFlight(rollFlight, { roll: 1 }, 1 / 60);
}
assert.ok(rollFlight.vx > 0.5, "right cyclic accelerates to the helicopter right");
assert.ok(Math.abs(rollFlight.roll) <= HELICOPTER_FLIGHT_LIMITS.maxRollDeg + 1e-6,
  "helicopter roll remains bounded");
console.log("Helicopter flight P0 static + dynamics contracts PASS");

assert.equal(movementHudState({ mounted:false, grounded:true }), MOVEMENT_HUD_STATES.WALK);
assert.equal(movementHudState({ mounted:true, grounded:true }), MOVEMENT_HUD_STATES.MOUNT_GROUND);
assert.equal(movementHudState({ mounted:true, grounded:false }), MOVEMENT_HUD_STATES.MOUNT_FLIGHT);

const campusCss = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const mcmEventUiSource = readFileSync(new URL("./src/events/zombie-university-2026/event-ui.js", import.meta.url), "utf8");
assert.match(campusCss, /body\[data-movement-state="MOUNT_FLIGHT"\] #jump/,
  "flight moves 상승 to the top of the right control stack");
assert.match(campusCss, /body\[data-movement-state="MOUNT_FLIGHT"\] #descend/,
  "flight reserves the bottom action for 하강");
assert.match(playerControllerSource, /const base = mounted \? "가속" : "RUN"/,
  "mounted RUN control becomes 가속");
assert.match(playerControllerSource, /this\.descendButton\.hidden = bike \|\| state !== MOVEMENT_HUD_STATES\.MOUNT_FLIGHT/,
  "bike hides 하강; the control only appears for a flight mount");

const campusHtml = readFileSync(new URL("./campus/index.html", import.meta.url), "utf8");
assert.match(campusHtml, /id="inkyung-living-moment"[^>]*aria-label="인경호에서 해볼 것"[^>]*hidden/,
  "C15.3 Inkyung living guide exists and starts hidden");
assert.match(campusHtml, /id="inkyung-living-actions"/,
  "C15.3 Inkyung living guide owns one compact action-summary node");
const trackedQuestHud = campusHtml.match(/<section\b[^>]*id="quest-hud"[^>]*>[\s\S]*?<\/section>/)?.[0];
assert.ok(trackedQuestHud, "Quest Runtime owns one tracked quest HUD");
assert.doesNotMatch(campusHtml, /id="npc-quest"|id="main2-quest"/,
  "legacy Main 01 / Main 02 HUD shells are removed");
for (const id of ["next-discovery", "next-discovery-primary"]) {
  assert.equal((campusHtml.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1);
  assert.ok(trackedQuestHud.includes(`id="${id}"`), "Next action stays inside the tracked quest HUD");
}
assert.doesNotMatch(campusHtml, /<aside[^>]*id="next-discovery"/, "No duplicate next-discovery popup");
assert.match(campusCss, /\.next-discovery\[hidden\]\s*\{[^}]*display:\s*none/s,
  "Hidden next action does not occupy HUD space");
assert.match(campusCss, /\.inkyung-living-moment\[hidden\]\s*\{[^}]*display:\s*none/s,
  "C15.3 hidden living guide never occupies HUD space");
// Mini-map M0 static contract: one passive, initially hidden SVG HUD.
for (const id of ["minimap", "minimap-svg", "minimap-geometry", "minimap-pois", "minimap-objective", "minimap-social", "minimap-player", "minimap-compass"]) {
  assert.equal((campusHtml.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1,
    `Mini-map has exactly one ${id} node`);
}
const minimapShell = campusHtml.match(/<aside\b[^>]*id="minimap"[^>]*>[\s\S]*?<\/aside>/)?.[0];
assert.ok(minimapShell, "Mini-map shell exists");
assert.match(minimapShell, /<aside\b[^>]*\bhidden\b/, "Mini-map starts hidden");
assert.match(minimapShell, /<svg\b[^>]*id="minimap-svg"[^>]*viewBox="0 0 112 112"/,
  "Mini-map uses the locked SVG viewBox");
assert.equal((minimapShell.match(/id="minimap-open-map"/g) ?? []).length, 1,
  "M2 upgrades the Mini-map with one Full Map trigger");
assert.match(minimapShell, /id="minimap-open-map"[^>]*aria-controls="full-map-panel"[^>]*aria-expanded="false"/,
  "Mini-map Full Map trigger is accessible and starts closed");
assert.doesNotMatch(minimapShell, /\btabindex\s*=/i,
  "Mini-map does not add ad-hoc tabindex controls");
assert.match(campusCss, /\.minimap\s*\{[^}]*--minimap-size:\s*var\(--world-right-rail-map-size,\s*112px\);[^}]*pointer-events:\s*none;/s,
  "Mini-map defaults to the shared 112px right-rail shell");
assert.match(campusCss, /\.minimap\[hidden\],[\s\S]*\.minimap\[data-minimap-state="UNAVAILABLE"\],[\s\S]*\.minimap\[data-minimap-state="HIDDEN"\],[\s\S]*\.minimap\[data-minimap-state="SUSPENDED"\]\s*\{[^}]*display:\s*none/s,
  "Mini-map hides all non-active states");
assert.match(campusCss, /@media\s*\(max-width:\s*380px\),\s*\(max-height:\s*640px\)\s*\{\s*\.minimap\s*\{\s*--minimap-size:\s*96px;/,
  "Mini-map uses 96px in compact viewports");
assert.match(campusCss, /@media\s*\(pointer:\s*fine\) and \(min-width:\s*700px\)[\s\S]*?\.minimap\s*\{\s*--minimap-size:\s*156px;/s,
  "Mini-map uses 156px on desktop");
assert.match(campusCss, /data-map-kind="ROAD"/,
  "Mini-map has a semantic road presentation layer");
assert.match(campusCss, /data-map-kind="PATH"/,
  "Mini-map has a semantic walkway presentation layer");
const minimapDataSource = readFileSync(new URL("./src/minimap/minimap-data.js", import.meta.url), "utf8");
assert.match(minimapDataSource, /CAMPUS_ROADS/,
  "Mini-map roads derive from the shared Campus road authority");
assert.match(minimapDataSource, /CAMPUS_PATH_WIDTHS/,
  "Mini-map walkways derive from the shared runtime path-width authority");
assert.match(campusCss, /\.minimap-objective-ring/,
  "Mini-map M1 exposes a dedicated objective presentation");
assert.match(campusCss, /\.minimap-social-marker\[data-social-kind="friend"\]/,
  "Mini-map M1 distinguishes friend markers from general players");
assert.doesNotMatch(minimapDataSource, /maproad[^\n]*\{\s*x\s*:/,
  "Mini-map does not hard-code separate road coordinates");
const minimapSources = ["model", "poi-registry", "data", "renderer", "controller"]
  .map(name => readFileSync(new URL(`./src/minimap/minimap-${name}.js`, import.meta.url), "utf8"));
assert.doesNotMatch(minimapSources.join("\n").replace(/^\s*\/\/.*$/gm, ""),
  /supabase|realtime|heartbeat|\bfetch\s*\(|\.rpc\s*\(|\.subscribe\s*\(/i,
  "Mini-map modules remain independent of database and presence transport");

for (const id of ["full-map-panel","full-map-close","full-map-surface","full-map-svg","full-map-marker-layer","full-map-geometry","full-map-pois",
  "full-map-social","full-map-objective","full-map-destination","full-map-player","full-map-info",
  "full-map-set-destination","full-map-clear-destination","full-map-zoom-in","full-map-zoom-out",
  "full-map-locate","full-map-reset-view","full-map-zoom-label"]) {
  assert.equal((campusHtml.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1,
    `Full Map has exactly one ${id} node`);
}
assert.match(campusHtml, /id="full-map-panel"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*hidden/,
  "Full Map is a closed modal by default");
assert.match(campusCss, /\.full-map-panel\s*\{[^}]*position:\s*fixed/s,
  "Full Map occupies a dedicated modal layer");
assert.match(campusCss, /\.full-map-surface\s*\{[^}]*aspect-ratio:\s*1[^}]*touch-action:\s*none/s,
  "Full Map keeps a square touch-safe map surface");
assert.match(campusCss, /\.full-map-controls\s*\{/,
  "Full Map exposes persistent zoom and locate controls");
assert.match(campusCss, /--full-map-inverse-zoom/,
  "Full Map keeps marker visual size stable while zooming");
const fullMapSource = readFileSync(new URL("./src/minimap/full-map-controller.js", import.meta.url), "utf8");
const roomMapSource = readFileSync(new URL("./src/minimap/room-map-data.js", import.meta.url), "utf8");
assert.match(fullMapSource, /worldToMapUv/,
  "Full Map reuses the canonical world-to-map normalization");
assert.match(fullMapSource, /FULL_MAP_ZOOM = Object\.freeze\(\{ min: 1, max: 4/,
  "Full Map zoom is bounded from 1x through 4x");
assert.match(fullMapSource, /pointerdown[\s\S]*pointermove[\s\S]*pointerup/,
  "Full Map supports pointer drag/pinch gestures");
assert.match(fullMapSource, /wheel/,
  "Full Map supports cursor-centred wheel zoom");
assert.match(fullMapSource, /centerOnPlayer/,
  "Full Map exposes a current-location recenter action");
assert.doesNotMatch(fullMapSource.replace(/^\s*\/\/.*$/gm, ""),
  /supabase|realtime|heartbeat|\bfetch\s*\(|\.rpc\s*\(|\.subscribe\s*\(/i,
  "Full Map adds no database or presence transport dependency");
assert.match(roomMapSource, /CLUB_ROOM[\s\S]*CLUB_ROOM_EXIT[\s\S]*CLUB_ROOM_FURNITURE/,
  "M2-2 room map derives from the authoritative room layout");
assert.match(roomMapSource, /ROOM_FLOOR[\s\S]*ROOM_FURNITURE/,
  "M2-2 exposes semantic room floor and furniture geometry");
assert.match(campusCss, /data-map-kind="ROOM_FLOOR"/,
  "Mini-map/Full Map style the room floor geometry");
assert.match(campusCss, /data-map-kind="ROOM_FURNITURE"/,
  "Mini-map/Full Map style room furniture geometry");
assert.match(campusCss, /\.minimap\[data-map-mode="room"\][\s\S]*\.minimap-base/,
  "Indoor Mini-map gets a distinct room background for readability");
assert.match(campusCss, /@media \(max-width: 720px\)[\s\S]*\.full-map-panel\s*\{[^}]*place-items:\s*start stretch/s,
  "Mobile Full Map shrink-wraps its content instead of stretching into an empty screen");

// M3 route / compass guidance: separate layers and a compact chip, never a large HUD card.
for (const id of ["minimap-route", "minimap-navigation", "nav-guidance", "nav-guidance-arrow", "nav-guidance-title",
  "nav-guidance-detail", "nav-guidance-cancel", "full-map-route", "full-map-pick", "full-map-nav", "full-map-nav-clear"]) {
  assert.equal((campusHtml.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1, `M3 has exactly one ${id} node`);
}
assert.match(minimapShell, /id="minimap-geometry"[\s\S]*id="minimap-route"[\s\S]*id="minimap-pois"[\s\S]*id="minimap-objective"[\s\S]*id="minimap-navigation"/,
  "M3 route draws under POIs and the destination sits beside, not inside, the quest objective layer");
assert.match(campusHtml, /id="nav-guidance"[^>]*hidden/, "Guidance chip starts hidden");
assert.match(campusHtml, /id="auto-move-hud"[^>]*hidden/, "P0-A Auto Move HUD starts hidden");
assert.match(campusHtml, /id="auto-move-resume"[^>]*hidden[^>]*>재개<\/button>/,
  "P1-A Auto Move HUD exposes an initially hidden resume action");
assert.match(campusHtml, /id="auto-move-cancel"[^>]*>일시정지<\/button>/,
  "P1-A Auto Move stop action is explicitly a pause, not route deletion");
assert.match(campusHtml, /id="full-map-auto-move"[^>]*>자동이동<\/button>/, "Full Map exposes the Auto Move action");
assert.match(campusCss, /\.auto-move-hud\s*\{[^}]*top:\s*calc\(/s, "Auto Move HUD stacks below navigation guidance");
const autoMoveSource = readFileSync(new URL("./src/navigation/player-auto-move.js", import.meta.url), "utf8");
assert.doesNotMatch(autoMoveSource, /setLocalPosition|setPosition|translateLocal/, "P0-B Auto Move never bypasses PlayerController transforms");
assert.match(autoMoveSource, /sprint:\s*false/, "P0-B Auto Move keeps the existing walk motion instead of forcing sprint");
assert.match(autoMoveSource, /stuckMs:\s*2500/, "P0-C bounds stuck detection time");
assert.match(autoMoveSource, /maxReroutes:\s*1/, "P0-C permits only one automatic reroute");
assert.match(autoMoveSource, /requestReroute\(/, "P0-C retries through navigation instead of teleporting");
assert.match(autoMoveSource, /PAUSED:\s*"PAUSED"/, "P1-A adds an explicit resumable PAUSED state");
assert.match(autoMoveSource, /function resume\(navigationSnapshot\)/, "P1-A can resume the same destination session");
assert.match(autoMoveSource, /autoMove\.pause|\.pause\(AUTO_MOVE_CANCEL_REASON\.MANUAL_INPUT\)/,
  "P1-A manual control pauses Auto Move instead of permanently cancelling it");
assert.match(playerControllerSource, /\(!this\.mounted \|\| this\.onBike\) && this\.assist !== null/,
  "P1-B allows assisted movement for the campus bike while keeping flight mounts manual-only");
assert.match(campusCss, /\.nav-guidance\s*\{[^}]*position:\s*fixed[^}]*max-width:\s*min\(236px/s,
  "Guidance chip stays compact");
assert.match(campusCss, /\.minimap-route-line\s*\{[^}]*stroke:\s*#ff7c6d/s,
  "Route uses the navigation coral, distinct from quest amber and road beige");
assert.match(campusCss, /\.full-map-objective\[hidden\],\s*\.full-map-destination\[hidden\][^{]*\{[^}]*display:\s*none\s*!important/s,
  "Hidden Full Map objective/destination markers really hide (display:grid must not override [hidden])");
const m3MainSource =readFileSync(new URL("./src/main.js", import.meta.url), "utf8");
assert.match(m3MainSource, /\(!controller\.mounted \|\| controller\.onBike\)/,
  "P1-B Auto Move availability includes the campus bike but not other mounts");
assert.match(m3MainSource, /createNavigationState\(/, "M3 Guidance State is wired into the World");
assert.match(m3MainSource, /navigation\?\.update\(\{ position: pos, yaw: orbit\.yaw, spaceId: navigationSpaceId\(\) \}\)/,
  "Guidance updates every campus frame with the current space");
console.log("M3 route/compass guidance static contracts PASS");

assert.match(campusHtml, /class="campus-topbar"/, "compact top bar replaces the large always-on HUD card");
assert.match(campusHtml, /id="world-lobby"[^>]*data-p0-stage="shell"[^>]*hidden/,
  "P0.1 lobby shell exists but remains opt-in on the production campus route");
assert.match(campusHtml, /src="\/src\/lobby\/lobby-shell\.js"/,
  "P0.1 lobby shell has an isolated bootstrap module");
assert.match(campusHtml, /id="main-gate-start"[^>]*class="world-lobby-primary-slot world-lobby-main-gate"/,
  "P0.3 exposes one actionable MAIN_GATE card");
assert.match(campusHtml, /id="resume-last-location"[^>]*class="world-lobby-secondary-slot world-lobby-resume"[^>]*hidden/,
  "P0.4 resume CTA starts hidden until a valid save exists");
assert.match(campusHtml, /id="back-gate-locked"[^>]*aria-haspopup="dialog"[^>]*aria-controls="back-gate-lock-dialog"/,
  "P0.5 exposes Back Gate as an informative locked card, not a start action");
assert.match(campusHtml, /id="back-gate-lock-dialog"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*hidden/,
  "P0.5 locked Back Gate detail starts closed as a modal dialog");
assert.match(campusHtml, /id="lobby-transition-fade"[^>]*hidden/,
  "P0.6 provides a dedicated transition fade overlay");
assert.match(campusHtml, /id="world-loading"[\s\S]*id="world-loading-bar"[\s\S]*id="world-loading-continue"/,
  "P1.7 provides an immediate World loading surface before the canvas");
assert.match(campusHtml, /src="\/src\/lobby\/lobby-loading\.js"[\s\S]*id="application"/,
  "P1.7 loading bootstrap is scheduled before the heavy World module");
assert.match(campusHtml, /id="lobby-menu-toggle"[^>]*aria-controls="lobby-menu"[^>]*aria-expanded="false"/,
  "P1.1 activates the Main Lobby menu trigger");
assert.match(campusHtml, /id="lobby-menu"[^>]*hidden[\s\S]*id="lobby-open-profile"[\s\S]*id="lobby-open-settings"[\s\S]*href="\/"/,
  "P1.1 menu exposes profile, settings and Hub return only");
assert.match(campusHtml, /id="lobby-player-summary"[\s\S]*id="lobby-player-name"[\s\S]*id="lobby-player-look"[\s\S]*id="lobby-player-account"/,
  "P1.2 exposes a compact player summary without inventing a new profile surface");
assert.match(campusHtml, /id="lobby-presence-summary"[\s\S]*id="lobby-zone-presence"[\s\S]*id="lobby-friends-summary"/,
  "P1.3 exposes Place Zone presence and friend summary");
assert.match(campusHtml, /id="lobby-quest-highlight"[^>]*hidden[\s\S]*id="lobby-quest-state"[\s\S]*id="lobby-quest-title"[\s\S]*id="lobby-quest-objective"[\s\S]*id="lobby-quest-progress"/,
  "P1.4 reserves exactly one compact quest highlight");
const lobbyShellSource = readFileSync(new URL("./src/lobby/lobby-shell.js", import.meta.url), "utf8");
const lobbyWorldSource = readFileSync(new URL("./src/lobby/lobby-world.js", import.meta.url), "utf8");
const lobbyMainGateSource = readFileSync(new URL("./src/lobby/lobby-main-gate.js", import.meta.url), "utf8");
const worldResumeSource = readFileSync(new URL("./src/lobby/world-resume.js", import.meta.url), "utf8");
const lobbyResumeSource = readFileSync(new URL("./src/lobby/lobby-resume.js", import.meta.url), "utf8");
const lobbyBackGateSource = readFileSync(new URL("./src/lobby/lobby-back-gate.js", import.meta.url), "utf8");
const lobbyTransitionSource = readFileSync(new URL("./src/lobby/lobby-transition.js", import.meta.url), "utf8");
const lobbyMenuSource = readFileSync(new URL("./src/lobby/lobby-menu.js", import.meta.url), "utf8");
const lobbyPlayerSummarySource = readFileSync(new URL("./src/lobby/lobby-player-summary.js", import.meta.url), "utf8");
const lobbyPresenceSummarySource = readFileSync(new URL("./src/lobby/lobby-presence-summary.js", import.meta.url), "utf8");
const lobbyQuestHighlightSource = readFileSync(new URL("./src/lobby/lobby-quest-highlight.js", import.meta.url), "utf8");
const lobbySpawnRegistrySource = readFileSync(new URL("./src/lobby/spawn-registry.js", import.meta.url), "utf8");
const lobbyLoadingSource = readFileSync(new URL("./src/lobby/lobby-loading.js", import.meta.url), "utf8");
const characterSource = readFileSync(new URL("./src/character-model.js", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("./src/main.js", import.meta.url), "utf8");
for (const factory of ["createMiniMapDataSource", "createMiniMapRenderer", "createMiniMapController"]) {
  assert.match(mainSource, new RegExp(`${factory}\\(`), `World wires ${factory}`);
}
assert.match(mainSource, /minimap\?\.update\(/, "World updates the Mini-map in its lifecycle");
assert.match(mainSource, /getObjectiveMarker:/,
  "Mini-map M1 reads the active objective through an injected getter");
assert.match(mainSource, /getSocialMarkers:/,
  "Mini-map M1 reads same-zone social markers through an injected getter");
assert.match(mainSource, /miniMapRemotes\?\.\(\)/,
  "Mini-map M1 reuses existing same-zone Realtime samples");
assert.match(mainSource, /minimap:\s*\(\(\) => \{ try \{ return minimap\?\.status\(\)/,
  "World debug status exposes the Mini-map without propagating errors");
assert.match(mainSource, /createFullMapController\(/,
  "M2 wires the Full Map controller");
assert.match(mainSource, /fullMap:\s*\(\(\) => \{ try \{ return fullMap\?\.status\(\)/,
  "World debug status exposes the Full Map without propagating errors");
assert.match(mainSource, /fullMap:\s*fullMap\?\.openState === true/,
  "Open Full Map suspends the Mini-map through the shared overlay contract");
assert.match(mainSource, /rooms\.onChange\(/,
  "M2-2 switches map profiles from the Room transition authority");
assert.match(mainSource, /createRoomMapDataSource\(status\.roomId\)/,
  "M2-2 resolves the active interior map without duplicating room coordinates");
assert.match(mainSource, /get\('start'\) === 'club-room'/,
  "Room-map preview can boot directly into the club room");
assert.match(mainSource, /rooms\.enter\("ROOM_CLUBHOUSE_01"\)/,
  "Room-map preview enters the existing Room transition instead of teleporting ad hoc");
assert.match(mainSource, /minimap\?\.setDataSource\([\s\S]*indoor:\s*true/,
  "M2-2 keeps the Mini-map active with a room-local profile");
const lobbyBrowserQaSource = readFileSync(new URL("./qa-main-lobby-browser.mjs", import.meta.url), "utf8");
assert.match(lobbyShellSource, /get\("lobby"\) === "1"/,
  "lobby shell only activates through the explicit lobby preview query");
assert.match(lobbyWorldSource, /onActiveChange = null[\s\S]*setInputLocked\(true\)/s,
  "P0.2 delegates lobby input locking to the shared authority when one is injected");
assert.match(mainSource, /ownerId:\s*"lobby-world"[\s\S]*INPUT_FOCUS_POLICY\.SYSTEM_LOCK/s,
  "P0-D4a binds the lobby scene to a SYSTEM_LOCK owner");
assert.match(lobbyWorldSource, /character\.update\([\s\S]*moving:\s*false[\s\S]*grounded:\s*true/s,
  "P0.2 reuses the real character in an idle grounded preview pose");
assert.match(lobbyMainGateSource, /lobbyWorld\.leave\(\)/,
  "P0.3 releases lobby world mode before gameplay starts");
assert.match(lobbyMainGateSource, /player\.setLocalPosition\(target\.x, target\.y, target\.z\)/,
  "P1.5 sends the player to the Registry-resolved canonical spawn target");
assert.match(lobbyMainGateSource, /setLobbyShellVisible\(false/,
  "P0.3 restores the gameplay HUD by hiding the lobby shell");
assert.match(worldResumeSource, /WORLD_RESUME_SAVE_INTERVAL_MS = 2000/,
  "P0.4 throttles resume persistence instead of writing every frame");
assert.match(worldResumeSource, /!grounded \|\| mounted \|\| insideRoom/,
  "P0.4 only persists safe outdoor grounded pedestrian states");
assert.match(lobbyResumeSource, /enterResume/,
  "P0.4 has an explicit resume handoff contract");
assert.match(lobbySpawnRegistrySource, /BACK_GATE[\s\S]*state:\s*SPAWN_STATE\.LOCKED_PROGRESS/,
  "P1.5 registry pins Back Gate to the locked-progress state");
assert.match(lobbySpawnRegistrySource, /BACK_GATE[\s\S]*unlockType:\s*SPAWN_UNLOCK_TYPE\.QUEST[\s\S]*questId:\s*QUEST_ID/,
  "P1.5 registry binds Back Gate unlock to the authored Main 1 quest id");
assert.match(lobbyBackGateSource, /canStart:\s*\(\) => canStartSpawn\(refresh\(\)\)/,
  "P1.5 Back Gate startability refreshes the shared Spawn Registry contract");
assert.match(mainSource, /spawnProgressContext[\s\S]*QUEST_ID[\s\S]*backGateLock\.refresh\(\)/,
  "P1.5 Main 1 completion is re-read before Back Gate is offered as a start point");
assert.match(lobbyTransitionSource, /fadeSeconds:\s*0\.16/,
  "P0.6 fades lobby chrome before the world handoff");
assert.match(lobbyTransitionSource, /blendSeconds:\s*0\.32/,
  "P0.6 blends the orbit camera before enabling control");
assert.match(lobbyTransitionSource, /setInputLocked\(true\)/,
  "P0.6 acquires the shared input lock when the transition starts");
assert.match(lobbyTransitionSource, /setInputLocked\(false\)/,
  "P0.6 releases the shared input lock only from transition completion");
assert.match(mainSource, /ownerId:\s*"lobby-transition"[\s\S]*INPUT_FOCUS_POLICY\.SYSTEM_LOCK/s,
  "P0-D4a binds the lobby transition to a SYSTEM_LOCK owner");
assert.match(lobbyMenuSource, /existingProfileButton\?\.click\?\.\(\)/,
  "P1.1 reuses the existing profile surface");
assert.match(lobbyMenuSource, /existingSettingsButton\?\.click\?\.\(\)/,
  "P1.1 reuses the existing settings surface");
assert.match(lobbyPlayerSummarySource, /profile\?\.nickname/,
  "P1.2 reads the existing profile nickname authority");
assert.match(lobbyPlayerSummarySource, /profile\?\.signedIn \? "INHAGAME 계정" : "게스트"/,
  "P1.2 derives account state from the existing profile authority");
assert.match(lobbyPlayerSummarySource, /DEFAULT_LOBBY_CHARACTER = "기본 인덕이 · 기본 외형"/,
  "P1.2 labels only the currently implemented default character/appearance");
assert.match(lobbyPresenceSummarySource, /LOBBY_PRESENCE_SCOPE = "WORLD"/,
  "P1.3 labels the primary lobby population surface as World-wide");
assert.match(lobbyPresenceSummarySource, /populationStatus\.snapshot\.online/,
  "P1.3 derives the World-wide total from the heartbeat aggregate, not Place Zone Realtime");
assert.match(lobbyPresenceSummarySource, /remoteByUser\?\.\(userId\)/,
  "P1.3 keeps friend context scoped to the current Place Zone");
assert.match(lobbyPresenceSummarySource, /friendPanel\?\.setOpen/,
  "P1.3 delegates friend detail to the existing friend panel");
assert.match(lobbyQuestHighlightSource, /WORLD_QUEST[\s\S]*FIRST_TOUR[\s\S]*WORLD_QUEST_AVAILABLE/,
  "P1.4 has an explicit quest priority order");
assert.match(lobbyQuestHighlightSource, /QUEST_OBJECTIVES\[stage\]/,
  "P1.4 reuses the authored NPC quest objective contract");
assert.match(lobbyQuestHighlightSource, /TOUR_STOPS\[tourStage\]\.label/,
  "P1.4 reuses the existing first-tour objective");
assert.doesNotMatch(lobbyQuestHighlightSource, /daily|일일|기간 한정|reward|보상/i,
  "P1.4 does not invent daily quests, live events, or rewards");
assert.match(lobbySpawnRegistrySource, /AVAILABLE[\s\S]*LOCKED_PROGRESS[\s\S]*LOCKED_ACCOUNT[\s\S]*COMING_SOON[\s\S]*NEW[\s\S]*DISABLED[\s\S]*UNKNOWN[\s\S]*HIDDEN/,
  "P1.5 Spawn Registry implements the canonical Future Content state model");
assert.match(lobbySpawnRegistrySource, /catch \{[\s\S]*state = SPAWN_STATE\.UNKNOWN/,
  "P1.5 state resolver failures degrade to UNKNOWN, never LOCKED");
assert.match(lobbySpawnRegistrySource, /DEFAULT_SPAWN_DEFINITIONS[\s\S]*MAIN_GATE[\s\S]*BACK_GATE/,
  "P1.5 default Registry contains only the currently grounded Main/Back Gate definitions");
assert.match(lobbyMainGateSource, /spawnDefinition && !canStartSpawn\(spawnDefinition\)/,
  "P1.5 Main Gate action is gated by the shared Registry state");
for (const phase of ["BOOT","RENDERER","WORLD","CHARACTER","STREAMING","ONLINE","READY"]) {
  assert.match(lobbyLoadingSource, new RegExp(phase), `P1.7 loading defines ${phase}`);
}
assert.match(lobbyLoadingSource, /slowAfterMs = 6500/,
  "P1.7 exposes the slow-load state after a bounded delay");
assert.match(lobbyLoadingSource, /essentialReady[\s\S]*기본 월드 먼저 보기|continueButton/s,
  "P1.7 only offers early entry after the essential World is ready");
assert.match(mainSource, /void loadOptionalNpcRuntime\(\)/,
  "P1.7 moves optional NPC runtime loading off the critical boot path");
assert.doesNotMatch(lobbyMainGateSource + lobbyResumeSource + lobbyBackGateSource,
  /world_lobby_(main_gate_start|resume|locked_spawn_open)/,
  "P0.7 does not emit lobby telemetry event names that the current API/database reject");
assert.match(characterSource, /modelState = "fallback"[\s\S]*primitive fallback remains active/s,
  "P0.7 preserves the primitive character fallback contract");
assert.match(characterSource, /BIKE_RIDER_FOOT_Y = 0\.31/,
  "bike rider sits lower into the saddle for the fine-tuned cycling pose");
assert.match(characterSource, /BIKE_RIDER_Z = -0\.07/,
  "bike rider body is pulled forward toward the saddle center");
assert.match(characterSource, /wings: bike[\s\S]*\[\[12, -72, -58\], \[12, 72, 58\]\]/,
  "bike rider wings reach the handlebar in the refined pose");
assert.match(characterSource, /legs: bike \? \[BIKE_LEG_BEND \+ pedal, BIKE_LEG_BEND - pedal\]/,
  "bike rider legs use the cycling pose");
assert.match(lobbyBrowserQaSource, /width:\s*360, height:\s*800/,
  "P1.6 browser QA pins the standard 360px mobile viewport");
assert.match(lobbyBrowserQaSource, /width:\s*360, height:\s*640/,
  "P1.6 browser QA pins a short 360px mobile viewport");
assert.match(lobbyBrowserQaSource, /width:\s*320, height:\s*800/,
  "P1.6 browser QA pins a narrow 320px mobile viewport");
assert.match(lobbyBrowserQaSource, /invalid-resume/,
  "P0.7 browser QA covers corrupted Resume degradation");
assert.match(lobbyBrowserQaSource, /avatar-fallback/,
  "P1.6 browser QA covers failed character assets");
assert.match(lobbyBrowserQaSource, /optional-data-failure/,
  "P1.6 browser QA covers optional quest/NPC endpoint failure");
assert.match(lobbyBrowserQaSource, /#lobby-player-summary[\s\S]*#lobby-presence-summary[\s\S]*#lobby-quest-highlight/s,
  "P1.6 browser QA checks the P1 summary surfaces");
assert.match(lobbyPresenceSummarySource, /catch \{[\s\S]*readDegraded = true/,
  "P1.6 Presence read failures degrade without escaping the lobby update loop");
assert.match(lobbyQuestHighlightSource, /catch \{ readDegraded = true; \}/,
  "P1.6 Quest read failures degrade without escaping the lobby update loop");
assert.match(campusCss, /\.world-lobby\s*\{/,
  "P0.1 defines the lobby shell layout");
assert.match(campusCss, /@media \(max-width: 560px\)[\s\S]*\.world-lobby-avatar-slot/s,
  "P0.1 includes a mobile shell adaptation");
assert.match(campusCss, /@media \(max-width: 340px\)[\s\S]*\.world-lobby-player-summary[\s\S]*width:\s*calc\(50vw - 15px\)[\s\S]*\.world-lobby-presence-summary[\s\S]*min-width:\s*0/s,
  "P1.3 narrow-mobile guardrail keeps the two summary cards from overlapping");
assert.match(campusCss, /body\[data-lobby-world="true"\] \.world-lobby-avatar-slot/,
  "P0.2 removes the fake avatar placeholder once the real world character is used");
assert.match(campusHtml, /class="return-home-label">메인허브<\/span>/,
  "back action explicitly labels the main hub destination");
assert.match(campusHtml, /id="hud-menu"[^>]*hidden/, "low-frequency identity/settings actions start inside a hidden menu");
assert.match(campusHtml, /class="social-cluster"[\s\S]*id="emote-toggle"[\s\S]*id="chat-toggle"/,
  "chat and emote share one social cluster");
assert.equal((campusHtml.match(/id="chat-toggle"/g) ?? []).length, 1, "chat toggle remains unique");
assert.equal((campusHtml.match(/id="zone"/g) ?? []).length, 1, "location authority remains a single DOM target");
assert.match(campusCss, /\.campus-topbar\s*\{/);
// P0-F3a: read-only progression HUD. Wide pill + narrow in-chip badge + menu line; no authority.
for (const id of ["progression-hud", "progression-level", "progression-exp", "progression-fill",
  "progression-badge", "progression-badge-level", "progression-badge-fill", "progression-menu-line"]) {
  assert.equal((campusHtml.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1, `${id} is a single DOM target`);
}
assert.match(campusHtml, /class="location-chip"[^>]*>[\s\S]*?id="zone"[\s\S]*?id="progression-badge"[^>]*hidden/,
  "the narrow-screen Lv badge lives inside the location chip and starts hidden");
assert.match(campusHtml, /id="progression-hud"[^>]*hidden/, "the progression pill starts hidden until a server snapshot");
assert.match(campusCss, /@media \(min-width: 960px\) \{\s*\.progression-hud:not\(\[hidden\]\) \{ display: flex; \}\s*\.progression-badge \{ display: none !important; \}/,
  "the pill only shows where it clears the Main Quest HUD and Mini-map; narrower screens use the badge");
assert.match(campusCss, /body\[data-lobby-shell="true"\] > \.progression-hud,\s*body\[data-space\]:not\(\[data-space="campus"\]\) > \.progression-hud \{ display: none !important; \}/,
  "the progression pill follows the Main Quest HUD visibility rules");
assert.doesNotMatch(m3MainSource, /createClient\([^)]*\)[^\n]*progression|progression[^\n]*createClient\(/,
  "progression never creates its own Supabase client");
console.log("P0-F3a progression HUD static contracts PASS");
// P0-F3b: Student Center shop panel. One menu entry, one modal section, server-rendered offers.
assert.match(campusHtml, /id="hud-menu"[\s\S]*?id="open-shop"[^>]*aria-controls="shop-panel"[^>]*>🛍 상점</,
  "the HUD menu carries the single shop entry point");
assert.equal((campusHtml.match(/id="shop-panel"/g) ?? []).length, 1, "shop panel is a single DOM target");
assert.match(campusHtml, /id="shop-panel"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*hidden/, "the shop panel is a modal that starts hidden");
assert.match(campusCss, /body\[data-lobby-shell="true"\] > #shop-panel,/, "the lobby shell hides the shop panel");
assert.match(campusCss, /\.shop-panel \{[^}]*z-index: 70;/s, "the shop modal stacks above the fixed event chip");
assert.match(campusCss, /\.shop-offer-buy \{[^}]*min-height: 44px/s, "shop buttons keep a 44px touch target");
assert.match(m3MainSource, /createShopClient\(\{ getClient: \(\) => online\?\.supabase \?\? null \}\)/,
  "the shop reuses the online member client");
assert.match(m3MainSource, /ownerId:\s*"shop"[\s\S]*INPUT_FOCUS_POLICY\.BLOCKING_UI/s,
  "an open shop suspends world actions through InputFocusManager");
assert.match(campusCss, /body:has\(#hud-menu:not\(\[hidden\]\)\) > \.mcm26-chip,\s*body:has\(#view-settings:not\(\[hidden\]\)\) > \.mcm26-chip \{ visibility: hidden; pointer-events: none; \}/,
  "the event chip never covers an open HUD menu or View Settings panel");
assert.match(campusCss, /\.biryong-objective\s*\{[^}]*top:\s*max\(66px,/s,
  "the Biryong objective clears the compact campus topbar");
assert.match(campusCss, /--world-right-rail-event-top:\s*calc\([\s\S]*--world-right-rail-map-size[\s\S]*--world-right-rail-gap/s,
  "the right HUD rail puts the event row below the Mini-map");
assert.match(campusCss, /body:has\(#nav-guidance:not\(\[hidden\]\)\)\s*\{[^}]*--world-right-rail-event-top:/s,
  "active Mini-map guidance reserves a row before the event chip");
assert.match(campusCss, /body:has\(#auto-move-hud:not\(\[hidden\]\)\)\s*\{[^}]*--world-right-rail-event-top:/s,
  "active auto-move controls reserve another row before the event chip");
assert.match(campusCss, /body:has\(> \.mcm26-chip:not\(\[hidden\]\)\) > \.inkyung-living-moment\s*\{[^}]*--world-right-rail-event-top/s,
  "the Living Campus guide drops below a visible event chip on mobile");
assert.match(mcmEventUiSource, /\.mcm26-chip\{[^}]*top:var\(--world-right-rail-event-top/s,
  "the event chip consumes the shared right HUD rail top");
assert.match(mcmEventUiSource, /data-short-label/,
  "the mobile event chip exposes a compact visible label instead of a wide pill");
console.log("P0-F3b student center shop static contracts PASS");
// Student Center shop wallet balance: server read-model on the member client, header line only.
assert.match(m3MainSource, /createWalletClient\(\{ getClient: \(\) => online\?\.supabase \?\? null \}\)/,
  "the wallet balance reuses the online member client");
assert.match(campusCss, /\.shop-panel-wallet\[hidden\] \{ display: none; \}/, "the wallet line hides without an account");
assert.match(campusCss, /\.shop-panel-titles \{ min-width: 0; \}/, "the shop header titles can shrink at 360px");
console.log("Student Center shop wallet balance static contracts PASS");
// Student Center shop world entry P0: the same panel from the terrace in front of 학생회관.
assert.match(m3MainSource, /contextActions\.set\("student-center-shop", shopWorldAction\)/,
  "the world entry competes in the shared interaction slot (F / #context-action)");
assert.match(m3MainSource, /openPanel: \(\) => shopPanel\.setOpen\(true\)/, "the world entry opens the existing shop panel");
assert.equal((campusHtml.match(/id="shop-world-label"/g) ?? []).length, 1, "one shop world marker");
assert.match(campusHtml, /id="shop-world-label"[^>]*aria-hidden="true"[^>]*hidden/, "the marker is decorative and starts hidden");
assert.match(campusHtml, /id="open-shop"/, "the HUD menu shop entry stays");
console.log("Student Center shop world entry static contracts PASS");
// Inventory P0: read-only owned items from get_my_world_inventory_v1 on the member client.
{
  const inventoryClientSource = readFileSync(new URL("./src/inventory/inventory-client.js", import.meta.url), "utf8");
  assert.match(campusHtml, /id="hud-menu"[\s\S]*?id="open-inventory"[^>]*aria-controls="inventory-panel"[^>]*>🎒 인벤토리</,
    "the HUD menu carries the inventory entry");
  assert.equal((campusHtml.match(/id="inventory-panel"/g) ?? []).length, 1, "inventory panel is a single DOM target");
  assert.match(m3MainSource, /createInventoryClient\(\{ getClient: \(\) => online\?\.supabase \?\? null \}\)/,
    "the inventory reuses the online member client");
  assert.deepEqual([...inventoryClientSource.matchAll(/"([a-z_]+_v1)"/g)].map((m) => m[1]), ["get_my_world_inventory_v1"],
    "the inventory makes exactly one read RPC and no write RPC");
  assert.doesNotMatch(inventoryClientSource, /createClient\(/, "no inventory-owned Supabase client");
  assert.match(m3MainSource, /onPurchase: \(\) => \{\s*void inventory\.refresh\("purchase"\);/, "shop purchase re-reads the inventory");
  assert.match(m3MainSource, /void inventory\.refresh\("reward"\)/, "MCM reward re-reads the inventory");
  assert.match(campusCss, /body\[data-lobby-shell="true"\] > #inventory-panel,/, "the lobby shell hides the inventory panel");
}
console.log("Inventory P0 static contracts PASS");
// Wardrobe UI P0: server loadout + owned wearables; equip / unequip through the loadout authority only.
{
  const loadoutClientSource = readFileSync(new URL("./src/appearance/loadout-client.js", import.meta.url), "utf8");
  assert.match(campusHtml, /id="hud-menu"[\s\S]*?id="open-wardrobe"[^>]*aria-controls="wardrobe-panel"[^>]*>👕 옷장</,
    "the HUD menu carries the wardrobe entry");
  assert.equal((campusHtml.match(/id="wardrobe-panel"/g) ?? []).length, 1, "wardrobe panel is a single DOM target");
  assert.match(m3MainSource, /createLoadoutClient\(\{ getClient: \(\) => online\?\.supabase \?\? null \}\)/,
    "the loadout reuses the online member client");
  assert.deepEqual([...loadoutClientSource.matchAll(/"([a-z_]+_v1)"/g)].map((m) => m[1]).sort(),
    ["equip_my_world_item_v1", "get_my_world_appearance_loadout_v1", "unequip_my_world_item_v1"],
    "the wardrobe uses exactly the loadout authority RPCs");
  assert.doesNotMatch(loadoutClientSource, /createClient\(/, "no loadout-owned Supabase client");
  assert.match(m3MainSource, /void loadout\.refresh\("purchase"\)/, "shop purchase re-reads the loadout");
  assert.match(m3MainSource, /void loadout\.refresh\("reward"\)/, "MCM reward re-reads the loadout");
  assert.match(m3MainSource, /ownerId:\s*"wardrobe"[\s\S]*INPUT_FOCUS_POLICY\.BLOCKING_UI/s,
    "an open wardrobe suspends world actions through InputFocusManager");
  assert.match(campusCss, /body\[data-lobby-shell="true"\] > #wardrobe-panel,/, "the lobby shell hides the wardrobe");
}
console.log("Wardrobe UI P0 static contracts PASS");
// Local Equipment Projection P0 + Equipment Asset Binding P0: loadout.onChange → slot anchors; two bound models.
{
  const projectionSource = readFileSync(new URL("./src/appearance/equipment-projection.js", import.meta.url), "utf8");
  const loaderSource = readFileSync(new URL("./src/appearance/equipment-asset-loader.js", import.meta.url), "utf8");
  const characterSource = readFileSync(new URL("./src/character-model.js", import.meta.url), "utf8");
  const catalogSource = readFileSync(new URL("./src/collection/item-catalog.js", import.meta.url), "utf8");
  assert.match(m3MainSource, /createEquipmentProjection\(\{\s*loadout,\s*getAnchor: \(slot\) => character\.getEquipmentAnchor\(slot\)/,
    "the projection is driven by the loadout client and the character's anchors");
  assert.match(characterSource, /parent: player, height: HUMAN_HEIGHT/, "equipment anchors hang off the player, not the visual");
  assert.match(characterSource, /equipment\.setVisible\(!value\)/, "first person hides equipment with the character");
  assert.match(catalogSource, /iconAssetId: null, modelAssetId,/, "catalog items take an optional modelAssetId");
  assert.equal((catalogSource.match(/modelAssetId: '[^']+'/g) ?? []).length, 4, "bound items: cap + backpack + hoodie + MCM survivor top");
  assert.match(loaderSource, /"equipment\.head\.induck_cap\.v1": "\/assets\/induck-cap-v1\.glb"/, "cap model binding");
  assert.match(loaderSource, /"equipment\.back\.induck_backpack\.v1": "\/assets\/induck-backpack-v1\.glb"/, "backpack model binding");
  assert.match(loaderSource, /"equipment\.top\.induck_hoodie\.v1": "\/assets\/induck-hoodie-v1\.glb"/, "hoodie model binding");
  assert.match(loaderSource, /"equipment\.top\.mcm_2026_survivor\.v1": "\/assets\/mcm-survivor-top-v1\.gltf"/, "MCM survivor top uses dedicated model");
  assert.doesNotMatch(projectionSource, /\.rpc\(|supabase|setInterval/, "the projection makes no network call and never polls");
}
console.log("Local Equipment Projection P0 static contracts PASS");
// Multiplayer Equipment Projection P0: optional Presence equipment, protocol v1, no new broadcast.
{
  const protocolSource = readFileSync(new URL("./src/network/protocol.js", import.meta.url), "utf8");
  const avatarSource = readFileSync(new URL("./src/online/remote-avatar.js", import.meta.url), "utf8");
  const onlineSource = readFileSync(new URL("./src/online/world-online.js", import.meta.url), "utf8");
  assert.match(protocolSource, /export const PROTOCOL_VERSION = 1;/, "equipment is an optional v1 extension");
  assert.match(protocolSource, /PRESENCE_OPTIONAL_FIELDS = Object\.freeze\(\["guest", "equipment"\]\)/);
  assert.doesNotMatch(protocolSource, /POSE_OPTIONAL_FIELDS = Object\.freeze\(\[[^\]]*equipment/, "equipment never rides the pose packet");
  assert.match(avatarSource, /createEquipmentProjection\(\{\s*loadout: equipmentSource/, "remote avatars reuse the Equipment Projection");
  assert.match(m3MainSource, /loadout\.onChange\(\(change\) => online\?\.setLocalEquipment\(change\.accountId, publicEquipmentFor\(change, change\.accountId\)\)\)/,
    "the sender equipment comes from the loadout client's server read");
  assert.doesNotMatch(onlineSource, /channel\(|REALTIME_EVENTS/, "no equipment channel or broadcast in the online bootstrap");
}
console.log("Multiplayer Equipment Projection P0 static contracts PASS");
assert.match(campusCss, /\.tour\s*\{[^}]*position:\s*fixed[^}]*display:\s*flex/s,
  "tour objective is a compact one-line overlay");
assert.match(campusCss, /\.social-cluster\s*\{/);
assert.match(campusCss, /body:has\(> #minimap:not\(\[hidden\]\)\) > \.tracked-quest-hud\s*\{[^}]*right:\s*calc\(max\(12px, env\(safe-area-inset-right\)\) \+ 120px\)/s,
  "mobile tracked quest reserves the visible Mini-map safe zone");
assert.match(campusCss, /@media \(max-width: 560px\)[\s\S]*?\.tracked-quest-hud-open\s*\{[\s\S]*?grid-template-areas:\s*"flag heading"\s*"flag objective"\s*"bearing bearing"/s,
  "mobile tracked quest stacks bearing below copy instead of competing with Mini-map width");

assert.match(campusCss, /@media \(pointer: fine\) and \(min-width: 700px\)/,
  "desktop HUD has a fine-pointer adaptation");
assert.match(campusCss, /#joystick,[\s\S]*#run,[\s\S]*#jump,[\s\S]*#descend[\s\S]*display:\s*none !important/s,
  "desktop hides touch-only locomotion controls");
assert.match(campusCss, /#context-action \{[\s\S]*bottom:\s*20px[\s\S]*min-height:\s*38px/s,
  "desktop keeps context interaction compact near the bottom edge");
assert.match(campusHtml, /id="emote-toggle"[^>]*title="감정표현 \(E\)"/);
assert.match(campusHtml, /id="chat-toggle"[^>]*title="채팅 \(Enter\)"/);
assert.match(campusHtml, /id="open-keyboard-help"[^>]*>⌨ 키보드 조작<\/button>/,
  "desktop HUD menu exposes a dedicated keyboard reference");
assert.match(campusHtml, /id="keyboard-shortcuts-panel"[^>]*hidden/,
  "keyboard reference starts closed");
for (const key of ["WASD", "Shift", "Space", "C", "Ctrl", "E", "F", "M", "V", "Enter", "Esc"]) {
  assert.match(campusHtml, new RegExp(`<kbd>${key}<\\/kbd>`), `keyboard panel lists ${key}`);
}
assert.match(campusCss, /\.desktop-only \{ display:\s*none !important; \}/,
  "desktop-only keyboard entry stays hidden on touch layouts");
assert.match(campusCss, /@media \(pointer: fine\) and \(min-width: 700px\) \{[\s\S]*\.desktop-only \{ display:\s*block !important; \}/s,
  "keyboard entry appears for desktop/fine pointer");
const chatPanelSource = readFileSync(new URL("./src/online/chat-panel.js", import.meta.url), "utf8");
assert.match(chatPanelSource, /shouldIgnoreShortcut\(\)/,
  "global Enter chat shortcut can be suppressed by the shared input-focus authority");
const controllerSource = readFileSync(new URL("./src/player-controller.js", import.meta.url), "utf8");
assert.doesNotMatch(controllerSource, /profile-panel|view-settings|keyboard-shortcuts-panel/,
  "PlayerController no longer owns panel-specific movement policy");
assert.match(mainSource, /ownerId:\s*"keyboard-help"[\s\S]*INPUT_FOCUS_POLICY\.BLOCKING_UI/s,
  "keyboard reference movement blocking is owned by InputFocusManager");
const tourSource = readFileSync(new URL("./src/campus-tour.js", import.meta.url), "utf8");
assert.doesNotMatch(tourSource, /이동해서 방문하세요/, "compact objective omits instructional filler");

const contextChoice = selectContextAction([
  { id: "mount", priority: 100 },
  { id: "seat", priority: 260, distance: 1.5 },
  { id: "npc", priority: 300, distance: 5 }
]);
assert.equal(contextChoice.id, "npc", "direct NPC interaction outranks seat and mount");
assert.equal(selectContextAction([
  { id: "seat-far", priority: 260, distance: 4 },
  { id: "seat-near", priority: 260, distance: 1 }
]).id, "seat-near", "same-priority context actions prefer the nearest target");
assert.equal(selectContextAction([{ id: "hidden", priority: 999, visible: false }, { id: "mount", priority: 100 }]).id,
  "mount", "hidden context actions never occupy the slot");

const zones = ["C01_GATE", "C02_MAIN_HALL", "C03_CENTRAL"].map(id =>
  JSON.parse(readFileSync(new URL(`./data/zones/${id}.json`, import.meta.url), "utf8")));
const registry = new ZoneRegistry(zones);
assert.ok(Math.abs(LANDMARKS.mainHall.x - 55) < 1);
assert.ok(Math.abs(LANDMARKS.mainHall.z - 5) < 1);
assert.deepEqual(TOUR_STOPS.map(s => registry.findContaining({ x: s.x, z: s.z })?.id),
  ["C01_GATE", "C02_MAIN_HALL"]);
assert.deepEqual(["C01_GATE", "C02_MAIN_HALL", "C03_CENTRAL"],
  [[0,-110],[55,-3],[128,-4]].map(([x,z]) => registry.findContaining({x,z})?.id));
const main=BUILDINGS[0], entrance=MAIN_ENTRANCE, n=HALL_FRONT.inward;
const outside={x:entrance.x,y:1.15,z:entrance.z};
const hit=moveAroundObstacles(outside,n.x*30,n.z*30);
assert.ok(Math.hypot(hit.x-outside.x,hit.z-outside.z)<5,'cannot tunnel through rotated main facade');
const inside={x:entrance.x+n.x*8,y:main.height+1.15,z:entrance.z+n.z*8};
assert.equal(resolveHeight(inside,2),main.height+1.15,'mount lands on actual source footprint roof');
assert.equal(resolveHeight({...inside,x:0,z:-70},1.15),1.15,'landing after clearing roof');
assert.ok(cameraSafeFraction([outside.x,3,outside.z],[inside.x,3,inside.z])<1,'camera stops at rotated facade');
assert.equal(resolveHeight({x:0,y:3,z:-90},8),8,'open gate has no fictitious overhead beam');
assert.ok(!OBSTACLES.some(b=>b.id==='gate_beam'));
assert.ok(OBSTACLES.filter(b=>b.id.includes('agora')).every(b=>
  b.id.startsWith('fac_agora_courtyard_guard_')&&b.polygon.every(p=>p.z < -60)), 'only visible 6/9 courtyard guards; no retired pond-side Agora collider');
// Walk the two remaining public-facing tour stops.
const path = [{x:0,z:-98}, ...TOUR_STOPS];
for (let i = 1; i < path.length; i++) {
  const from = path[i-1], to = path[i];
  let position = {x:from.x, y:1.15, z:from.z};
  for (let n = 1; n <= 80; n++) {
    const wanted = {x:from.x + (to.x-from.x)*n/80, z:from.z + (to.z-from.z)*n/80};
    const next = moveAroundObstacles(position, wanted.x-position.x, wanted.z-position.z);
    position = {...next, y:1.15};
  }
  assert.ok(Math.hypot(position.x-to.x, position.z-to.z) < 0.1, `walkable leg ${i}`);
}
const elements = new Map();
globalThis.document = { getElementById(id) {
  if (!elements.has(id)) elements.set(id, { hidden:false, textContent:"", addEventListener(_type, cb) { this.click = cb; } });
  return elements.get(id);
} };
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, val) => storage.set(key, val) };
const tour = createCampusTour();
assert.equal(tour.stage, 0);
for (const stop of TOUR_STOPS) {
  assert.equal(getPlaceZoneAt(stop).id,stop.placeZoneId);
  tour.update(stop, getPlaceZoneAt(stop).id, 0);
}
assert.equal(tour.stage, 2);
assert.match(elements.get("tour-objective").textContent, /완료/);
assert.equal(storage.get("inhagame-campus-tour-v1"), "2");
assert.doesNotMatch(elements.get("tour-bearing").textContent, /아고라/);
storage.set("inhagame-campus-tour-v1", "3");
assert.equal(createCampusTour().stage, 2, "old completed tour remains complete");
elements.get("tour-restart").click();
assert.equal(createCampusTour().stage, 0);
console.log("compact top HUD / one-line objective / social cluster contract PASS");
console.log("P2 WALK/MOUNT_GROUND/MOUNT_FLIGHT HUD state contract PASS");
console.log("context action priority/distance/visibility PASS");
console.log("campus geo, legacy zone compatibility, semantic tour, footprint collision, roof landing, camera occlusion PASS");
console.log("walkable gate→hall, tour progress/persistence/restart PASS");
console.log("Main Lobby P0.7 static responsive/failure contracts PASS");


const hubHtml = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const hubSource = readFileSync(new URL("./hub.js", import.meta.url), "utf8");
const hubCatalog = JSON.parse(readFileSync(new URL("./data/game-catalog.json", import.meta.url), "utf8"));
const hubProfileSource = readFileSync(new URL("./profile/profile.js", import.meta.url), "utf8");
const hubAccountSource = readFileSync(new URL("./hub-account.js", import.meta.url), "utf8");
const hubMessagesClientSource = readFileSync(new URL("./hub-messages-client.js", import.meta.url), "utf8");
const hubMessagesSource = readFileSync(new URL("./hub-messages.js", import.meta.url), "utf8");
const hubFriendsClientSource = readFileSync(new URL("./hub-friends-client.js", import.meta.url), "utf8");
const hubFriendsSource = readFileSync(new URL("./hub-friends.js", import.meta.url), "utf8");
const playerCardSource = readFileSync(new URL("./src/social/player-card.js", import.meta.url), "utf8");
const hubCss = readFileSync(new URL("./hub.css", import.meta.url), "utf8");

// Hub Auth P1-B preview contract.
for (const id of ["hub-google-auth", "hub-social-auth", "hub-profile-setup"]) {
  assert.equal((hubHtml.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1,
    `Hub Google auth has exactly one ${id} node`);
}
assert.match(hubAccountSource, /signInWithOAuth\(\{[\s\S]*provider:\s*['"]google['"]/,
  "Hub P1-B starts Google OAuth through Supabase Auth");
assert.match(hubAccountSource, /state:'setup_required'/,
  "Hub P1-B separates OAuth authentication from nickname onboarding");
assert.match(hubAccountSource, /completeProfile\(user, nickname\)/,
  "Hub P1-B completes an explicit INHAGAME nickname profile");
assert.doesNotMatch(hubAccountSource,
  /user_metadata\?\.(?:full_name|name|picture)|user_metadata\[['"](?:full_name|name|picture)['"]\]/,
  "Hub P1-B never auto-copies Google display name or picture");
assert.match(hubHtml, /Google 계정의 이름과 프로필 사진은 INHAGAME 공개 프로필에 자동으로 복사하지 않습니다/,
  "Hub explains OAuth metadata minimization");
assert.match(hubHtml, /Google 로그인 시 계정 생성·연결을 위해 Google 계정 식별자, 이메일, 이메일 확인 여부/,
  "Hub discloses Google OAuth account data processing before sign-in");
assert.match(hubHtml, /href="https:\/\/duck\.inhagame\.example\/privacy\.html#google-login"/,
  "Hub Google disclosure links to the matching privacy-policy section");
assert.match(hubCss, /\.google-auth-button\s*\{/,
  "Hub P1-B styles the Google sign-in control");

// Hub Auth P0-D: self-service account deletion.
for (const id of ["hub-delete-account-open","hub-delete-account-panel","hub-delete-account-confirmation",
  "hub-delete-account-cancel","hub-delete-account-confirm","hub-delete-account-status"]) {
  assert.equal((hubHtml.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1,
    `Hub account deletion has exactly one ${id} node`);
}
assert.match(hubHtml, /최근 15분 안에 다시 로그인한 계정만 탈퇴할 수 있습니다/,
  "Hub explains the recent re-authentication deletion gate");
assert.match(hubHtml, /운영자·GM 계정은 권한 이전 후 탈퇴할 수 있습니다/,
  "Hub explains the staff-account deletion block");
assert.match(hubAccountSource, /client\.rpc\(['"]delete_my_inhagame_account_v1['"]/,
  "Hub deletion calls only the server-authoritative self-delete RPC");
assert.match(hubAccountSource, /p_confirmation:\s*['"]탈퇴['"]/,
  "Hub sends the exact destructive confirmation phrase");
assert.match(hubAccountSource, /ACCOUNT_REAUTH_REQUIRED/,
  "Hub maps the server re-authentication requirement");
assert.match(hubAccountSource, /STAFF_ACCOUNT_DELETION_BLOCKED/,
  "Hub maps the server staff-account protection");
assert.match(hubCss, /\.account-danger-zone\s*\{/,
  "Hub deletion confirmation has a dedicated danger-zone surface");

// Hub Auth P1-C: explicit Google identity linking for an existing INHAGAME account.
for (const id of ["hub-linked-identities","hub-google-link-badge","hub-link-google","hub-google-link-status"]) {
  assert.equal((hubHtml.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1,
    `Hub Google identity linking has exactly one ${id} node`);
}
assert.match(hubAccountSource, /auth\.getUserIdentities\(\)/,
  "Hub reads linked identities from Supabase Auth");
assert.match(hubAccountSource, /auth\.linkIdentity\(\{[\s\S]*provider:\s*['"]google['"]/,
  "Hub explicitly links Google to the current signed-in account");
assert.match(hubAccountSource, /identity_linked=google/,
  "Hub uses a dedicated return marker for Google identity linking");
assert.match(hubAccountSource, /getPermanentSession\(\)/,
  "Hub requires a permanent signed-in session before starting identity linking");
assert.match(hubCss, /\.linked-identities\s*\{/,
  "Hub renders a dedicated identity-linking surface");

assert.equal((hubHtml.match(/href="\/campus\/\?lobby=1"/g) ?? []).length, 1,
  "Hub exposes one primary Campus entry and routes it through Main Lobby");
assert.equal(hubCatalog.games.find(game => game.id === "campus")?.playUrl, "/campus/?lobby=1",
  "Campus catalog route remains Main Lobby for non-home consumers");
assert.match(hubSource, /value === "\/campus\/\?lobby=1"/,
  "Hub catalog URL allowlist accepts the Main Lobby campus route");
assert.match(hubSource, /filter\(\(game\) => game\.id !== "campus"\)/,
  "Home game cards exclude Campus because the hero owns Campus entry");
assert.match(hubProfileSource, /raw === '\/campus\/\?lobby=1'/,
  "Profile catalog accepts the Main Lobby campus route");

// Hub Messages P0-M2: one authenticated mailbox panel, shared account client, responsive inbox/thread.
assert.match(hubSource, /new Set\(\["home", "ranking", "friends", "messages", "account", "settings"\]\)/,
  "Hub router includes friends and messages panels");
assert.equal((hubHtml.match(/data-panel="messages"/g) ?? []).length, 2,
  "desktop and mobile navigation each expose one messages entry");
assert.equal((hubHtml.match(/data-message-unread/g) ?? []).length, 2,
  "desktop and mobile navigation each carry one unread badge");
for (const id of ["hub-messages-status","hub-messages-signed-out","hub-messages-shell","hub-message-inbox-list",
  "hub-message-thread","hub-message-thread-list","hub-message-composer","hub-message-input","hub-message-send",
  "hub-message-archive","hub-message-block"]) {
  assert.equal((hubHtml.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1,
    `Hub Messages has exactly one ${id} node`);
}
assert.match(hubHtml, /id="hub-message-input"[^>]*maxlength="1000"/,
  "composer mirrors the server 1000-character cap");
assert.match(hubHtml, /hub-account\.js[\s\S]*hub-messages-client\.js[\s\S]*hub-messages\.js/,
  "shared account client loads before the messages client and UI");
assert.match(hubAccountSource, /window\.InhaHubAccountClient = client/,
  "messages reuse the existing Hub account Supabase client");
assert.match(hubAccountSource, /emailRedirectTo:\s*'https:\/\/duck\.inhagame\.example\/verify-inha\.html'/,
  "Hub Inha verification requests the reserved public-example OTP redirect");
assert.doesNotMatch(hubMessagesClientSource, /createClient\(/,
  "messages client never creates another Supabase client");
for (const rpc of ["get_my_hub_conversations_v1","get_hub_messages_v1","send_hub_message_v1",
  "mark_hub_conversation_read_v1","get_my_hub_unread_count_v1","archive_hub_conversation_v1",
  "report_hub_message_v1","block_world_user"]) {
  assert.match(hubMessagesClientSource, new RegExp(`"${rpc}"`), `messages client uses ${rpc}`);
}
assert.match(hubMessagesClientSource, /generation \+= 1/,
  "account switches invalidate stale message requests");
assert.match(hubMessagesSource, /visibilitychange/,
  "unread badge refreshes when the Hub becomes visible without polling");
assert.doesNotMatch(hubMessagesSource, /setInterval\(/,
  "messages UI adds no background polling loop");
assert.match(hubCss, /\.message-layout\{[\s\S]*grid-template-columns:minmax\(270px,340px\) minmax\(0,1fr\)/,
  "desktop messages use an inbox/thread split");
assert.match(hubCss, /@media\(max-width:720px\)\{[\s\S]*\.message-layout\{grid-template-columns:1fr\}/,
  "mobile messages collapse to one column");
console.log("Hub Messages P0-M2 static contracts PASS");

// Hub Messages P0-M3: public player card -> privacy-preserving first-message draft.
assert.match(playerCardSource, /✉ 쪽지 보내기/,
  "public player card exposes the Hub message action when messaging is injected");
assert.match(playerCardSource, /onMessage\(target\.userId\)/,
  "player-card handoff uses the trusted target user id, never nickname/DOM text");
assert.match(mainSource, /sessionStorage\.setItem\("inhagame-hub-message-draft-v1"/,
  "World hands the draft target to the same-origin Hub through sessionStorage");
assert.match(mainSource, /window\.location\.assign\("\/#messages"\)/,
  "player-card message action opens the Hub messages panel");
assert.doesNotMatch(mainSource, /message(To|Target)=|#messages\?[^"'\n]*user/i,
  "message target is never placed in the Hub URL");
assert.match(hubMessagesClientSource, /PROFILE:\s*"get_world_public_profile"/,
  "Hub re-resolves the recipient through the existing public-profile authority");
assert.match(hubMessagesClientSource, /USER_ID = \/\^\[0-9a-f\]/,
  "Hub draft target accepts UUIDs only");
assert.match(hubMessagesSource, /DRAFT_MAX_AGE_MS = 10 \* 60 \* 1000/,
  "profile handoff expires after ten minutes");
assert.match(hubMessagesSource, /sessionStorage\.removeItem\(DRAFT_KEY\)/,
  "consumed or invalid draft targets are removed");
assert.match(hubMessagesSource, /INHA_VERIFICATION_REQUIRED/,
  "first-contact refusal has a dedicated user-facing state");
assert.doesNotMatch(hubMessagesSource, /URLSearchParams|messageTo|messageTarget/,
  "Hub never reads a recipient id from the URL");
assert.match(hubCss, /\.message-draft-intro\{/,
  "new-conversation draft has a dedicated presentation state");
console.log("Hub Messages P0-M3 profile-to-message static contracts PASS");

// Hub Friends P0: social is a primary destination; settings becomes a header utility.
assert.equal((hubHtml.match(/data-panel="friends"/g) ?? []).length, 2,
  "desktop and mobile primary navigation each expose one friends entry");
assert.equal((hubHtml.match(/data-friend-request-count/g) ?? []).length, 2,
  "friends navigation carries received-request badges on desktop and mobile");
assert.equal((hubHtml.match(/data-panel="settings"/g) ?? []).length, 1,
  "settings has one header-utility entry instead of occupying primary/mobile navigation");
assert.match(hubHtml, /class="header-actions"[\s\S]*class="header-settings"[^>]*data-panel="settings"/,
  "settings lives in the top-right header utility area");
assert.doesNotMatch(
  hubHtml.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0] ?? "",
  /data-panel="settings"/,
  "mobile bottom navigation no longer spends a primary slot on settings");
for (const id of ["hub-friends-status","hub-friends-signed-out","hub-friends-shell","hub-friends-refresh",
  "hub-friends-incoming","hub-friends-list","hub-friends-outgoing","hub-friends-blocked",
  "hub-friends-incoming-count","hub-friends-count","hub-friends-outgoing-count","hub-friends-blocked-count",
  "hub-friend-profile-modal","hub-friend-profile-close","hub-friend-profile-avatar","hub-friend-profile-name",
  "hub-friend-profile-badge","hub-friend-profile-title","hub-friend-profile-relationship",
  "hub-friend-profile-verified","hub-friend-profile-actions","hub-friend-profile-status"]) {
  assert.equal((hubHtml.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1,
    `Hub Friends has exactly one ${id} node`);
}
assert.match(hubHtml, /hub-account\.js[\s\S]*hub-friends-client\.js[\s\S]*hub-friends\.js[\s\S]*hub-messages-client\.js/,
  "friends and messages reuse the shared Hub account client in deterministic order");
assert.doesNotMatch(hubFriendsClientSource, /createClient\(/,
  "friends client never creates another Supabase client");
for (const rpc of ["get_my_world_social","respond_world_friend_request","cancel_world_friend_request",
  "remove_world_friend","unblock_world_user"]) {
  assert.match(hubFriendsClientSource, new RegExp(`"${rpc}"`), `friends client uses ${rpc}`);
}
assert.match(hubFriendsSource, /sessionStorage\.setItem\(DRAFT_KEY/,
  "friend rows reuse the privacy-preserving message draft handoff");
assert.match(hubFriendsSource, /location\.hash = "messages"/,
  "friend-to-message action opens the existing Hub messages panel");
assert.match(hubHtml, /id="hub-friend-profile-modal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*hidden/,
  "friend public profile is a closed modal by default");
assert.match(hubHtml, /공개 프로필에는 닉네임·아바타·칭호·인하대 인증·관계 상태만 표시합니다/,
  "friend profile explicitly communicates its public-field boundary");
assert.match(hubFriendsClientSource, /PROFILE:\s*"get_world_public_profile"/,
  "friend profile reuses the existing public-profile authority");
assert.match(hubFriendsClientSource, /BLOCK:\s*"block_world_user"/,
  "profile block action reuses the existing World block authority");
assert.match(hubFriendsClientSource, /function parseProfile\(raw\)/,
  "friend profile has a dedicated response allowlist parser");
assert.match(hubFriendsSource, /friends\.profile\(person\.userId\)/,
  "profile modal re-resolves the trusted friend UUID before rendering actions");
assert.match(hubFriendsSource, /hub-friend-profile-trigger/,
  "friend identity rows expose a dedicated profile trigger");
assert.doesNotMatch(hubFriendsSource, /\b(?:client|supabase)\.from\(/,
  "friend profile UI performs no direct table reads");
assert.match(hubCss, /\.friend-profile-modal\{[^}]*position:fixed[^}]*inset:0/s,
  "friend profile modal owns a fixed overlay layer");
assert.match(hubCss, /@media\(max-width:650px\)\{[\s\S]*\.friend-profile-public\{grid-template-columns:1fr\}/,
  "friend public fields collapse to one column on mobile");
assert.doesNotMatch(hubFriendsSource, /setInterval\(/,
  "Hub friends adds no background polling loop");
assert.match(hubCss, /\.hub-friends-shell\{[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
  "desktop friends use a two-column management layout");
assert.match(hubCss, /@media\(max-width:760px\)\{[\s\S]*\.hub-friends-shell\{grid-template-columns:1fr\}/,
  "friends collapse to one column on compact screens");
assert.match(hubCss, /@media\(max-width:650px\)\{[\s\S]*\.header-actions\{display:flex\}/,
  "mobile keeps the settings utility visible in the top-right header");
console.log("Hub Friends P0 static contracts PASS");


// P1.6 dynamic degraded-ready checks run in the routed Campus QA even when World tests are skipped.
{
  const zoneElement = { textContent: "" };
  const friendsButton = { textContent: "", disabled: false, addEventListener() {}, setAttribute() {} };
  const summary = createLobbyPresenceSummary({
    zoneElement, friendsButton,
    getOnline: () => { throw new Error("presence unavailable"); },
    social: { available: true }
  });
  assert.doesNotThrow(() => summary.update(), "Presence failure must not escape the lobby aggregator");
  assert.equal(summary.status().degraded, true);
  assert.equal(zoneElement.textContent, "전체 접속 —");
  assert.equal(friendsButton.disabled, true);
}

{
  const root = { hidden: true };
  const stateElement = { textContent: "" };
  const titleElement = { textContent: "" };
  const objectiveElement = { textContent: "" };
  const progressElement = { textContent: "" };
  const highlight = createLobbyQuestHighlight({
    root, stateElement, titleElement, objectiveElement, progressElement,
    getTourStage: () => 0,
    getQuest: () => { throw new Error("quest unavailable"); }
  });
  assert.equal(highlight.health().degraded, true);
  assert.equal(root.hidden, false, "Quest failure falls back to the valid first-tour task");
  assert.equal(titleElement.textContent, "첫 캠퍼스 탐방");
  assert.equal(objectiveElement.textContent, "정문 통과");
}

{
  const definition = createSpawnRegistry().get(SPAWN_ID.MAIN_GATE);
  const player = {
    pos: null,
    setLocalPosition(x, y, z) { this.pos = { x, y, z }; },
    setLocalEulerAngles() {}
  };
  const lobbyWorld = { active: true, leave() { this.active = false; return true; } };
  assert.equal(enterMainGate({ player, lobbyWorld, spawnDefinition: definition }), true,
    "Optional summary degradation must not block MAIN_GATE entry");
  assert.deepEqual(player.pos, {
    x: definition.spawnAnchor.x,
    y: definition.spawnAnchor.y,
    z: definition.spawnAnchor.z
  });
}

