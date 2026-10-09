import test from "node:test";
import assert from "node:assert/strict";
import { createGuestbookPanel } from "../src/guestbook/guestbook-panel.js";
import { GuestbookError } from "../src/guestbook/guestbook-client.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const A = "a0000000-0000-4000-8000-000000000001", B = "b0000000-0000-4000-8000-000000000002";
const ID = "c0000000-0000-4000-8000-000000000003";
const tick = () => new Promise(resolve => setImmediate(resolve));
const board = (account = A, entries = true) => ({ locationKey: "main_gate",
  entries: entries ? [{ id: ID, userId: account, mine: true, nickname: "synthetic", content: `${account} post` }] : [],
  dailyUsed: 0, dailyLimit: 3, dailyRemaining: 3, cooldownRemainingSeconds: 0, hasMore: false, nextBefore: null });
const nodes = root => [root, ...root.children.flatMap(nodes)];
const find = (f, cls) => nodes(f.panel).find(node => node.className.split(" ").includes(cls));
const type = (f, text) => { const input = find(f, "guestbook-textarea"); input.value = text; input.dispatch("input"); };
function fixture() {
  const doc = createFakeDocument(), panel = doc.createElement("section"), calls = [], writes = [];
  const guestbook = { available: true, setAccount() {}, load: args => new Promise((resolve, reject) => calls.push({ args, resolve, reject })),
    create: text => new Promise((resolve, reject) => writes.push({ text, resolve, reject })),
    remove: id => new Promise((resolve, reject) => writes.push({ id, resolve, reject })) };
  const ui = createGuestbookPanel({ panel, guestbook, doc }); ui.setAvailable(true, A);
  return { doc, panel, calls, writes, ui };
}
async function open(f, account = A, entries = true) {
  const result = f.ui.setOpen(true); f.calls.at(-1).resolve(board(account, entries)); await result;
}
async function failOpen(f) {
  const result = f.ui.setOpen(true); f.calls.at(-1).reject(new Error("synthetic outage")); await result;
}

test("initial load failure offers a single-flight read retry and clears the error after recovery", async () => {
  const f = fixture(); await failOpen(f);
  const retry = find(f, "guestbook-retry"); assert.ok(retry, "failed load has an in-panel retry");
  assert.equal(retry.textContent, "다시 불러오기"); assert.equal(retry.disabled, false);
  retry.focus(); retry.click(); retry.click(); void f.ui.refresh();
  assert.equal(f.calls.length, 2, "repeated retry and refresh share the active read");
  assert.equal(find(f, "guestbook-retry").disabled, true);
  const status = find(f, "guestbook-load-status");
  assert.equal(status.getAttribute("role"), "status");
  assert.match(status.textContent, /불러오는 중/);
  assert.equal(f.doc.activeElement, status, "keyboard retry keeps a live focus target");
  f.calls[1].reject(new Error("still unavailable")); await tick();
  assert.equal(find(f, "guestbook-retry").disabled, false);
  assert.equal(f.doc.activeElement, find(f, "guestbook-retry"));
  find(f, "guestbook-retry").click(); f.calls[2].resolve(board()); await tick();
  assert.equal(find(f, "guestbook-retry"), undefined);
  assert.equal(find(f, "guestbook-hint"), undefined);
  assert.equal(f.doc.activeElement, find(f, "guestbook-textarea"));
  assert.deepEqual(f.writes, []);
  retry.click(); assert.equal(f.calls.length, 3, "detached retry cannot reload a recovered board");
});

for (const editing of [false, true]) test(`same-account ${editing ? "edit" : "new"} draft survives close, failed reopen and retry`, async () => {
  const f = fixture(); await open(f);
  if (editing) find(f, "guestbook-entry-edit").click();
  type(f, "unfinished private draft");
  void f.ui.setOpen(true); assert.equal(f.calls.length, 1, "opening an open panel is idempotent");
  assert.equal(find(f, "guestbook-textarea").value, "unfinished private draft");
  await f.ui.setOpen(false); await f.ui.setOpen(false); await failOpen(f);
  find(f, "guestbook-retry").click(); f.calls.at(-1).resolve(board()); await tick();
  assert.equal(find(f, "guestbook-textarea").value, "unfinished private draft");
  assert.equal(f.ui.editingId, editing ? ID : null);
});

test("a failed manual refresh preserves the draft for read retry", async () => {
  const f = fixture(); await open(f); type(f, "keep while offline");
  const refreshing = f.ui.refresh(); f.calls.at(-1).reject(new Error("network")); await refreshing;
  find(f, "guestbook-retry").click(); f.calls.at(-1).resolve(board()); await tick();
  assert.equal(find(f, "guestbook-textarea").value, "keep while offline");
});

for (const boundary of ["switch", "logout", "unavailable"]) test(`${boundary} clears a retained draft and edit target`, async () => {
  const f = fixture(); await open(f); find(f, "guestbook-entry-edit").click(); type(f, "A secret");
  await f.ui.setOpen(false);
  if (boundary === "switch") { f.ui.setAvailable(true, B); f.ui.setAvailable(true, A); }
  else if (boundary === "logout") { f.ui.setAvailable(false, null); f.ui.setAvailable(true, A); }
  else { f.ui.setAvailable(false); f.ui.setAvailable(true, A); }
  await open(f); assert.equal(find(f, "guestbook-textarea").value, ""); assert.equal(f.ui.editingId, null);
});

for (const boundary of ["close", "account", "logout"]) for (const failure of [false, true]) {
  test(`retry late ${failure ? "failure" : "success"} is fenced after ${boundary}`, async () => {
    const f = fixture(); await failOpen(f); const retry = find(f, "guestbook-retry"); retry.click(); const old = f.calls.at(-1);
    if (boundary === "close") await f.ui.setOpen(false);
    else f.ui.setAvailable(boundary === "account", boundary === "account" ? B : null);
    const count = f.calls.length; retry.click(); assert.equal(f.calls.length, count, "detached control is inert");
    if (boundary !== "logout") { await open(f, boundary === "account" ? B : A); type(f, "current draft"); }
    const current = f.ui.data;
    if (failure) old.reject(new Error("old error")); else old.resolve(board(A)); await tick();
    assert.equal(f.ui.data, current);
    if (boundary === "logout") { assert.equal(f.ui.open, false); assert.equal(f.panel.children.length, 0); }
    else { assert.equal(find(f, "guestbook-textarea").value, "current draft"); assert.equal(find(f, "guestbook-hint"), undefined); }
  });
}

test("edit draft is discarded if the server no longer returns its entry", async () => {
  const f = fixture(); await open(f); find(f, "guestbook-entry-edit").click(); type(f, "deleted entry draft");
  await f.ui.setOpen(false); await open(f, A, false);
  assert.equal(f.ui.editingId, null); assert.equal(find(f, "guestbook-textarea").value, "");
});

for (const result of ["success", "failure"]) test(`closing a submitted write retains the existing no-replay behavior on ${result}`, async () => {
  const f = fixture(); await open(f); type(f, "already submitted"); find(f, "guestbook-save").click();
  await f.ui.setOpen(false); await open(f);
  assert.equal(find(f, "guestbook-textarea").value, ""); assert.equal(find(f, "guestbook-save").disabled, true);
  if (result === "success") f.writes[0].resolve(true); else f.writes[0].reject(new Error("uncertain write"));
  await tick(); assert.equal(f.writes.length, 1); assert.equal(find(f, "guestbook-textarea").value, "");
});

test("retry keeps signed-out and moderation errors authoritative without submitting anything", async () => {
  const f = fixture(); const opening = f.ui.setOpen(true);
  f.calls[0].reject(new GuestbookError("SOCIAL_RESTRICTED")); await opening;
  assert.match(find(f, "guestbook-load-status").textContent, /운영 조치/);
  find(f, "guestbook-retry").click(); f.calls[1].reject(new GuestbookError("SIGNED_OUT")); await tick();
  assert.match(find(f, "guestbook-load-status").textContent, /로그인한 계정/); assert.deepEqual(f.writes, []);
});

test("an edit draft from a later page survives a first-page reopen until the complete result excludes it", async () => {
  const f = fixture(); await open(f);
  const initial = f.ui.refresh(); f.calls.at(-1).resolve({ ...board(A, false), hasMore: true, nextBefore: '2026-10-06' }); await initial;
  const more = f.ui.loadMore(); f.calls.at(-1).resolve(board()); await more;
  find(f, "guestbook-entry-edit").click(); type(f, "older entry edit");
  await f.ui.setOpen(false);
  const reopen = f.ui.setOpen(true); f.calls.at(-1).resolve({ ...board(A, false), hasMore: true, nextBefore: '2026-10-06' }); await reopen;
  assert.equal(f.ui.editingId, ID, "missing from page one is not evidence of deletion");
  assert.equal(find(f, "guestbook-textarea").value, "older entry edit");
  assert.equal(find(f, "guestbook-save").textContent, "수정 저장", "preserved edit cannot silently become a new post");
  const complete = f.ui.loadMore(); f.calls.at(-1).resolve(board(A, false)); await complete;
  assert.equal(f.ui.editingId, null); assert.equal(find(f, "guestbook-textarea").value, "");
});

for (const success of [false, true]) test(`an unrelated draft survives close while delete is pending (${success ? "success" : "failure"})`, async () => {
  const f = fixture(); await open(f); type(f, "unsent new draft");
  find(f, "guestbook-entry-delete").click(); await f.ui.setOpen(false); await open(f);
  assert.equal(find(f, "guestbook-textarea").value, "unsent new draft");
  assert.equal(find(f, "guestbook-save").disabled, true);
  if (success) f.writes[0].resolve(true); else f.writes[0].reject(new Error("delete uncertain")); await tick();
  assert.equal(find(f, "guestbook-textarea").value, "unsent new draft");
  assert.equal(f.writes.length, 1);
});

test("retry completion does not steal focus after the user moves elsewhere", async () => {
  const f = fixture(); await failOpen(f); const retry = find(f, "guestbook-retry"); retry.focus(); retry.click();
  const outside = f.doc.createElement('button'); outside.focus();
  f.calls.at(-1).resolve(board()); await tick();
  assert.equal(f.doc.activeElement, outside);
});

test("recovery retains the server quota and cooldown snapshot", async () => {
  const f = fixture(); await failOpen(f); find(f, "guestbook-retry").click();
  f.calls.at(-1).resolve({ ...board(), dailyUsed: 3, dailyRemaining: 0, cooldownRemainingSeconds: 47 }); await tick();
  assert.equal(find(f, "guestbook-textarea").disabled, true);
  assert.equal(find(f, "guestbook-save").disabled, true);
  assert.match(find(f, "guestbook-rate").textContent, /3\/3.*47초/);
  assert.deepEqual(f.writes, []);
});

test("Escape closes a failed reopen without cancelling its hidden retained edit draft", async () => {
  const f = fixture(); await open(f); find(f, "guestbook-entry-edit").click(); type(f, "hidden edit draft");
  await f.ui.setOpen(false); await failOpen(f); f.doc.dispatch('keydown', { code: 'Escape' });
  assert.equal(f.ui.open, false, "there is no visible editor to cancel on the error view");
  await open(f); assert.equal(f.ui.editingId, ID); assert.equal(find(f, "guestbook-textarea").value, "hidden edit draft");
});
