// Read-only view of the local player for the network. It never writes to the entity or the
// controller; PlayerController keeps sole ownership of movement, jump physics and collision.

import { classifyAnim } from "../network/protocol.js";
import { wireMountFor } from "../mounts/mount-kinds.js";

// Canonical campus frame: the player is a child of CampusCoordinateFrame, so local position is
// the gameplay coordinate every client shares. Yaw is read from the rotation quaternion because
// Euler readback can flip into (180, y, 180) form.
export function yawFromQuaternion(q) {
  return Math.atan2(q.y, q.w) * 360 / Math.PI;
}

export function createPoseSource({ player, controller, isSeated = () => false }) {
  let last = null;
  let wasGrounded = true;
  return {
    // dtSec: frame delta. Returns { pose, jumped }.
    sample(dtSec) {
      const p = player.getLocalPosition();
      const q = player.getLocalRotation();
      let vx = 0;
      let vz = 0;
      if (last && dtSec > 0) {
        vx = (p.x - last.x) / dtSec;
        vz = (p.z - last.z) / dtSec;
      }
      last = { x: p.x, z: p.z };
      const speed = Math.hypot(vx, vz);
      const grounded = controller.grounded !== false;
      const mounted = controller.mounted === true;
      // PlayerController does not expose its sprint flag; horizontal speed above walking is RUN.
      const sprint = speed > (controller.walkSpeed ?? 7) + 0.5;
      const seated = isSeated() === true;
      const jumped = !seated && wasGrounded && !grounded && !mounted && (controller.velocityY ?? 0) > 0;
      wasGrounded = grounded;
      // A seated player is still: the alignment snap onto the seat is not velocity.
      const anim = classifyAnim({ moving: !seated && controller.moving === true, sprint, grounded, mounted, seated });
      const pose = Object.freeze({
        x: p.x, y: p.y, z: p.z,
        yaw: yawFromQuaternion(q),
        vx: seated || !Number.isFinite(vx) ? 0 : vx,
        vz: seated || !Number.isFinite(vz) ? 0 : vz,
        anim,
        // Which mount, from the same controller state as `mounted` (bike | dragon | null).
        mount: wireMountFor({ mounted, mountId: controller.mountId ?? null })
      });
      return { pose, jumped };
    }
  };
}
