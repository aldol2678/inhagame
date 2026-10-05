import * as pc from "playcanvas";
import { box, surface } from "./campus-render-kit.js";
import {
  INKYUNG_DUCK_ROSTER,
  MECHANICAL_DUCK_ID,
  MECHANICAL_DUCK_CHANCE,
  MECHANICAL_DUCK_INTERACTION_RADIUS,
  DUCK_SHORE_OBSERVATION_RADIUS,
  MECHANICAL_DUCK_CONTEXT_PRIORITY,
  DUCK_WATER_Y,
  inkyungDuckSpawnPoints,
  shouldSpawnMechanicalDuck,
  createDuckBrain,
  advanceDuckBrain,
  canObserveInkyungDucksFromShore,
  distanceToInkyungPondShore
} from "./ambient-ducks-state.js";

export {
  INKYUNG_DUCK_ROSTER,
  MECHANICAL_DUCK_ID,
  MECHANICAL_DUCK_CHANCE,
  MECHANICAL_DUCK_INTERACTION_RADIUS,
  DUCK_SHORE_OBSERVATION_RADIUS,
  MECHANICAL_DUCK_CONTEXT_PRIORITY,
  DUCK_WATER_Y,
  inkyungDuckSpawnPoints,
  shouldSpawnMechanicalDuck,
  createDuckBrain,
  advanceDuckBrain,
  canObserveInkyungDucksFromShore,
  distanceToInkyungPondShore
} from "./ambient-ducks-state.js";

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function material(hex, { emissive = null, intensity = 1 } = {}) {
  if (!emissive) return surface(hex);
  const n = parseInt(hex.slice(1), 16), e = parseInt(emissive.slice(1), 16), m = new pc.StandardMaterial();
  m.diffuse = new pc.Color((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255);
  m.emissive = new pc.Color((e >> 16 & 255) / 255, (e >> 8 & 255) / 255, (e & 255) / 255);
  m.emissiveIntensity = intensity;
  m.update();
  return m;
}

function createDuckVisual(root, spec) {
  const duck = new pc.Entity(spec.id);
  duck.setLocalPosition(spec.spawn.x, DUCK_WATER_Y, spec.spawn.z);
  root.addChild(duck);

  const white = material("#f4f2e8"), orange = material("#e7a14b");
  const gray = material("#aeb0a5"), mallardGreen = material("#174f3e"), mallardBrown = material("#6a4031");
  const mechanicalIvory = material("#d4d1b5"), seam = material("#60645f");
  const bodyMaterial = spec.mechanical ? mechanicalIvory : spec.kind === "mallard" ? gray : white;
  const headMaterial = spec.mechanical ? mechanicalIvory : spec.kind === "mallard" ? mallardGreen : white;

  const body = box(duck, spec.id + "_body", [0, .14, 0], [.42, .23, .29], bodyMaterial, 0, "sphere");
  const chest = spec.kind === "mallard"
    ? box(duck, spec.id + "_chest", [0, .15, .13], [.25, .20, .18], mallardBrown, 0, "sphere")
    : null;
  const neck = box(duck, spec.id + "_neck", [0, .22, .17], [.13, .22, .13], headMaterial, 0, "sphere");
  const head = box(duck, spec.id + "_head", [0, .32, .24], [.18, .18, .18], headMaterial, 0, "sphere");
  const beak = box(duck, spec.id + "_beak", [0, .30, .35], [.12, .055, .11], orange);
  const leftWing = box(duck, spec.id + "_wing_l", [-.16, .18, -.01], [.08, .055, .23], bodyMaterial, 0, "sphere");
  const rightWing = box(duck, spec.id + "_wing_r", [.16, .18, -.01], [.08, .055, .23], bodyMaterial, 0, "sphere");

  let leds = [];
  if (spec.mechanical) {
    box(duck, spec.id + "_seam_l", [-.211, .15, 0], [.012, .025, .19], seam);
    box(duck, spec.id + "_seam_r", [.211, .15, 0], [.012, .025, .19], seam);
    const ledMat = material("#f4d65a", { emissive: "#ffd54a", intensity: 1.8 });
    leds = [
      box(duck, spec.id + "_led_l", [-.214, .18, .07], [.035, .035, .035], ledMat, 0, "sphere"),
      box(duck, spec.id + "_led_r", [.214, .18, .07], [.035, .035, .035], ledMat, 0, "sphere")
    ];
  }

  return { root: duck, body, chest, neck, head, beak, wings: [leftWing, rightWing], leds };
}

function syncVisual(entry, elapsed) {
  const { brain, visual } = entry;
  const bob = Math.sin(elapsed * 2.2 + entry.phase) * 0.012;
  visual.root.setLocalPosition(brain.position.x, DUCK_WATER_Y + bob, brain.position.z);
  visual.root.setLocalEulerAngles(0, brain.yaw, 0);

  let wingAngle = 0;
  if (brain.state === "flap") wingAngle = Math.sin(brain.stateTime * 15) * 48;
  else if (brain.state === "groom") wingAngle = 10 + Math.sin(brain.stateTime * 6) * 8;
  visual.wings[0].setLocalEulerAngles(0, 0, wingAngle);
  visual.wings[1].setLocalEulerAngles(0, 0, -wingAngle);

  if (brain.state === "groom") {
    visual.head.setLocalEulerAngles(0, 0, 18 + Math.sin(brain.stateTime * 5) * 10);
    visual.neck.setLocalEulerAngles(0, 0, 8);
  } else {
    visual.head.setLocalEulerAngles(0, 0, 0);
    visual.neck.setLocalEulerAngles(0, 0, 0);
  }

  if (visual.leds.length) {
    const scale = 0.72 + 0.28 * Math.sin(elapsed * 4.2);
    for (const led of visual.leds) led.setLocalScale(.035 * scale, .035 * scale, .035 * scale);
  }
}

export function createInkyungDuckSystem({
  app,
  root,
  player = null,
  forceMechanical = false,
  mechanicalRandom = Math.random,
  canObserveOrdinary = () => false,
  getOrdinaryActionLabel = () => "오리 관찰",
  onOrdinaryObserved = () => {},
  onLoreFound = () => {}
} = {}) {
  if (!app || !root) throw new Error("Duck system requires app and root");
  const spawns = inkyungDuckSpawnPoints(INKYUNG_DUCK_ROSTER.length + 1);
  const entries = INKYUNG_DUCK_ROSTER.map((spec, index) => {
    const spawn = spawns[index];
    const brain = createDuckBrain({ ...spec, spawn, seed: index * 101 });
    return { brain, visual: createDuckVisual(root, { ...spec, spawn }), phase: index * 1.7 };
  });

  let mechanical = null;
  const spawnMechanical = () => {
    if (mechanical) return mechanical;
    const spawn = spawns.at(-1);
    const spec = { id: MECHANICAL_DUCK_ID, kind: "mechanical", speed: 0.35, spawn, mechanical: true };
    mechanical = { brain: createDuckBrain({ ...spec, seed: 404 }), visual: createDuckVisual(root, spec), phase: 4.4 };
    entries.push(mechanical);
    return mechanical;
  };
  if (shouldSpawnMechanicalDuck({ force: forceMechanical, random: mechanicalRandom })) spawnMechanical();

  let elapsed = 0;
  let discovered = false;
  const lore = Object.freeze({
    id: "lore.inkyung_mechanical_duck",
    title: "인경호 기계오리설",
    detail: "평범한 오리인 줄 알았는데 몸체의 이음선과 작은 불빛이 보인다.",
    reward: null
  });

  const discover = () => {
    if (!mechanical || discovered) return false;
    discovered = true;
    onLoreFound(lore);
    app.fire?.("inkyungDuckLoreFound", lore);
    return true;
  };

  return Object.freeze({
    ensureMechanicalDuck() {
      spawnMechanical();
      return true;
    },
    update(dt, playerPosition = player?.getLocalPosition?.() ?? null) {
      dt = Math.min(Number.isFinite(dt) ? dt : 0, 0.05);
      if (dt <= 0) return;
      elapsed += dt;
      for (const entry of entries) {
        advanceDuckBrain(entry.brain, dt, playerPosition);
        syncVisual(entry, elapsed);
      }
    },
    getContextAction(playerPosition = player?.getLocalPosition?.() ?? null) {
      if (!playerPosition) return null;
      const shoreDistance = distanceToInkyungPondShore(playerPosition);
      const canObserveFromShore = canObserveInkyungDucksFromShore(
        playerPosition, DUCK_SHORE_OBSERVATION_RADIUS
      );

      if (mechanical && !discovered) {
        const duckDistance = distance(mechanical.brain.position, playerPosition);
        if (duckDistance <= MECHANICAL_DUCK_INTERACTION_RADIUS || canObserveFromShore) {
          return {
            id: "inkyung-mechanical-duck",
            icon: "🦆",
            label: "수상한 오리 관찰",
            shortcut: "F",
            priority: MECHANICAL_DUCK_CONTEXT_PRIORITY,
            distance: canObserveFromShore ? shoreDistance : duckDistance,
            pressed: false,
            trigger: discover
          };
        }
      }

      if (!canObserveOrdinary() || !canObserveFromShore) return null;
      const nearest = entries
        .filter(entry => !entry.brain.mechanical)
        .map(entry => ({ entry, distance: distance(entry.brain.position, playerPosition) }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (!nearest) return null;
      return {
        id: "inkyung-ordinary-duck",
        icon: "🦆",
        label: getOrdinaryActionLabel?.() || "오리 관찰",
        shortcut: "F",
        priority: MECHANICAL_DUCK_CONTEXT_PRIORITY - 40,
        distance: shoreDistance,
        pressed: false,
        trigger: () => {
          const result = onOrdinaryObserved({
            id: nearest.entry.brain.id,
            kind: INKYUNG_DUCK_ROSTER.find(spec => spec.id === nearest.entry.brain.id)?.kind ?? "duck"
          });
          app.fire?.("inkyungOrdinaryDuckObserved", result ?? null);
          return result?.changed !== false;
        }
      };
    },
    discoverMechanicalDuck: discover,
    status() {
      return {
        count: entries.length,
        ordinaryCount: INKYUNG_DUCK_ROSTER.length,
        mechanicalSpawned: !!mechanical,
        mechanicalDiscovered: discovered,
        ducks: entries.map(({ brain }) => ({
          id: brain.id,
          mechanical: brain.mechanical,
          state: brain.state,
          x: brain.position.x,
          z: brain.position.z
        }))
      };
    },
    destroy() {
      for (const entry of entries) entry.visual.root.destroy?.();
      entries.length = 0;
      mechanical = null;
    }
  });
}
