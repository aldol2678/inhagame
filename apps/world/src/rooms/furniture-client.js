import { canonicalFurniture, FURNITURE_UUID, validateFurniture } from "./furniture-layout.js";

export function parseFurnitureSnapshot(raw, roomId) {
  if (!raw || raw.roomId !== roomId || !["owner", "visitor"].includes(raw.role) || !Number.isSafeInteger(raw.revision) || raw.revision < 0 || validateFurniture(raw.objects)) return null;
  return { roomId, role: raw.role, revision: raw.revision, objects: canonicalFurniture(raw.objects) };
}
const clone = objects => objects.map(object => ({ ...object }));
const same = (a,b) => JSON.stringify(canonicalFurniture(a)) === JSON.stringify(canonicalFurniture(b));

export function createFurnitureClient({ getClient, getUserId, onChange = () => {} }) {
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
  async function refresh() {
    if (!roomId || draft !== null || pending || reading) return false;
    const gen = generation, account = userId, room = roomId;
    reading = true; error = null; emit();
    try {
      const client = getClient();
      if (!client?.rpc || !current(gen, account)) throw Error("LAYOUT_DENIED");
      const result = await client.rpc("get_world_room_furniture_v1", { p_room: room });
      if (result.error) throw result.error;
      const parsed = parseFurnitureSnapshot(result.data, room);
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
        const client = getClient();
        if (!client?.rpc) throw Error("UNAVAILABLE");
        const result = await client.rpc("save_my_room_furniture_v1", { p_room: room, p_revision: revision, p_objects: objects });
        if (result.error) throw result.error;
        const parsed = parseFurnitureSnapshot(result.data, room);
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
