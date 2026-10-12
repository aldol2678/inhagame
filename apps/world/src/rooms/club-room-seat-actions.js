// The shared SeatInteraction remains synchronous for campus/private rooms. Club clicks first
// acquire the server seat, then recheck room, account, input ownership and position before moving.
import { locomotionIntent } from "../seat-anchors.js";
import { CLUB_ROOM_ID } from "./club-room-seats.js";

export function createClubRoomSeatActions({ session, seating, player, controller,
  getRoomId, canInteract = () => true, onStatus = () => {} }) {
  let pending = null, seatedClaim = null, epoch = 0;
  const valid = request => getRoomId() === CLUB_ROOM_ID && session.status().sessionId === request.sessionId &&
    session.admissionId === request.admissionId &&
    session.status().online && canInteract() && controller.grounded && !controller.mounted &&
    !locomotionIntent(controller).move && !locomotionIntent(controller).jump &&
    Math.hypot(player.getLocalPosition().x - request.position.x, player.getLocalPosition().z - request.position.z) < .12;
  const unsubscribe = seating.seats.onChange(event => {
    if (event.type !== "stand" || event.anchor.clubRoomId !== CLUB_ROOM_ID || !seatedClaim) return;
    const claim = seatedClaim; seatedClaim = null;
    // SeatController emits synchronously. Bind its release to the admission which acquired
    // the seat, never to whichever admission happens to be current when standing begins.
    void session.releaseSeat(event.anchor.seatId, claim.sessionId, claim.admissionId);
  });
  return {
    async toggle() {
      if (getRoomId() !== CLUB_ROOM_ID || !canInteract()) return false;
      if (seating.seats.isSeated) return seating.standUp("explicit");
      if (pending) return false;
      const anchor = seating.refreshNearby();
      if (!anchor?.seatId || !session.status().online) return false;
      const request = pending = { epoch: ++epoch, sessionId: session.status().sessionId, admissionId: session.admissionId,
        position: { ...player.getLocalPosition() }, anchor };
      let claimed = false;
      try {
        claimed = await session.claimSeat(anchor.seatId);
        if (pending !== request || request.epoch !== epoch || !valid(request)) return false;
        if (!claimed) { onStatus("다른 사람이 먼저 앉았어요. 다른 자리를 골라 주세요."); return false; }
        const seated = seating.sitDown(anchor);
        if (seated) { seatedClaim = request; claimed = false; } // ownership follows the synchronous stand event
        return seated;
      } finally {
        if (claimed) void session.releaseSeat(anchor.seatId, request.sessionId, request.admissionId);
        if (pending === request) pending = null;
      }
    },
    cancel() { epoch += 1; },
    update() { if (pending && !valid(pending)) epoch += 1; },
    destroy() { epoch += 1; unsubscribe(); },
    get pending() { return !!pending; }
  };
}
