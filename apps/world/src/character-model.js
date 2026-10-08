import { CAMPUS_BALLOON_ID } from "./mounts/campus-balloon-world.js";
import { createCampusBalloon } from "./mounts/campus-balloon-render.js";
import { CAMPUS_SHUTTLE_ID } from "./mounts/campus-shuttle-world.js";
import { createCampusShuttle } from "./mounts/campus-shuttle-render.js";
import { DUCK_BOAT_ID } from "./mounts/duck-boat-world.js";
import { createDuckBoat } from "./mounts/duck-boat-render.js";
import { CAMPUS_KART_ID } from "./mounts/campus-kart-world.js";
import { createCampusKart } from "./mounts/campus-kart-render.js";
import { CAMPUS_KICKBOARD_ID } from "./mounts/campus-kickboard-world.js";
import { createCampusKickboard } from "./mounts/campus-kickboard-render.js";
import * as pc from "playcanvas";
import { composeEmotePose, emoteOffsets, REST_OFFSETS } from "./online/emotes.js";
import { SIT_OFFSETS } from "./seat-anchors.js";
import { HUMAN_HEIGHT, PLAYER_ORIGIN_Y } from './player-dimensions.js';
import { CAMPUS_BIKE_ID } from './mounts/campus-bike-world.js';
import { attachRiderBike } from './mounts/campus-bike-rider.js';
import { CAMPUS_HELICOPTER_ID } from './mounts/campus-helicopter-world.js';
import { attachRiderHelicopter } from './mounts/campus-helicopter-rider.js';
import { createEquipmentAnchors } from './appearance/equipment-anchors.js';

const palette = {
  white: "#f7f6ed", softWhite: "#dfeaf0", navy: "#203952", darkNavy: "#122a40",
  orange: "#f3a431", ink: "#172430", blue: "#91d5ed", blueLight: "#b8e8f3",
  cream: "#f7dc83", pink: "#f5a7b9", saddle: "#375778"
};

function material(hex) {
  const value = parseInt(hex.slice(1), 16);
  const result = new pc.StandardMaterial();
  result.diffuse = new pc.Color(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
  result.update();
  return result;
}
const mats = Object.fromEntries(Object.entries(palette).map(([key, value]) => [key, material(value)]));

// Reserved instance/light mask bit: the fill can illuminate Annyongi meshes only.
// Share two unshadowed lights per application, never two per remote avatar.
const ANNYONGI_LIGHT_MASK = 1 << 8;
const annyongiLightOwners = new WeakMap();
function acquireAnnyongiFill(app) {
  let owner = annyongiLightOwners.get(app);
  if (!owner) {
    const root = new pc.Entity('Annyongi_ReadabilityFill');
    const lights = [[38, 25, .85], [25, 205, .38]].map(([pitch, yaw, strength]) => {
      const entity = new pc.Entity('Annyongi_PrivateFill');
      entity.addComponent('light', { type: 'directional', color: new pc.Color(.80, .91, 1), intensity: 0, castShadows: false, mask: ANNYONGI_LIGHT_MASK });
      entity.setLocalEulerAngles(pitch, yaw, 0);root.addChild(entity);
      return { entity, strength };
    });
    app.root.addChild(root);
    owner = { root, lights, users: 0 };
    annyongiLightOwners.set(app, owner);
  }
  owner.users++;
  return { update(night) { for (const {entity, strength} of owner.lights) entity.light.intensity = night * strength; },
    release() { if (--owner.users === 0) { owner.root.destroy(); annyongiLightOwners.delete(app); } } };
}

// [body pitch, wing deployment, ascent/forward/glide tail weights,
//  wing frequency, amplitude, sweep, dihedral, vertical lift]. +Z is forward.
const ANNYONGI_FLIGHT_POSES = Object.freeze({
  ground: [0, 0, 0, 0, 0, 3, 0, 18, 58, 0],
  hover: [0, .70, 0, 0, 0, 3, 17, 8, 8, .04],
  ascend: [-32, 1, 1, 0, 0, 11, 48, -10, 28, .18],
  forward: [58, .92, 0, 1, 0, 6, 14, 38, -14, .12],
  descend: [24, 1, 0, 0, 1, 2, 3, -18, 3, -.06]
});

const DUCK_BOUNDS = { glb: { bottom: -1.195, top: 1.67 }, fallback: { bottom: -1.1425, top: 1.205 } };
const BIKE_RIDER_FOOT_Y = 0.31;
const BIKE_RIDER_Z = -0.07;
const BIKE_RIDER_PITCH = 17;
const BIKE_LEG_BEND = 62;
const HELICOPTER_RIDER_FOOT_Y = 0.4;
const HELICOPTER_RIDER_Z = 0.18;

function duckPose(modelState, mounted, bike = false, helicopter = false, bob = 0) {
  const bounds = DUCK_BOUNDS[modelState === 'glb' ? 'glb' : 'fallback'];
  const scale = HUMAN_HEIGHT / (bounds.top - bounds.bottom);
  const bottomY = !mounted ? -PLAYER_ORIGIN_Y
    : bike ? BIKE_RIDER_FOOT_Y - PLAYER_ORIGIN_Y
      : helicopter ? HELICOPTER_RIDER_FOOT_Y - PLAYER_ORIGIN_Y
        : .55;
  const y = bottomY - bounds.bottom * scale + bob;
  return { scale, y, feetY: bottomY + bob, labelY: y + bounds.top * scale + .15 };
}

function part(parent, name, type, pos, scale, surface, angles = [0, 0, 0]) {
  const entity = new pc.Entity(name);
  entity.addComponent("render", { type });
  entity.render.material = mats[surface];
  entity.setLocalPosition(...pos);
  entity.setLocalScale(...scale);
  entity.setLocalEulerAngles(...angles);
  parent.addChild(entity);
  return entity;
}

function ridingBike(player) {
  return player.mountKind === CAMPUS_BIKE_ID;
}

function ridingHelicopter(player) {
  return player.mountKind === CAMPUS_HELICOPTER_ID;
}

export function createCharacter(app, player, { assetShadow = null, assetCanary = null, assetCanarySubjectKey = null } = {}) {
  // Independently authored QA cuboids; no original mascot fallback recipe.
  const duck = new pc.Entity("Public_QA_Avatar");
  player.addChild(duck);
  part(duck,"QA_Box","box",[0,0,0],[.8,2.3475,.8],"softWhite");
  const duckWings = [-1,1].map(side => part(duck,`QA_Arm_${side}`,"box",[side*.5,0,0],[.1,.3,.1],"softWhite"));
  const dragon = new pc.Entity("Public_QA_Carrier");
  player.addChild(dragon);
  dragon.enabled = false;
  part(dragon,"QA_Platform","box",[0,0,0],[1.4,.3,1.4],"softWhite");
  const dragonWings = [-1,1].map(side => part(dragon,`QA_Pivot_${side}`,"box",[side*.7,0,0],[.1,.1,.1],"softWhite"));
  const riderBike = attachRiderBike(player);
  const riderHelicopter = attachRiderHelicopter(player);
  // Equipment anchors live under the player (not under the active visual), so the fallback→GLB swap
  // keeps every attached equipment entity; the root copies the body pose in positionDuck.
  const equipment = createEquipmentAnchors({ createEntity: name => new pc.Entity(name), parent: player, height: HUMAN_HEIGHT });

  let elapsed = 0;
  let lastPose = null;
  let duckVisual = duck;
  let dragonVisual = dragon;
  let activeDuckWings = duckWings;
  let activeDragonWings = dragonWings;
  let activeDuckLegs = [];
  let mountedNow = false;
  let firstPerson = false;
  let cameraOccluded = false;
  // Character pose/status follows the duck; the carrier settles independently.
  let modelState = "loading";
  let dragonModelState = "loading";
  let annyongiRiderAnchor = null;
  let annyongiPitch = 0;
  let flightWings = false;
  let flightBlend = 0;
  let flightMode = 'ground';
  let wingPhase = 0;
  let wingAmplitude = 15;
  let wingFrequency = 3;
  let wingDihedral = 0;
  let bodyLift = 0;
  let headCounterPitch = 0;
  let flightHead = null;
  const tailMorphs = [];
  const tailWeights = [0, 0, 0];
  let wingSweep = 18;
  let previousFlightPosition = null;
  let lastReadability = null;
  let privateFill = null;
  const readabilityMaterials = new Map();
  function updateReadability() {
    const ambient = app.scene?.ambientLight;
    const light = ambient ? (ambient.r + ambient.g + ambient.b) / 3 : .5;
    const night = Math.max(0, Math.min(1, (.43 - light) / .32));
    if (lastReadability !== null && Math.abs(night - lastReadability) < .005) return;
    lastReadability = night;
    privateFill?.update(night);
    for (const material of readabilityMaterials.values()) {
      // A small palette floor keeps ink dark; private lights provide normal-based form.
      material.emissiveIntensity = .045 + night * .025;
      material.diffuse.set(1 - night * .15, 1 - night * .15, 1 - night * .15);
      material.update();
    }
  }
  let disposed = false;
  const knownInstances = new WeakSet();
  const duckInstances = new Set();
  const dragonInstances = new Set();
  let nameplateHeight = 0;
  let duckBaseEuler = [0, 0, 0];
  let duckCanaryPrepared = null;
  let duckCanaryReceipt = null;
  function positionDuck(mounted, bob = 0, bodyEuler = duckBaseEuler) {
    const bike = mounted && ridingBike(player);
    const helicopter = mounted && ridingHelicopter(player);
    const offsets = {
      [CAMPUS_KICKBOARD_ID]: [0, 0.17, 0],
      [CAMPUS_KART_ID]: [-0.42, 0.4, 0.35],
      [DUCK_BOAT_ID]: [-0.3, 0.3, -0.15],
      [CAMPUS_SHUTTLE_ID]: [0, 0.4, 0],
      [CAMPUS_BALLOON_ID]: [0, 0.65, 0]
    };
    const seat = mounted ? offsets[player.mountKind] : null;
    const pose = duckPose(modelState, seat ? false : mounted, bike, helicopter, bob);
    if (seat) { pose.y += seat[1]; pose.feetY += seat[1]; pose.labelY += seat[1]; }
    // Authored anchor is in the same player-root space as the GLB. The same
    // transform serves local and remote characters, including equipment/eye height.
    const annyongi = mounted && !seat && !bike && !helicopter && annyongiRiderAnchor;
    let anchorZ = -.22;
    if (annyongi) {
      const radians = annyongiPitch * Math.PI / 180;
      const anchorY = annyongi.y * Math.cos(radians) - annyongi.z * Math.sin(radians);
      anchorZ = annyongi.y * Math.sin(radians) + annyongi.z * Math.cos(radians);
      const delta = anchorY - .55;
      pose.y += delta; pose.feetY += delta; pose.labelY += delta;
    }
    const riderZ = seat ? seat[2] : bike ? BIKE_RIDER_Z : helicopter ? HELICOPTER_RIDER_Z : mounted ? anchorZ : 0;
    // Rotate the rider around the authored foot anchor, not around its torso.
    let posedZ = riderZ;
    if (annyongi) {
      const radians = bodyEuler[0] * Math.PI / 180;
      const bounds = DUCK_BOUNDS[modelState === 'glb' ? 'glb' : 'fallback'];
      const pivotAboveFeet = -bounds.bottom * pose.scale;
      pose.y = pose.feetY + pivotAboveFeet * Math.cos(radians);
      posedZ += pivotAboveFeet * Math.sin(radians);
      pose.labelY = pose.feetY + HUMAN_HEIGHT * Math.cos(radians) + .15;
    }
    duckVisual.setLocalPosition(seat ? seat[0] : 0, pose.y, posedZ);
    duckVisual.setLocalEulerAngles(bodyEuler[0], bodyEuler[1], bodyEuler[2]);
    duckVisual.setLocalScale(pose.scale, pose.scale, pose.scale);
    equipment.follow({
      feetY: pose.feetY, pivotY: pose.y, z: posedZ,
      euler: [bodyEuler[0] - duckBaseEuler[0], bodyEuler[1] - duckBaseEuler[1], bodyEuler[2] - duckBaseEuler[2]]
    });
    nameplateHeight = pose.labelY;
  }
  positionDuck(false);
  const riderKickboard = createCampusKickboard(player, { rider: true });
  const riderKart = createCampusKart(player, { rider: true });
  const riderDuckBoat = createDuckBoat(player, { rider: true });
  const riderShuttle = createCampusShuttle(player, { rider: true });
  const riderBalloon = createCampusBalloon(player, { rider: true });

  function showMountVisuals() {
    const bike = ridingBike(player);
    const helicopter = ridingHelicopter(player);
    const prototypes = [
      [CAMPUS_KICKBOARD_ID, riderKickboard], [CAMPUS_KART_ID, riderKart],
      [DUCK_BOAT_ID, riderDuckBoat], [CAMPUS_SHUTTLE_ID, riderShuttle],
      [CAMPUS_BALLOON_ID, riderBalloon]
    ];
    for (const [id, visual] of prototypes) {
      visual.enabled = mountedNow && player.mountKind === id && !firstPerson && !cameraOccluded;
    }
    const prototype = prototypes.some(([id]) => player.mountKind === id);
    dragonVisual.enabled = mountedNow && !bike && !helicopter && !prototype && !firstPerson && !cameraOccluded;
    riderBike.enabled = mountedNow && bike && !firstPerson && !cameraOccluded;
    riderHelicopter.root.enabled = mountedNow && helicopter && !firstPerson && !cameraOccluded;
  }

  function syncCameraVisibility() {
    duckVisual.enabled = !firstPerson && !cameraOccluded;
    equipment.setVisible(!firstPerson && !cameraOccluded);
    showMountVisuals();
  }

  const duckPivotSet = entity => {
    const wings = [-1, 1].map(side => entity?.findByName?.(side < 0 ? "DuckWing_L" : "DuckWing_R"));
    const legs = [-1, 1].map(side => entity?.findByName?.(side < 0 ? "DuckLeg_L" : "DuckLeg_R"));
    return { wings, legs, valid: [...wings, ...legs].every(Boolean) };
  };

  // Own instances, never the registry's shared container assets. The canary retains its
  // canonical clone for rollback, so it also needs disposal even while unattached.
  function ownInstance(entity, instances) {
    if (entity && !knownInstances.has(entity)) {
      knownInstances.add(entity);
      instances.add(entity);
      entity.once?.("destroy", () => instances.delete(entity));
    }
    return entity;
  }
  function releaseInstances(instances) {
    for (const entity of [...instances]) {
      instances.delete(entity);
      entity.destroy();
    }
  }
  player.once?.("destroy", () => {
    disposed = true;
    releaseInstances(duckInstances);
    releaseInstances(dragonInstances);
  });

  function loadModel(url, { productionCanary = false } = {}) {
    return new Promise((resolve, reject) => {
      app.assets.loadFromUrl(url, "container", async (error, asset) => {
        if (disposed) { resolve(null); return; }
        if (error || !asset?.resource) {
          reject(error || new Error(`No GLB resource for ${url}`));
          return;
        }
        try {
          void assetShadow?.observeResource?.(url, asset, { consumer: "character" });
          if (productionCanary && assetCanary?.enabled && assetCanarySubjectKey) {
            duckCanaryPrepared = await assetCanary.prepare(url, asset, {
              subjectKey: assetCanarySubjectKey,
              consumer: "character-production",
              instantiateOptions: { castShadows: true, receiveShadows: true },
              // Validation runs at creation, before asynchronous canary preparation settles.
              validateCanonicalEntity: entity => duckPivotSet(ownInstance(entity, duckInstances)).valid,
              validateOptimizedEntity: entity => duckPivotSet(ownInstance(entity, duckInstances)).valid
            });
            duckCanaryReceipt = duckCanaryPrepared.receipt;
            ownInstance(duckCanaryPrepared.canonicalEntity, duckInstances);
            ownInstance(duckCanaryPrepared.activeEntity, duckInstances);
            if (disposed) { releaseInstances(duckInstances); resolve(null); return; }
            resolve(duckCanaryPrepared.activeEntity);
            return;
          }
          resolve(ownInstance(
            asset.resource.instantiateRenderEntity({ castShadows: true, receiveShadows: true }),
            productionCanary ? duckInstances : dragonInstances
          ));
        } catch (cause) {
          reject(cause);
        }
      });
    });
  }

  const duckReady = loadModel("/assets/induck-v3.glb", { productionCanary: true }).then(loadedDuck => {
    if (disposed) { releaseInstances(duckInstances); return; }
    const pivots = duckPivotSet(loadedDuck);
    if (!pivots.valid) throw new Error("Campus duck GLB wing/leg pivots are missing");
    loadedDuck.name = "Induck_GLB_Visual";
    loadedDuck.enabled = !firstPerson && !cameraOccluded;
    player.addChild(loadedDuck);
    duckVisual = loadedDuck;
    { const e = loadedDuck.getLocalEulerAngles(); duckBaseEuler = [e.x, e.y, e.z]; }
    activeDuckWings = pivots.wings;
    activeDuckLegs = pivots.legs;
    modelState = "glb";
    positionDuck(mountedNow);
    duck.enabled = false;
  }).catch(error => {
    releaseInstances(duckInstances);
    modelState = "fallback";
    duckVisual = duck;
    activeDuckWings = duckWings;
    activeDuckLegs = [];
    duckBaseEuler = [0, 0, 0];
    if (!disposed) { positionDuck(mountedNow); syncCameraVisibility(); }
    console.warn("Campus duck GLB unavailable; primitive fallback remains active:", error);
  });
  const dragonReady = loadModel("/assets/annyongi-flight-v1.glb").then(loadedDragon => {
    if (disposed) { releaseInstances(dragonInstances); return; }
    const wings = [-1, 1].map(side => loadedDragon?.findByName?.(side < 0 ? "DragonWing_L" : "DragonWing_R"));
    if (wings.some(node => !node)) throw new Error("Campus carrier GLB wing pivots are missing");
    loadedDragon.name = "Annyongi_GLB_Visual";
    player.addChild(loadedDragon);
    dragonVisual = loadedDragon;
    activeDragonWings = wings;
    dragonModelState = "glb";
    flightHead = loadedDragon.findByName?.('FlightHeadPivot');
    flightWings = !!loadedDragon.findByName?.('FlightWing_L') && !!loadedDragon.findByName?.('FlightWing_R');
    if (flightWings) {
      privateFill = acquireAnnyongiFill(app);
      for (const component of loadedDragon.findComponents('render')) for (const instance of component.meshInstances) {
        if (instance.morphInstance && ['Tail', 'TailCloud'].includes(instance.node.name)) tailMorphs.push(instance.morphInstance);
        const source = instance.material;
        if (!readabilityMaterials.has(source)) {
          const clone = source.clone();
          clone.emissive.set(1, 1, 1);
          clone.emissiveMapVertexColor = true;
          readabilityMaterials.set(source, clone);
        }
        instance.material = readabilityMaterials.get(source);
        instance.mask |= ANNYONGI_LIGHT_MASK;
      }
      loadedDragon.once('destroy', () => {
        privateFill?.release();privateFill = null;
        for (const material of readabilityMaterials.values()) material.destroy();
        readabilityMaterials.clear();
      });
      updateReadability();
    }
    const anchor = loadedDragon.findByName?.("RiderAnchor")?.getLocalPosition?.();
    annyongiRiderAnchor = anchor ? { y: anchor.y, z: anchor.z } : null;
    positionDuck(mountedNow);
    showMountVisuals();
    dragon.enabled = false;
  }).catch(error => {
    releaseInstances(dragonInstances);
    dragonModelState = "fallback";
    flightWings = false;
    annyongiRiderAnchor = null;
    dragonVisual = dragon;
    activeDragonWings = dragonWings;
    if (!disposed) showMountVisuals();
    console.warn("Campus carrier GLB unavailable; primitive fallback remains active:", error);
  });
  // Wait for both handled outcomes without letting either suppress a good sibling.
  const ready = Promise.all([duckReady, dragonReady]).then(() => modelState);
  return {
    // Render AABBs are world-space and include the authored rider seat and full vehicle.
    // Bounds remain readable in first person; visibility must not decide photo support.
    getPhotoSubjectBounds(mountId) {
      if (disposed || !mountedNow || player.mountKind !== mountId) return null;
      const mount = new Map([[CAMPUS_BIKE_ID, riderBike], [CAMPUS_HELICOPTER_ID, riderHelicopter.root],
        [CAMPUS_KICKBOARD_ID, riderKickboard], [CAMPUS_KART_ID, riderKart], [DUCK_BOAT_ID, riderDuckBoat]]).get(mountId);
      if (!mount || mount.parent !== player || duckVisual.parent !== player) return null;
      const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
      for (const root of [duckVisual, mount]) {
        let count = 0;
        for (const render of root.findComponents('render')) for (const instance of render.meshInstances) {
          const b = instance.aabb, c = b.center, h = b.halfExtents;
          for (const axis of ['x', 'y', 'z']) { min[axis] = Math.min(min[axis], c[axis] - h[axis]); max[axis] = Math.max(max[axis], c[axis] + h[axis]); }
          count++;
        }
        if (!count) return null;
      }
      // Campus render root mirrors Z; Photo and locomotion use the gameplay frame.
      return [min.x,min.y,min.z,max.x,max.y,max.z].every(Number.isFinite)
        ? { min: { ...min, z: -max.z }, max: { ...max, z: -min.z } } : null;
    },
    dragon,
    ready,
    get modelState() { return modelState; },
    get dragonModelState() { return dragonModelState; },
    get nameplateHeight() { return nameplateHeight; },
    get pose() { return lastPose; },
    get flightVisualState() { return { mode: flightMode, deployment: flightBlend, pitch: annyongiPitch, tail: [...tailWeights], headPitch: headCounterPitch, lift: bodyLift }; },
    get eyeHeight() { return nameplateHeight - .225; },
    /** Slot attachment anchor for the local equipment projection (null for non-equipment slots). */
    getEquipmentAnchor: slot => equipment.anchor(slot),
    get equipmentVisible() { return equipment.visible; },
    get assetCanary() { return duckCanaryReceipt; },
    rollbackAssetCanary(reason = "RUNTIME_ROLLBACK") {
      if (disposed || !duckCanaryPrepared || duckCanaryPrepared.receipt?.authority !== "OPTIMIZED_CANARY") {
        return duckCanaryReceipt;
      }
      const receipt = duckCanaryPrepared.rollback(reason);
      duckCanaryReceipt = receipt;
      const canonical = duckCanaryPrepared.activeEntity;
      if (canonical && canonical !== duckVisual) {
        canonical.name = "Induck_GLB_Visual";
        canonical.enabled = !firstPerson && !cameraOccluded;
        player.addChild(canonical);
        duckVisual = canonical;
        const pivots = duckPivotSet(canonical);
        if (!pivots.valid) throw new Error("Campus canonical GLB pivots are missing after canary rollback");
        activeDuckWings = pivots.wings;
        activeDuckLegs = pivots.legs;
        const e = canonical.getLocalEulerAngles();
        duckBaseEuler = [e.x, e.y, e.z];
        modelState = "glb";
        positionDuck(mountedNow);
        showMountVisuals();
      }
      return receipt;
    },
    setFirstPerson(value) {
      firstPerson = value;
      syncCameraVisibility();
    },
    setCameraOccluded(value) {
      const next = value === true;
      if (cameraOccluded === next) return;
      cameraOccluded = next;
      syncCameraVisibility();
    },
    // poseOffsets: a local-only scripted pose (e.g. the 울림돌 shout) that outranks emotes, not sitting.
    update(dt, { mounted, moving, grounded, emote = null, seated = false, poseOffsets = null, flightClearance = Infinity }) {
      elapsed += dt;
      const bike = ridingBike(player);
      const helicopter = ridingHelicopter(player);
      const fly = mounted && !bike && !helicopter && ![CAMPUS_KICKBOARD_ID, CAMPUS_KART_ID, DUCK_BOAT_ID, CAMPUS_SHUTTLE_ID, CAMPUS_BALLOON_ID].includes(player.mountKind);
      const attitude = helicopter && player.flightAttitude
        ? player.flightAttitude : { pitch: 0, roll: 0 };
      // Derive visual motion from the existing transform, for local and remote avatars.
      // Ignore teleports and never write movement, collision or network state.
      const position = player.getLocalPosition?.();
      const deltaY = position && previousFlightPosition ? position.y - previousFlightPosition.y : 0;
      const travel = position && previousFlightPosition ? Math.hypot(position.x - previousFlightPosition.x, position.z - previousFlightPosition.z) : 0;
      const validStep = dt > 0 && dt <= .15 && Math.abs(deltaY) < 2 && travel < 3;
      const vertical = validStep ? deltaY / dt : 0;
      previousFlightPosition = position ? { x: position.x, y: position.y, z: position.z } : null;
      const landing = fly && !grounded && vertical < -.6 && flightClearance < 5;
      flightMode = !fly || grounded ? 'ground' : landing ? 'landing' : vertical > .6 ? 'ascend' : vertical < -.6 ? 'descend' : moving ? 'forward' : 'hover';
      const smooth = 1 - Math.exp(-Math.max(0, dt) * 6);
      // One shared exponential blend keeps body, head, tail, rider and wings in phase.
      // Landing progressively returns to the curled ground shape before contact.
      const approach = landing ? Math.max(0, Math.min(1, flightClearance / 5)) : 1;
      const target = flightMode === 'landing'
        ? [24 * approach, approach, 0, 0, approach, 3, 8 * approach, -18 * approach, 38 * (1 - approach), -.06 * approach]
        : ANNYONGI_FLIGHT_POSES[flightMode];
      flightBlend += (target[1] - flightBlend) * smooth;
      annyongiPitch += ((annyongiRiderAnchor ? target[0] : 0) - annyongiPitch) * smooth;
      headCounterPitch += ((flightMode === 'forward' ? -46 : flightMode === 'ascend' ? 12 : flightMode === 'descend' ? -20 : flightMode === 'landing' ? -20 * approach : 0) - headCounterPitch) * smooth;
      bodyLift += (target[9] - bodyLift) * smooth;
      for (let i = 0; i < 3; i++) {
        tailWeights[i] += (target[i + 2] - tailWeights[i]) * smooth;
        for (const morph of tailMorphs) morph.setWeight(i, tailWeights[i]);
      }
      flightHead?.setLocalEulerAngles(headCounterPitch, 0, 0);
      if (flightWings && fly) updateReadability();
      const bob = fly && dragonModelState === 'glb' ? bodyLift + Math.sin(elapsed * 3) * .045 * flightBlend
        : !mounted && moving && grounded ? Math.sin(elapsed * 10) * .017 : 0;
      const legSwing = moving && grounded && !mounted ? Math.sin(elapsed * 11) * 22 : 0;
      const pedal = bike && moving ? Math.sin(elapsed * 8) * 18 : 0;
      const base = {
        bodyY: bob,
        bodyEuler: bike
          ? [duckBaseEuler[0] + BIKE_RIDER_PITCH, duckBaseEuler[1], duckBaseEuler[2]]
          : helicopter
            ? [duckBaseEuler[0] + attitude.pitch * .35, duckBaseEuler[1], duckBaseEuler[2] - attitude.roll * .35]
            : fly && flightWings
              ? [duckBaseEuler[0] + annyongiPitch * .30, duckBaseEuler[1], duckBaseEuler[2]]
              : duckBaseEuler,
        wings: bike
          ? [[12, -72, -58], [12, 72, 58]]
          : helicopter
            ? [[5, -35, -42], [5, 35, 42]]
            : [0, 1].map(index => [0, 0, (index ? -1 : 1) * (22 + (moving && !mounted ? Math.sin(elapsed * 11) * 13 : 0))]),
        legs: bike ? [BIKE_LEG_BEND + pedal, BIKE_LEG_BEND - pedal]
          : helicopter ? [28, 28] : [legSwing, -legSwing]
      };
      const offsets = seated && !mounted ? SIT_OFFSETS
        : poseOffsets && !mounted ? poseOffsets
        : emote && !mounted ? emoteOffsets(emote.id, emote.elapsedMs) : REST_OFFSETS;
      const pose = composeEmotePose(base, offsets);
      lastPose = pose;
      positionDuck(mounted, pose.bodyY, pose.bodyEuler);
      riderHelicopter.update(dt, {
        active: mounted && helicopter && !firstPerson && !cameraOccluded,
        pitch: attitude.pitch,
        roll: attitude.roll
      });
      activeDuckWings.forEach((wing, index) => wing.setLocalEulerAngles(...pose.wings[index]));
      wingFrequency += (target[5] - wingFrequency) * smooth;
      wingAmplitude += (target[6] - wingAmplitude) * smooth;
      wingSweep += (target[7] - wingSweep) * smooth;
      wingDihedral += (target[8] - wingDihedral) * smooth;
      wingPhase = (wingPhase + Math.max(0, dt) * wingFrequency) % (Math.PI * 2);
      activeDragonWings.forEach((wing, index) => {
        if (!flightWings) { wing.setLocalEulerAngles(0, 0, 0); return; }
        const side = index ? 1 : -1;
        const flap = Math.sin(wingPhase) * wingAmplitude;
        // Only the small CloudWing identity remains in the settled ground pose.
        // Keep a nonsingular transform and the existing smooth deployment/phase.
        const scale = Math.max(.001, flightBlend);
        wing.enabled = flightBlend > .002;
        wing.setLocalScale(scale, scale, scale);
        wing.setLocalEulerAngles(0, side * wingSweep * flightBlend, side * (wingDihedral + flap * flightBlend));
      });
      activeDuckLegs.forEach((leg, index) => leg.setLocalEulerAngles(pose.legs[index], 0, 0));
      if (dragonModelState === "glb" && fly) {
        dragonVisual.setLocalPosition(0, bob, 0);
        dragonVisual.setLocalEulerAngles(annyongiPitch, 0, 0);
      }
    },
    setMounted(mounted) {
      mountedNow = mounted;
      showMountVisuals();
    }
  };
}
