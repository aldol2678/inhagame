import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { createGuestbookPanel } from "../src/guestbook/guestbook-panel.js";
import { GuestbookClient } from "../src/guestbook/guestbook-client.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const A = "a0000000-0000-4000-8000-000000000001", B = "b0000000-0000-4000-8000-000000000002";
const ID = "c0000000-0000-4000-8000-000000000003";
const tick = () => new Promise(resolve => setImmediate(resolve));
const board = (account, content = `${account} post`, more = false) => ({ locationKey: "main_gate",
  entries: [{ id: ID, userId: account, content, mine: true, nickname: "synthetic", avatar: "classic" }],
  dailyUsed: 0, dailyLimit: 3, dailyRemaining: 3, cooldownRemainingSeconds: 0, hasMore: more, nextBefore: more ? "2026-10-01" : null });
const nodes = root => [root, ...root.children.flatMap(nodes)];
const find = (f, cls) => nodes(f.panel).find(node => node.className.split(" ").includes(cls));
const draft = (f, text) => { const input = find(f, "guestbook-textarea"); input.value = text; input.dispatch("input"); return input; };

function fixture(onOpenChange) {
  const doc = createFakeDocument(), panel = doc.createElement("section"), calls = [];
  const pending = (op, args) => new Promise((resolve, reject) => calls.push({ op, args, resolve, reject }));
  const api = { available: true, setAccount() {}, load: args => pending("load", args),
    create: text => pending("create", text), update: (id, text) => pending("update", [id, text]), remove: id => pending("remove", id) };
  const ui = createGuestbookPanel({ panel, guestbook: api, doc, onOpenChange });
  ui.setAvailable(true, A);
  return { doc, panel, calls, ui, api };
}
async function open(f, account = A) {
  const result = f.ui.setOpen(true);
  f.calls.at(-1).resolve(board(account)); await result;
}

for (const op of ["create", "update", "remove"]) {
  for (const late of ["success", "failure"]) test(`panel ${op} ignores A's late ${late} while B is saving`, async () => {
    const f = fixture(); await open(f);
    if (op === "update") find(f, "guestbook-entry-edit").click();
    if (op !== "remove") { draft(f, "A private draft"); find(f, "guestbook-save").click(); }
    else find(f, "guestbook-entry-delete").click();
    const old = f.calls.at(-1);
    f.ui.setAvailable(true, B);
    assert.equal(f.ui.open, false, "account boundary closes old UI");
    assert.equal(f.ui.data, null);
    assert.equal(f.panel.children.length, 0);
    await open(f, B);
    draft(f, "B private draft"); find(f, "guestbook-save").click();
    const current = f.calls.at(-1), count = f.calls.length;
    if (late === "success") old.resolve(true); else old.reject(new Error("synthetic failure"));
    await tick();
    assert.equal(f.calls.length, count, "old completion cannot refresh the new account");
    assert.equal(find(f, "guestbook-textarea").value, "B private draft");
    assert.equal(find(f, "guestbook-save").disabled, true, "old finally cannot unlock B's pending save");
    assert.equal(find(f, "guestbook-hint"), undefined);
    current.resolve(true); await tick();
    assert.equal(f.calls.at(-1).op, "load");
    f.calls.at(-1).resolve(board(B, "B saved")); await tick();
    assert.equal(find(f, "guestbook-textarea").value, "");
    assert.equal(find(f, "guestbook-hint").textContent, "새 방명록을 남겼어요.");
  });
}

for (const method of ["refresh", "loadMore"]) {
  for (const late of ["success", "failure"]) test(`${method} late ${late} cannot publish across A→B→A`, async () => {
    const f = fixture();
    const first = f.ui.setOpen(true); f.calls[0].resolve(board(A, "A initial", true)); await first;
    const old = f.ui[method](); const pending = f.calls.at(-1);
    f.ui.setAvailable(true, B); f.ui.setAvailable(true, A);
    await open(f, A); draft(f, "new A draft");
    const current = f.ui.data;
    if (late === "success") pending.resolve(board(A, "old A data")); else pending.reject(new Error("old A error"));
    await old;
    assert.equal(f.ui.data, current);
    assert.equal(find(f, "guestbook-textarea").value, "new A draft");
    assert.equal(find(f, "guestbook-hint"), undefined);
  });
}

test("same-account reconnect preserves board, draft, edit state and pending ownership", async () => {
  const f = fixture(); await open(f);
  find(f, "guestbook-entry-edit").click(); draft(f, "in progress");
  const current = f.ui.data;
  f.ui.setAvailable(true, A); f.ui.setAvailable(true);
  assert.equal(f.ui.data, current); assert.equal(f.ui.editingId, ID);
  assert.equal(find(f, "guestbook-textarea").value, "in progress");
  assert.equal(f.calls.length, 1);
});

test("logout closes and fences reopening despite a stale available getter", async () => {
  const f = fixture(); await open(f); draft(f, "private");
  f.ui.setAvailable(false, null);
  assert.equal(f.ui.open, false); assert.equal(f.ui.data, null);
  assert.equal(await f.ui.setOpen(true), false);
  assert.equal(f.calls.length, 1);
});

test("detached A editor actions cannot submit a write or draft for B", async () => {
  const f = fixture(); await open(f);
  const oldInput = draft(f, "A draft"), oldSave = find(f, "guestbook-save"), oldDelete = find(f, "guestbook-entry-delete");
  f.ui.setAvailable(true, B); await open(f, B); draft(f, "B draft");
  oldInput.value = "late A input"; oldInput.dispatch("input"); oldSave.click(); oldDelete.click(); await tick();
  assert.equal(f.calls.length, 2);
  assert.equal(find(f, "guestbook-textarea").value, "B draft");
});

test("account close callback may reopen the new account without outer cleanup erasing it", async () => {
  let f, reopening;
  f = fixture(value => { if (!value) reopening = f.ui.setOpen(true); });
  await open(f);
  f.ui.setAvailable(true, B);
  assert.equal(f.ui.open, true);
  assert.equal(f.calls.length, 2);
  f.calls[1].resolve(board(B)); await reopening;
  assert.equal(f.ui.data.entries[0].userId, B);
  assert.equal(f.panel.hidden, false);
});

test("production identity callback passes explicit identity even when online.userId is stale", async () => {
  const doc = createFakeDocument(), panel = doc.createElement("section"), calls = [];
  let getter = A;
  const guestbook = new GuestbookClient({ getSelfUserId: () => getter,
    getClient: () => ({ rpc: async () => { calls.push(true); return { data: board(getter), error: null }; } }) });
  const guestbookPanel = createGuestbookPanel({ panel, guestbook, doc });
  const noop = () => {}, client = { setAccount: noop }, online = { get userId() { return getter; } };
  const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const body = source.match(/online\.onIdentity\(\(identity\) => \{([\s\S]*?)\n  \}\);\n  online\.chat\.feed/)?.[1];
  assert.ok(body);
  const context = createContext({ online, photoMode: { close: noop }, guestbookPanel, syncBiryongAccount: noop, progression: client,
    biryongRelationships: client, shop: client, wallet: client, inventory: client, dailyQuiz: client,
    attendance: client, lifeSkillBook: client, fishing: client, loadout: client, inkyungSideEvent: { setScope: noop }, duckCompanion: { refresh: noop, reset: noop },
    lastPersonalRoomUserId: null, roomSession: { stop: noop }, roomFurniture: { reset: noop },
    rooms: { currentSpace: "CAMPUS" }, personalRoom: { reset: noop }, npcAiSignedIn: false,
    mcmEvent: { setSignedIn: noop }, mcmEventPreviewMode: false, npcTest: { setAiSignedIn: noop },
    profile: { setIdentity: noop }, lobbyPlayerSummary: { render: noop }, chatPanel: { refreshAvailability: noop },
    friendPanel: { setAvailable: noop }, nearbyPanel: { render: noop, setOpen: noop },
    accompany: { refresh: noop, reset: noop }, social: { mine: async () => ({ friends: [] }), reset: noop },
    socialAccountSession: { setAccount: noop }, lobbyPresenceSummary: { setFriends: noop, update: noop },
    follow: { stop: noop }, FollowStopReason: { OFFLINE: "OFFLINE" }, playerCard: { close: noop },
    lobbyQuestHighlight: { update: noop }
  });
  runInContext(`function identityHandler(identity) {${body}\n}`, context);
  context.identityHandler({ userId: A }); await guestbookPanel.setOpen(true);
  context.identityHandler(null);
  assert.equal(guestbook.available, false);
  assert.equal(await guestbookPanel.setOpen(true), false);
  context.identityHandler({ userId: B }); getter = B;
  await guestbookPanel.setOpen(true);
  assert.equal(guestbookPanel.data.entries[0].userId, B);
  assert.equal(calls.length, 2);
});

for (const late of ["success", "failure"]) test(`same-account reopen keeps pending write ownership through old ${late}`, async () => {
  const f = fixture(); await open(f); draft(f, "first write"); find(f, "guestbook-save").click();
  const old = f.calls.at(-1);
  await f.ui.setOpen(false); await open(f);
  assert.equal(find(f, "guestbook-textarea").disabled, true, "reopening cannot join an older write with a new draft");
  find(f, "guestbook-save").click();
  const count = f.calls.length;
  if (late === "success") old.resolve(true); else old.reject(new Error("synthetic error"));
  await tick();
  assert.equal(f.calls.length, count, "closed view cannot trigger a readback");
  assert.equal(find(f, "guestbook-textarea").disabled, false, "settled write releases only its own busy state");
  assert.equal(find(f, "guestbook-hint"), undefined);
  draft(f, "new draft"); find(f, "guestbook-save").click();
  assert.equal(f.calls.at(-1).args, "new draft");
  f.calls.at(-1).reject(new Error("current failure")); await tick();
  assert.ok(find(f, "guestbook-hint"), "current failures still give feedback");
  assert.equal(find(f, "guestbook-textarea").value, "new draft");
});
