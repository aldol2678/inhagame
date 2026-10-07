import { LIFE_PROP_WORLD_SCALE, NPC_ACTIVITY_PROPS } from '../src/life-props.js';

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
        model.setLocalPosition(...definition.position);
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
