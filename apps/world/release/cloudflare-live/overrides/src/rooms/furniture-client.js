import { canonicalFurniture, FURNITURE_UUID, validateFurniture } from "./furniture-layout.js";
import { readGuestSessionId } from "../activity/session-id.js";

// AUTH (migrated 2026-11-13, Tier 4 guest-open — READ + SAVE, A-2): both paths authenticate
// with the v0.1 guest session id in the `X-Session-Id` header only — no other credential header
// is sent. The id is read lazily by readGuestSessionId() (fishing-reporter-wiring.js: localStorage
// 'inha-v01:sync-session', fallback 'inha-v01:server-session'; null when absent — never
// fabricated). The account bound by setAccount IS that session id.
// Read: GET /api/world-room-furniture?room_id=. Save: POST /api/world-room-furniture
// { roomId, revision, objects }. The server answers 200 + the snapshot, or an HTTP status with
// { error: <server refusal code> }.
// Before: the client called getClient().rpc() on the signed-in permanent-account client
// (get_world_room_furniture_v1 / save_my_room_furniture_v1). That path is gone; only the
// transport changed — parsing, state, generation and the revision rules are unchanged.

export const ROOM_FURNITURE_API_PATH = "/api/world-room-furniture";

export function parseFurnitureSnapshot(raw, roomId) {
  if (!raw || raw.roomId !== roomId || !["owner", "visitor"].includes(raw.role) || !Number.isSafeInteger(raw.revision) || raw.revision < 0 || validateFurniture(raw.objects)) return null;
  return { roomId, role: raw.role, revision: raw.revision, objects: canonicalFurniture(raw.objects) };
}
const clone = objects => objects.map(object => ({ ...object }));
const same = (a,b) => JSON.stringify(canonicalFurniture(a)) === JSON.stringify(canonicalFurniture(b));

export function createFurnitureClient({
  getSessionId = readGuestSessionId,
  getUserId,
  fetcher = (...args) => globalThis.fetch(...args),
  endpoint = ROOM_FURNITURE_API_PATH,
  onChange = () => {}
}) {
  let generation = 0, userId = null, roomId = null, snapshot = null, draft = null;
  let pending = false, reading = false, error = null;
  const state = () => ({ roomId, role: snapshot?.role ?? null, revision: snapshot?.revision ?? null,
    objects: clone(draft ?? snapshot?.objects ?? []), editing: draft !== null,
    dirty: draft !== null && !same(draft, snapshot?.objects ?? []), pending, reading, error, ready: snapshot !== null });
  const emit = () => onChange(state());
  const current = (gen, account) => gen === generation && account === getUserId() && account === userId;
  function reset() {
    generation++; userId = null; roomId = null; snapshot = null; draft = null; pending = false; reading = false; error = null; emit();
  }
  /** Fetch the snapshot; throws Error(<server refusal code>) on a non-200 answer. */
  async function fetchSnapshot(id) {
    let sessionId = null;
    try { sessionId = await getSessionId?.() ?? null; } catch { sessionId = null; }
    if (!sessionId) throw Error("UNAVAILABLE");
    const response = await fetcher(`${endpoint}?room_id=${encodeURIComponent(id)}`, { headers: { "X-Session-Id": sessionId } });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Error(typeof data?.error === "string" && data.error ? data.error : "UNAVAILABLE");
    return data;
  }

  /** Save the layout; throws Error(<server refusal code>) on a non-200 answer. */
  async function fetchSave(id, revision, objects) {
    let sessionId = null;
    try { sessionId = await getSessionId?.() ?? null; } catch { sessionId = null; }
    if (!sessionId) throw Error("UNAVAILABLE");
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Id": sessionId },
      body: JSON.stringify({ roomId: id, revision, objects })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Error(typeof data?.error === "string" && data.error ? data.error : "UNAVAILABLE");
    return data;
  }

  async function refresh() {
    if (!roomId || draft !== null || pending || reading) return false;
    const gen = generation, account = userId, room = roomId;
    reading = true; error = null; emit();
    try {
      if (!current(gen, account)) throw Error("LAYOUT_DENIED");
      const data = await fetchSnapshot(room);
      const parsed = parseFurnitureSnapshot(data, room);
      if (!parsed) throw Error("UNAVAILABLE");
      if (!current(gen, account)) return false;
      snapshot = parsed; return true;
    } catch (cause) {
      if (current(gen, account)) {
        error = cause?.message === "LAYOUT_DENIED" ? "LAYOUT_DENIED" : "UNAVAILABLE";
        if (error === "LAYOUT_DENIED") { snapshot = null; draft = null; }
      }
      return false;
    } finally { if (current(gen, account)) { reading = false; emit(); } }
  }
  return {
    state,
    reset,
    async bind(nextRoom) {
      const account = getUserId();
      if (nextRoom === roomId && account === userId) return !!snapshot;
      reset();
      if (!FURNITURE_UUID.test(nextRoom ?? "") || !FURNITURE_UUID.test(account ?? "")) return false;
      roomId = nextRoom; userId = account; return refresh();
    },
    refresh,
    begin() {
      if (!snapshot || snapshot.role !== "owner" || !current(generation, userId) || pending || reading || error) return false;
      draft = clone(snapshot.objects); error = null; emit(); return true;
    },
    edit(objects) {
      if (!draft || pending || !current(generation, userId)) return false;
      draft = clone(objects); error = null; emit(); return true;
    },
    cancel({ force = false } = {}) {
      if (pending && !force) return false;
      if (pending && force) { generation++; pending = false; snapshot = null; }
      draft = null; error = null; emit(); return true;
    },
    async save(owned) {
      if (draft === null || pending || snapshot?.role !== "owner" || !current(generation, userId)) return false;
      error = validateFurniture(draft, owned ?? []);
      if (error) { emit(); return false; }
      const gen = generation, account = userId, room = roomId;
      const objects = canonicalFurniture(draft), revision = snapshot.revision;
      pending = true; error = null; emit();
      try {
        const data = await fetchSave(room, revision, objects);
        const parsed = parseFurnitureSnapshot(data, room);
        if (!parsed || parsed.role !== "owner" || parsed.revision < revision || !same(parsed.objects, objects)) throw Error("UNAVAILABLE");
        if (!current(gen, account)) return false;
        snapshot = parsed; draft = clone(parsed.objects); return true;
      } catch (cause) {
        if (current(gen, account)) error = ["LAYOUT_CONFLICT", "ITEM_NOT_OWNED", "LAYOUT_DENIED", "INVALID_LAYOUT", "ROOM_BOUNDS", "EXIT_BLOCKED", "FURNITURE_OVERLAP"].includes(cause?.message) ? cause.message : "UNAVAILABLE";
        return false;
      } finally { if (current(gen, account)) { pending = false; emit(); } }
    }
  };
}
