import { FIVE_SOUTH_ENTRY_APPROACH } from '../north-campus-layout.js';
import { metersToWorld } from '../world-scale.js';

export const BUILDING5_COMBAT_ENTRY = Object.freeze({
  id: 'combat.building5.training_gate',
  placeZoneId: 'AREA_BUILDING_5_WEST',
  x: FIVE_SOUTH_ENTRY_APPROACH.x,
  z: FIVE_SOUTH_ENTRY_APPROACH.z,
  interactionRadius: metersToWorld(6)
});

export const BUILDING5_COMBAT_CONTEXT_PRIORITY = 220;
export const BUILDING5_COMBAT_EXIT_PRIORITY = 420;

export function createBuilding5CombatInteraction({ runtime } = {}) {
  if (!runtime?.startTraining || !runtime?.end || !runtime?.snapshot) {
    throw new TypeError('Building 5 Combat interaction requires Combat v0.3 runtime');
  }

  let nearby = false;
  let distance = Infinity;

  function observe(position, {
    placeZoneId = null,
    grounded = false,
    blocked = false
  } = {}) {
    if (runtime.active) {
      nearby = true;
      distance = 0;
      return Object.freeze({
        id: 'building5-combat-exit',
        icon: '⚔️',
        label: '전투 훈련 종료',
        compactLabel: '훈련 종료',
        shortcut: 'Esc',
        priority: BUILDING5_COMBAT_EXIT_PRIORITY,
        distance: 0,
        disabled: false,
        pressed: true,
        trigger: () => runtime.end('PLAYER_EXIT')
      });
    }

    distance = position && Number.isFinite(position.x) && Number.isFinite(position.z)
      ? Math.hypot(position.x - BUILDING5_COMBAT_ENTRY.x, position.z - BUILDING5_COMBAT_ENTRY.z)
      : Infinity;
    nearby = placeZoneId === BUILDING5_COMBAT_ENTRY.placeZoneId &&
      grounded === true && blocked === false && distance <= BUILDING5_COMBAT_ENTRY.interactionRadius;
    if (!nearby) return null;

    return Object.freeze({
      id: 'building5-combat-training',
      icon: '⚔️',
      label: '5호관 전투 훈련 시작',
      compactLabel: '전투 훈련',
      shortcut: 'F',
      priority: BUILDING5_COMBAT_CONTEXT_PRIORITY,
      distance,
      disabled: false,
      pressed: false,
      trigger: () => runtime.startTraining({
        sourceRef: BUILDING5_COMBAT_ENTRY.id,
        placeZoneId: BUILDING5_COMBAT_ENTRY.placeZoneId
      })
    });
  }

  return Object.freeze({
    observe,
    status: () => Object.freeze({
      nearby,
      distance: Number.isFinite(distance) ? distance : null,
      entry: BUILDING5_COMBAT_ENTRY,
      runtime: runtime.snapshot()
    })
  });
}
