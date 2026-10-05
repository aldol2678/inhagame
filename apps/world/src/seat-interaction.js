// Seat interaction wiring: aligns the player to a seat, stands up on locomotion input, keeps the
// prompt in sync and shares the state online. Dependencies are injected so Node tests drive it.
// It reads PlayerController input and only sets the transform when sitting/standing; the
// controller keeps physics and collision for everything else.

import { SeatController, findSeat, locomotionIntent } from "./seat-anchors.js";

export function createSeatInteraction({ player, controller, emotes, places, getOnline = () => null, seats = new SeatController() }) {
  let nearby = null;
  const occupants = () => getOnline()?.remoteSeatedPositions() ?? [];

  function sitDown(anchor) {
    if (!seats.sit(anchor, { occupants: occupants() })) return false;
    emotes?.cancel("sit");
    controller.velocityY = 0;
    controller.jumpQueued = false;
    player.setLocalPosition(anchor.position.x, anchor.position.y, anchor.position.z);
    player.setLocalEulerAngles(0, anchor.yaw, 0);
    getOnline()?.forcePose();
    return true;
  }

  function standUp(reason) {
    const point = seats.stand(reason);
    if (!point) return false;
    player.setLocalPosition(point.x, point.y, point.z);
    controller.velocityY = 0;
    controller.grounded = true;
    getOnline()?.forcePose();
    return true;
  }

  return {
    seats,
    get nearby() { return nearby; },
    sitDown,
    standUp,
    toggle() {
      if (seats.isSeated) return standUp("explicit");
      return nearby ? sitDown(nearby) : false;
    },
    // S1 rule: an emote while seated stands the player up first; no seated emote variants yet.
    requestEmote(id, locomotion) {
      if (seats.isSeated && standUp("emote")) return emotes.request(id, { moving: false, grounded: true, mounted: false });
      return emotes.request(id, locomotion);
    },
    // Before PlayerController.update: stand on move/jump/mount/zone change.
    // Returns true while the player stays seated (the controller must not translate them).
    beforeController() {
      if (!seats.isSeated) return false;
      const reason = seats.shouldStand({ intent: locomotionIntent(controller), placeZoneId: places.getCurrentPlaceZone()?.id ?? null });
      if (reason) standUp(reason);
      return seats.isSeated;
    },
    // After the frame's movement: which free seat, if any, the prompt offers.
    refreshNearby() {
      nearby = !seats.isSeated && !controller.mounted && controller.grounded
        ? findSeat(player.getLocalPosition(), { occupants: occupants() }) : null;
      return nearby;
    }
  };
}
