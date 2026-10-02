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

export function createCharacter(app, player) {
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
  let modelState = "loading";
  let nameplateHeight = 0;
  let duckBaseEuler = [0, 0, 0];
  function positionDuck(mounted, bob = 0, bodyEuler = duckBaseEuler) {
    const bike = mounted && ridingBike(player);
    const helicopter = mounted && ridingHelicopter(player);
    const pose = duckPose(modelState, mounted, bike, helicopter, bob);
    const riderZ = bike ? BIKE_RIDER_Z : helicopter ? HELICOPTER_RIDER_Z : mounted ? -0.22 : 0;
    duckVisual.setLocalPosition(0, pose.y, riderZ);
    duckVisual.setLocalEulerAngles(bodyEuler[0], bodyEuler[1], bodyEuler[2]);
    duckVisual.setLocalScale(pose.scale, pose.scale, pose.scale);
    equipment.follow({
      feetY: pose.feetY, pivotY: pose.y, z: riderZ,
      euler: [bodyEuler[0] - duckBaseEuler[0], bodyEuler[1] - duckBaseEuler[1], bodyEuler[2] - duckBaseEuler[2]]
    });
    nameplateHeight = pose.labelY;
  }
  positionDuck(false);

  function showMountVisuals() {
    const bike = ridingBike(player);
    const helicopter = ridingHelicopter(player);
    dragonVisual.enabled = mountedNow && !bike && !helicopter && !firstPerson;
    riderBike.enabled = mountedNow && bike && !firstPerson;
    riderHelicopter.root.enabled = mountedNow && helicopter && !firstPerson;
  }

  function loadModel(url) {
    return new Promise((resolve, reject) => {
      app.assets.loadFromUrl(url, "container", (error, asset) => {
        if (error || !asset?.resource) {
          reject(error || new Error(`No GLB resource for ${url}`));
          return;
        }
        try {
          resolve(asset.resource.instantiateRenderEntity({ castShadows: true, receiveShadows: true }));
        } catch (cause) {
          reject(cause);
        }
      });
    });
  }

  const ready = Promise.all([
    loadModel("/assets/induck-v3.glb"),
    loadModel("/assets/annyongi-flight-v1.glb")
  ]).then(([loadedDuck, loadedDragon]) => {
    const newDuckWings = [-1, 1].map(side => loadedDuck.findByName(side < 0 ? "DuckWing_L" : "DuckWing_R"));
    const newDragonWings = [-1, 1].map(side => loadedDragon.findByName(side < 0 ? "DragonWing_L" : "DragonWing_R"));
    const newDuckLegs = [-1, 1].map(side => loadedDuck.findByName(side < 0 ? "DuckLeg_L" : "DuckLeg_R"));
    if ([...newDuckWings, ...newDragonWings, ...newDuckLegs].some(node => !node)) {
      loadedDuck.destroy();
      loadedDragon.destroy();
      throw new Error("Campus GLB wing pivots are missing");
    }
    loadedDuck.name = "Induck_GLB_Visual";
    loadedDragon.name = "Annyongi_GLB_Visual";
    loadedDuck.enabled = !firstPerson;
    player.addChild(loadedDuck);
    player.addChild(loadedDragon);
    duck.enabled = false;
    dragon.enabled = false;
    duckVisual = loadedDuck;
    { const e = loadedDuck.getLocalEulerAngles(); duckBaseEuler = [e.x, e.y, e.z]; }
    dragonVisual = loadedDragon;
    activeDuckWings = newDuckWings;
    activeDragonWings = newDragonWings;
    activeDuckLegs = newDuckLegs;
    modelState = "glb";
    positionDuck(mountedNow);
    showMountVisuals();
    return modelState;
  }).catch(error => {
    modelState = "fallback";
    console.warn("Campus character GLB unavailable; primitive fallback remains active:", error);
    return modelState;
  });
  return {
    dragon,
    ready,
    get modelState() { return modelState; },
    get nameplateHeight() { return nameplateHeight; },
    get pose() { return lastPose; },
    get eyeHeight() { return nameplateHeight - .225; },
    /** Slot attachment anchor for the local equipment projection (null for non-equipment slots). */
    getEquipmentAnchor: slot => equipment.anchor(slot),
    get equipmentVisible() { return equipment.visible; },
    setFirstPerson(value) {
      firstPerson = value;
      duckVisual.enabled = !value;
      equipment.setVisible(!value);
      showMountVisuals();
    },
    // poseOffsets: a local-only scripted pose (e.g. the 울림돌 shout) that outranks emotes, not sitting.
    update(dt, { mounted, moving, grounded, emote = null, seated = false, poseOffsets = null }) {
      elapsed += dt;
      const bike = ridingBike(player);
      const helicopter = ridingHelicopter(player);
      const fly = mounted && !bike && !helicopter;
      const attitude = helicopter && player.flightAttitude
        ? player.flightAttitude : { pitch: 0, roll: 0 };
      const bob = fly && modelState === 'glb' ? Math.sin(elapsed * 4) * .045
        : !mounted && moving && grounded ? Math.sin(elapsed * 10) * .017 : 0;
      const legSwing = moving && grounded && !mounted ? Math.sin(elapsed * 11) * 22 : 0;
      const pedal = bike && moving ? Math.sin(elapsed * 8) * 18 : 0;
      const base = {
        bodyY: bob,
        bodyEuler: bike
          ? [duckBaseEuler[0] + BIKE_RIDER_PITCH, duckBaseEuler[1], duckBaseEuler[2]]
          : helicopter
            ? [duckBaseEuler[0] + attitude.pitch * .35, duckBaseEuler[1], duckBaseEuler[2] - attitude.roll * .35]
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
        active: mounted && helicopter && !firstPerson,
        pitch: attitude.pitch,
        roll: attitude.roll
      });
      activeDuckWings.forEach((wing, index) => wing.setLocalEulerAngles(...pose.wings[index]));
      activeDragonWings.forEach((wing, index) => wing.setLocalEulerAngles(0, 0,
        (index ? -1 : 1) * (fly ? Math.sin(elapsed * 8) * 28 + 12 : 10)));
      activeDuckLegs.forEach((leg, index) => leg.setLocalEulerAngles(pose.legs[index], 0, 0));
      if (modelState === "glb" && fly) {
        dragonVisual.setLocalPosition(0, Math.sin(elapsed * 4) * 0.045, 0);
        dragonVisual.setLocalEulerAngles(0, 0, moving ? Math.sin(elapsed * 5) * 3 : 0);
      }
    },
    setMounted(mounted) {
      mountedNow = mounted;
      showMountVisuals();
    }
  };
}
