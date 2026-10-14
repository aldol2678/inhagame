import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createChatPanel } from "../src/online/chat-panel.js";
import { createFakeDocument } from "./support/fake-dom.mjs";
import { createRealtimeWorld, createWorldClient, runWorld } from "./support/online-world-harness.mjs";

function rig({ getChat, submit = () => ({ result: "offline" }) } = {}) {
  const doc = createFakeDocument();
  const toggle = doc.createElement("button");
  const form = doc.createElement("form");
  const input = doc.createElement("input");
  const feedList = doc.createElement("ol");
  const hint = doc.createElement("p");
  input.value = "";
  form.append(input);
  const chat = { signedIn: true, submit };
  const openChanges = [];
  const panel = createChatPanel({
    toggle, form, input, feedList, hint, doc, getChat: getChat ?? (() => chat),
    onOpenChange: value => openChanges.push(value)
  });
  return { doc, toggle, form, input, hint, chat, panel, openChanges };
}

test("logout clears an open account draft and feedback despite the old session getter", () => {
  const submitted = [];
  const r = rig({ submit: text => { submitted.push(text); return { result: "offline" }; } });
  r.panel.refreshAvailability("account-a");
  r.panel.setOpen(true);
  r.input.value = "A의 보내지 않은 문장";
  r.panel.send();
  assert.match(r.hint.textContent, /온라인/);

  // world-online emits identity=null before clearing its old session; signedIn is still true.
  r.panel.refreshAvailability(null);
  assert.equal(r.input.value, "");
  assert.equal(r.hint.textContent, "");
  assert.equal(r.panel.open, false);
  assert.equal(r.doc.activeElement, null);
  assert.equal(r.toggle.getAttribute("aria-disabled"), "true");
  r.panel.refreshAvailability(null);
  assert.deepEqual(r.openChanges, [true, false], "duplicate logout releases input ownership only once");
  r.toggle.click();
  r.doc.dispatch("keydown", { code: "Enter" });
  assert.equal(r.panel.open, false, "the stale signedIn getter cannot reopen signed-out chat");
  r.input.value = "stale input event";
  assert.equal(r.panel.send(), "signed_out");
  assert.deepEqual(submitted, ["A의 보내지 않은 문장"], "logout never sends a draft or accepts a stale submit");
});

test("a direct account switch clears a closed draft and stale feedback without sending", () => {
  const submitted = [];
  const r = rig({ submit: text => { submitted.push(text); return { result: "sent" }; } });
  r.panel.refreshAvailability("account-a");
  r.input.value = "private draft A";
  r.hint.textContent = "A's old error";
  r.panel.refreshAvailability("account-b");
  assert.equal(r.input.value, "");
  assert.equal(r.hint.textContent, "");
  assert.equal(r.panel.open, false);
  assert.equal(r.toggle.getAttribute("aria-disabled"), "false");
  assert.deepEqual(submitted, []);
  r.panel.setOpen(true);
  r.input.dispatch("keydown", { code: "Enter", key: "Enter" });
  assert.deepEqual(submitted, [], "B's empty Enter cannot send A's draft");
});

test("same-account refreshes and close/reopen preserve an unsent draft without duplicating events", () => {
  const submitted = [];
  const r = rig({ submit: text => { submitted.push(text); return { result: "sent" }; } });
  r.panel.refreshAvailability("account-a");
  r.panel.setOpen(true);
  r.input.value = "한글 👋 unfinished";
  r.hint.textContent = "same-account feedback";
  r.panel.refreshAvailability("account-a");
  r.panel.refreshAvailability();
  assert.equal(r.input.value, "한글 👋 unfinished");
  assert.equal(r.hint.textContent, "same-account feedback");
  assert.equal(r.panel.open, true);
  r.panel.setOpen(false);
  r.panel.setOpen(true);
  r.panel.refreshAvailability("account-a");
  assert.equal(r.input.value, "한글 👋 unfinished");
  assert.deepEqual(r.openChanges, [true, false, true]);
  r.input.dispatch("keydown", { code: "Enter", key: "Enter" });
  assert.deepEqual(submitted, ["한글 👋 unfinished"], "repeated identity callbacks do not duplicate submit handlers");
});

for (const result of ["sent", "offline"]) {
  test(`a reentrant ${result} result for A cannot overwrite B's draft, hint or open state`, () => {
    const r = rig({ submit: () => {
      r.panel.refreshAvailability("account-b");
      r.panel.setOpen(true);
      r.input.value = "B's new draft";
      r.hint.textContent = "B's current feedback";
      return { result };
    } });
    r.panel.refreshAvailability("account-a");
    r.panel.setOpen(true);
    r.input.value = "A's submitted text";
    r.panel.send();
    assert.equal(r.input.value, "B's new draft");
    assert.equal(r.hint.textContent, "B's current feedback");
    assert.equal(r.panel.open, true);
  });
}

test("real online auth callbacks clear A on logout and B login, with no synthetic wire send", async () => {
  const world = createRealtimeWorld();
  const a = createWorldClient(world, { label: "A" });
  const r = rig({ getChat: () => a.online.chat });
  const seen = [];
  const off = a.online.onIdentity(identity => {
    seen.push({ identity: identity?.userId ?? null, sessionUserId: a.online.userId });
    r.panel.refreshAvailability(identity?.userId ?? null);
  });
  try {
    await runWorld(world, 700);
    r.panel.setOpen(true);
    r.input.value = "A's never-sent draft";
    const member = a.lib.clients.find(client => client.storageKey === "default");
    member.signOut();
    await runWorld(world, 700);
    assert.ok(seen.some(event => event.identity === null && event.sessionUserId === "user-a"),
      "exercise the actual stale session-getter ordering");
    assert.equal(r.input.value, "");
    assert.equal(r.panel.open, false);
    member.signIn({ id: "user-b", is_anonymous: false });
    await runWorld(world, 700);
    r.panel.setOpen(true);
    assert.equal(r.input.value, "");
    r.input.dispatch("keydown", { code: "Enter", key: "Enter" });
    const messages = world.server.wire.filter(entry => entry.kind === "action" && entry.payload.p.type === "chat");
    assert.deepEqual(messages, [], "auth changes and reconnects never auto-send text");
  } finally { off(); a.online.stop(); }
});

test("transient transport disconnect/reconnect preserves the same-account draft without replay", async () => {
  const world = createRealtimeWorld();
  const a = createWorldClient(world, { label: "A" });
  const r = rig({ getChat: () => a.online.chat });
  const off = a.online.onIdentity(identity => r.panel.refreshAvailability(identity?.userId ?? null));
  try {
    await runWorld(world, 700);
    r.panel.setOpen(true);
    r.input.value = "same-account offline draft";
    world.server.setOnline(false);
    await runWorld(world, 300);
    assert.equal(r.panel.send(), "offline");
    assert.equal(r.input.value, "same-account offline draft");
    world.server.setOnline(true);
    await runWorld(world, 3000);
    assert.equal(a.online.status().state, "ONLINE");
    assert.equal(r.input.value, "same-account offline draft");
    assert.equal(r.panel.open, true);
    assert.deepEqual(world.server.wire.filter(entry => entry.kind === "action" && entry.payload.p.type === "chat"), []);
  } finally { off(); a.online.stop(); }
});

test("main passes the emitted identity to chat availability instead of the still-old session getter", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.ok(/chatPanel\.refreshAvailability\(identity\?\.userId \?\? null\)/.test(main));
});
