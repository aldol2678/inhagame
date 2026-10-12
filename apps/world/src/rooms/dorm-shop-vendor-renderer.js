import * as pc from 'playcanvas';
import { createHumanAvatar } from '../../npc-factory/dev-human-avatar.mjs';
import { npcNameplateOffset } from '../../npc-factory/npc-dimensions.mjs';
import { DORM_SHOP_VENDOR } from '../shop/dorm-shop-vendor.js';

// Room-owned, fixed-position actor. No campus roster, server schedule, AI or seat ownership.
export function createDormShopVendorRenderer({ app, root, player, camera, doc = globalThis.document } = {}) {
  const vendor = DORM_SHOP_VENDOR;
  const visual = createHumanAvatar(root, { id: vendor.npcId, name: vendor.name }, vendor.appearance);
  visual.marker.enabled = false; visual.identityMarker.enabled = false;
  const label = doc.createElement('div');
  label.className = 'dorm-shop-vendor-nameplate';
  label.textContent = `${vendor.name} · 생활관 가구점`;
  label.setAttribute('style', 'position:fixed;z-index:62;transform:translate(-50%,-100%);padding:4px 8px;border-radius:7px;border:1px solid #d9c399;background:#19332fe8;color:#fff;font:700 12px/1.4 system-ui,sans-serif;white-space:nowrap;pointer-events:none');
  label.hidden = true; doc.body.append(label);
  let elapsed = 0, disposed = false;
  function update(dt = 0) {
    if (disposed) return;
    visual.avatar.enabled = root.enabled === true;
    if (!root.enabled) { label.hidden = true; return; }
    elapsed += Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.05));
    const position = player?.getLocalPosition?.();
    let heading = vendor.heading;
    if (position && position.z <= 1.3 && Math.hypot(position.x - vendor.position.x, position.z - vendor.position.z) < 4) {
      heading -= Math.max(-35, Math.min(35, Math.atan2(position.x - vendor.position.x, vendor.position.z - position.z) * 180 / Math.PI));
    }
    visual.avatar.setLocalPosition(vendor.position.x, vendor.position.y + Math.sin(elapsed * 1.6) * .003, vendor.position.z);
    visual.avatar.setLocalEulerAngles(0, heading, 0);
    visual.arms.forEach((arm, i) => arm.setLocalEulerAngles(Math.sin(elapsed * 1.3) * (i ? -1.5 : 1.5), 0, 0));
  }
  const projected = new pc.Vec3();
  function draw() {
    if (disposed) return;
    label.hidden = true;
    const position = player?.getLocalPosition?.();
    if (!root.enabled || !camera?.camera || !position ||
        Math.hypot(position.x - vendor.position.x, position.z - vendor.position.z) > 5.5) return;
    const rect = app.graphicsDevice.canvas.getBoundingClientRect();
    const world = visual.avatar.getPosition();
    projected.set(world.x, world.y + npcNameplateOffset(vendor.appearance.height), world.z);
    const screen = camera.camera.worldToScreen(projected);
    if (screen.z <= 0 || screen.x < 8 || screen.x > rect.width - 8 || screen.y < 30 || screen.y > rect.height) return;
    label.hidden = false;
    const halfWidth = label.getBoundingClientRect().width / 2;
    label.style.left = `${rect.left + Math.max(halfWidth + 8, Math.min(rect.width - halfWidth - 8, screen.x))}px`;
    label.style.top = `${rect.top + screen.y}px`;
  }
  function destroy() {
    if (disposed) return;
    disposed = true; app.off('update', update); app.off('postrender', draw);
    root.off('destroy', destroy); label.remove(); visual.avatar.destroy();
    // createHumanAvatar's materials are shared with other actors and are not ours to destroy.
  }
  visual.avatar.setLocalPosition(vendor.position.x, vendor.position.y, vendor.position.z);
  visual.avatar.setLocalEulerAngles(0, vendor.heading, 0);
  app.on('update', update); app.on('postrender', draw); root.on('destroy', destroy);
  return { destroy, visual, update, get disposed() { return disposed; } };
}
