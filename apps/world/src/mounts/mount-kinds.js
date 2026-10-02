import { CAMPUS_BALLOON_ID } from "./campus-balloon-world.js";
import { CAMPUS_SHUTTLE_ID } from "./campus-shuttle-world.js";
import { DUCK_BOAT_ID } from "./duck-boat-world.js";
import { CAMPUS_KART_ID } from "./campus-kart-world.js";
import { CAMPUS_KICKBOARD_ID } from "./campus-kickboard-world.js";
// Local mount ids ↔ network mount kinds. PlayerController.mountId is the one local authority;
// movement, character visuals, HUD and the network all derive from it.
import { Anim, Mount, mountOf } from "../network/protocol.js";
import { CAMPUS_BIKE_ID } from "./campus-bike-world.js";
import { CAMPUS_HELICOPTER_ID } from "./campus-helicopter-world.js";

export const DRAGON_MOUNT_ID = "annyongi";

// What the local player broadcasts: null on foot, otherwise one stable wire mount kind.
export function wireMountFor({ mounted = false, mountId = null } = {}) {
  if (!mounted) return null;
  if (mountId === CAMPUS_KICKBOARD_ID) return Mount.KICKBOARD;
  if (mountId === CAMPUS_KART_ID) return Mount.KART;
  if (mountId === DUCK_BOAT_ID) return Mount.DUCK_BOAT;
  if (mountId === CAMPUS_SHUTTLE_ID) return Mount.SHUTTLE;
  if (mountId === CAMPUS_BALLOON_ID) return Mount.BALLOON;
  if (mountId === CAMPUS_BIKE_ID) return Mount.BIKE;
  if (mountId === CAMPUS_HELICOPTER_ID) return Mount.HELICOPTER;
  return Mount.DRAGON;
}

// Local mount id for a network mount kind.
export function mountIdForWire(mount) {
  if (mount === Mount.KICKBOARD) return CAMPUS_KICKBOARD_ID;
  if (mount === Mount.KART) return CAMPUS_KART_ID;
  if (mount === Mount.DUCK_BOAT) return DUCK_BOAT_ID;
  if (mount === Mount.SHUTTLE) return CAMPUS_SHUTTLE_ID;
  if (mount === Mount.BALLOON) return CAMPUS_BALLOON_ID;
  if (mount === Mount.BIKE) return CAMPUS_BIKE_ID;
  if (mount === Mount.HELICOPTER) return CAMPUS_HELICOPTER_ID;
  if (mount === Mount.DRAGON) return DRAGON_MOUNT_ID;
  return null;
}

// What a remote avatar shows for one sample: mounted only while FLY; the mount comes from the
// same sample (legacy FLY without a mount, or an unknown one, is the dragon).
export function remoteMountState({ anim = null, mount = null } = {}) {
  const mounted = anim === Anim.FLY;
  return { mounted, mountId: mounted ? mountIdForWire(mountOf(anim, mount)) : null };
}

