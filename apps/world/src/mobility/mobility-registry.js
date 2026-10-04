import {CAMPUS_BALLOON_ID} from "../mounts/campus-balloon-world.js";
import { CAMPUS_SHUTTLE_ID } from "../mounts/campus-shuttle-world.js";
import { DUCK_BOAT_ID } from "../mounts/duck-boat-world.js";
import { CAMPUS_KART_ID } from "../mounts/campus-kart-world.js";
import { CAMPUS_KICKBOARD_ID } from "../mounts/campus-kickboard-world.js";
// INHA WORLD · Mobility Registry P0.8.
// Presentation/runtime metadata only. Ownership remains the Collection authority and no entry here
// grants a player a mount. HIDDEN definitions remain addressable to code but never appear in the book.

import { CAMPUS_BIKE_ID } from "../mounts/campus-bike-world.js";
import { CAMPUS_HELICOPTER_ID } from "../mounts/campus-helicopter-world.js";
import { DRAGON_MOUNT_ID } from "../mounts/mount-kinds.js";

export const MOBILITY_AVAILABILITY = Object.freeze({
  EXPERIMENTAL: "EXPERIMENTAL",
  AVAILABLE: "AVAILABLE",
  LOCKED_PROGRESS: "LOCKED_PROGRESS",
  COMING_SOON: "COMING_SOON",
  DISABLED: "DISABLED",
  HIDDEN: "HIDDEN"
});

export const MOBILITY_ACCESS = Object.freeze({
  TEST_ONLY: "TEST_ONLY",
  OWNED: "OWNED",
  EVENT: "EVENT",
  SYSTEM: "SYSTEM"
});

export const SUMMON_POLICY = Object.freeze({
  NEAR_PLAYER: "NEAR_PLAYER",
  FIXED_ANCHOR: "FIXED_ANCHOR",
  CLEAR_AREA: "CLEAR_AREA",
  WATER_SPAWN: "WATER_SPAWN",
  LANDING_PAD: "LANDING_PAD"
});

const freezeDefinition = (definition) => Object.freeze({
  ...definition,
  domains: Object.freeze([...(definition.domains ?? [])]),
  seats: Object.freeze((definition.seats ?? []).map(Object.freeze)),
  summonClearance: Object.freeze({ ...(definition.summonClearance ?? {}) }),
  capabilities: Object.freeze({ ...(definition.capabilities ?? {}) }),
  technical: Object.freeze({ ...(definition.technical ?? {}) })
});

export const MOBILITY_REGISTRY = Object.freeze([
 freezeDefinition({
   mobilityId:"aircraft.balloon.campus_prototype",mountId:CAMPUS_BALLOON_ID,displayName:"열기구",emoji:"🎈",
   category:"AIRCRAFT",domains:["AIR"],availability:MOBILITY_AVAILABILITY.EXPERIMENTAL,access:MOBILITY_ACCESS.TEST_ONLY,
   statusLabel:"실험중",accessLabel:"테스트 전용",description:"부력과 공기 저항으로 천천히 상승·하강하는 1인승 실험용 열기구입니다.",
   activeEligible:false,activeBlockedReason:"테스트 전용 열기구는 기본 탈것으로 저장하지 않아요.",
   physicsProfile:"BUOYANCY",inputProfile:"BALLOON",propulsion:"BUOYANCY",cameraProfile:"BALLOON_CHASE",hudProfile:"BALLOON_LIGHT",networkProfile:"VEHICLE_BUOYANCY",
   summonPolicy:SUMMON_POLICY.CLEAR_AREA,summonClearance:{radius:3.6,height:10.3},spawnDomain:"GROUND",
   spawnAnchorPolicy:"NEAR_PLAYER_SAFE_AREA",summonEnabled:true,primaryAction:"SUMMON_TEST",primaryLabel:"소환 테스트",
   summonLabel:"넓은 지상 공간",summonHint:"기구 전체가 들어가는 넓은 실외 공간이 필요해요. 육지에 내려온 뒤 하차할 수 있어요.",
   seats:[{id:"pilot",role:"PILOT",controls:true}],capabilities:{buoyancy:true,land:true},
   technical:{PHYSICS:"BUOYANCY",INPUT:"BALLOON",PROPULSION:"BUOYANCY",HUD:"BALLOON_LIGHT",NETWORK:"VEHICLE_BUOYANCY"}
 }),
  freezeDefinition({
    mobilityId:"transit.campus_shuttle",mountId:CAMPUS_SHUTTLE_ID,displayName:"캠퍼스 셔틀",emoji:"🚌",
    category:"TRANSIT",domains:["GROUND"],availability:MOBILITY_AVAILABILITY.HIDDEN,access:MOBILITY_ACCESS.TEST_ONLY,
    statusLabel:"송도캠퍼스 구현 후",accessLabel:"테스트 전용",
    description:"송도캠퍼스 노선 구현 전까지 월드와 이동수단 도감에서 숨기는 셔틀 프로토타입입니다.",
    activeEligible:false,activeBlockedReason:"노선 운행형 교통수단은 기본 탈것으로 설정하지 않아요.",
    physicsProfile:"PATH_CONSTRAINED",inputProfile:"AUTOPILOT",propulsion:"WHEEL_MOTOR",cameraProfile:"TRANSIT_CHASE",hudProfile:"TRANSIT_LIGHT",networkProfile:"TRANSIT_LOCAL_P0",
    summonPolicy:SUMMON_POLICY.FIXED_ANCHOR,summonClearance:{radius:1.6,height:2.8},spawnDomain:"GROUND",
    spawnAnchorPolicy:"CAMPUS_SHUTTLE_ROUTE",summonEnabled:false,primaryAction:"LOCATE_TEST",primaryLabel:"정류장 안내",
    summonLabel:"노선 자동 운행",summonHint:"정문 승강장의 파란 표식에서 기다려 주세요. 정차 중 M 또는 탑승 버튼으로 타고 내릴 수 있어요.",
    seats:[{id:"passenger",role:"PASSENGER",controls:false}],capabilities:{transit:true,autopilot:true},
    technical:{PHYSICS:"PATH_CONSTRAINED",INPUT:"AUTOPILOT",ROUTE:"campus.main_gate_test",NETWORK:"LOCAL_P0 · 공유 운행 미지원"}
  }),
  freezeDefinition({
    mobilityId: "vehicle.kart.campus_prototype",
    mountId: CAMPUS_KART_ID, displayName: "캠퍼스 카트", emoji: "🛺",
    category: "VEHICLE", domains: ["GROUND"],
    availability: MOBILITY_AVAILABILITY.EXPERIMENTAL, access: MOBILITY_ACCESS.TEST_ONLY,
    statusLabel: "실험중", accessLabel: "테스트 전용",
    description: "운전자 1명과 승객 3명의 좌석 계약을 검증합니다. 현재 실험에서는 운전석만 이용할 수 있으며 다른 플레이어의 동승은 아직 지원하지 않아요.",
    activeEligible: false,
    activeBlockedReason: "정식 소유권 연동 전에는 기본 탈것으로 설정할 수 없어요.",
    physicsProfile: "CAR_LIGHT", inputProfile: "CAR", propulsion: "WHEEL_MOTOR",
    cameraProfile: "GROUND_CHASE", hudProfile: "GROUND_LIGHT", networkProfile: "VEHICLE_GROUND",
    summonUX: "NEARBY",
    summonPolicy: SUMMON_POLICY.CLEAR_AREA, summonClearance: { radius: 1.7, height: 2.5 },
    spawnDomain: "GROUND", spawnAnchorPolicy: "NEAR_PLAYER_SAFE_AREA", summonEnabled: true,
    primaryAction: "SUMMON_TEST", primaryLabel: "카트 호출", summonLabel: "가까운 안전 지점 자동 배치",
    summonHint: "현재 위치 주변을 최대 약 50m까지 탐색해 가장 가까운 평탄한 빈 공간에 카트를 배치해요.",
    seats: [
      { id:"driver", role:"DRIVER", controls:true, offset:{x:-0.42,y:0.4,z:0.35} },
      { id:"passenger_1", role:"PASSENGER", controls:false, offset:{x:0.42,y:0.4,z:0.35} },
      { id:"passenger_2", role:"PASSENGER", controls:false, offset:{x:-0.42,y:0.4,z:-0.45} },
      { id:"passenger_3", role:"PASSENGER", controls:false, offset:{x:0.42,y:0.4,z:-0.45} }
    ],
    capabilities: { ride: true, park: true, jump: false },
    technical: { PHYSICS: "CAR_LIGHT", INPUT: "CAR", PROPULSION: "WHEEL_MOTOR",
      CAMERA: "GROUND_CHASE", HUD: "GROUND_LIGHT", NETWORK: "VEHICLE_GROUND · 좌석 동기화 미지원" }
  }),
  freezeDefinition({
    mobilityId: "vehicle.kickboard.campus_prototype",
    mountId: CAMPUS_KICKBOARD_ID, displayName: "전동 킥보드", emoji: "🛴",
    category: "PERSONAL_MOUNT", domains: ["GROUND"],
    availability: MOBILITY_AVAILABILITY.EXPERIMENTAL, access: MOBILITY_ACCESS.TEST_ONLY,
    statusLabel: "실험중", accessLabel: "테스트 전용",
    description: "빠른 모터 가속과 좁은 회전을 검증하는 1인승 지상 탈것입니다.",
    activeEligible: false,
    activeBlockedReason: "정식 소유권 연동 전에는 기본 탈것으로 설정할 수 없어요.",
    physicsProfile: "KICKBOARD", inputProfile: "BIKE_LIKE", propulsion: "WHEEL_MOTOR",
    cameraProfile: "GROUND_CHASE", hudProfile: "GROUND_LIGHT", networkProfile: "VEHICLE_GROUND",
    summonUX: "INSTANT",
    summonPolicy: SUMMON_POLICY.NEAR_PLAYER, summonClearance: { radius: 0.65, height: 1.9 },
    spawnDomain: "GROUND", spawnAnchorPolicy: "NEAR_PLAYER_SAFE_GROUND", summonEnabled: true,
    primaryAction: "SUMMON_TEST", primaryLabel: "바로 타기", summonLabel: "즉시 소환·탑승",
    summonHint: "실외의 마른 지상에서는 현재 위치에서 바로 킥보드를 꺼내 타요. 실내·수면·공중에서는 이용할 수 없어요.",
    seats: [{ id: "rider", role: "RIDER", controls: true }],
    capabilities: { ride: true, park: true, jump: false },
    technical: { PHYSICS: "KICKBOARD", INPUT: "BIKE_LIKE", PROPULSION: "WHEEL_MOTOR",
      CAMERA: "GROUND_CHASE", HUD: "GROUND_LIGHT", NETWORK: "VEHICLE_GROUND" }
  }),
  freezeDefinition({
    mobilityId: "vehicle.helicopter.campus_prototype",
    mountId: CAMPUS_HELICOPTER_ID,
    displayName: "캠퍼스 헬리콥터",
    emoji: "🚁",
    category: "AIRCRAFT",
    domains: ["GROUND", "AIR"],
    availability: MOBILITY_AVAILABILITY.EXPERIMENTAL,
    access: MOBILITY_ACCESS.TEST_ONLY,
    statusLabel: "실험중",
    accessLabel: "테스트 전용",
    description: "비행 조작과 계기판을 검증하는 실험용 헬리콥터입니다.",
    activeEligible: false,
    activeBlockedReason: "정식 소유권 연동 전에는 기본 탈것으로 설정할 수 없어요.",
    summonUX: "PAD",
    summonPolicy: SUMMON_POLICY.LANDING_PAD,
    summonClearance: { radius: 3.2, height: 3.0 },
    spawnDomain: "GROUND",
    spawnAnchorPolicy: "NEAR_PLAYER_SAFE_AREA_OR_STADIUM_PAD",
    summonEnabled: true,
    primaryAction: "SUMMON_TEST",
    primaryLabel: "헬기 호출",
    summonLabel: "주변 착륙지 · 대운동장 fallback",
    summonHint: "가까운 착륙 가능 지점을 먼저 찾고, 공간이 없으면 대운동장 안전 패드에 헬리콥터를 배치해요.",
    seats: [{ id: "pilot", role: "PILOT", controls: true }],
    capabilities: { hover: true, land: true, assistedLanding: true },
    technical: {
      PHYSICS: "HELICOPTER",
      INPUT: "HELICOPTER",
      PROPULSION: "ROTOR",
      HUD: "FLIGHT_LIGHT",
      NETWORK: "VEHICLE_FLIGHT"
    }
  }),
  freezeDefinition({
    mobilityId: "vehicle.bicycle.campus_prototype",
    mountId: CAMPUS_BIKE_ID,
    displayName: "캠퍼스 자전거",
    emoji: "🚲",
    category: "PERSONAL_MOUNT",
    domains: ["GROUND"],
    availability: MOBILITY_AVAILABILITY.EXPERIMENTAL,
    access: MOBILITY_ACCESS.TEST_ONLY,
    statusLabel: "실험중",
    accessLabel: "테스트 전용",
    description: "지상 이동과 탑승 동작을 검증하는 실험용 자전거입니다.",
    activeEligible: false,
    activeBlockedReason: "정식 소유권 연동 전에는 기본 탈것으로 설정할 수 없어요.",
    summonPolicy: SUMMON_POLICY.FIXED_ANCHOR,
    summonClearance: { radius: 0.8, height: 1.4 },
    spawnDomain: "GROUND",
    spawnAnchorPolicy: "MAIN_GATE_TEST_ANCHOR",
    summonEnabled: false,
    primaryAction: "LOCATE_TEST",
    primaryLabel: "테스트 위치 안내",
    summonLabel: "정문 고정 위치",
    summonHint: "현재 자전거 시각물과 충돌 영역은 정문 고정 기준이라 동적 소환하지 않아요.",
    seats: [{ id: "rider", role: "RIDER", controls: true }],
    capabilities: { park: true, ride: true },
    technical: {
      PHYSICS: "BICYCLE",
      INPUT: "BIKE",
      PROPULSION: "PEDAL",
      HUD: "GROUND_LIGHT",
      NETWORK: "VEHICLE_GROUND"
    }
  }),
  freezeDefinition({
    mobilityId: "creature.annyongi_dragon",
    mountId: DRAGON_MOUNT_ID,
    displayName: "안뇽이 비룡",
    emoji: "🐉",
    category: "CREATURE",
    domains: ["AIR"],
    availability: MOBILITY_AVAILABILITY.LOCKED_PROGRESS,
    access: MOBILITY_ACCESS.EVENT,
    statusLabel: "이벤트",
    accessLabel: "이벤트 보상",
    description: "이벤트 보상형 SPECIAL 비행 탈것입니다. 기본 지급 탈것이 아닙니다.",
    activeEligible: false,
    activeBlockedReason: "획득 후에만 기본 탈것으로 설정할 수 있어요.",
    summonPolicy: SUMMON_POLICY.CLEAR_AREA,
    summonClearance: { radius: 1.2, height: 2.1 },
    spawnDomain: "GROUND",
    spawnAnchorPolicy: "PLAYER_CLEAR_AREA",
    summonEnabled: false,
    primaryAction: "LOCKED",
    primaryLabel: "획득 정보",
    summonLabel: "넓은 곳에 소환",
    summonHint: "획득 후 주변 공간이 충분할 때 소환할 수 있어요.",
    seats: [{ id: "rider", role: "RIDER", controls: true }],
    capabilities: { fly: true, land: true },
    technical: {
      PHYSICS: "CREATURE_FLIGHT",
      INPUT: "FLIGHT_ASSIST",
      PROPULSION: "ANIMAL",
      HUD: "FLIGHT_LIGHT",
      ACQUISITION: "EVENT"
    }
  }),
  freezeDefinition({
    mobilityId:"vessel.inkyung_duckboat",mountId:DUCK_BOAT_ID,displayName:"인경호 오리배",emoji:"🦆",
    category:"VESSEL",domains:["WATER_SURFACE"],availability:MOBILITY_AVAILABILITY.EXPERIMENTAL,access:MOBILITY_ACCESS.TEST_ONLY,
    statusLabel:"실험중",accessLabel:"테스트 전용",
    description:"인경호 남쪽 선착장에 준비된 2인승 오리배입니다. 현재 조종석만 이용할 수 있으며 다른 플레이어 동승은 미지원입니다.",
    activeEligible:false,activeBlockedReason:"테스트 전용 탈것은 기본 탈것으로 저장하지 않아요.",
    physicsProfile:"BOAT",inputProfile:"BOAT",propulsion:"PEDAL",cameraProfile:"WATER_CHASE",hudProfile:"WATER_LIGHT",networkProfile:"VEHICLE_WATER",
    summonUX:"DOCK",summonPolicy:SUMMON_POLICY.FIXED_ANCHOR,summonClearance:{radius:1.3,height:2.2},
    spawnDomain:"WATER_SURFACE",spawnAnchorPolicy:"INKYUNG_DOCK",summonEnabled:false,
    primaryAction:"LOCATE_TEST",primaryLabel:"선착장 위치 안내",summonLabel:"선착장 고정 이용",
    summonHint:"인경호 남쪽의 갈색 선착장으로 가면 오리배가 준비되어 있어요. 선착장 가까이에서 탑승하고, 하차할 때도 선착장으로 돌아와 주세요.",
    locateStatus:"🦆 오리배는 인경호 남쪽 갈색 선착장에서 바로 이용할 수 있어요.",
    seats:[{id:"driver",role:"DRIVER",controls:true,offset:{x:-.3,y:.3,z:0}},
      {id:"passenger",role:"PASSENGER",controls:false,offset:{x:.3,y:.3,z:0}}],
    capabilities:{float:true,ride:true,jump:false},
    technical:{PHYSICS:"BOAT",INPUT:"BOAT",PROPULSION:"PEDAL",HUD:"WATER_LIGHT",NETWORK:"VEHICLE_WATER · 좌석 동기화 미지원",UX:"DOCK"}
  }),
  freezeDefinition({
    mobilityId: "spacecraft.inha_explorer.prototype",
    mountId: null,
    displayName: "INHA Explorer",
    emoji: "🚀",
    category: "SPACECRAFT",
    domains: ["GROUND", "AIR", "SPACE"],
    availability: MOBILITY_AVAILABILITY.HIDDEN,
    access: MOBILITY_ACCESS.SYSTEM,
    statusLabel: "숨김",
    accessLabel: "시스템",
    description: "장기 Spacecraft-ready 스키마 검증용 숨김 정의입니다.",
    activeEligible: false,
    activeBlockedReason: "플레이 콘텐츠가 아니에요.",
    summonPolicy: SUMMON_POLICY.LANDING_PAD,
    summonClearance: { radius: 12, height: 18 },
    spawnDomain: "GROUND",
    spawnAnchorPolicy: "SPACEPORT",
    summonEnabled: false,
    primaryAction: "HIDDEN",
    primaryLabel: "숨김",
    summonLabel: "착륙장·우주항",
    summonHint: "대형 우주선은 지정 착륙장과 안전 반경을 요구하도록 예약돼 있어요.",
    seats: [
      { id: "pilot", role: "PILOT", controls: true },
      { id: "copilot", role: "COPILOT", controls: false },
      { id: "engineer", role: "ENGINEER", controls: false }
    ],
    capabilities: { atmosphericFlight: true, orbitalFlight: true, docking: true, land: true },
    technical: {
      PHYSICS: "SPACECRAFT_6DOF",
      INPUT: "SPACE_6DOF",
      PROPULSION: "ROCKET + RCS",
      HUD: "SPACECRAFT",
      NETWORK: "VEHICLE_SPACE"
    }
  })
]);

export function getMobilityDefinition(mobilityId) {
  return MOBILITY_REGISTRY.find((definition) => definition.mobilityId === mobilityId) ?? null;
}

export function getMobilityByMountId(mountId) {
  return MOBILITY_REGISTRY.find((definition) => definition.mountId === mountId) ?? null;
}

export function getPlayerVisibleMobility() {
  return MOBILITY_REGISTRY.filter((definition) => definition.availability !== MOBILITY_AVAILABILITY.HIDDEN);
}

export function mobilityMatchesFilter(definition, filter = "ALL") {
  if (!definition) return false;
  if (filter === "ALL") return true;
  if (filter === "GROUND") return definition.domains.includes("GROUND");
  if (filter === "WATER") return definition.domains.some((domain) => domain.startsWith("WATER_"));
  if (filter === "AIR") return definition.domains.includes("AIR");
  if (filter === "SPACE") return definition.domains.includes("SPACE");
  if (filter === "TRANSIT") return definition.category === "TRANSIT";
  return false;
}

export function mobilityMatchesQuery(definition, query = "") {
  const needle = String(query).trim().toLocaleLowerCase("ko-KR");
  if (!needle) return true;
  return [definition.displayName, definition.category, ...definition.domains]
    .join(" ")
    .toLocaleLowerCase("ko-KR")
    .includes(needle);
}
