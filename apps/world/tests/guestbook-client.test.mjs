import test from "node:test";
import assert from "node:assert/strict";
import {
  GUESTBOOK_LOCATION, GUESTBOOK_DAILY_LIMIT, GuestbookClient, GuestbookError,
  parseGuestbookBoard, parseGuestbookEntry
} from "../src/guestbook/guestbook-client.js";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ENTRY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const entry = (overrides = {}) => ({
  id: ENTRY, userId: OTHER, nickname: "방문자", avatar: "explorer", inhaVerified: true,
  content: "안녕하세요", createdAt: "2026-09-26T11:00:00.000Z",
  updatedAt: "2026-09-26T11:00:00.000Z", mine: false, ...overrides
});

test("guestbook parser keeps only public display fields", () => {
  const parsed = parseGuestbookEntry({ ...entry(), email: "secret@example.com", studentId: "hidden" });
  assert.deepEqual(Object.keys(parsed), [
    "id", "userId", "nickname", "avatar", "inhaVerified", "content",
    "createdAt", "updatedAt", "mine"
  ]);
  assert.equal(parsed.inhaVerified, true);
  assert.equal(parsed.email, undefined);
});

test("board parser exposes daily quota and cooldown state", () => {
  const board = parseGuestbookBoard({
    locationKey: GUESTBOOK_LOCATION,
    entries: [entry()],
    hasMore: true,
    nextBefore: "2026-09-26T11:00:00.000Z",
    dailyLimit: 3,
    dailyUsed: 1,
    dailyRemaining: 2,
    cooldownRemainingSeconds: 42
  });
  assert.equal(board.entries.length, 1);
  assert.equal(board.dailyLimit, GUESTBOOK_DAILY_LIMIT);
  assert.equal(board.dailyUsed, 1);
  assert.equal(board.dailyRemaining, 2);
  assert.equal(board.cooldownRemainingSeconds, 42);
  assert.equal(board.hasMore, true);
  assert.throws(() => parseGuestbookBoard({ locationKey: "back_gate" }), GuestbookError);
});

test("client uses v2 list/create/update/delete RPCs", async () => {
  const calls = [];
  const ownId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const client = {
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === "get_world_guestbook_v2") return {
        data: {
          locationKey: GUESTBOOK_LOCATION,
          entries: [entry()],
          hasMore: false,
          nextBefore: null,
          dailyLimit: 3,
          dailyUsed: 1,
          dailyRemaining: 2,
          cooldownRemainingSeconds: 0
        },
        error: null
      };
      if (name === "create_world_guestbook_entry_v2") return {
        data: entry({ id: ownId, userId: ME, content: "내 새 글", mine: true }),
        error: null
      };
      if (name === "update_world_guestbook_entry_v2") return {
        data: entry({ id: ownId, userId: ME, content: "수정 글", mine: true }),
        error: null
      };
      if (name === "delete_world_guestbook_entry_v2") return { data: true, error: null };
      throw new Error(name);
    }
  };
  const api = new GuestbookClient({ getClient: () => client, getSelfUserId: () => ME });

  const board = await api.load({ limit: 99 });
  assert.equal(board.entries[0].nickname, "방문자");
  const created = await api.create("  내 새 글  ");
  assert.equal(created.content, "내 새 글");
  const updated = await api.update(ownId, "  수정 글 ");
  assert.equal(updated.content, "수정 글");
  assert.equal(await api.remove(ownId), true);

  assert.deepEqual(calls.map(([name]) => name), [
    "get_world_guestbook_v2",
    "create_world_guestbook_entry_v2",
    "update_world_guestbook_entry_v2",
    "delete_world_guestbook_entry_v2"
  ]);
  assert.equal(calls[0][1].p_limit, 50);
  assert.equal(calls[1][1].p_content, "내 새 글");
  assert.equal(calls[2][1].p_entry_id, ownId);
});

test("client rejects signed-out and malformed writes before network calls", async () => {
  let calls = 0;
  const client = { rpc: async () => { calls += 1; return { data: null, error: null }; } };
  const signedOut = new GuestbookClient({ getClient: () => client, getSelfUserId: () => null });
  await assert.rejects(() => signedOut.load(), (error) => error.code === "SIGNED_OUT");

  const signedIn = new GuestbookClient({ getClient: () => client, getSelfUserId: () => ME });
  await assert.rejects(() => signedIn.create(" ".repeat(3)), (error) => error.code === "INVALID_CONTENT");
  await assert.rejects(() => signedIn.create("x".repeat(151)), (error) => error.code === "INVALID_CONTENT");
  await assert.rejects(() => signedIn.update("not-a-uuid", "hi"), (error) => error.code === "ENTRY_UNAVAILABLE");
  await assert.rejects(() => signedIn.remove("not-a-uuid"), (error) => error.code === "ENTRY_UNAVAILABLE");
  assert.equal(calls, 0);
});

test("moderation restriction errors remain distinct for the UI", async () => {
  const client = {
    rpc: async () => ({ data: null, error: { message: "SOCIAL_RESTRICTED" } })
  };
  const api = new GuestbookClient({ getClient: () => client, getSelfUserId: () => ME });
  await assert.rejects(() => api.load(), (error) =>
    error instanceof GuestbookError && error.code === "SOCIAL_RESTRICTED");
});

test("server rate-limit errors remain distinct for the UI", async () => {
  const client = {
    rpc: async (name) => ({
      data: null,
      error: { message: name === "create_world_guestbook_entry_v2" ? "DAILY_LIMIT_REACHED" : "FAILED" }
    })
  };
  const api = new GuestbookClient({ getClient: () => client, getSelfUserId: () => ME });
  await assert.rejects(() => api.create("세 번째 다음 글"), (error) =>
    error instanceof GuestbookError && error.code === "DAILY_LIMIT_REACHED");
});
