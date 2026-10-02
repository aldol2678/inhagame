// Audio follows the authoritative campus Place Zone and room transition state.
// Other campus areas intentionally resolve to silence in Soundscape P0-A.
export const AUDIO_TRANSITION = Object.freeze({ fadeSeconds: 1.25 });

export const AUDIO_PROFILES = Object.freeze({
  MAIN_GATE: Object.freeze({ id: "MAIN_GATE", ambience: "gate_v1", layers: Object.freeze([
    Object.freeze({ id: "traffic", gain: 0.075, filterHz: 240, kind: "traffic" }),
    Object.freeze({ id: "arrival", gain: 0.03, filterHz: 850, kind: "arrival" })
  ]) }),
  INKYUNG: Object.freeze({ id: "INKYUNG", ambience: "inkyung_v1", layers: Object.freeze([
    Object.freeze({ id: "water", gain: 0.06, filterHz: 700, kind: "water" }),
    Object.freeze({ id: "air", gain: 0.025, filterHz: 650, kind: "air" })
  ]) }),
  PERSONAL_ROOM: Object.freeze({ id: "PERSONAL_ROOM", ambience: "room_v0", layers: Object.freeze([
    Object.freeze({ id: "room-tone", gain: 0.07, filterHz: 320, kind: "room" }),
    Object.freeze({ id: "window-leak", gain: 0.025, filterHz: 380, kind: "window" })
  ]) })
});

export function resolveAudioZone({ space = "campus", placeZoneId = null } = {}) {
  if (space === "ROOM_PERSONAL_BASIC") return AUDIO_PROFILES.PERSONAL_ROOM;
  if (space !== "campus") return null;
  if (placeZoneId === "AREA_MAIN_GATE") return AUDIO_PROFILES.MAIN_GATE;
  if (placeZoneId === "AREA_INKYUNG_STUDENT_CENTER") return AUDIO_PROFILES.INKYUNG;
  return null;
}
