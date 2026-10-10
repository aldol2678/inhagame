import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WORLD_KICK_MINUTES, WORLD_SESSION_RPC, parseWorldSessionRoster,
  kickWorldAccount, restoreWorldAccount, mountWorldSessionAdmin,
  classifyKickOutcome, classifyRestoreOutcome
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
  assert.equal(accounts.children[0].textContent,"접속 중인 로그인 계정이 없습니다.");
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


// ---- Accepted / block-confirmed / session-ended are three separate facts -------------------------
const later = "2026-10-09T11:10:00.000Z";
function scenario({ listAfterKick, kick, restore, listAfterRestore, initial } = {}) {
  const ids = [
    "hub-world-session-admin", "hub-world-session-summary", "hub-world-session-status",
    "hub-world-session-accounts", "hub-world-session-blocks", "hub-world-session-refresh",
    "hub-world-session-duration"
  ];
  const nodes = Object.fromEntries(ids.map(id => [id, new FakeNode()]));
  nodes["hub-world-session-admin"].hidden = true;
  let phase = "initial";
  let list = initial ?? roster();
  const doc = { visibilityState:"visible", getElementById:id => nodes[id] ?? null,
    createElement:tag => new FakeNode(tag), addEventListener() {} };
  const win = { location:{ hash:"#account" }, addEventListener() {}, setInterval:() => 7,
    clearInterval() {}, setTimeout(fn) { fn(); } };
  const client = {
    auth:{
      async getUser() { return { data:{ user:{ id:OPERATOR, is_anonymous:false } } }; },
      onAuthStateChange() { return { data:{ subscription:{ unsubscribe() {} } } }; }
    },
    async rpc(name, args) {
      if (name === WORLD_SESSION_RPC.LIST) {
        if (phase === "kicked") {
          const next = typeof listAfterKick === "function" ? listAfterKick() : listAfterKick;
          if (next instanceof Error) return { data:null, error:{ message:"offline" } };
          return { data:next, error:null };
        }
        if (phase === "restored") return { data:listAfterRestore ?? roster(), error:null };
        return { data:list, error:null };
      }
      if (name === WORLD_SESSION_RPC.KICK) {
        phase = "kicked";
        if (kick instanceof Error) return { data:null, error:{ message:"reply lost" } };
        return { data:kick ?? { userId:args.p_user_id, sessionsRemoved:2, blockedUntil:later }, error:null };
      }
      if (name === WORLD_SESSION_RPC.RESTORE) {
        phase = "restored";
        return { data:restore ?? true, error:null };
      }
      throw new Error("UNEXPECTED_RPC");
    }
  };
  mountWorldSessionAdmin({ client, documentLike:doc, windowLike:win, confirmAction:() => true });
  return { nodes, status:() => nodes["hub-world-session-status"].textContent };
}
const blockedRoster = (accounts = []) => roster({
  accounts, blocked:[{ userId:TARGET, nickname:"canary-a", blockedUntil:later }]
});
const stillOnline = () => [{ userId:TARGET, nickname:"canary-a", sessionCount:1, space:"campus",
  placeZoneId:"AREA_MAIN_GATE", lastSeenAt:now }];
async function kickViaUi(options) {
  const h = scenario(options);
  await settle();
  const accounts = h.nodes["hub-world-session-accounts"];
  await accounts.listeners.click({ target:accounts.children[0].children[1] });
  return h;
}

test("classification keeps command acceptance, block confirmation and session end apart", () => {
  const result = { userId:TARGET, sessionsRemoved:2, blockedUntil:later };
  const full = classifyKickOutcome(result, parseWorldSessionRoster(blockedRoster()), TARGET);
  assert.deepEqual({ ...full }, {
    accepted:true, blockConfirmed:true, blockUnknown:false, heartbeatCleared:true, heartbeatUnknown:false,
    realtimeClosed:"UNKNOWN", evidence:"roster", blockedUntil:later, sessionsRemoved:2
  });
  const noBlock = classifyKickOutcome(result, parseWorldSessionRoster(roster({ accounts:[] })), TARGET);
  assert.equal(noBlock.accepted, true);
  assert.equal(noBlock.blockConfirmed, false);
  const lingering = classifyKickOutcome(result,
    parseWorldSessionRoster(blockedRoster(stillOnline())), TARGET);
  assert.equal(lingering.blockConfirmed, true);
  assert.equal(lingering.heartbeatCleared, false);
  const shorter = classifyKickOutcome({ ...result, blockedUntil:"2026-10-09T12:00:00.000Z" },
    parseWorldSessionRoster(blockedRoster()), TARGET);
  assert.equal(shorter.blockConfirmed, false, "a shorter stored block than the one promised is not confirmed");
  assert.equal(classifyKickOutcome(result, null, TARGET).blockConfirmed, false);
  assert.equal(classifyRestoreOutcome(true, parseWorldSessionRoster(roster()), TARGET).unblockConfirmed, true);
  assert.equal(classifyRestoreOutcome(true, parseWorldSessionRoster(blockedRoster()), TARGET).unblockConfirmed, false);
});

test("restore helper reports false (nothing to remove) instead of failing, and rejects non-booleans", async () => {
  assert.equal(await restoreWorldAccount({ rpc:async () => ({ data:false, error:null }) }, TARGET), false);
  assert.equal(await restoreWorldAccount({ rpc:async () => ({ data:true, error:null }) }, TARGET), true);
  await assert.rejects(restoreWorldAccount({ rpc:async () => ({ data:null, error:null }) }, TARGET),
    /RESTORE_UNCONFIRMED/);
});

test("kick: block confirmed and heartbeat session gone, with Realtime closure explicitly unproven", async () => {
  const h = await kickViaUi({ listAfterKick:blockedRoster() });
  assert.match(h.status(), /차단 확인됨/);
  assert.match(h.status(), /접속 집계 세션 종료 확인\(정리 2개\)/);
  assert.match(h.status(), /Realtime\) 연결이 닫혔는지는 확인할 수 없습니다/);
  assert.doesNotMatch(h.status(), /퇴장 처리 완료/);
});

test("kick: accepted but the block is not visible in the independent read", async () => {
  const h = await kickViaUi({ listAfterKick:roster({ accounts:[] }) });
  assert.match(h.status(), /수락됐지만 차단 목록에서 확인되지 않았습니다/);
  assert.doesNotMatch(h.status(), /차단 확인됨/);
});

test("kick: block confirmed while a heartbeat session still lingers is not reported as ended", async () => {
  const h = await kickViaUi({ listAfterKick:blockedRoster(stillOnline()) });
  assert.match(h.status(), /차단 확인됨/);
  assert.match(h.status(), /집계 세션이 아직 남아 있어 종료는 미확인/);
  assert.doesNotMatch(h.status(), /종료 확인/);
});

test("kick: accepted but the read-back fails says exactly that", async () => {
  const h = await kickViaUi({ listAfterKick:new Error("offline") });
  assert.match(h.status(), /퇴장 명령은 수락됐지만/);
  assert.match(h.status(), /결과 확인에 실패/);
  assert.doesNotMatch(h.status(), /차단 확인됨/);
});

test("kick: a lost reply is resolved by reading the real state back", async () => {
  const applied = await kickViaUi({ kick:new Error("reply lost"), listAfterKick:blockedRoster() });
  assert.match(applied.status(), /응답은 받지 못했지만 조회 결과 차단이 적용되어 있습니다/);
  const notApplied = await kickViaUi({ kick:new Error("reply lost"), listAfterKick:roster() });
  assert.match(notApplied.status(), /적용되지 않은 것으로 조회됩니다/);
});

async function restoreViaUi(options) {
  const h = scenario({ initial:blockedRoster(), ...options });
  await settle();
  const blocks = h.nodes["hub-world-session-blocks"];
  assert.equal(blocks.children[0].children[1].dataset.action, "restore");
  await blocks.listeners.click({ target:blocks.children[0].children[1] });
  return h;
}

test("restore: removed, already restored, and still blocked are three different messages", async () => {
  const removed = await restoreViaUi({ restore:true, listAfterRestore:roster() });
  assert.match(removed.status(), /차단 해제를 확인했습니다/);
  const already = await restoreViaUi({ restore:false, listAfterRestore:roster() });
  assert.match(already.status(), /이미 차단이 해제된 상태로 확인됩니다/);
  const lingering = await restoreViaUi({ restore:true, listAfterRestore:blockedRoster() });
  assert.match(lingering.status(), /수락됐지만 차단이 아직 목록에 남아 있습니다/);
  assert.doesNotMatch(lingering.status(), /해제를 확인했습니다/);
});
