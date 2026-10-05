// INHA WORLD · Equipment attachment anchors (Local Equipment Projection P0).
// The character layer owns one stable equipment root per local character and one anchor per equipment
// slot. The root is a child of the player entity, not of the active visual, so swapping the primitive
// fallback for the GLB (or any future base character / skin) never orphans attached equipment. Each
// frame the character copies its body pose into the root (feet height, depth, body rotation), so anchors
// move with walking, emotes and riding. The rotation pivots where the visual pivots (its origin, not the
// feet): Equipment_Root sits at the pivot and carries the rotation, Equipment_Frame shifts back down to
// the feet, and the slot anchors hang off the frame at feet-relative positions. Anchor positions are
// expressed in a body-height space that does not depend on the base model's internal node layout; a
// base character may pass its own layout.
// No item knowledge here: anchors know slots only. No renderer-specific API (WebGPU / WebGL2 agnostic).

import { APPEARANCE_SLOTS } from "../collection/item-catalog.js";

export const EQUIPMENT_SLOTS = APPEARANCE_SLOTS;

/**
 * Default slot anchor positions as fractions of body height ([x, y, z] × height, feet at y = 0,
 * facing +z). Generic humanoid placement, not tied to any item; real items add their own offsets later.
 */
export const DEFAULT_EQUIPMENT_ANCHOR_LAYOUT = Object.freeze({
  BODY: Object.freeze([0, 0.45, 0]),
  FACE: Object.freeze([0, 0.86, 0.1]),
  HAIR: Object.freeze([0, 0.94, 0]),
  HEAD: Object.freeze([0, 0.97, 0]),
  TOP: Object.freeze([0, 0.55, 0]),
  BOTTOM: Object.freeze([0, 0.3, 0]),
  SHOES: Object.freeze([0, 0.02, 0]),
  BACK: Object.freeze([0, 0.55, -0.12]),
  ACCESSORY: Object.freeze([0, 0.62, 0.05])
});

export const EQUIPMENT_ROOT_NAME = "Equipment_Root";
export const EQUIPMENT_FRAME_NAME = "Equipment_Frame";
export const equipmentAnchorName = (slot) => `Equipment_${slot}`;

/**
 * @param {{ createEntity: (name: string) => object, parent: object, height: number,
 *   layout?: Record<string, number[]> }} options
 *   createEntity: `name => new pc.Entity(name)` in the World; tests pass a fake with the same surface.
 */
export function createEquipmentAnchors({ createEntity, parent, height, layout = DEFAULT_EQUIPMENT_ANCHOR_LAYOUT } = {}) {
  if (typeof createEntity !== "function" || !parent || !(height > 0)) throw new Error("Equipment anchors need createEntity, parent and height");
  const root = createEntity(EQUIPMENT_ROOT_NAME);
  parent.addChild(root);
  const frame = createEntity(EQUIPMENT_FRAME_NAME);
  root.addChild(frame);
  const anchors = new Map();
  for (const slot of EQUIPMENT_SLOTS) {
    const at = layout[slot];
    if (!Array.isArray(at) || at.length !== 3) throw new Error(`Equipment anchor layout missing ${slot}`);
    const anchor = createEntity(equipmentAnchorName(slot));
    anchor.setLocalPosition(at[0] * height, at[1] * height, at[2] * height);
    frame.addChild(anchor);
    anchors.set(slot, anchor);
  }
  let visible = true;
  root.enabled = true;
  let lastFrame = null;

  return Object.freeze({
    root,
    slots: EQUIPMENT_SLOTS,
    /** The anchor entity of one slot, or null for anything that is not an equipment slot (e.g. BADGE). */
    anchor: (slot) => anchors.get(slot) ?? null,
    /**
     * Body pose in the player's space: feet height, depth offset, body rotation (degrees) and the height
     * the visual rotates about (defaults to the feet).
     */
    follow({ feetY = 0, z = 0, euler = [0, 0, 0], pivotY = feetY } = {}) {
      const key = `${feetY}|${pivotY}|${z}|${euler[0]}|${euler[1]}|${euler[2]}`;
      if (key === lastFrame) return;
      lastFrame = key;
      root.setLocalPosition(0, pivotY, z);
      root.setLocalEulerAngles(euler[0], euler[1], euler[2]);
      frame.setLocalPosition(0, feetY - pivotY, 0);
    },
    /** Equipment follows the base character's visibility (first person hides both). Cheap when unchanged. */
    setVisible(value) {
      const next = Boolean(value);
      if (next === visible) return;
      visible = next;
      root.enabled = next;
    },
    get visible() { return visible; },
    destroy() {
      anchors.clear();
      root.destroy?.();
    }
  });
}
