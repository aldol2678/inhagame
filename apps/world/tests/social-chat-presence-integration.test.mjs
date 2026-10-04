import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { SocialClient, Relationship } from "../src/social/social-client.js";
import { createSocialAccountSession } from "../src/social/social-account-session.js";
import { createChatPanel } from "../src/online/chat-panel.js";
import { createFriendPanel } from "../src/social/friend-panel.js";
import { createLobbyPresenceSummary } from "../src/lobby/lobby-presence-summary.js";
import { AccompanyClient } from "../src/social/accompany-client.js";
import { AccompanyController } from "../src/social/accompany-controller.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const A = "a0000000-0000-4000-8000-000000000001", B = "b0000000-0000-4000-8000-000000000002";
const X = "c0000000-0000-4000-8000-000000000003", Y = "d0000000-0000-4000-8000-000000000004";
const flush = () => new Promise(resolve => setImmediate(resolve));
const list = (friends, blocked) => ({ friends: friends.map(userId => ({ userId })), blocked: blocked.map(userId => ({ userId })), incoming: [], outgoing: [] });

for (const late of ["success", "failure"]) test(`actual main identity callback isolates chat, social and lobby on late A ${late}`, async () => {
  let account = A, networkState = "ONLINE", roomActive = false;
  const pending = [], writes = [], sent = [], roomNotifications = [];
  const client = { rpc(name, args) {
    if (name === "get_my_world_social") return new Promise((resolve, reject) => pending.push({ resolve: data => resolve({ data, error: null }), reject }));
    if (name === "get_my_world_accompany") return Promise.resolve({ data: [], error: null });
    writes.push({ name, args });
    return Promise.resolve({ data: {}, error: null });
  } };
  const online = {
    get userId() { return account; },
    status: () => ({ signedIn: !!account, state: networkState, count: 0 }),
    remoteByUser: userId => userId === Y ? { presence: "present" } : null,
    chat: { get signedIn() { return !!account; }, submit: text => { sent.push(text); return { result: "sent" }; } }
  };
  const doc = createFakeDocument(), input = doc.createElement("input"), hint = doc.createElement("p");
  input.value = "";
  const chatPanel = createChatPanel({ toggle: doc.createElement("button"), form: doc.createElement("form"), input, hint,
    feedList: doc.createElement("ol"), getChat: () => online.chat, doc });
  const social = new SocialClient({ getClient: () => client, getSelfUserId: () => account });
  const friendPanel = createFriendPanel({ toggle: doc.createElement("button"), panel: doc.createElement("section"), social, doc, timers: {} });
  const lobbyPresenceSummary = createLobbyPresenceSummary({ friendsButton: doc.createElement("button"), getOnline: () => online, social, friendPanel });
  const playerCard = { close() {} };
  const socialAccountSession = createSocialAccountSession({ social, onFriends: value => lobbyPresenceSummary.setFriends(value),
    onAccountChange: () => { playerCard.close(); if (friendPanel.open) void friendPanel.setOpen(false); } });
  const accompany = new AccompanyController({ client: new AccompanyClient({ getClient: () => client, getSelfUserId: () => account }),
    getSelfUserId: () => account, follow: { isFollowing: () => false }, navigation: { snapshot: () => null } });
  social.onRelationshipChange((id, state) => { if (accompany.peerId === id && state !== Relationship.FRIENDS) void accompany.end("relationship"); });
  social.onRelationshipChange((id, state) => lobbyPresenceSummary.applyRelationship(id, state));
  social.onRelationshipChange(() => roomNotifications.push(roomActive));

  // Execute the production callback body unchanged. Only unrelated engine, shop and HUD
  // dependencies are inert fixtures; all three privacy/display paths above are real modules.
  const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const body = source.match(/online\.onIdentity\(\(identity\) => \{([\s\S]*?)\n  \}\);\n  online\.chat\.feed/)?.[1];
  assert.ok(body, "production identity callback located");
  const noop = () => {};
  const accountClient = { setAccount: noop };
  const context = createContext({
    online, socialAccountSession, chatPanel, friendPanel, lobbyPresenceSummary, playerCard, accompany,
    syncBiryongAccount: noop, progression: accountClient, shop: accountClient, wallet: accountClient,
    inventory: accountClient, dailyQuiz: accountClient, attendance: accountClient, loadout: accountClient,
    inkyungSideEvent: { setScope: noop }, lastPersonalRoomUserId: null,
    roomSession: { stop: () => { roomActive = false; } }, roomFurniture: { reset: noop }, rooms: { currentSpace: "CAMPUS" },
    personalRoom: { reset: noop }, npcAiSignedIn: false, mcmEvent: { setSignedIn: noop }, mcmEventPreviewMode: false,
    npcTest: { setAiSignedIn: noop }, profile: { setIdentity: noop }, lobbyPlayerSummary: { render: noop },
    nearbyPanel: { render: noop, setOpen: noop }, guestbookPanel: { setAvailable: noop }, follow: { stop: noop }, FollowStopReason: { OFFLINE: "offline" }
  });
  runInContext(`function identityHandler(identity) {${body}\n}`, context);
  context.identityHandler({ userId: A });
  pending[0].resolve(list([X], [Y])); await flush();
  chatPanel.setOpen(true); input.value = "synthetic A draft";
  context.identityHandler({ userId: A }); // A's second list request stays pending.
  await flush();
  roomActive = true;
  accompany.session = { id: "e0000000-0000-4000-8000-000000000005", peerId: X, state: "active" };
  roomNotifications.length = 0;
  context.identityHandler(null); // online.userId deliberately still A, matching actual stopSession.
  assert.equal(input.value, "");
  assert.equal(chatPanel.open, false);
  assert.equal(chatPanel.setOpen(true), false);
  assert.equal(social.available, false);
  assert.equal(lobbyPresenceSummary.status().totalFriends, null);
  assert.ok(roomNotifications.length > 0 && roomNotifications.every(value => value === false));
  assert.deepEqual(writes, [], "logout listener teardown must not send an accompany end or any write");

  account = B; networkState = "CONNECTING";
  context.identityHandler({ userId: B });
  chatPanel.setOpen(true); input.value = "synthetic B draft";
  pending[2].resolve(list([Y], [X])); await flush();
  assert.equal(lobbyPresenceSummary.status().totalFriends, 1);
  assert.equal(lobbyPresenceSummary.status().sameZoneFriends, null, "CONNECTING never invents zero friends");
  if (late === "success") pending[1].resolve(list([X], [Y]));
  else pending[1].reject(new Error("synthetic offline"));
  await flush();
  assert.equal(input.value, "synthetic B draft");
  assert.equal(social.isBlocked(X), true);
  assert.equal(social.isBlocked(Y), false);
  assert.equal(lobbyPresenceSummary.status().totalFriends, 1);
  networkState = "ONLINE";
  assert.equal(lobbyPresenceSummary.update().sameZoneFriends, 1);
  networkState = "RECONNECTING";
  assert.equal(lobbyPresenceSummary.update().sameZoneFriends, null);
  assert.equal(input.value, "synthetic B draft", "same-account transport changes keep the current draft");
  assert.deepEqual(sent, []);
  assert.deepEqual(writes, []);
  socialAccountSession.dispose();
});
