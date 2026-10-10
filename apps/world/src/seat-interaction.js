// Seat interaction wiring: aligns the player to a seat, stands up on locomotion input, keeps the
// prompt in sync and shares the state online. Dependencies are injected so Node tests drive it.
// It reads PlayerController input and only sets the transform when sitting/standing; the
// controller keeps physics and collision for everything else.

import { SeatController, findSeat, locomotionIntent } from "./seat-anchors.js";

export function createSeatInteraction({
  player, controller, emotes, places, getOnline = () => null, seats = new SeatController(),
  getAnchors = () => undefined, getSpaceId = () => null,
  getPlaceZoneId = () => places.getCurrentPlaceZone()?.id ?? null,
  canInteract = () => true, resolveStandPoint = anchor => anchor.standPoint
}) {
  let nearby = null;
  let seatedSpaceId = null;
  const occupants = () => getOnline()?.remoteSeatedPositions() ?? [];
  const currentAnchor = anchor => {
    const anchors = getAnchors();
    return anchors === undefined ? anchor : anchors.find(candidate => candidate.id === anchor?.id &&
      candidate.yaw === anchor.yaw && ["x", "y", "z"].every(axis => candidate.position[axis] === anchor.position[axis]));
  };

  function sitDown(anchor) {
    if (!canInteract() || controller.mounted || !controller.grounded || !currentAnchor(anchor)) return false;
    if (!seats.sit(anchor, { occupants: occupants() })) return false;
    seatedSpaceId = getSpaceId();
    nearby = null;
    emotes?.cancel("sit");
    controller.moving = false;
    controller.velocityY = 0;
    controller.jumpQueued = false;
    player.setLocalPosition(anchor.position.x, anchor.position.y, anchor.position.z);
    player.setLocalEulerAngles(0, anchor.yaw, 0);
    getOnline()?.forcePose();
    return true;
  }

  function standUp(reason) {
    const anchor = seats.seated;
    if (!anchor) return false;
    // A late callback must never apply a room-local anchor to a different coordinate frame.
    const sameSpace = seatedSpaceId === getSpaceId();
    const point = sameSpace ? resolveStandPoint(anchor) : null;
    seats.stand(reason);
    seatedSpaceId = null;
    nearby = null;
    if (sameSpace) {
      if (point) player.setLocalPosition(point.x, point.y, point.z);
      controller.velocityY = 0;
      controller.grounded = true;
      controller.moving = false;
      getOnline()?.forcePose();
    }
    return true;
  }

  return {
    seats,
    get nearby() { return nearby; },
    sitDown,
    standUp,
    toggle() {
      if (seats.isSeated) return standUp("explicit");
      // Re-resolve at activation, including mobile taps and furniture refreshes between frames.
      refreshNearby();
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
      const reason = seatedSpaceId !== getSpaceId() ? "space"
        : !currentAnchor(seats.seated) ? "furniture"
          : seats.shouldStand({ intent: locomotionIntent(controller), placeZoneId: getPlaceZoneId() });
      if (reason) standUp(reason);
      return seats.isSeated;
    },
    // After the frame's movement: which free seat, if any, the prompt offers.
    refreshNearby
  };

  function refreshNearby() {
    nearby = canInteract() && !seats.isSeated && !controller.mounted && controller.grounded
      ? findSeat(player.getLocalPosition(), { occupants: occupants(), anchors: getAnchors() }) : null;
    return nearby;
  }
}
