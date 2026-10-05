import test from "node:test";
import assert from "node:assert/strict";
import {renderStaffName, staffBadgeForUser} from "../src/staff-badges.js";
test("public package never infers staff authority from a configured account ID",()=>{
 for(const value of [null,undefined,"sample-player","00000000-0000-4000-8000-000000000001"]) assert.equal(staffBadgeForUser(value),null);
 const el={textContent:"",appendChild(){throw Error("unexpected badge");}};
 assert.equal(renderStaffName(el,"Sample player","00000000-0000-4000-8000-000000000001",{createElement(){throw Error("unexpected badge");}}),null);
 assert.equal(el.textContent,"Sample player");
});

const GM = "aa300000-0000-4000-8000-000000000003";
const PLAYER = "aa200000-0000-4000-8000-000000000002";
const tick = () => new Promise((resolve) => setImmediate(resolve));
const doc = { createElement() { return { dataset: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }; } };
function element() {
  return { children: [], name: "", set textContent(value) { this.name = value; this.children = []; },
    get textContent() { return this.name; }, appendChild(chip) { this.children.push(chip); } };
}

// Each test starts a fresh authenticated/guest session and ends it to discard its cache.
import { setStaffBadgeClient } from "../src/staff-badges.js";
test.afterEach(() => setStaffBadgeClient(null));

test("server confirmation restores own profile and remote nameplates with one lookup", async () => {
  const calls = [];
  setStaffBadgeClient({ async rpc(name, args) {
    calls.push({ name, args });
    return { data: [{ user_id: GM, badge_code: "gm" }] };
  } });
  const profile = element(), plate = element();
  renderStaffName(profile, "테스트 운영자", GM, doc);
  renderStaffName(plate, "테스트 운영자", GM, doc);
  await tick();
  assert.deepEqual(calls, [{ name: "get_world_staff_badges_v1", args: { p_user_ids: [GM] } }]);
  for (const node of [profile, plate]) {
    assert.equal(node.textContent, "테스트 운영자");
    assert.equal(node.children[0].textContent, "GM");
    assert.equal(node.children[0].className, "staff-badge");
    assert.equal(node.children[0].attrs["aria-label"], "게임 운영자");
  }
  renderStaffName(profile, "바뀐 이름", GM, doc);
  assert.equal(profile.children.length, 1);
  assert.equal(calls.length, 1);
});

test("a GM nickname and unrequested or unsupported server rows never create badges", async () => {
  setStaffBadgeClient({ async rpc() {
    return { data: [{ user_id: GM, badge_code: "gm" }, { user_id: PLAYER, badge_code: "admin" }, null] };
  } });
  const node = element();
  renderStaffName(node, "GM 운영자", PLAYER, doc);
  await tick();
  assert.equal(node.children.length, 0);
  assert.equal(staffBadgeForUser(GM), null);
  assert.equal(staffBadgeForUser(PLAYER), null);
});

test("late confirmation cannot overwrite a reused nameplate", async () => {
  let finish;
  setStaffBadgeClient({ rpc() { return new Promise((resolve) => { finish = resolve; }); } });
  const node = element();
  renderStaffName(node, "운영자", GM, doc);
  await tick();
  renderStaffName(node, "다른 플레이어", PLAYER, doc);
  finish({ data: [{ user_id: GM, badge_code: "gm" }] });
  await tick();
  assert.equal(node.textContent, "다른 플레이어");
  assert.equal(node.children.length, 0);
});

test("logout discards both cached and pending badges", async () => {
  let finish;
  setStaffBadgeClient({ rpc() { return new Promise((resolve) => { finish = resolve; }); } });
  const node = element();
  renderStaffName(node, "운영자", GM, doc);
  await tick();
  setStaffBadgeClient(null);
  renderStaffName(node, "인덕이", null, doc);
  finish({ data: [{ user_id: GM, badge_code: "gm" }] });
  await tick();
  assert.equal(node.textContent, "인덕이");
  assert.equal(node.children.length, 0);
  assert.equal(staffBadgeForUser(GM), null);
});

test("the new session owns results even when the old response arrives last", async () => {
  let finish;
  setStaffBadgeClient({ rpc() { return new Promise((resolve) => { finish = resolve; }); } });
  const node = element();
  renderStaffName(node, "운영자", GM, doc);
  await tick();
  setStaffBadgeClient({ async rpc() { return { data: [] }; } });
  renderStaffName(node, "일반 계정", GM, doc);
  await tick();
  finish({ data: [{ user_id: GM, badge_code: "gm" }] });
  await tick();
  assert.equal(node.children.length, 0);
  assert.equal(staffBadgeForUser(GM), null);
});

test("batching stays within 64 IDs and deduplicates requests", async () => {
  const batches = [];
  setStaffBadgeClient({ async rpc(_name, args) { batches.push(args.p_user_ids); return { data: [] }; } });
  for (let i = 0; i < 70; i++) {
    const id = `aa100000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    renderStaffName(element(), "플레이어", id, doc);
    renderStaffName(element(), "플레이어", id, doc);
  }
  await tick();
  assert.deepEqual(batches.map((batch) => batch.length), [64, 6]);
  assert.equal(new Set(batches.flat()).size, 70);
});

test("lookup failures preserve names and do not repeat on every render", async () => {
  for (const failure of [() => { throw new Error("offline"); }, () => ({ error: { message: "denied" } }), () => ({ data: {} })]) {
    let calls = 0;
    setStaffBadgeClient({ rpc() { calls++; return failure(); } });
    const node = element();
    renderStaffName(node, "운영자", GM, doc);
    await tick();
    renderStaffName(node, "운영자", GM, doc);
    await tick();
    assert.equal(node.textContent, "운영자");
    assert.equal(node.children.length, 0);
    assert.equal(calls, 1);
  }
});
