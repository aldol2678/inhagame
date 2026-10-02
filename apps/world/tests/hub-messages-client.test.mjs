import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../hub-messages-client.js", import.meta.url), "utf8");
const context = { window: {}, console };
vm.runInNewContext(source, context, { filename: "hub-messages-client.js" });
const {
  isUserId, parseRecipient, parseMessage, parseConversation, parseConversationList, parseThread,
  messageErrorCode, createHubMessagesClient
} = context.window.InhaHubMessagesClient;

const A = "81000000-0000-4000-8000-000000000001";
const B = "82000000-0000-4000-8000-000000000002";
const C1 = "c1000000-0000-4000-8000-000000000001";
const M1 = "m1000000-0000-4000-8000-000000000001";

const message = (overrides = {}) => ({
  id: M1, senderId: B, body: "안녕하세요", deleted: false,
  createdAt: "2026-09-28T03:10:00Z", ...overrides
});
const conversation = (overrides = {}) => ({
  conversationId: C1,
  other: { userId: B, nickname: "밥돌", title: null, avatar: "classic", inhaVerified: false },
  updatedAt: "2026-09-28T03:10:00Z",
  unreadCount: 1,
  blockedByMe: false,
  lastMessage: message(),
  ...overrides
});

function scripted() {
  const calls = [];
  const queue = [];
  return {
    calls,
    respond(value) { queue.push(value); },
    async rpc(name, args) {
      calls.push([name, args]);
      if (!queue.length) throw new Error("no scripted response");
      const next = queue.shift();
      return next instanceof Promise ? next : next;
    }
  };
}

test("parsers accept the documented mailbox shapes", () => {
  assert.equal(parseMessage(message()).body, "안녕하세요");
  assert.equal(parseConversation(conversation()).other.nickname, "밥돌");
  assert.equal(parseConversationList([conversation()]).length, 1);
  assert.equal(parseThread({ conversationId: C1, messages: [message()] }, C1).messages.length, 1);
});

test("parsers reject malformed or oversized private content", () => {
  assert.equal(parseMessage(message({ body: "" })), null);
  assert.equal(parseMessage(message({ body: "x".repeat(1001) })), null);
  assert.equal(parseConversation(conversation({ unreadCount: -1 })), null);
  assert.equal(parseConversationList([conversation(), { nope: true }]), null);
  assert.equal(parseThread({ conversationId: "other", messages: [] }, C1), null);
});

test("unavailable counterpart exposes no invented profile detail", () => {
  const parsed = parseConversation(conversation({
    other: { userId: B, available: false }
  }));
  assert.equal(parsed.other.available, false);
  assert.equal(parsed.other.nickname, "이용할 수 없는 사용자");
  assert.equal(parsed.other.inhaVerified, false);
});

test("unknown transport/database text is never surfaced as an error code", () => {
  assert.equal(messageErrorCode({ message: "relation private.secret does not exist" }), "FAILED");
  assert.equal(messageErrorCode({ message: "NOT_ALLOWED" }), "NOT_ALLOWED");
});

test("list binds to the account and derives the unread badge from server rows", async () => {
  const server = scripted();
  const client = createHubMessagesClient({ rpc: server.rpc });
  client.setAccount(A);
  server.respond({ data: [conversation({ unreadCount: 3 })], error: null });
  const result = await client.list(50);
  assert.equal(result.outcome, "READY");
  assert.equal(result.unreadCount, 3);
  assert.equal(client.conversations[0].other.userId, B);
  assert.equal(server.calls[0][0], "get_my_hub_conversations_v1");
  assert.equal(server.calls[0][1].p_limit, 50);
});

test("refreshUnread uses the narrow unread RPC and validates the count", async () => {
  const server = scripted();
  const client = createHubMessagesClient({ rpc: server.rpc });
  client.setAccount(A);
  server.respond({ data: 7, error: null });
  assert.equal((await client.refreshUnread()).unreadCount, 7);
  assert.equal(server.calls[0][0], "get_my_hub_unread_count_v1");
  server.respond({ data: -1, error: null });
  assert.equal((await client.refreshUnread()).outcome, "FAILED");
});

test("account switch discards a stale inbox response", async () => {
  const server = scripted();
  const client = createHubMessagesClient({ rpc: server.rpc });
  client.setAccount(A);
  let resolve;
  server.respond(new Promise((r) => { resolve = r; }));
  const pending = client.list();
  client.setAccount(B);
  resolve({ data: [conversation()], error: null });
  assert.equal((await pending).outcome, "STALE");
  assert.equal(client.conversations.length, 0);
});

test("profile draft recipient is UUID-only, allowlisted and account-switch guarded", async () => {
  const server = scripted();
  const client = createHubMessagesClient({ rpc: server.rpc });
  client.setAccount(A);
  assert.equal(isUserId(B), true);
  assert.equal(isUserId("밥"), false);
  assert.equal((await client.recipient("밥")).code, "TARGET_UNAVAILABLE");
  assert.equal(server.calls.length, 0);

  server.respond({ data: { userId: B, nickname: "밥돌", title: "탐험가", avatar: "classic",
    inhaVerified: true, available: true, relationship: "none", email: "leak@example.test" }, error: null });
  const result = await client.recipient(B);
  assert.equal(result.outcome, "READY");
  assert.equal(result.recipient.userId, B);
  assert.equal(result.recipient.relationship, "none");
  assert.equal(result.recipient.email, undefined);
  assert.equal(server.calls.at(-1)[0], "get_world_public_profile");
  assert.equal(server.calls.at(-1)[1].p_target, B);

  assert.equal(parseRecipient({ userId: B, available: false, relationship: "unavailable" }).available, false);
});

test("thread read, send, mark-read and archive use only P0-M1 RPCs", async () => {
  const server = scripted();
  const client = createHubMessagesClient({ rpc: server.rpc });
  client.setAccount(A);

  server.respond({ data: [conversation({ unreadCount: 2 })], error: null });
  await client.list();

  server.respond({ data: { conversationId: C1, messages: [message()] }, error: null });
  assert.equal((await client.thread(C1)).outcome, "READY");

  server.respond({ data: { messageId: "m2" }, error: null });
  assert.equal((await client.send(B, "  답장  ")).outcome, "SUCCESS");
  assert.equal(server.calls.at(-1)[0], "send_hub_message_v1");
  assert.equal(server.calls.at(-1)[1].p_recipient, B);
  assert.equal(server.calls.at(-1)[1].p_body, "답장");

  server.respond({ data: { conversationId: C1, readAt: "2026-09-28T03:11:00Z" }, error: null });
  assert.equal((await client.markRead(C1)).outcome, "SUCCESS");
  assert.equal(client.unreadCount, 0);

  server.respond({ data: { conversationId: C1, archived: true }, error: null });
  assert.equal((await client.archive(C1)).outcome, "SUCCESS");
  assert.equal(server.calls.at(-1)[0], "archive_hub_conversation_v1");
});

test("send rejects blank and oversized text before an RPC", async () => {
  const server = scripted();
  const client = createHubMessagesClient({ rpc: server.rpc });
  client.setAccount(A);
  assert.equal((await client.send(B, "   ")).code, "INVALID_MESSAGE");
  assert.equal((await client.send(B, "x".repeat(1001))).code, "INVALID_MESSAGE");
  assert.equal(server.calls.length, 0);
});

test("block and structured report keep their existing authority boundaries", async () => {
  const server = scripted();
  const client = createHubMessagesClient({ rpc: server.rpc });
  client.setAccount(A);

  server.respond({ data: { relationship: "blocked_by_me" }, error: null });
  assert.equal((await client.block(B)).outcome, "SUCCESS");
  assert.equal(server.calls.at(-1)[0], "block_world_user");
  assert.equal(server.calls.at(-1)[1].p_target, B);

  assert.equal((await client.report(M1, "made_up")).code, "INVALID_CATEGORY");
  server.respond({ data: { status: "received" }, error: null });
  assert.equal((await client.report(M1, "spam")).outcome, "SUCCESS");
  assert.equal(server.calls.at(-1)[0], "report_hub_message_v1");
  assert.equal(server.calls.at(-1)[1].p_message, M1);
  assert.equal(server.calls.at(-1)[1].p_category, "spam");
});

test("server refusals become stable codes and never raw text", async () => {
  const server = scripted();
  const client = createHubMessagesClient({ rpc: server.rpc });
  client.setAccount(A);

  server.respond({ data: null, error: { message: "NOT_ALLOWED" } });
  assert.equal((await client.send(B, "hi")).code, "NOT_ALLOWED");

  server.respond({ data: null, error: { message: "SQL stack trace: secret" } });
  assert.equal((await client.thread(C1)).code, "FAILED");
});
