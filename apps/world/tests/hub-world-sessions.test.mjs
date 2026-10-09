import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WORLD_KICK_MINUTES, WORLD_SESSION_RPC, parseWorldSessionRoster,
  kickWorldAccount, restoreWorldAccount, mountWorldSessionAdmin
} from "../hub-world-sessions.mjs";

const OPERATOR = "5f000000-0000-4000-8000-000000000061";
const TARGET = "33333333-3333-4333-8333-333333333333";
const now = "2026-10-09T10:40:00.000Z";
const roster = ({ accounts = [
  { userId:TARGET, nickname:"canary-a", sessionCount:2, space:"campus",
    placeZoneId:"AREA_MAIN_GATE", lastSeenAt:now }
], blocked = [], operatorUserId = OPERATOR } = {}) => ({
  operatorUserId, onlineSessions:3, guestSessions:1, accounts, blocked, asOf:now
});

class FakeNode {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "30";
  }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  appendChild(node) { this.children.push(node); return node; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  closest(selector) { return selector === "button[data-action]" && this.tagName === "BUTTON"
    && this.dataset.action ? this : null; }
}
function harness({ authorized = true, confirm = () => true } = {}) {
  const ids = [
    "hub-world-session-admin", "hub-world-session-summary", "hub-world-session-status",
    "hub-world-session-accounts", "hub-world-session-blocks", "hub-world-session-refresh",
    "hub-world-session-duration"
  ];
  const nodes = Object.fromEntries(ids.map(id => [id, new FakeNode()]));
  nodes["hub-world-session-admin"].hidden = true;
  const calls = [];
  let list = roster();
  const doc = {
    visibilityState:"visible",
    getElementById(id) { return nodes[id] ?? null; },
    createElement(tag) { return new FakeNode(tag); },
    addEventListener() {}
  };
  const win = {
    location:{ hash:"#account" },
    addEventListener() {},
    setInterval() { return 7; },
    clearInterval() {},
    setTimeout(fn) { fn(); }
  };
  const client = {
    auth:{
      async getUser() { return { data:{ user:{ id:OPERATOR, is_anonymous:false } } }; },
      onAuthStateChange() { return { data:{ subscription:{ unsubscribe() {} } } }; }
    },
    async rpc(name, args) {
      calls.push([name,args]);
      if (name === WORLD_SESSION_RPC.LIST) {
        return authorized ? { data:list, error:null } :
          { data:null, error:{ code:"42501", message:"unauthorized" } };
      }
      if (name === WORLD_SESSION_RPC.KICK) {
        list = roster({
          accounts:[],
          blocked:[{ userId:TARGET, nickname:"canary-a", blockedUntil:now }]
        });
        return { data:{ userId:args.p_user_id, sessionsRemoved:2, blockedUntil:now }, error:null };
      }
      if (name === WORLD_SESSION_RPC.RESTORE) {
        list = roster();
        return { data:true, error:null };
      }
      throw new Error("UNEXPECTED_RPC");
    }
  };
  const controller = mountWorldSessionAdmin({
    client, documentLike:doc, windowLike:win, confirmAction:confirm
  });
  return { nodes, calls, controller, client };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("RPC parser rejects malformed roster or account IDs", () => {
  assert.throws(() => parseWorldSessionRoster({ accounts:[], blocked:[] }),
    /INVALID_WORLD_SESSION_ROSTER/);
  assert.throws(() => parseWorldSessionRoster(roster({
    accounts:[{ userId:"invalid", nickname:"x", sessionCount:1, lastSeenAt:now }]
  })), /INVALID_WORLD_SESSION_ACCOUNT/);
  const valid = parseWorldSessionRoster(roster());
  assert.equal(valid.accounts[0].sessionCount,2);
  assert.equal(valid.operatorUserId, OPERATOR);
});

test("RPC helpers enforce account and allowed duration and confirm server readback", async () => {
  const calls = [];
  const client = { rpc:async (name,args) => {
    calls.push([name,args]);
    return name === WORLD_SESSION_RPC.KICK
      ? { data:{ userId:TARGET, sessionsRemoved:2 }, error:null }
      : { data:true, error:null };
  } };
  assert.deepEqual(WORLD_KICK_MINUTES,[5,30,60,240]);
  await assert.rejects(kickWorldAccount(client,OPERATOR,30,OPERATOR),/INVALID_KICK_REQUEST/);
  await assert.rejects(kickWorldAccount(client,TARGET,1440,OPERATOR),/INVALID_KICK_REQUEST/);
  assert.equal(calls.length,0);
  const outcome = await kickWorldAccount(client,TARGET,30,OPERATOR);
  assert.equal(outcome.sessionsRemoved,2);
  assert.deepEqual(calls[0],[
    "kick_world_user_v1",{ p_user_id:TARGET,p_minutes:30 }
  ]);
  await restoreWorldAccount(client,TARGET);
  assert.deepEqual(calls[1],[
    "restore_world_user_v1",{ p_user_id:TARGET }
  ]);
  await assert.rejects(restoreWorldAccount(client,"not-a-uuid"),/INVALID_RESTORE_REQUEST/);
});

test("world admin sees account roster, can confirm kick and restore, with no guest kick", async () => {
  const h = harness();
  await settle();
  const panel = h.nodes["hub-world-session-admin"];
  const accounts = h.nodes["hub-world-session-accounts"];
  const blocked = h.nodes["hub-world-session-blocks"];
  assert.equal(panel.hidden,false);
  assert.match(h.nodes["hub-world-session-summary"].textContent,/게스트 1세션/);
  assert.equal(accounts.children.length,1);
  const kickButton = accounts.children[0].children[1];
  assert.equal(kickButton.dataset.action,"kick");
  assert.equal(kickButton.textContent,"강제 퇴장");
  assert.equal(kickButton.disabled,false);
  await accounts.listeners.click({ target:kickButton });
  assert.equal(h.calls.filter(([name])=>name===WORLD_SESSION_RPC.KICK).length,1);
  assert.equal(accounts.children[0].textContent,"");
  assert.equal(blocked.children.length,1);
  assert.equal(blocked.children[0].children[1].textContent,"차단 해제");
  await blocked.listeners.click({ target:blocked.children[0].children[1] });
  assert.equal(h.calls.filter(([name])=>name===WORLD_SESSION_RPC.RESTORE).length,1);
  assert.equal(accounts.children.length,1);
});

test("a regular member never sees the admin panel", async () => {
  const h = harness({ authorized:false });
  await settle();
  assert.equal(h.nodes["hub-world-session-admin"].hidden,true);
  assert.equal(h.nodes["hub-world-session-accounts"].children.length,0);
});

test("cancelled confirmation does not call kick RPC", async () => {
  const h = harness({ confirm:() => false });
  await settle();
  const a = h.nodes["hub-world-session-accounts"];
  await a.listeners.click({ target:a.children[0].children[1] });
  assert.equal(h.calls.filter(([name])=>name===WORLD_SESSION_RPC.KICK).length,0);
});

test("hub account view contains the hidden admin card and loads its scripts", () => {
  const html = readFileSync(new URL("../index.html",import.meta.url),"utf8");
  const account = html.split('data-view="account"')[1]?.split('data-view="friends"')[0] || "";
  assert.match(account,/id="hub-world-session-admin"[^>]*hidden/);
  assert.match(account,/id="hub-world-session-accounts"/);
  assert.match(account,/id="hub-world-session-blocks"/);
  assert.match(html,/<script type="module" src="\/hub-world-sessions\.mjs"><\/script>/);
  assert.match(html,/<link rel="stylesheet" href="\/hub-world-sessions\.css">/);
});
