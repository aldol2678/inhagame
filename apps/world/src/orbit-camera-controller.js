import {inStudentCampusRegion} from './student-center-frame.js';
import {WALK_SHAPE} from './player-dimensions.js';
import { cameraSafeFraction } from "./world-collision.js";
import { CAMPUS_BIKE_ID } from "./mounts/campus-bike-world.js";
import { inMainGateCameraArea } from './main-gate-camera-collision.js';

const WALK = { initial: 3.5, min: 1.5, max: 7 };
const FLIGHT = { initial: Math.hypot(7.3, 18.5), min: 12, max: 36 };
const ANNYONGI_FLIGHT = Object.freeze({ initial: 6.2, min: 4.5, max: 16 });
export const INDOOR_CAMERA = Object.freeze({ initial: 2.2, min: 1.1, max: 3.2 });
const THIRD_PERSON_PITCH = Object.freeze({ min: -1.25, orbitMin: 0.12, max: 1.2 });
const FIRST_PERSON_PITCH = Object.freeze({ min: -1.35, max: 1.35 });
export const POINTER_LOCK_LOOK = Object.freeze({ yaw: 0.0028, pitch: 0.0024 });
export const MOUSE_DRAG_LOOK = Object.freeze({ yaw: 0.006, pitch: 0.005 });
export const MOUSE_SENSITIVITY_LIMITS = Object.freeze({ min: 0.5, max: 2 });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function flightMount() {
  return typeof document !== "undefined" && document.body?.dataset?.mountId === CAMPUS_BIKE_ID
    ? false
    : true;
}

export class OrbitCameraController {
  constructor(camera, canvas, { canUseGameplayShortcut = () => true } = {}) {
    this.camera = camera;
    this.canvas = canvas;
    this.canUseGameplayShortcut = typeof canUseGameplayShortcut === "function"
      ? canUseGameplayShortcut
      : () => true;
    this.yaw = 0;
    this.pitch = Math.atan2(7.3, 18.5);
    this.distance = WALK.initial;
    this.mounted = false;
    this.firstPerson = false;
    this.localVisualOccluded = false;
    this.distances = { walk: WALK.initial, flight: FLIGHT.initial, annyongi: ANNYONGI_FLIGHT.initial };
    this.flightProfile = "flight";
    this.thirdPersonPitch = this.pitch;
    this.firstPersonPitch = 0;
    this.target = { x: 0, y: 0, z: 0 };
    this.inputEnabled = true;
    this.pointerLockActive = false;
    this.mouseSensitivity = 1;
    this.invertMouseY = false;
    this.indoor = null;
    this.outdoorObstacles = undefined;
    this.perspectiveButton = document.getElementById("toggle-first-person");
    this.perspectiveButton?.addEventListener("click", () => {
      if (this.canUseGameplayShortcut()) this.togglePerspective();
    });
    window.addEventListener("keydown", (event) => {
      if (!this.inputEnabled || !this.canUseGameplayShortcut()) return;
      if (event.code !== "KeyV" || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "")) return;
      event.preventDefault();
      this.togglePerspective();
    });
    this.pointers = new Map();
    this.#bindInput();
  }

  get zoomLimits() { return this.indoor ? this.indoor.limits : this.mounted ? (this.flightProfile === "annyongi" ? ANNYONGI_FLIGHT : FLIGHT) : WALK; }

  // Undefined preserves Campus's default collision policy; an explicit set belongs
  // to a different outdoor coordinate frame. Indoor rooms override it temporarily.
  setOutdoorObstacles(obstacles = undefined) {
    this.outdoorObstacles = obstacles;
  }

  setIndoor(indoor = null) {
    if (indoor && !this.indoor) {
      this.indoor = { limits: indoor.limits ?? INDOOR_CAMERA, obstacles: indoor.obstacles, saved: { distance: this.distance, pitch: this.pitch } };
      this.distance = this.indoor.limits.initial;
      if (!this.firstPerson) this.pitch = clamp(this.pitch, THIRD_PERSON_PITCH.orbitMin, 0.7);
    } else if (indoor && this.indoor) {
      // A nested room transition keeps the campus camera snapshot but must use the new
      // room's walls immediately. Otherwise the chase camera can end up behind a wall.
      this.indoor.limits = indoor.limits ?? INDOOR_CAMERA;
      this.indoor.obstacles = indoor.obstacles;
      this.distance = clamp(this.distance, this.indoor.limits.min, this.indoor.limits.max);
    } else if (!indoor && this.indoor) {
      const { saved } = this.indoor;
      this.indoor = null;
      this.distance = clamp(saved.distance, this.zoomLimits.min, this.zoomLimits.max);
      if (!this.firstPerson) this.pitch = saved.pitch;
    }
  }

  setMounted(mounted) {
    const useFlight = mounted && flightMount();
    const profile = typeof document !== "undefined" && document.body?.dataset?.mountId === "annyongi" ? "annyongi" : "flight";
    if (this.mounted === useFlight && (!useFlight || this.flightProfile === profile)) return;
    this.distances[this.mounted ? this.flightProfile : "walk"] = this.distance;
    this.mounted = useFlight;
    this.flightProfile = profile;
    this.distance = clamp(this.distances[useFlight ? profile : "walk"], this.zoomLimits.min, this.zoomLimits.max);
  }

  togglePerspective() {
    if (!this.inputEnabled) return;
    if (this.firstPerson) {
      this.firstPersonPitch = this.pitch;
      this.pitch = this.thirdPersonPitch;
    } else {
      this.thirdPersonPitch = this.pitch;
      this.pitch = this.firstPersonPitch;
    }
    this.firstPerson = !this.firstPerson;
    this.pointers.clear();
    this.camera.camera.nearClip = this.firstPerson ? 0.05 : 0.3;
    this.perspectiveButton?.setAttribute("aria-pressed", String(this.firstPerson));
    if (this.perspectiveButton) this.perspectiveButton.textContent = this.firstPerson ? "👁 3인칭으로" : "👁 1인칭으로";
  }

  setInputEnabled(enabled = true) {
    this.inputEnabled = enabled === true;
    if (!this.inputEnabled) this.pointers.clear();
  }

  setPointerLockActive(active = false) {
    const next = active === true;
    if (this.pointerLockActive === next) return false;
    this.pointerLockActive = next;
    this.pointers.clear();
    return true;
  }

  setMouseLookSettings({ sensitivity = this.mouseSensitivity, invertY = this.invertMouseY } = {}) {
    const numeric = Number(sensitivity);
    this.mouseSensitivity = Number.isFinite(numeric)
      ? clamp(numeric, MOUSE_SENSITIVITY_LIMITS.min, MOUSE_SENSITIVITY_LIMITS.max)
      : 1;
    this.invertMouseY = invertY === true;
    return { sensitivity: this.mouseSensitivity, invertY: this.invertMouseY };
  }

  pointerLook(deltaX = 0, deltaY = 0) {
    if (!this.inputEnabled || !this.pointerLockActive) return false;
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return false;
    const vertical = this.invertMouseY ? -deltaY : deltaY;
    this.yaw -= deltaX * POINTER_LOCK_LOOK.yaw * this.mouseSensitivity;
    this.pitch = clamp(
      this.pitch + vertical * POINTER_LOCK_LOOK.pitch * this.mouseSensitivity,
      this.firstPerson ? FIRST_PERSON_PITCH.min : THIRD_PERSON_PITCH.min,
      this.firstPerson ? FIRST_PERSON_PITCH.max : THIRD_PERSON_PITCH.max
    );
    return true;
  }

  zoom(factor) {
    if (!this.firstPerson) this.distance = clamp(this.distance * factor, this.zoomLimits.min, this.zoomLimits.max);
  }

  #bindInput() {
    this.canvas.addEventListener("pointerdown", (event) => {
      if (!this.inputEnabled) return;
      if (this.pointerLockActive && event.pointerType === "mouse") return;
      if (event.pointerType === "mouse" && event.button !== 0 && event.button !== 1 && event.button !== 2) return;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.inputEnabled) return;
      if (this.pointerLockActive && event.pointerType === "mouse") return;
      const previous = this.pointers.get(event.pointerId);
      if (!previous) return;
      const point = { x: event.clientX, y: event.clientY };

      if (this.pointers.size === 1) {
        const mouse = event.pointerType === "mouse";
        const sensitivity = mouse ? this.mouseSensitivity : 1;
        const vertical = (point.y - previous.y) * (mouse && this.invertMouseY ? -1 : 1);
        this.yaw -= (point.x - previous.x) * MOUSE_DRAG_LOOK.yaw * sensitivity;
        this.pitch = clamp(
          this.pitch + vertical * MOUSE_DRAG_LOOK.pitch * sensitivity,
          this.firstPerson ? FIRST_PERSON_PITCH.min : THIRD_PERSON_PITCH.min,
          this.firstPerson ? FIRST_PERSON_PITCH.max : THIRD_PERSON_PITCH.max
        );
      } else if (this.pointers.size === 2) {
        const other = [...this.pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
        if (other) {
          const before = Math.hypot(previous.x - other.x, previous.y - other.y);
          const after = Math.hypot(point.x - other.x, point.y - other.y);
          if (before > 0 && after > 0) this.zoom(before / after);
        }
      }
      this.pointers.set(event.pointerId, point);
      event.preventDefault();
    });

    const endPointer = (event) => this.pointers.delete(event.pointerId);
    this.canvas.addEventListener("pointerup", endPointer);
    this.canvas.addEventListener("pointercancel", endPointer);
    this.canvas.addEventListener("lostpointercapture", endPointer);
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    this.canvas.addEventListener("wheel", (event) => {
      if (!this.inputEnabled) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.canvas.clientHeight : 1);
      this.zoom(Math.exp(delta * 0.001));
      event.preventDefault();
    }, { passive: false });
  }

  apply(position, eyeHeight = -0.35) {
    this.localVisualOccluded = false;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    if (this.firstPerson) {
      const eyeY = position.y + eyeHeight;
      const horizontal = Math.cos(this.pitch);
      this.camera.setPosition(position.x, eyeY, -position.z);
      this.camera.lookAt(position.x - sin * horizontal, eyeY - Math.sin(this.pitch), -(position.z + cos * horizontal));
      return;
    }
    const annyongi = this.mounted && this.flightProfile === "annyongi";
    const lead = this.mounted ? (annyongi ? .2 : 5.5) : 0.35;
    const height = this.mounted ? (annyongi ? .3 : 2.1) : eyeHeight;
    this.target.x = position.x - sin * lead;
    this.target.y = position.y + height;
    this.target.z = position.z + cos * lead;

    // Keep the physical chase camera on the existing safe orbit floor while allowing
    // the view itself to pitch upward. A negative spherical orbit would otherwise put
    // the camera under the campus ground at normal third-person zoom distances.
    const viewPitch = this.pitch;
    const orbitPitch = Math.max(viewPitch, THIRD_PERSON_PITCH.orbitMin);
    // Fit a 3.8-unit cloud-wing span in portrait without changing user zoom memory.
    const aspect = Number(this.camera.camera?.aspectRatio) || 1;
    const framingScale = annyongi ? Math.max(1, Math.min(1.35, .65 / aspect)) : 1;
    const framedDistance = this.distance * framingScale;
    const horizontal = Math.cos(orbitPitch) * framedDistance;
    const eye = [position.x, position.y + height, position.z];
    const candidate = [
      this.target.x + sin * horizontal,
      this.target.y + Math.sin(orbitPitch) * framedDistance,
      this.target.z - cos * horizontal
    ];
    const fraction = cameraSafeFraction(eye, candidate, this.indoor ? this.indoor.obstacles : this.outdoorObstacles);
    const cameraX = eye[0] + (candidate[0] - eye[0]) * fraction;
    const cameraY = eye[1] + (candidate[1] - eye[1]) * fraction;
    const cameraZ = -(eye[2] + (candidate[2] - eye[2]) * fraction);
    // A real wall/prop can legitimately compress the chase orbit. Hide only the
    // local body/equipment when that camera enters their envelope; keep third
    // person input, chosen zoom, the obstacle and all other actors unchanged.
    const campusOutdoor = this.outdoorObstacles === undefined;
    const studentArea=campusOutdoor && inStudentCampusRegion(eye[0],eye[2]);
    let bodyClearance=.6;
    if(studentArea&&fraction<1){
      // A collision-compressed portrait orbit can let the local body fill the
      // route before the eye enters it. Bound the projected collision diameter
      // to half the viewport width; retain intentional uncompressed close zoom.
      const lens=this.camera.camera,fov=Number(lens.fov),aspect=Number(lens.aspectRatio);
      if(fov>0&&fov<180&&aspect>0){
        const horizontalTan=Math.tan(fov*Math.PI/360)*(lens.horizontalFov?1:aspect);
        bodyClearance=Math.max(bodyClearance,WALK_SHAPE.radius/(horizontalTan*.5));
      }
    }
    // Regional walls can legitimately compress the camera into the local body
    // too. Reuse the existing local-only mask; never remove the real collider.
    const regionalCompression = !campusOutdoor && fraction < 1;
    this.localVisualOccluded = !this.indoor && !this.mounted && (regionalCompression || (campusOutdoor && inMainGateCameraArea(eye)) || studentArea) &&
      Math.hypot(cameraX - eye[0], cameraY - eye[1], -cameraZ - eye[2]) < bodyClearance;
    this.camera.setPosition(cameraX, cameraY, cameraZ);
    if (viewPitch < THIRD_PERSON_PITCH.orbitMin) {
      const viewHorizontal = Math.cos(viewPitch);
      this.camera.lookAt(
        cameraX - sin * viewHorizontal,
        cameraY - Math.sin(viewPitch),
        cameraZ - cos * viewHorizontal
      );
    } else {
      this.camera.lookAt(this.target.x, this.target.y, -this.target.z);
    }
  }
}
