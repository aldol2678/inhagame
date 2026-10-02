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
        if (!this.onBike) {
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
      if (!this.inputEnabled || this.onBike) return;
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
    const bike = this.onBike;

    if (this.runButton) {
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

  getMountContextAction() {
    if (!this.inputEnabled) return null;
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
    const assisted = !manual && (!this.mounted || this.onBike) && this.assist !== null;
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
    const velocityX = assisted ? this.assist.x * speed : (x * cos - z * sin) * speed;
    const velocityZ = assisted ? this.assist.z * speed : (x * sin + z * cos) * speed;
    if (this.moving) this.entity.setLocalEulerAngles(0, Math.atan2(velocityX, velocityZ) * 180 / Math.PI, 0);

    if (this.mounted && !this.onBike) {
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

    if (this.jumpQueued && this.grounded && !this.onBike) {
      this.velocityY = this.jumpVelocity;
      this.grounded = false;
    }
    this.jumpQueued = false;
    this.velocityY += this.gravity * dt;

    const space = this.space;
    const obstacles = this.onBike
      ? (space.obstacles ?? CAMPUS_OBSTACLES_WITHOUT_BIKE)
      : space.obstacles;
    const nextXZ = space.constrain(pos,moveAroundObstacles(pos, velocityX * dt, velocityZ * dt, obstacles));
    let nextX = nextXZ.x;
    let nextZ = nextXZ.z;
    const ground=this.groundY+space.groundHeight(nextX,nextZ);
    const followsGround=this.grounded&&Math.abs(pos.y-this.groundY-space.groundHeight(pos.x,pos.z))<.08;
    const requestedY=(followsGround?ground:pos.y)+this.velocityY*dt;
    let nextY = resolveHeight({ x: nextX, y: pos.y, z: nextZ }, requestedY, ground, obstacles);

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
