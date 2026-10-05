// NetworkTransport contract. The network core talks only to this shape and never learns
// whether the implementation is Supabase Realtime, a WebSocket, a realtime gateway or a game server.
//
// Methods may return void or a Promise. The core never awaits them: outcomes arrive through
// the subscribe* callbacks, and thrown errors or rejected promises are contained by the core.
//
//   connect({ sessionId, credentials })   open the connection; report via status "connected" | "error"
//   disconnect()                           close deliberately; no further callbacks required
//   joinPlaceZone(placeZoneId, presence)   join the zone channel and track this presence there
//   leavePlaceZone(placeZoneId)            untrack and leave the zone channel
//   publishPresence(placeZoneId, presence) update tracked presence
//   publishPose(placeZoneId, packet)       fire-and-forget pose snapshot (lossy is fine)
//   publishAction(placeZoneId, packet)     fire-and-forget transient action
//
//   subscribePresence(handler)  handler({ type: "sync" | "join" | "leave", placeZoneId, presences: [...] })
//                               "sync" is the full current zone membership (it may include self).
//   subscribePose(handler)      handler({ placeZoneId, sessionId, packet })  sender identified by the transport
//   subscribeAction(handler)    handler({ placeZoneId, sessionId, packet })
//   subscribeStatus(handler)    handler({ status: "connected" | "disconnected" | "error", reason? })
//   Each subscribe* returns an unsubscribe function.
//
// `credentials` is opaque to the core and must only be used by the transport to authenticate.
// It must never be copied into presence, pose or action payloads.

export const TransportStatus = Object.freeze({
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  ERROR: "error"
});

export const TRANSPORT_METHODS = Object.freeze([
  "connect", "disconnect",
  "joinPlaceZone", "leavePlaceZone",
  "publishPresence", "publishPose", "publishAction",
  "subscribePresence", "subscribePose", "subscribeAction", "subscribeStatus"
]);

export function assertNetworkTransport(transport) {
  const missing = TRANSPORT_METHODS.filter((name) => typeof transport?.[name] !== "function");
  if (missing.length) throw new TypeError(`NetworkTransport is missing: ${missing.join(", ")}`);
  return transport;
}
