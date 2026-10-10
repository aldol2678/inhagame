import { LIFE_PROP_WORLD_SCALE, NPC_ACTIVITY_PROPS, NPC_ACTIVITY_HAND_RADII, NPC_ACTIVITY_CONTACT_OVERLAP_WORLD } from '../src/life-props.js';

// Map a prop-local surface point to the solid hand's ellipsoid surface. The normal
// points from hand into prop. Only the small world-space contact overlap is permitted;
// the model's GRIP origin is a reference, not a safe hand insertion point.
export function purposefulActivityPropPosition(definition, worldScale) {
  const [qx, qy, qz, qw] = definition.rotation;
  const rotate = ([x, y, z]) => {
    const tx = 2*(qy*z-qz*y), ty = 2*(qz*x-qx*z), tz = 2*(qx*y-qy*x);
    return [x+qw*tx+qy*tz-qz*ty, y+qw*ty+qz*tx-qx*tz, z+qw*tz+qx*ty-qy*tx];
  };
  const normal = rotate(definition.contactNormal);
  const contact = rotate(definition.contactPoint);
  const supportRadius = Math.hypot(...normal.map((value, i) => value*NPC_ACTIVITY_HAND_RADII[i]));
  return definition.position.map((centre, i) => centre +
    NPC_ACTIVITY_HAND_RADII[i]**2*normal[i]/supportRadius -
    (LIFE_PROP_WORLD_SCALE*contact[i] + NPC_ACTIVITY_CONTACT_OVERLAP_WORLD*normal[i])/worldScale);
}

// Render-only projection of the existing purposeful activity. The straight-arm rig is
// unchanged: one primary hand, no claim of two-hand book/camera contact or face-level PHOTO.
// Like equipment projection, each desire owns a generation; late loads are destroyed.
export function createPurposefulActivityProps({ visual, loadModel }) {
  const arm = visual.arms[0]; // ArmPivot_-1, never the nonuniformly scaled Hand mesh
  // createHumanAvatar creates these accessories locally enabled. Do not capture entity.enabled:
  // PlayCanvas includes ancestor visibility in that getter (the campus may start hidden).
  const fallback = ['HeldBook', 'BookSpine'].map(name => visual.avatar.findByName(name)).filter(Boolean);
  let desired = null, generation = 0, entity = null, disposed = false;
  const restoreFallback = () => { for (const accessory of fallback) accessory.enabled = true; };
  function clear() {
    entity?.destroy();
    entity = null;
    restoreFallback();
  }
  function update(activity, { moving = false, sitting = false, visible = true } = {}) {
    if (disposed) return;
    const definition = !moving && !sitting && visible && Object.hasOwn(NPC_ACTIVITY_PROPS, activity)
      ? NPC_ACTIVITY_PROPS[activity] : null;
    const next = definition?.id ?? null;
    if (next === desired) return; // no requests, retries or allocations for unchanged frames
    desired = next;
    const token = ++generation;
    clear();
    if (!definition || !arm || !Number.isFinite(visual.worldScale) || visual.worldScale <= 0) return;
    let request;
    try { request = Promise.resolve(loadModel(next)); }
    catch { return; } // unavailable optional decoration must not interrupt the NPC loop
    request.then(model => {
      if (disposed || generation !== token) { model?.destroy(); return; }
      if (!model) return;
      try {
        model.name = `NPC_Activity_${next}`;
        model.setLocalPosition(...purposefulActivityPropPosition(definition, visual.worldScale));
        model.setLocalRotation(...definition.rotation);
        const scale = LIFE_PROP_WORLD_SCALE / visual.worldScale;
        model.setLocalScale(scale, scale, scale);
        arm.addChild(model);
        entity = model;
        for (const accessory of fallback) accessory.enabled = false;
      } catch {
        model.destroy();
        entity = null;
        restoreFallback();
      }
    }).catch(() => { /* Keep the old accessory, retry only after the desire changes. */ });
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    generation++;
    clear();
    visual.avatar.off('destroy', dispose);
  }
  visual.avatar.once('destroy', dispose);
  return { update, dispose };
}
