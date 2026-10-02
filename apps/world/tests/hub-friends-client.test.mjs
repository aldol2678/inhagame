import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../hub-friends-client.js", import.meta.url), "utf8");
const context = { window: {}, console };
vm.runInNewContext(source, context, { filename: "hub-friends-client.js" });

const {
  isUserId, parsePerson, parseProfile, parseSocial, friendErrorCode, createHubFriendsClient
} = context.window.InhaHubFriendsClient;

const A = "81000000-0000-4000-8000-000000000001";
const B = "82000000-0000-4000-8000-000000000002";
const C = "83000000-0000-4000-8000-000000000003";

function social(overrides = {}) {
  return {
    friends: [{ userId:B, nickname:"밥돌", title:"탐험가", avatar:"explorer", inhaVerified:true, email:"leak@example.test" }],
    incoming: [{ userId:C, nickname:"찰리", title:null, avatar:"classic" }],
    outgoing: [],
    blocked: [],
    ...overrides
  };
}

function scripted() {
  const calls = [];
  const queue = [];
  return {
    calls,
    respond(value) { queue.push(value); },
    async rpc(name, args) {
      calls.push([name,args]);
      if (!queue.length) throw new Error("no scripted response");
      return queue.shift();
    }
  };
}

test("person parser keeps only the public friend-card allowlist", () => {
  assert.equal(isUserId(B), true);
  assert.equal(isUserId("밥돌"), false);
  const person = parsePerson(social().friends[0]);
  assert.equal(person.userId, B);
  assert.equal(person.nickname, "밥돌");
  assert.equal(person.title, "탐험가");
  assert.equal(person.avatar, "explorer");
  assert.equal(person.inhaVerified, true);
  assert.equal(person.email, undefined);
});

test("public profile parser keeps only safe fields and relationship", () => {
  const profile = parseProfile({
    userId:B, nickname:"밥돌", title:"탐험가", avatar:"explorer",
    inhaVerified:true, available:true, relationship:"friends",
    email:"leak@example.test", joinedAt:"2020-01-01"
  });
  assert.equal(profile.userId, B);
  assert.equal(profile.relationship, "friends");
  assert.equal(profile.available, true);
  assert.equal(profile.email, undefined);
  assert.equal(profile.joinedAt, undefined);
  const unavailable = parseProfile({ userId:B, available:false, relationship:"unavailable", nickname:"비밀" });
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.nickname, "이용할 수 없는 사용자");
  assert.equal(parseProfile({ userId:B, available:true, relationship:"made_up" }), null);
});

test("social parser validates all four sections", () => {
  const parsed = parseSocial(social());
  assert.equal(parsed.friends.length, 1);
  assert.equal(parsed.incoming.length, 1);
  assert.equal(parsed.outgoing.length, 0);
  assert.equal(parsed.blocked.length, 0);
  assert.equal(parseSocial({ ...social(), friends:null }), null);
  assert.equal(parseSocial({ ...social(), incoming:[{ userId:"nickname" }] }), null);
});

test("unknown database text never becomes a user-facing error code", () => {
  assert.equal(friendErrorCode({ message:"SOCIAL_RESTRICTED" }), "SOCIAL_RESTRICTED");
  assert.equal(friendErrorCode({ message:"relation private.secret does not exist" }), "FAILED");
});

test("list uses the existing World social authority and binds to one account", async () => {
  const server = scripted();
  const client = createHubFriendsClient({ rpc:server.rpc });
  client.setAccount(A);
  server.respond({ data:social(), error:null });
  const result = await client.list();
  assert.equal(result.outcome, "READY");
  assert.equal(result.snapshot.friends[0].userId, B);
  assert.equal(result.snapshot.incoming[0].userId, C);
  assert.equal(server.calls[0][0], "get_my_world_social");
  assert.equal(Object.keys(server.calls[0][1]).length, 0);
});

test("profile resolves through the existing public-profile RPC and is account guarded", async () => {
  const server = scripted();
  const client = createHubFriendsClient({ rpc:server.rpc });
  client.setAccount(A);
  server.respond({ data:{
    userId:B, nickname:"밥돌", title:"탐험가", avatar:"explorer",
    inhaVerified:true, available:true, relationship:"friends", email:"leak@example.test"
  }, error:null });
  const result = await client.profile(B);
  assert.equal(result.outcome, "READY");
  assert.equal(result.profile.userId, B);
  assert.equal(result.profile.relationship, "friends");
  assert.equal(result.profile.email, undefined);
  assert.equal(server.calls.at(-1)[0], "get_world_public_profile");
  assert.equal(server.calls.at(-1)[1].p_target, B);
});

test("account switch discards a late friend-list response", async () => {
  const server = scripted();
  const client = createHubFriendsClient({ rpc:server.rpc });
  client.setAccount(A);
  let resolve;
  server.respond(new Promise((r) => { resolve = r; }));
  const pending = client.list();
  client.setAccount(B);
  resolve({ data:social(), error:null });
  assert.equal((await pending).outcome, "STALE");
  assert.equal(client.snapshot.friends.length, 0);
});

test("friend mutations map to the existing RPCs only", async () => {
  const server = scripted();
  const client = createHubFriendsClient({ rpc:server.rpc });
  client.setAccount(A);

  server.respond({ data:{ relationship:"friends" }, error:null });
  assert.equal((await client.accept(B)).outcome, "SUCCESS");
  assert.equal(server.calls.at(-1)[0], "respond_world_friend_request");
  assert.equal(server.calls.at(-1)[1].p_target, B);
  assert.equal(server.calls.at(-1)[1].p_accept, true);

  server.respond({ data:{ relationship:"none" }, error:null });
  assert.equal((await client.reject(C)).outcome, "SUCCESS");
  assert.equal(server.calls.at(-1)[0], "respond_world_friend_request");
  assert.equal(server.calls.at(-1)[1].p_accept, false);

  server.respond({ data:{ relationship:"none" }, error:null });
  await client.cancel(B);
  assert.equal(server.calls.at(-1)[0], "cancel_world_friend_request");

  server.respond({ data:{ relationship:"none" }, error:null });
  await client.remove(B);
  assert.equal(server.calls.at(-1)[0], "remove_world_friend");

  server.respond({ data:{ relationship:"blocked_by_me" }, error:null });
  await client.block(B);
  assert.equal(server.calls.at(-1)[0], "block_world_user");

  server.respond({ data:{ relationship:"none" }, error:null });
  await client.unblock(B);
  assert.equal(server.calls.at(-1)[0], "unblock_world_user");
});

test("invalid or self targets never reach an RPC", async () => {
  const server = scripted();
  const client = createHubFriendsClient({ rpc:server.rpc });
  client.setAccount(A);
  assert.equal((await client.accept("밥돌")).code, "TARGET_UNAVAILABLE");
  assert.equal((await client.remove(A)).code, "TARGET_UNAVAILABLE");
  assert.equal(server.calls.length, 0);
});
