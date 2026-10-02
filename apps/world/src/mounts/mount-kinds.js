// Local mount ids ↔ network mount kinds. PlayerController.mountId is the one local authority;
// movement, character visuals, HUD and the network all derive from it.
import { Anim, Mount, mountOf } from "../network/protocol.js";
import { CAMPUS_BIKE_ID } from "./campus-bike-world.js";

export const DRAGON_MOUNT_ID = "annyongi";

// What the local player broadcasts: null on foot, otherwise bike | dragon.
export function wireMountFor({ mounted = false, mountId = null } = {}) {
  if (!mounted) return null;
  return mountId === CAMPUS_BIKE_ID ? Mount.BIKE : Mount.DRAGON;
}

// Local mount id for a network mount kind.
export function mountIdForWire(mount) {
  if (mount === Mount.BIKE) return CAMPUS_BIKE_ID;
  if (mount === Mount.DRAGON) return DRAGON_MOUNT_ID;
  return null;
}

// What a remote avatar shows for one sample: mounted only while FLY; the mount comes from the
// same sample (legacy FLY without a mount, or an unknown one, is the dragon).
export function remoteMountState({ anim = null, mount = null } = {}) {
  const mounted = anim === Anim.FLY;
  return { mounted, mountId: mounted ? mountIdForWire(mountOf(anim, mount)) : null };
}
