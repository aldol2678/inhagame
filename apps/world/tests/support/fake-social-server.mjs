// In-memory stand-in for the World social RPCs (migration 20260926030000), same rules:
// caller = the client's own user id, one canonical row per pair, directional blocks,
// generic "unavailable", allowlisted card fields. Records every call for assertions.

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export class FakeSocialServer {
  constructor(profiles) {
    this.profiles = new Map(profiles.map((p) => [p.userId, p]));
    this.pairs = new Map(); // key -> { status, requestedBy }
    this.blocks = new Set(); // `${blocker}>${blocked}`
    this.reports = [];
    this.calls = [];
  }

  relationship(me, other) {
    if (this.blocks.has(`${me}>${other}`)) return "blocked_by_me";
    if (this.blocks.has(`${other}>${me}`)) return "unavailable";
    const row = this.pairs.get(pairKey(me, other));
    if (!row) return "none";
    if (row.status === "accepted") return "friends";
    return row.requestedBy === me ? "outgoing" : "incoming";
  }

  card(id) {
    const p = this.profiles.get(id);
    // Extra private fields on purpose: the client must drop them.
    return { userId: p.userId, nickname: p.nickname, title: p.title ?? null, avatar: p.avatar ?? "classic", inhaVerified: p.inhaVerified === true, email: "leak@example.test", department: "비공개", joinedAt: "2020-01-01" };
  }

  clientFor(me) {
    return {
      rpc: async (name, args) => {
        this.calls.push({ me, name, args: { ...args } });
        const t = args.p_target;
        const fail = (message) => ({ data: null, error: { message } });
        const ok = (data) => ({ data, error: null });
        if (name !== "get_my_world_social" && (!this.profiles.has(t) || t === me)) {
          return fail(name === "report_world_user" && t === me ? "CANNOT_REPORT_SELF" : "TARGET_UNAVAILABLE");
        }
        const state = () => ({ userId: t, relationship: this.relationship(me, t) });
        const key = pairKey(me, t ?? "");
        switch (name) {
          case "get_world_public_profile": {
            const rel = this.relationship(me, t);
            return ok(rel === "unavailable" ? { userId: t, available: false, relationship: rel } : { ...this.card(t), available: true, relationship: rel });
          }
          case "get_world_relationship": return ok(state());
          case "send_world_friend_request": {
            const rel = this.relationship(me, t);
            if (rel === "blocked_by_me" || rel === "unavailable") return fail("NOT_ALLOWED");
            if (rel === "none") this.pairs.set(key, { status: "pending", requestedBy: me });
            return ok(state());
          }
          case "respond_world_friend_request": {
            const row = this.pairs.get(key);
            if (row?.status === "pending" && row.requestedBy === t) {
              if (args.p_accept) row.status = "accepted"; else this.pairs.delete(key);
            }
            return ok(state());
          }
          case "cancel_world_friend_request": {
            const row = this.pairs.get(key);
            if (row?.status === "pending" && row.requestedBy === me) this.pairs.delete(key);
            return ok(state());
          }
          case "remove_world_friend": {
            if (this.pairs.get(key)?.status === "accepted") this.pairs.delete(key);
            return ok(state());
          }
          case "block_world_user": this.blocks.add(`${me}>${t}`); this.pairs.delete(key); return ok(state());
          case "unblock_world_user": this.blocks.delete(`${me}>${t}`); return ok(state());
          case "get_my_world_social": {
            const lists = { friends: [], incoming: [], outgoing: [], blocked: [] };
            for (const [k, row] of this.pairs) {
              const [a, b] = k.split("|");
              if (a !== me && b !== me) continue;
              const other = a === me ? b : a;
              const bucket = row.status === "accepted" ? "friends" : row.requestedBy === me ? "outgoing" : "incoming";
              lists[bucket].push(this.card(other));
            }
            for (const b of this.blocks) {
              const [blocker, blocked] = b.split(">");
              if (blocker === me) lists.blocked.push(this.card(blocked));
            }
            return ok(lists);
          }
          case "report_world_user": {
            if (!["spam", "harassment", "inappropriate_name", "other"].includes(args.p_category)) return fail("INVALID_CATEGORY");
            const dup = this.reports.some((r) => r.reporter === me && r.target === t && r.category === args.p_category);
            if (!dup) this.reports.push({ reporter: me, target: t, category: args.p_category, zone: args.p_place_zone_id });
            return ok({ status: dup ? "duplicate" : "received" });
          }
          default: return fail("FAILED");
        }
      }
    };
  }
}
