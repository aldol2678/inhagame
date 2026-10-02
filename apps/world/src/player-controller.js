import {CAMPUS_BALLOON_ID,getCampusBalloonParkedPose,parkCampusBalloonAt,setCampusBalloonPropVisible} from "./mounts/campus-balloon-world.js";
import {createBalloonState,stepBalloon,BALLOON_LIMITS} from "./mounts/balloon-flight.js";
import {CAMPUS_SHUTTLE_ID,syncCampusShuttleProp} from "./mounts/campus-shuttle-world.js";
import {createTransitRuntime} from "./mobility/transit-runtime.js";
import { DUCK_BOAT_ID,getDuckBoatParkedPose,parkDuckBoatAt,setDuckBoatPropVisible } from "./mounts/duck-boat-world.js";
import { INKYUNG_DOCK,INKYUNG_WATER_Y,findDuckBoatSummonPose,stepDuckBoat,constrainDuckBoat } from "./mounts/duck-boat-motion.js";
import { createVehicleSeats } from "./mobility/vehicle-seats.js";
import { CAMPUS_KART_ID, getCampusKartParkedPose, parkCampusKartAt, setCampusKartPropVisible } from "./mounts/campus-kart-world.js";
import { CAR_LIGHT_PROFILE, stepLightCar } from "./mounts/ground-mount-motion.js";
import { CAMPUS_KICKBOARD_ID, getCampusKickboardParkedPose, parkCampusKickboardAt, setCampusKickboardPropVisible } from "./mounts/campus-kickboard-world.js";
import { GROUND_MOTION_PROFILES, stepGroundMount } from "./mounts/ground-mount-motion.js";
import { getMobilityByMountId } from "./mobility/mobility-registry.js";
import { findGroundSummonPose } from "./mobility/ground-summon.js";
import { WORLD_BOUNDS, OBSTACLES } from "./campus-layout.js";
import { moveAroundObstacles, resolveHeight, canOccupy } from "./world-collision.js";
import { MOUNT_SHAPE, PLAYER_ORIGIN_Y } from './player-dimensions.js';
import { roadviewGroundHeight } from './roadview-layout.js';
import { constrainPondWalk, overPondWater } from './landmark-detail-layout.js';
import { CAMPUS_BIKE_ID, MAIN_GATE_CAMPUS_BIKE, setCampusBikePropVisible } from './mounts/campus-bike-world.js';
import {
  CAMPUS_HELICOPTER_ID, CAMPUS_HELICOPTER, getCampusHelicopterParkedPose,
  parkCampusHelicopterAt, setCampusHelicopterPropVisible
} from './mounts/campus-helicopter-world.js';
import { createHelicopterFlightState, HELICOPTER_FLIGHT_LIMITS, stepHelicopterFlight } from './mounts/helicopter-flight.js';
import { DRAGON_MOUNT_ID } from './mounts/mount-kinds.js';

export const MOVEMENT_HUD_STATES = Object.freeze({
  WALK: "WALK",
  MOUNT_GROUND: "MOUNT_GROUND",
  MOUNT_FLIGHT: "MOUNT_FLIGHT"
});

export function movementHudState({ mounted = false, grounded = true } = {}) {
  if (!mounted) return MOVEMENT_HUD_STATES.WALK;
  return grounded ? MOVEMENT_HUD_STATES.MOUNT_GROUND : MOVEMENT_HUD_STATES.MOUNT_FLIGHT;
}

export const CAMPUS_MOVEMENT_SPACE = Object.freeze({
  id: "campus", obstacles: undefined, bounds: WORLD_BOUNDS, allowMount: true,
  groundHeight: roadviewGroundHeight, constrain: constrainPondWalk
});

const CAMPUS_OBSTACLES_WITHOUT_BIKE = Object.freeze(
  OBSTACLES.filter(({ id }) => id !== MAIN_GATE_CAMPUS_BIKE.id)
);

// NPC talk is 300. Parked vehicles must win while standing on their props.
export const BIKE_CONTEXT_PRIORITY = 320;
export const HELICOPTER_CONTEXT_PRIORITY = 330;
const BIKE_CRUISE = 9;
const BIKE_BOOST = 14;
const DRAGON_CRUISE = 11;
const DRAGON_BOOST = 18;

export const HELICOPTER_SUMMON_SHAPE = Object.freeze({
  radius: 3.2,
  footOffset: PLAYER_ORIGIN_Y,
  headOffset: 2.8
});

export function findHelicopterSummonPose({
  origin,
  yawDeg = 0,
  groundY = PLAYER_ORIGIN_Y,
  groundHeight = roadviewGroundHeight,
  canOccupyAt = (position, shape) => canOccupy(position, shape),
  overWater = overPondWater,
  bounds = WORLD_BOUNDS
} = {}) {
  if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.z)) return null;
  const baseYaw = Number.isFinite(yawDeg) ? yawDeg : 0;
  const distances = [4.8, 6.4, 8.0];
  const offsets = [0, 45, -45, 90, -90, 135, -135, 180];
  for (const distance of distances) {
    for (const offset of offsets) {
      const radians = (baseYaw + offset) * Math.PI / 180;
      const x = origin.x + Math.sin(radians) * distance;
      const z = origin.z + Math.cos(radians) * distance;
      if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) continue;
      if (overWater(x, z)) continue;
      const ground = groundHeight(x, z);
      if (!Number.isFinite(ground)) continue;
      const position = { x, y: groundY + ground, z };
      if (!canOccupyAt(position, HELICOPTER_SUMMON_SHAPE)) continue;
      return Object.freeze({ x, y: ground + 0.05, z, yaw: baseYaw });
    }
  }
  return null;
}

export class PlayerController {
  constructor(entity, {
    walkSpeed = 7,
    sprintSpeed = 12,
    jumpVelocity = 7,
    gravity = -20,
    groundY = PLAYER_ORIGIN_Y,
    bounds = WORLD_BOUNDS
  } = {}) {
    this.entity = entity;
    this.walkSpeed = walkSpeed;
    this.sprintSpeed = sprintSpeed;
    this.jumpVelocity = jumpVelocity;
    this.gravity = gravity;
    this.groundY = groundY;
    this.bounds = bounds;
    this.keys = new Set();
    this.velocityY = 0;
    this.grounded = true;
    this.touchVector = { x: 0, y: 0 };
    this.jumpQueued = false;
    this.ascendHeld = false;
    this.descendHeld = false;
    this.mounted = false;
    this.mountId = null;
    this.groundMotion = { speed: 0, yaw: 0, vx: 0, vz: 0 };
    this.kartSeats = createVehicleSeats(getMobilityByMountId(CAMPUS_KART_ID).seats);
    this.boatSeats=createVehicleSeats(getMobilityByMountId(DUCK_BOAT_ID).seats);
    this.boatMotion={speed:0,yaw:0,vx:0,vz:0};
    const shuttleDefinition=getMobilityByMountId(CAMPUS_SHUTTLE_ID);
    this.shuttle=createTransitRuntime({groundHeight:roadviewGroundHeight,canTravel:(p,from)=>{
      const {radius,height}=shuttleDefinition.summonClearance;
      const shape={radius,footOffset:this.groundY,headOffset:height-this.groundY};
      const swept=moveAroundObstacles({x:from.x,y:from.y+this.groundY,z:from.z},p.x-from.x,p.z-from.z,undefined,shape);
      return Math.hypot(swept.x-p.x,swept.z-p.z)<.001 && p.x-radius>=WORLD_BOUNDS.minX && p.x+radius<=WORLD_BOUNDS.maxX &&
        p.z-radius>=WORLD_BOUNDS.minZ && p.z+radius<=WORLD_BOUNDS.maxZ && !overPondWater(p.x,p.z) &&
        canOccupy({x:p.x,y:p.y+this.groundY,z:p.z},{radius,footOffset:this.groundY,headOffset:height-this.groundY});
    }});
    this.balloonFlight=createBalloonState();
    this.helicopterFlight = createHelicopterFlightState();
    this.mountBlocked = false;
    this.landing = false;
    this.moving = false;
    this.touchSprint = false;
    this.assist = null;
    this.space = CAMPUS_MOVEMENT_SPACE;
    this.inputEnabled = true;
    // Extra world-level block for the M key (open panels, dialogue); set by the World.
    this.transportGate = null;
    this.#syncMountKind();
    this.#bindKeyboard();
    this.#bindTouch();
    this.#bindMount();
  }

  get onBike() {
    return this.mounted && this.mountId === CAMPUS_BIKE_ID;
  }

  get onKickboard() { return this.mounted && this.mountId === CAMPUS_KICKBOARD_ID; }
  get onGroundMount() { return this.onBike || this.onKickboard || this.onKart; }
  get onSurfaceMount() { return this.onGroundMount || this.onDuckBoat || this.onShuttle; }

  get onKart() { return this.mounted && this.mountId === CAMPUS_KART_ID; }
  get onDuckBoat() { return this.mounted && this.mountId===DUCK_BOAT_ID; }
  get onShuttle(){return this.mounted&&this.mountId===CAMPUS_SHUTTLE_ID;}
  get onBalloon(){return this.mounted&&this.mountId===CAMPUS_BALLOON_ID;}
  get onHelicopter() {
    return this.mounted && this.mountId === CAMPUS_HELICOPTER_ID;
  }

  #syncMountKind() {
    if (this.entity) this.entity.mountKind = this.mountId;
    if (typeof document !== "undefined" && document.body) {
      if (this.mountId) document.body.dataset.mountId = this.mountId;
      else delete document.body.dataset.mountId;
    }
  }

  #bindKeyboard() {
    window.addEventListener("keydown", (event) => {
      if (!this.inputEnabled) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
      this.keys.add(event.code);
      if (event.code === "Space") {
        event.preventDefault();
        if (!this.onSurfaceMount) {
          this.jumpQueued = true;
          this.ascendHeld = true;
        }
      }
      // M is the transport key: the same decision as the transport button (getMountContextAction).
      if (event.code === "KeyM" && !event.repeat) this.transportAction();
    });
    window.addEventListener("keyup", (event) => {
      this.keys.delete(event.code);
      if (event.code === "Space") this.ascendHeld = false;
    });
  }

  #bindTouch() {
    const pad = document.getElementById("joystick");
    const knob = document.getElementById("joystick-knob");
    const jump = document.getElementById("jump");
    const run = document.getElementById("run");
    if (!pad || !knob || !jump || !run) return;

    let pointerId = null;
    const updatePad = (clientX, clientY) => {
      const radius = (pad.clientWidth - knob.clientWidth) / 2;
      const rect = pad.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const length = Math.hypot(dx, dy) || 1;
      if (length > radius) {
        dx = dx / length * radius;
        dy = dy / length * radius;
      }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      this.touchVector.x = dx / radius;
      this.touchVector.y = dy / radius;
    };

    const resetPad = () => {
      pointerId = null;
      this.touchVector.x = 0;
      this.touchVector.y = 0;
      knob.style.transform = "translate(0,0)";
    };

    pad.addEventListener("pointerdown", (event) => {
      if (!this.inputEnabled) return;
      pointerId = event.pointerId;
      pad.setPointerCapture(pointerId);
      updatePad(event.clientX, event.clientY);
    });
    pad.addEventListener("pointermove", (event) => {
      if (event.pointerId === pointerId) updatePad(event.clientX, event.clientY);
    });
    pad.addEventListener("pointerup", resetPad);
    pad.addEventListener("pointercancel", resetPad);
    jump.addEventListener("pointerdown", (event) => {
      if (!this.inputEnabled || this.onSurfaceMount) return;
      this.jumpQueued = true;
      this.ascendHeld = true;
      jump.setPointerCapture(event.pointerId);
    });
    const stopAscending = () => { this.ascendHeld = false; };
    jump.addEventListener("pointerup", stopAscending);
    jump.addEventListener("pointercancel", stopAscending);
    jump.addEventListener("lostpointercapture", stopAscending);
    document.getElementById("descend")?.addEventListener("pointerdown", (event) => {
      if (!this.inputEnabled) return;
      this.descendHeld = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      document.getElementById("descend")?.addEventListener(type, () => { this.descendHeld = false; });
    }

    const setRun = (enabled) => {
      this.touchSprint = enabled;
      this.#updateMovementHud();
    };
    run.addEventListener("pointerdown", (event) => {
      if (!this.inputEnabled) return;
      if (event.button !== undefined && event.button !== 0) return;
      setRun(!this.touchSprint);
    });
    run.addEventListener("click", (event) => {
      if (event.detail === 0 && !event.pointerType) setRun(!this.touchSprint);
    });
    window.addEventListener("blur", () => {
      setRun(false);
      this.ascendHeld = false;
      this.descendHeld = false;
      this.touchVector.x = 0;
      this.touchVector.y = 0;
      knob.style.transform = "translate(0,0)";
      this.keys.clear();
    });
  }

  #bindMount() {
    this.runButton = document.getElementById("run");
    this.descendButton = document.getElementById("descend");
    this.jumpButton = document.getElementById("jump");
    this.#updateMovementHud();
  }

  #updateMovementHud() {
    const state = movementHudState(this);
    const signature = `${state}:${this.mountId || "walk"}:${this.touchSprint ? 1 : 0}:${this.landing ? 1 : 0}`;
    if (this._hudSignature === signature) return;
    this._hudSignature = signature;
    this.hudState = state;
    this.#syncMountKind();
    if (document.body) document.body.dataset.movementState = state;
    const mounted = state !== MOVEMENT_HUD_STATES.WALK;
    const bike = this.onSurfaceMount;

    if (this.runButton) {
      this.runButton.hidden = this.onShuttle || this.onBalloon;
      const base = mounted ? "가속" : "RUN";
      this.runButton.textContent = this.touchSprint ? `${base} ON` : base;
      this.runButton.setAttribute("aria-pressed", String(this.touchSprint));
      this.runButton.setAttribute("aria-label", this.touchSprint
        ? mounted ? "가속 끄기" : "달리기 끄기"
        : mounted ? "가속 켜기" : "달리기 켜기");
    }
    if (this.jumpButton) {
      this.jumpButton.hidden = bike;
      this.jumpButton.textContent = mounted && !bike ? "상승" : "JUMP";
      this.jumpButton.setAttribute("aria-label", mounted && !bike ? "상승" : "점프");
      this.jumpButton.disabled = this.landing || bike;
    }
    if (this.descendButton) {
      this.descendButton.hidden = bike || state !== MOVEMENT_HUD_STATES.MOUNT_FLIGHT;
      this.descendButton.disabled = this.landing;
      this.descendButton.setAttribute("aria-label", "하강");
    }
  }

  setInputEnabled(enabled = true) {
    this.inputEnabled = enabled === true;
    if (this.inputEnabled) return;
    this.keys.clear();
    this.touchVector.x = 0;
    this.touchVector.y = 0;
    this.jumpQueued = false;
    this.ascendHeld = false;
    this.descendHeld = false;
    this.touchSprint = false;
    this.assist = null;
    this.moving = false;
    this.#updateMovementHud();
  }

  #nearParkedBike() {
    const p = this.entity.getLocalPosition();
    const a = MAIN_GATE_CAMPUS_BIKE;
    return Math.hypot(p.x - a.x, p.z - a.z) <= a.interactionRadius;
  }

  #nearParkedHelicopter() {
    const p = this.entity.getLocalPosition();
    const a = getCampusHelicopterParkedPose();
    return Math.hypot(p.x - a.x, p.z - a.z) <= CAMPUS_HELICOPTER.interactionRadius;
  }

  #nearParkedKickboard() {
    const a = getCampusKickboardParkedPose(), p = this.entity.getLocalPosition();
    return a && this.space.id === "campus" && Math.abs(p.y-this.groundY-a.y) < 0.3 && Math.hypot(p.x-a.x,p.z-a.z) <= 1.8;
  }

  summonKickboardNearPlayer() {
    if (!this.inputEnabled) return false;
    const pose = findGroundSummonPose({
      definition: getMobilityByMountId(CAMPUS_KICKBOARD_ID), origin: this.entity.getLocalPosition(),
      yawDeg: this.entity.getLocalEulerAngles?.().y ?? 0, spaceId: this.space.id,
      mounted: this.mounted, grounded: this.grounded, allowMount: this.space.allowMount,
      groundHeight: this.space.groundHeight, overWater: overPondWater,
      canOccupyAt: (p, shape) => canOccupy(p, shape, this.space.obstacles),
      bounds: this.bounds, groundY: this.groundY
    });
    if (!pose) return false;
    this.preferredMountId = CAMPUS_KICKBOARD_ID;
    return parkCampusKickboardAt(pose);
  }

  boardKickboard() {
    if (!this.inputEnabled || this.mounted || !this.grounded || !this.space.allowMount || !this.#nearParkedKickboard()) return false;
    const p = this.entity.getLocalPosition(), a = getCampusKickboardParkedPose();
    // Boarding uses the same clearance as summoning and may never teleport through a wall.
    const d = getMobilityByMountId(CAMPUS_KICKBOARD_ID);
    const shape = { radius: d.summonClearance.radius, footOffset: this.groundY, headOffset: d.summonClearance.height-this.groundY };
    if (overPondWater(p.x,p.z) || !canOccupy(p,shape,this.space.obstacles)) return false;
    this.mounted = true; this.mountId = CAMPUS_KICKBOARD_ID;
    this.landing = false; this.jumpQueued = false; this.velocityY = 0;
    this.groundMotion = { speed: 0, yaw: a.yaw, vx: 0, vz: 0 };
    setCampusKickboardPropVisible(false); this.#updateMovementHud(); return true;
  }

  dismountKickboard() {
    if (!this.onKickboard || !this.grounded) return false;
    const p = this.entity.getLocalPosition();
    parkCampusKickboardAt({ x:p.x, y:p.y-this.groundY, z:p.z, yaw:this.groundMotion.yaw });
    this.mounted=false; this.mountId=null; this.landing=false; this.velocityY=0;
    this.groundMotion={speed:0,yaw:0,vx:0,vz:0};
    this.#updateMovementHud(); return true;
  }

  #nearParkedKart() {
    const a = getCampusKartParkedPose(), p = this.entity.getLocalPosition();
    return a && this.space.id === "campus" && Math.abs(p.y-this.groundY-a.y) < 0.3 && Math.hypot(p.x-a.x,p.z-a.z) <= 1.8;
  }

  summonKartNearPlayer() {
    if (!this.inputEnabled) return false;
    const pose = findGroundSummonPose({
      definition: getMobilityByMountId(CAMPUS_KART_ID), origin: this.entity.getLocalPosition(),
      yawDeg: this.entity.getLocalEulerAngles?.().y ?? 0, spaceId: this.space.id,
      mounted: this.mounted, grounded: this.grounded, allowMount: this.space.allowMount,
      groundHeight: this.space.groundHeight, overWater: overPondWater,
      canOccupyAt: (p, shape) => canOccupy(p, shape, this.space.obstacles),
      bounds: this.bounds, groundY: this.groundY
    });
    if (!pose) return false;
    this.preferredMountId = CAMPUS_KART_ID;
    return parkCampusKartAt(pose);
  }

  boardKart() {
    if (!this.inputEnabled || this.mounted || !this.grounded || !this.space.allowMount || !this.#nearParkedKart()) return false;
    const p = this.entity.getLocalPosition(), a = getCampusKartParkedPose();
    // Boarding uses the same clearance as summoning and may never teleport through a wall.
    const d = getMobilityByMountId(CAMPUS_KART_ID);
    const shape = { radius: d.summonClearance.radius, footOffset: this.groundY, headOffset: d.summonClearance.height-this.groundY };
    if (overPondWater(p.x,p.z) || !canOccupy(p,shape,this.space.obstacles)) return false;
    if (!this.kartSeats.claim("driver", "local-player")) return false;
    this.mounted = true; this.mountId = CAMPUS_KART_ID;
    this.landing = false; this.jumpQueued = false; this.velocityY = 0;
    this.groundMotion = { speed: 0, yaw: a.yaw, vx: 0, vz: 0 };
    setCampusKartPropVisible(false); this.#updateMovementHud(); return true;
  }

  dismountKart() {
    if (!this.onKart || !this.grounded) return false;
    const p = this.entity.getLocalPosition();
    parkCampusKartAt({ x:p.x, y:p.y-this.groundY, z:p.z, yaw:this.groundMotion.yaw });
    this.kartSeats.release("driver", "local-player");
    this.mounted=false; this.mountId=null; this.landing=false; this.velocityY=0;
    this.groundMotion={speed:0,yaw:0,vx:0,vz:0};
    this.#updateMovementHud(); return true;
  }

  #nearDuckDock() {
    const p=this.entity.getLocalPosition();
    return this.space.id==="campus" && Math.hypot(p.x-INKYUNG_DOCK.shore.x,p.z-INKYUNG_DOCK.shore.z)<=4;
  }
  summonDuckBoat() {
    if(!this.inputEnabled || !this.space.allowMount)return false;
    const pose=findDuckBoatSummonPose({definition:getMobilityByMountId(DUCK_BOAT_ID),
      origin:this.entity.getLocalPosition(),spaceId:this.space.id,mounted:this.mounted,grounded:this.grounded,
      bounds:this.bounds,canOccupyAt:(p,shape)=>canOccupy(p,shape,this.space.obstacles)});
    if (!pose) return false;
    this.preferredMountId = DUCK_BOAT_ID;
    return parkDuckBoatAt(pose);
  }
  boardDuckBoat() {
    if(!this.inputEnabled || this.mounted || !this.grounded || !this.space.allowMount || !this.#nearDuckDock())return false;
    const a=getDuckBoatParkedPose();
    if(!a || Math.hypot(a.x-INKYUNG_DOCK.spawn.x,a.z-INKYUNG_DOCK.spawn.z)>3 ||
      !this.boatSeats.claim("driver","local-player"))return false;
    this.mounted=true;this.mountId=DUCK_BOAT_ID;this.velocityY=0;this.landing=false;this.jumpQueued=false;
    this.boatMotion={speed:0,yaw:a.yaw,vx:0,vz:0};
    this.entity.setLocalPosition(a.x,INKYUNG_WATER_Y+this.groundY,a.z);
    setDuckBoatPropVisible(false);this.#updateMovementHud();return true;
  }
  dismountDuckBoat() {
    if(!this.onDuckBoat)return false;
    const p=this.entity.getLocalPosition(),shore=INKYUNG_DOCK.shore;
    if(Math.hypot(p.x-INKYUNG_DOCK.spawn.x,p.z-INKYUNG_DOCK.spawn.z)>3)return false;
    const exit={x:shore.x,y:this.groundY+roadviewGroundHeight(shore.x,shore.z),z:shore.z};
    if(overPondWater(exit.x,exit.z) || !canOccupy(exit))return false;
    parkDuckBoatAt({x:p.x,y:INKYUNG_WATER_Y,z:p.z,yaw:this.boatMotion.yaw});
    this.boatSeats.release("driver","local-player");
    this.mounted=false;this.mountId=null;this.velocityY=0;this.grounded=true;
    this.entity.setLocalPosition(exit.x,exit.y,exit.z);this.#updateMovementHud();return true;
  }

  boardShuttle() {
    if(!this.inputEnabled||this.mounted||!this.grounded||this.space.id!=="campus"||!this.space.allowMount||!this.shuttle.boardingAllowed)return false;
    const p=this.entity.getLocalPosition(),a=this.shuttle.currentStation.platform;
    if(Math.hypot(p.x-a.x,p.z-a.z)>1.5)return false;
    this.mounted=true;this.mountId=CAMPUS_SHUTTLE_ID;this.velocityY=0;this.jumpQueued=false;this.landing=false;
    const bus=this.shuttle.pose;this.entity.setLocalPosition(bus.x,bus.y+this.groundY,bus.z);
    this.#updateMovementHud();return true;
  }
  dismountShuttle() {
    if(!this.onShuttle||!this.shuttle.boardingAllowed)return false;
    const a=this.shuttle.currentStation.platform,exit={x:a.x,y:roadviewGroundHeight(a.x,a.z)+this.groundY,z:a.z};
    if(overPondWater(exit.x,exit.z)||!canOccupy(exit))return false;
    this.mounted=false;this.mountId=null;this.velocityY=0;this.grounded=true;
    this.entity.setLocalPosition(exit.x,exit.y,exit.z);this.#updateMovementHud();return true;
  }
  #nearBalloon(){
    const a=getCampusBalloonParkedPose(),p=this.entity.getLocalPosition();
    return a&&this.space.id==="campus"&&Math.hypot(p.x-a.x,p.z-a.z)<=2&&Math.abs(p.y-this.groundY-a.y)<.3;
  }
  summonBalloonNearPlayer(){
    if(!this.inputEnabled)return false;
    const pose=findGroundSummonPose({definition:getMobilityByMountId(CAMPUS_BALLOON_ID),origin:this.entity.getLocalPosition(),
      yawDeg:this.entity.getLocalEulerAngles?.().y??0,spaceId:this.space.id,mounted:this.mounted,grounded:this.grounded,allowMount:this.space.allowMount,
      groundHeight:this.space.groundHeight,overWater:overPondWater,canOccupyAt:(p,shape)=>canOccupy(p,shape,this.space.obstacles),bounds:this.bounds,groundY:this.groundY});
    if (!pose) return false;
    this.preferredMountId = CAMPUS_BALLOON_ID;
    return parkCampusBalloonAt(pose);
  }
  boardBalloon(){
    if(!this.inputEnabled||this.mounted||!this.grounded||!this.space.allowMount||!this.#nearBalloon())return false;
    const a=getCampusBalloonParkedPose(),d=getMobilityByMountId(CAMPUS_BALLOON_ID),p=this.entity.getLocalPosition();
    if(overPondWater(p.x,p.z)||!canOccupy(p,{radius:d.summonClearance.radius,footOffset:this.groundY,headOffset:d.summonClearance.height-this.groundY}))return false;
    this.mounted=true;this.mountId=CAMPUS_BALLOON_ID;this.velocityY=0;this.jumpQueued=false;this.landing=false;
    this.balloonFlight=createBalloonState(a.yaw);setCampusBalloonPropVisible(false);this.#updateMovementHud();return true;
  }
  dismountBalloon(){
    if(!this.onBalloon||!this.grounded)return false;
    const p=this.entity.getLocalPosition();if(overPondWater(p.x,p.z))return false;
    parkCampusBalloonAt({x:p.x,y:p.y-this.groundY,z:p.z,yaw:this.balloonFlight.yaw});
    this.mounted=false;this.mountId=null;this.velocityY=0;this.balloonFlight=createBalloonState();
    this.#updateMovementHud();return true;
  }
  getMountContextAction() {
    if (!this.inputEnabled) return null;
    const actions = [];
    if(this.onBalloon||(!this.mounted&&this.grounded&&this.space.allowMount&&this.#nearBalloon())){
      actions.push({ mobilityId: CAMPUS_BALLOON_ID, id:"mount",icon:"🎈",label:this.onBalloon?(this.grounded?"열기구에서 내리기":"육지에 내려온 뒤 하차해 주세요"):"열기구 타기",
        compactLabel:this.onBalloon?"하차":"탑승",shortcut:"M",priority:340,pressed:this.onBalloon,
        disabled:this.onBalloon&&!this.grounded,trigger:()=>this.onBalloon?this.dismountBalloon():this.boardBalloon() });
    }

    const platform=this.shuttle.currentStation.platform,p0=this.entity.getLocalPosition();
    if(this.onShuttle || (!this.mounted&&this.grounded&&this.space.id==="campus"&&this.space.allowMount&&this.shuttle.boardingAllowed&&Math.hypot(p0.x-platform.x,p0.z-platform.z)<=1.5)){
      actions.push({ mobilityId: CAMPUS_SHUTTLE_ID, id:"mount",icon:"🚌",label:this.onShuttle?(this.shuttle.boardingAllowed?"셔틀에서 내리기":"다음 정류장 · "+this.shuttle.nextStation.name):"캠퍼스 셔틀 타기",
        compactLabel:this.onShuttle?"하차":"탑승",shortcut:"M",priority:340,pressed:this.onShuttle,
        disabled:this.onShuttle&&!this.shuttle.boardingAllowed,trigger:()=>this.onShuttle?this.dismountShuttle():this.boardShuttle() });
    }

    if(this.onDuckBoat || (!this.mounted && this.grounded && this.space.allowMount && this.#nearDuckDock() && getDuckBoatParkedPose())) {
      const p=this.entity.getLocalPosition();
      const canExit=!this.onDuckBoat || Math.hypot(p.x-INKYUNG_DOCK.spawn.x,p.z-INKYUNG_DOCK.spawn.z)<=3;
      actions.push({ mobilityId: DUCK_BOAT_ID, id:"mount",icon:"🦆",label:this.onDuckBoat ? (canExit?"선착장에 내리기":"선착장으로 돌아와 주세요"):"오리배 타기",
        compactLabel:this.onDuckBoat?"하차":"탑승",shortcut:"M",priority:340,pressed:this.onDuckBoat,disabled:!canExit,
        trigger:()=>this.onDuckBoat?this.dismountDuckBoat():this.boardDuckBoat() });
    }

    if (this.onKart || (!this.mounted && this.grounded && this.space.allowMount && this.#nearParkedKart())) {
      actions.push({ mobilityId: CAMPUS_KART_ID,  id:"mount", icon:"🛺", label:this.onKart ? "카트에서 내리기" : "카트 타기",
        compactLabel:this.onKart ? "내리기" : "탑승", shortcut:"M", priority:340,
        pressed:this.onKart, trigger:()=>this.onKart ? this.dismountKart() : this.boardKart()  });
    }

    if (this.onKickboard || (!this.mounted && this.grounded && this.space.allowMount && this.#nearParkedKickboard())) {
      actions.push({ mobilityId: CAMPUS_KICKBOARD_ID,  id:"mount", icon:"🛴", label:this.onKickboard ? "킥보드에서 내리기" : "킥보드 타기",
        compactLabel:this.onKickboard ? "내리기" : "탑승", shortcut:"M", priority:340,
        pressed:this.onKickboard, trigger:()=>this.onKickboard ? this.dismountKickboard() : this.boardKickboard()  });
    }
    if (actions.length) return actions.find(action => action.mobilityId === this.preferredMountId) ?? actions[0];
    if (this.onHelicopter) {
      if (this.landing) {
        return {
          id: "mount", icon: "🚁", label: "자동 착륙 취소", compactLabel: "착륙 취소", shortcut: "M",
          priority: HELICOPTER_CONTEXT_PRIORITY, pressed: true, trigger: () => this.cancelHelicopterLanding()
        };
      }
      return {
        id: "mount", icon: "🚁",
        label: this.grounded ? "헬리콥터에서 내리기" : "자동 착륙",
        compactLabel: this.grounded ? "내리기" : "착륙", shortcut: "M",
        priority: HELICOPTER_CONTEXT_PRIORITY, pressed: true,
        trigger: () => this.grounded ? this.dismountHelicopter() : this.startHelicopterLanding()
      };
    }
    if (!this.mounted && this.grounded && this.space.allowMount && this.#nearParkedHelicopter()) {
      return {
        id: "mount", icon: "🚁", label: "헬리콥터 타기", compactLabel: "탑승", shortcut: "M",
        priority: HELICOPTER_CONTEXT_PRIORITY, pressed: false, trigger: () => this.boardHelicopter()
      };
    }
    if (this.onBike) {
      return {
        id: "mount", icon: "🚲", label: "자전거에서 내리기", compactLabel: "내리기", shortcut: "M",
        priority: BIKE_CONTEXT_PRIORITY, pressed: true, trigger: () => this.dismountBike()
      };
    }
    if (!this.mounted && this.grounded && this.space.allowMount && this.#nearParkedBike()) {
      return {
        id: "mount", icon: "🚲", label: "자전거 타기", compactLabel: "타기", shortcut: "M",
        priority: BIKE_CONTEXT_PRIORITY, pressed: false, trigger: () => this.boardBike()
      };
    }
    if (!this.space.allowMount && !this.mounted) return null;
    const p = this.entity.getLocalPosition();
    if (this.mounted) {
      const airborne = overPondWater(p.x, p.z) ||
        p.y > this.groundY + roadviewGroundHeight(p.x, p.z) + 0.05;
      if (this.landing) {
        return { id: "mount", icon: "🐉", label: "착지 중", compactLabel: "착지 중", shortcut: "M", priority: 120,
          pressed: true, disabled: true, trigger: () => false };
      }
      return { id: "mount", icon: "🐉", label: airborne ? "착지" : "탈것에서 내리기",
        compactLabel: airborne ? "착지" : "내리기", shortcut: "M", priority: 120, pressed: true, trigger: () => this.toggleMount() };
    }
    if (!this.grounded) return null;
    return { id: "mount", icon: "🐉",
      label: this.mountBlocked ? "넓은 곳에서 탑승하세요" : "탈것 탑승",
      compactLabel: this.mountBlocked ? "좁아요" : "탑승", shortcut: "M", priority: 100, pressed: false, disabled: this.mountBlocked,
      trigger: () => this.toggleMount() };
  }

  // Transport authority. Keyboard M and the transport button both run the action that
  // getMountContextAction() offers right now: local parked vehicles first, then the dragon.
  setTransportGate(gate = null) {
    this.transportGate = typeof gate === "function" ? gate : null;
  }

  transportAction() {
    if (!this.inputEnabled || this.transportGate?.() === false) return false;
    const action = this.getMountContextAction();
    if (!action || action.disabled === true) return false;
    return action.trigger() !== false;
  }

  setMovementSpace(space = CAMPUS_MOVEMENT_SPACE) {
    this.space = space ?? CAMPUS_MOVEMENT_SPACE;
    this.bounds = this.space.bounds ?? WORLD_BOUNDS;
  }

  summonHelicopterNearPlayer() {
    if (!this.inputEnabled || this.mounted || !this.grounded || !this.space.allowMount) return false;
    const origin = this.entity.getLocalPosition();
    const pose = findHelicopterSummonPose({
      origin,
      yawDeg: this.entity.getLocalEulerAngles?.().y ?? 0,
      groundY: this.groundY,
      groundHeight: this.space.groundHeight ?? roadviewGroundHeight,
      canOccupyAt: (position, shape) => canOccupy(position, shape, this.space.obstacles),
      overWater: overPondWater,
      bounds: this.bounds
    });
    if (!pose) return false;
    parkCampusHelicopterAt(pose);
    setCampusHelicopterPropVisible(true);
    return true;
  }

  boardHelicopter() {
    if (!this.inputEnabled || this.mounted || !this.grounded || !this.space.allowMount) return false;
    if (!this.#nearParkedHelicopter()) return false;
    const parked = getCampusHelicopterParkedPose();
    this.mounted = true;
    this.mountId = CAMPUS_HELICOPTER_ID;
    this.landing = false;
    this.jumpQueued = false;
    this.velocityY = 0;
    this.helicopterFlight = createHelicopterFlightState({ yaw: parked.yaw });
    this.entity.flightAttitude = { ...this.helicopterFlight };
    this.entity.setLocalEulerAngles(0, this.helicopterFlight.yaw, 0);
    this.entity.setLocalPosition(
      parked.x,
      this.groundY + roadviewGroundHeight(parked.x, parked.z),
      parked.z
    );
    this.grounded = true;
    setCampusHelicopterPropVisible(false);
    this.#updateMovementHud();
    return true;
  }

  startHelicopterLanding() {
    if (!this.onHelicopter || this.grounded) return false;
    this.landing = true;
    this.#updateMovementHud();
    return true;
  }

  cancelHelicopterLanding() {
    if (!this.onHelicopter || !this.landing) return false;
    this.landing = false;
    this.#updateMovementHud();
    return true;
  }

  dismountHelicopter() {
    if (!this.onHelicopter || !this.grounded) return false;
    const p = this.entity.getLocalPosition();
    parkCampusHelicopterAt({
      x: p.x,
      y: p.y - this.groundY,
      z: p.z,
      yaw: this.helicopterFlight.yaw
    });
    this.mounted = false;
    this.mountId = null;
    this.landing = false;
    this.velocityY = 0;
    this.entity.flightAttitude = null;
    setCampusHelicopterPropVisible(true);
    this.#updateMovementHud();
    return true;
  }

  boardBike() {
    if (!this.inputEnabled || this.mounted || !this.grounded || !this.space.allowMount) return false;
    if (!this.#nearParkedBike()) return false;
    this.mounted = true;
    this.mountId = CAMPUS_BIKE_ID;
    this.landing = false;
    this.jumpQueued = false;
    this.velocityY = 0;
    setCampusBikePropVisible(false);
    this.#updateMovementHud();
    return true;
  }

  dismountBike() {
    if (!this.onBike) return false;
    this.mounted = false;
    this.mountId = null;
    this.landing = false;
    this.velocityY = 0;
    setCampusBikePropVisible(true);
    this.#updateMovementHud();
    return true;
  }

  toggleMount() {
    if (!this.inputEnabled) return;
    if(this.onBalloon){this.dismountBalloon();return;}

    if(this.onShuttle){this.dismountShuttle();return;}

    if(this.onDuckBoat){this.dismountDuckBoat();return;}

    if (this.onKart) { this.dismountKart(); return; }

    if (this.onKickboard) { this.dismountKickboard(); return; }
    if (this.onHelicopter) {
      if (this.landing) this.cancelHelicopterLanding();
      else if (this.grounded) this.dismountHelicopter();
      else this.startHelicopterLanding();
      return;
    }
    if (this.onBike) {
      this.dismountBike();
      return;
    }
    if (!this.space.allowMount && !this.mounted) return;
    this.mountBlocked = false;
    if (this.mounted) {
      const p=this.entity.getLocalPosition();
      if (overPondWater(p.x,p.z) || p.y > this.groundY + roadviewGroundHeight(p.x, p.z) + 0.05) {
        this.landing = true;
      } else {
        this.mounted = false;
        this.mountId = null;
        this.landing = false;
        this.velocityY = 0;
      }
    } else if (this.grounded) {
      if (!canOccupy(this.entity.getLocalPosition(), { ...MOUNT_SHAPE, footOffset: this.groundY })) {
        this.mountBlocked = true;
        this.#updateMovementHud();
        return;
      }
      this.mounted = true;
      this.mountId = DRAGON_MOUNT_ID;
      this.jumpQueued = false;
      this.velocityY = 0;
    }
    this.#updateMovementHud();
  }

  setAssistedMovement({ x = 0, z = 0, sprint = false } = {}) {
    if (!this.inputEnabled) return;
    const length = Math.hypot(x, z);
    this.assist = length > 1e-6 ? { x: x / length, z: z / length, sprint: sprint === true } : null;
  }

  clearAssistedMovement() {
    this.assist = null;
  }

  update(dt, cameraYaw = 0) {
    this.shuttle.update(dt);
    const bus=this.shuttle.pose;syncCampusShuttleProp(bus,!this.onShuttle);
    if(this.onShuttle){
      this.entity.setLocalPosition(bus.x,bus.y+this.groundY,bus.z);this.entity.setLocalEulerAngles(0,bus.yaw,0);
      this.moving=this.shuttle.transitState==="MOVING";this.grounded=true;this.velocityY=0;this.jumpQueued=false;
      this.#updateMovementHud();return;
    }

    if (this.onKickboard || this.onKart) dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1));
    if (!this.inputEnabled) {
      this.keys.clear();
      this.touchVector.x = 0;
      this.touchVector.y = 0;
      this.jumpQueued = false;
      this.ascendHeld = false;
      this.descendHeld = false;
      this.assist = null;
      this.moving = false;
      return;
    }
    let x = 0;
    let z = 0;
    let yawInput = 0;
    if (this.onHelicopter) {
      if (this.keys.has("KeyA")) x -= 1;
      if (this.keys.has("KeyD")) x += 1;
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) z += 1;
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) z -= 1;
      if (this.keys.has("ArrowLeft")) yawInput -= 1;
      if (this.keys.has("ArrowRight")) yawInput += 1;
    } else {
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) z += 1;
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) z -= 1;
    }

    x += this.touchVector.x;
    z += -this.touchVector.y;

    const mag = Math.hypot(x, z);
    if (mag > 1) {
      x /= mag;
      z /= mag;
    }

    if(this.onDuckBoat) {
      dt=Math.max(0,Math.min(Number.isFinite(dt)?dt:0,.1));
      const p=this.entity.getLocalPosition(),authorized=this.boatSeats.canDrive("local-player");
      this.boatMotion=stepDuckBoat(this.boatMotion,{throttle:authorized?z:0,steer:authorized?x:0},dt);
      const d=getMobilityByMountId(DUCK_BOAT_ID),shape={radius:d.summonClearance.radius,footOffset:this.groundY,headOffset:d.summonClearance.height-this.groundY};
      const candidate=moveAroundObstacles(p,this.boatMotion.vx*dt,this.boatMotion.vz*dt,this.space.obstacles,shape);
      const next=constrainDuckBoat(p,candidate,shape.radius);
      this.entity.setLocalPosition(next.x,INKYUNG_WATER_Y+this.groundY,next.z);
      this.entity.setLocalEulerAngles(0,this.boatMotion.yaw,0);
      this.moving=Math.hypot(next.x-p.x,next.z-p.z)>.0001;this.grounded=true;this.jumpQueued=false;this.velocityY=0;
      this.#updateMovementHud();return;
    }
    if(this.onBalloon){
      dt=Math.max(0,Math.min(Number.isFinite(dt)?dt:0,.1));
      const p=this.entity.getLocalPosition(),sin=Math.sin(cameraYaw),cos=Math.cos(cameraYaw);
      const ascend=this.ascendHeld||this.keys.has("Space");
      const descend=this.descendHeld||this.keys.has("KeyC")||this.keys.has("ControlLeft")||this.keys.has("ControlRight");
      const flight=stepBalloon(this.balloonFlight,{x:x*cos-z*sin,z:x*sin+z*cos,lift:ascend?1:descend?-1:0},dt);
      const d=getMobilityByMountId(CAMPUS_BALLOON_ID),shape={radius:d.summonClearance.radius,footOffset:this.groundY,headOffset:d.summonClearance.height-this.groundY};
      const next=moveAroundObstacles(p,flight.vx*dt,flight.vz*dt,this.space.obstacles,shape);
      next.x=Math.max(this.bounds.minX+shape.radius,Math.min(this.bounds.maxX-shape.radius,next.x));
      next.z=Math.max(this.bounds.minZ+shape.radius,Math.min(this.bounds.maxZ-shape.radius,next.z));
      const water=overPondWater(next.x,next.z),ground=this.groundY+(water?1:roadviewGroundHeight(next.x,next.z));
      const requested=Math.min(this.groundY+BALLOON_LIMITS.maxAltitude,Math.max(ground,p.y+flight.vy*dt));
      const y=resolveHeight({x:next.x,y:p.y,z:next.z},requested,ground,this.space.obstacles,shape);
      if(Math.abs(y-(p.y+flight.vy*dt))>.00001)flight.vy=0;
      this.balloonFlight=flight;this.entity.setLocalPosition(next.x,y,next.z);this.entity.setLocalEulerAngles(0,flight.yaw,0);
      this.grounded=!water&&Math.abs(y-ground)<.001;this.moving=Math.hypot(flight.vx,flight.vz,flight.vy)>.02;
      this.velocityY=0;this.jumpQueued=false;this.#updateMovementHud();return;
    }
    if (this.onHelicopter) {
      const pos = this.entity.getLocalPosition();
      const touchActive = Math.hypot(this.touchVector.x, this.touchVector.y) > 0.04;
      if (Math.abs(yawInput) < 0.01 && touchActive) {
        const cameraDegrees = cameraYaw * 180 / Math.PI;
        const delta = ((cameraDegrees - this.helicopterFlight.yaw + 540) % 360) - 180;
        yawInput = Math.max(-1, Math.min(1, delta / 50));
      }

      const ascend = this.ascendHeld || this.keys.has("Space");
      const descend = this.descendHeld || this.keys.has("KeyC") ||
        this.keys.has("ControlLeft") || this.keys.has("ControlRight");
      if (this.landing && ascend) this.landing = false;
      const collective = this.landing ? -0.72 : ascend ? 1 : descend ? -1 : 0;
      const boost = this.touchSprint || this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");

      let flight = stepHelicopterFlight(this.helicopterFlight, {
        pitch: z,
        roll: x,
        yaw: yawInput,
        collective,
        boost
      }, dt);
      const mountShape = { ...MOUNT_SHAPE, footOffset: this.groundY };
      const nextXZ = moveAroundObstacles(pos, flight.vx * dt, flight.vz * dt, undefined, mountShape);
      const water = overPondWater(nextXZ.x, nextXZ.z);
      const ground = this.groundY + (water ? 1 : roadviewGroundHeight(nextXZ.x, nextXZ.z));
      const altitudeCeiling = this.groundY + HELICOPTER_FLIGHT_LIMITS.maxAltitude;
      const requestedY = Math.min(altitudeCeiling, pos.y + flight.vy * dt);
      let nextY = resolveHeight(
        { x: nextXZ.x, y: pos.y, z: nextXZ.z },
        Math.max(ground, requestedY),
        ground,
        undefined,
        mountShape
      );
      const grounded = !water && nextY <= ground + 0.001;
      if (grounded) {
        nextY = ground;
        if (flight.vy < 0) flight = { ...flight, vy: 0 };
      }
      const nextX = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, nextXZ.x));
      const nextZ = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, nextXZ.z));

      this.helicopterFlight = flight;
      this.entity.flightAttitude = { pitch: flight.pitch, roll: flight.roll, yaw: flight.yaw };
      this.entity.setLocalEulerAngles(0, flight.yaw, 0);
      this.entity.setLocalPosition(nextX, nextY, nextZ);
      this.grounded = grounded;
      this.moving = Math.hypot(flight.vx, flight.vz) > 0.05 || Math.abs(flight.vy) > 0.05 ||
        Math.hypot(x, z) > 0.04 || Math.abs(yawInput) > 0.04;
      if (this.landing && this.grounded) this.landing = false;
      this.#updateMovementHud();
      this.jumpQueued = false;
      return;
    }

    const manual = Math.hypot(x, z) > 0.04;
    // Assisted movement may drive walking and the campus bike. Flight mounts stay manual-only
    // until a dedicated 3D navigation policy exists.
    const assisted = !manual && (!this.mounted || this.onGroundMount) && this.assist !== null;
    const sprint = assisted ? this.assist.sprint
      : this.touchSprint || this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const walkSpeed = sprint ? this.sprintSpeed : this.walkSpeed;
    const mountCruise = this.onBike ? BIKE_CRUISE : DRAGON_CRUISE;
    const mountBoost = this.onBike ? BIKE_BOOST : DRAGON_BOOST;
    const speed = this.mounted ? (sprint ? mountBoost : mountCruise) : walkSpeed;

    this.moving = manual || assisted;
    const pos = this.entity.getLocalPosition();
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    let velocityX = assisted ? this.assist.x * speed : (x * cos - z * sin) * speed;
    let velocityZ = assisted ? this.assist.z * speed : (x * sin + z * cos) * speed;
    if (this.onKickboard) {
      const profile = GROUND_MOTION_PROFILES[getMobilityByMountId(this.mountId).physicsProfile];
      this.groundMotion = stepGroundMount(this.groundMotion, {
        x: assisted ? this.assist.x : x*cos-z*sin, z: assisted ? this.assist.z : x*sin+z*cos, boost:sprint
      }, dt, profile);
      velocityX=this.groundMotion.vx; velocityZ=this.groundMotion.vz;
      this.moving=this.groundMotion.speed > 0.01;
    }
    if (this.onKart) {
      const profile = (getMobilityByMountId(this.mountId).physicsProfile === "CAR_LIGHT" ? CAR_LIGHT_PROFILE : null);
      const desiredYaw = assisted ? Math.atan2(this.assist.x,this.assist.z)*180/Math.PI : this.groundMotion.yaw;
      const steering = assisted ? Math.max(-1,Math.min(1,(((desiredYaw-this.groundMotion.yaw+540)%360)-180)/35)) : x;
      const authorized = this.kartSeats.canDrive("local-player");
      this.groundMotion = stepLightCar(this.groundMotion, {
        x: authorized ? steering : 0, z: authorized ? (assisted ? 1 : z) : 0, boost:sprint
      }, dt, profile);
      velocityX=this.groundMotion.vx; velocityZ=this.groundMotion.vz;
      this.moving=Math.abs(this.groundMotion.speed) > 0.01;
    }
    if (this.moving) this.entity.setLocalEulerAngles(0, this.onKart ? this.groundMotion.yaw : Math.atan2(velocityX, velocityZ) * 180 / Math.PI, 0);

    if (this.mounted && !this.onGroundMount) {
      const ascend = (this.ascendHeld || this.keys.has("Space")) && !this.landing;
      const descend = this.descendHeld || this.keys.has("KeyC") || this.keys.has("ControlLeft") || this.keys.has("ControlRight");
      const vertical = this.landing ? -8 : ascend ? 8 : descend ? -8 : 0;
      const proposedY = Math.min(24, pos.y + vertical * dt);
      const mountShape = { ...MOUNT_SHAPE, footOffset: this.groundY };
      const nextXZ = moveAroundObstacles(pos, velocityX * dt, velocityZ * dt, undefined, mountShape);
      const landingPosition = { x: nextXZ.x, y: pos.y, z: nextXZ.z };
      const water=overPondWater(nextXZ.x,nextXZ.z);
      const landingGround=this.groundY+(water?1:roadviewGroundHeight(nextXZ.x,nextXZ.z));
      const nextY = resolveHeight(landingPosition, Math.max(landingGround,proposedY), landingGround, undefined, mountShape);
      this.entity.setLocalPosition(
        Math.max(this.bounds.minX, Math.min(this.bounds.maxX, nextXZ.x)),
        nextY,
        Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, nextXZ.z))
      );
      this.grounded = !water && nextY === landingGround;
      this.#updateMovementHud();
      this.jumpQueued = false;
      if (this.landing && this.grounded) {
        this.mounted = false;
        this.mountId = null;
        this.landing = false;
        this.#updateMovementHud();
      }
      return;
    }

    if (this.jumpQueued && this.grounded && !this.onGroundMount) {
      this.velocityY = this.jumpVelocity;
      this.grounded = false;
    }
    this.jumpQueued = false;
    this.velocityY += this.gravity * dt;

    const space = this.space;
    const obstacles = this.onBike
      ? (space.obstacles ?? CAMPUS_OBSTACLES_WITHOUT_BIKE)
      : space.obstacles;
    const groundVehicleShape = (this.onKickboard || this.onKart) ? {
      radius: getMobilityByMountId(this.mountId).summonClearance.radius,
      footOffset: this.groundY, headOffset: getMobilityByMountId(this.mountId).summonClearance.height-this.groundY
    } : undefined;
    const nextXZ = space.constrain(pos,moveAroundObstacles(pos, velocityX * dt, velocityZ * dt, obstacles, groundVehicleShape));
    let nextX = nextXZ.x;
    let nextZ = nextXZ.z;
    const ground=this.groundY+space.groundHeight(nextX,nextZ);
    const followsGround=this.grounded&&Math.abs(pos.y-this.groundY-space.groundHeight(pos.x,pos.z))<.08;
    const requestedY=(followsGround?ground:pos.y)+this.velocityY*dt;
    let nextY = resolveHeight({ x: nextX, y: pos.y, z: nextZ }, requestedY, ground, obstacles, groundVehicleShape);

    nextX = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, nextX));
    nextZ = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, nextZ));

    if (nextY <= ground) {
      nextY = ground;
      this.velocityY = 0;
      this.grounded = true;
    } else if (this.velocityY < 0 && nextY > pos.y + this.velocityY * dt) {
      this.velocityY = 0;
      this.grounded = false;
    } else if (this.velocityY > 0 && nextY < pos.y + this.velocityY * dt) {
      this.velocityY = 0;
    }
    this.entity.setLocalPosition(nextX, nextY, nextZ);
    if (this.mountBlocked && canOccupy(this.entity.getLocalPosition(), { ...MOUNT_SHAPE, footOffset: this.groundY })) {
      this.mountBlocked = false;
      this.#updateMovementHud();
    }
  }
}

