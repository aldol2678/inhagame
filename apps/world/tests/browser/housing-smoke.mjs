// Housing (Social S1-D) browser smoke: the real /campus/ boot walks the first-dormitory loop.
//
// Campus → 제1생활관 entrance → Dorm Lobby → '내 방' door (guest boundary) → Personal Room scene →
// Dorm Lobby return anchor → Campus return anchor, repeated, on desktop and a 360 px phone.
// Offline (harness.mjs): supabase-js is stubbed, so the guest boundary is exercised for real and the
// signed-in owner path enters the same nested transition main.js uses after the room authority
// resolves. No production, login or secret.
//
//   npm ci --prefix apps/world/tests/browser
//   WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/housing-smoke.mjs
import assert from "node:assert/strict";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

const CYCLES = 3;
// Slow GPU-less CI runners render a frame every few hundred ms, so each step gets generous time.
const STEP_TIMEOUT_MS = 45_000;
const started = Date.now();

async function boot(smoke, viewport) {
  const page = await smoke.context.newPage();
  await page.setViewportSize(viewport);
  const fatalError = smoke.watch(page);
  // Optional: HOUSING_SMOKE_CPU_THROTTLE=<rate> emulates a slow CI runner (few frames per second).
  const throttle = Number(process.env.HOUSING_SMOKE_CPU_THROTTLE || 0);
  if (throttle > 1) await (await smoke.context.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await page.goto(`${smoke.origin}/campus/`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await Promise.race([
    page.waitForFunction(() => window.__INHAGAME_P0__?.getStatus?.().loading?.finished === true
      || window.__INHAGAME_P0__?.getStatus?.().renderer === "UNAVAILABLE", null, { timeout: TIMEOUT_MS, polling: 100 }),
    fatalError
  ]);
  const renderer = await page.evaluate(() => window.__INHAGAME_P0__.getStatus().renderer);
  assert.notEqual(renderer, "UNAVAILABLE", "campus boot");
  return { page, fatalError };
}

// Teleport onto an anchor (canonical frame; the player entity lives under the space root).
async function standAt(page, point) {
  await page.evaluate(({ x, z, y }) => {
    const d = window.__INHAGAME_P0__;
    d.controller.velocityY = 0;
    d.player.setLocalPosition(x, y ?? d.player.getLocalPosition().y, z);
  }, point);
  await page.waitForTimeout(250);
}

async function waitFor(page, fatalError, fn, arg, label) {
  await Promise.race([
    page.waitForFunction(fn, arg, { timeout: STEP_TIMEOUT_MS, polling: 50 }).catch(error => {
      throw new Error(`${label}: ${error.message}`);
    }),
    fatalError
  ]);
}

const status = page => page.evaluate(() => {
  const s = window.__INHAGAME_P0__.getStatus();
  return {
    space: s.space, contextAction: s.contextAction, placeZone: s.placeZone,
    zoneLabel: document.getElementById("zone")?.textContent ?? null,
    bodySpace: document.body.dataset.space ?? null,
    audioZone: s.audio?.zone ?? null,
    minimap: s.minimap ? { state: s.minimap.state ?? null, sourceId: s.minimap.sourceId ?? s.minimap.source ?? null } : null,
    roomStats: window.__INHAGAME_P0__.rooms.stats,
    roomStatus: window.__INHAGAME_P0__.rooms.status(),
    rootChildren: window.__INHAGAME_P0__.app.root.children.length,
    inputEnabled: window.__INHAGAME_P0__.controller.inputEnabled
  };
});

async function pressF(page) { await page.keyboard.press("KeyF"); }

// Presses F on one specific door. Every room door shares the id "room-door", and on a slow runner
// the Context Action slot can still hold the previous space's door for a frame after a transition,
// so the slot must show this door's own label before F is pressed. The press is retried (the door
// has an 800 ms cooldown and busy guard, so a repeat can never double-transition) until the space
// actually changes.
async function useDoor(page, fatalError, { id, label, space, name }) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await waitFor(page, fatalError, ([wantId, wantLabel]) => {
      const active = window.__INHAGAME_P0__.contextActions.active;
      return active?.id === wantId && new RegExp(wantLabel).test(active.label ?? "");
    }, [id, label.source], `${name} action`);
    await pressF(page);
    const changed = await page.waitForFunction(want => window.__INHAGAME_P0__.getStatus().space === want, space,
      { timeout: 10_000, polling: 50 }).then(() => true, () => false);
    if (changed) {
      if (attempt > 1) console.log(`${name}: door took ${attempt} presses`);
      return attempt;
    }
  }
  const snapshot = await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    const status = d.getStatus();
    return { space: status.space, active: d.contextActions.active?.label ?? null, rooms: d.rooms.status(),
      focus: { worldAction: status.inputFocus?.worldAction, topOwners: status.inputFocus?.topOwners ?? null },
      frame: d.app.frame };
  });
  throw new Error(`${name}: space never became ${space} ${JSON.stringify(snapshot)}`);
}

// Presentation stress for the S1-D2 Room HUD (the live state needs a signed-in Room Session):
// owner and visitor strips must stay clear of the top bar, the Mini-map rail and the action button.
async function checkRoomHud(page, label) {
  const out = {};
  for (const [role, state] of [
    ["owner", { active: true, phase: "READY", role: "owner", count: 3, ownerPresent: true, visibility: "friends" }],
    ["visitor", { active: true, phase: "READY", role: "visitor", count: 2, ownerPresent: false, visibility: "friends",
      ownerDisplayName: "아주긴닉네임의친구계정" }]
  ]) {
    const boxes = await page.evaluate((next) => {
      window.__INHAGAME_P0__.roomHud.update(next);
      const rect = (el) => {
        if (!el || el.hidden || getComputedStyle(el).display === "none" || getComputedStyle(el).visibility === "hidden") return null;
        const r = el.getBoundingClientRect();
        return r.width && r.height ? { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height } : null;
      };
      return {
        viewport: { width: innerWidth, height: innerHeight },
        hud: rect(document.getElementById("room-hud")),
        topbar: rect(document.querySelector(".campus-topbar .location-chip")),
        menu: rect(document.getElementById("hud-menu-toggle")),
        minimap: rect(document.getElementById("minimap")),
        context: rect(document.getElementById("context-action")),
        buttons: [...document.querySelectorAll("#room-hud button")].map((b) => ({ text: b.textContent, ...b.getBoundingClientRect().toJSON() }))
      };
    }, state);
    const overlap = (a, b) => a && b && a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
    assert.ok(boxes.hud, `${label} ${role}: room HUD visible`);
    assert.ok(boxes.hud.x >= 0 && boxes.hud.right <= boxes.viewport.width, `${label} ${role}: HUD inside the viewport`);
    for (const other of ["topbar", "menu", "minimap", "context"])
      assert.ok(!overlap(boxes.hud, boxes[other]), `${label} ${role}: HUD overlaps ${other} ${JSON.stringify(boxes)}`);
    for (const b of boxes.buttons) assert.ok(b.height >= 36, `${label} ${role}: ${b.text} tap target ${b.height}px`);
    assert.deepEqual(boxes.buttons.map((b) => b.text), role === "owner" ? ["👥 친구 공개", "꾸미기", "나가기"] : ["나가기"]);
    out[role] = { hud: boxes.hud, buttons: boxes.buttons.length };
    if (role === "owner") {
      // Housing H3: the owner's knock prompt is the owner Room HUD footer; the HUD stays clear of the rails.
      const prompt = await page.evaluate((ownerState) => {
        const d = window.__INHAGAME_P0__;
        d.knockPrompt.push({ knockId: "22222222-2222-4222-8222-222222222222", roomId: "11111111-1111-4111-8111-111111111111",
          visitorUserId: "b2000000-0000-4000-8000-0000000000b2", status: "PENDING",
          expiresAt: new Date(Date.now() + 30_000).toISOString(), visitorDisplayName: "아주긴닉네임의친구계정" });
        d.roomHud.update({ ...ownerState, count: 2 });
        const r = (el) => { const b = el?.getBoundingClientRect(); return b && b.width ? b.toJSON() : null; };
        const box = r(document.getElementById("room-hud"));
        const knock = r(document.querySelector("#room-hud .room-knock-prompt"));
        const buttons = [...document.querySelectorAll("#room-hud .room-knock-prompt button")].map((b) => ({ text: b.textContent, ...b.getBoundingClientRect().toJSON() }));
        return { box, knock, buttons };
      }, state);
      if (process.env.HOUSING_SMOKE_SHOTS) await page.screenshot({ path: `${process.env.HOUSING_SMOKE_SHOTS}/room-knock-${label}.png` });
      prompt.hiddenAfter = await page.evaluate(() => {
        window.__INHAGAME_P0__.knockPrompt.clear();
        return document.querySelector("#room-hud .room-knock-prompt").hidden;
      });
      assert.ok(prompt.knock, `${label}: knock prompt visible in the Room HUD`);
      assert.ok(prompt.box.x >= 0 && prompt.box.right <= boxes.viewport.width && prompt.box.bottom <= boxes.viewport.height,
        `${label}: Room HUD with a knock stays inside the viewport`);
      for (const other of ["topbar", "menu", "minimap", "context"])
        assert.ok(!overlap(prompt.box, boxes[other]), `${label}: Room HUD with a knock overlaps ${other} ${JSON.stringify({ prompt, boxes })}`);
      assert.deepEqual(prompt.buttons.map((b) => b.text), ["들어오게 하기", "나중에"]);
      for (const b of prompt.buttons) assert.ok(b.height >= 40, `${label}: knock ${b.text} tap target ${b.height}px`);
      assert.equal(prompt.hiddenAfter, true, `${label}: knock prompt clears`);
      out.knockPrompt = prompt.box;
    }
    // Optional evidence: HOUSING_SMOKE_SHOTS=<dir> saves one screenshot per viewport and role.
    if (process.env.HOUSING_SMOKE_SHOTS) {
      out[role].overlay = await page.evaluate(() => ({
        fade: !document.getElementById("space-fade").hidden,
        fadeOn: document.getElementById("space-fade").classList.contains("on"),
        hudHidden: document.getElementById("room-hud").hidden,
        bodySpace: document.body.dataset.space ?? null,
        top: document.elementFromPoint(20, 90)?.id || document.elementFromPoint(20, 90)?.className || null
      }));
      await page.screenshot({ path: `${process.env.HOUSING_SMOKE_SHOTS}/room-hud-${label}-${role}.png` });
    }
  }
  return out;
}

// Native editor + real PlayCanvas primitives, with an isolated in-memory authority. This is an
// offline module integration contract, not signed-in two-account / production Supabase QA.
async function checkFurniture(page, label) {
  await page.evaluate(async () => {
    const { createFurnitureClient } = await import("/src/rooms/furniture-client.js");
    const { createFurnitureEditor } = await import("/src/rooms/furniture-editor.js");
    const { createFurnitureLayer } = await import("/src/rooms/furniture-renderer.js");
    const { ROOM_FURNITURE } = await import("/src/rooms/furniture-layout.js");
    const d = window.__INHAGAME_P0__, room = d.app.root.findByName("Room_ROOM_PERSONAL_BASIC");
    const baselineChildren = room.children.length, enabled = d.controller.inputEnabled;
    const originalEditor = document.getElementById("furniture-editor"); originalEditor.id = "furniture-editor-inactive-smoke";
    const layer = createFurnitureLayer(d.app,room);
    const roomId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let stored = { roomId,role:"owner",revision:0,objects:[] }, lostResponse = true, ui;
    const calls = [];
    const inventory = { state:"READY",snapshot:{items:ROOM_FURNITURE.map(item=>({ itemId:item.itemId,quantity:1 }))},
      refresh:async()=>true,onChange:()=>()=>{} };
    const client = createFurnitureClient({ getUserId:()=>userId,getClient:()=>({ rpc:async(name,args)=>{
      calls.push({ name,args:structuredClone(args) });
      if (name === "save_my_room_furniture_v1") {
        if (JSON.stringify(stored.objects) !== JSON.stringify(args.p_objects)) stored = { ...stored,revision:stored.revision+1,objects:structuredClone(args.p_objects) };
        if (lostResponse) { lostResponse=false; return {data:null,error:{message:"response lost"}}; }
      }
      return {data:structuredClone(stored),error:null};
    }}),onChange:state=>{ layer.setObjects(state.objects); ui?.update(state); } });
    ui = createFurnitureEditor({ client,inventory,onOpenChange:open=>{ d.controller.inputEnabled = !open; } });
    await client.bind(roomId); ui.openEditor();
    window.__FURNITURE_SMOKE__ = {client,ui,layer,calls,inventory,roomId,room,baselineChildren,enabled,originalEditor,
      items:ROOM_FURNITURE.map(item=>item.itemId),visitor:()=>{stored.role="visitor";} };
  });
  const editor = page.locator("#furniture-editor");
  assert.equal(await editor.isVisible(),true,`${label}: editor opens`);
  const bounds = await editor.boundingBox(); const viewport = page.viewportSize();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x+bounds.width <= viewport.width && bounds.y+bounds.height <= viewport.height,`${label}: editor fits viewport`);
  for (const itemId of await page.evaluate(()=>window.__FURNITURE_SMOKE__.items))
    await editor.locator(`button[data-focus="${itemId}"]`).click();
  const chairId = await page.evaluate(()=>window.__FURNITURE_SMOKE__.client.state().objects.find(row=>row.itemId==="furniture.induck_chair").id);
  await editor.locator('select[data-focus="selection"]').selectOption(chairId);
  const plan = editor.locator("svg.furniture-plan"), planBounds = await plan.boundingBox();
  await plan.click({position:{x:planBounds.width*3.4/10.8,y:planBounds.height*5.2/8.4}});
  await editor.getByRole("button",{name:"가구 이동 ↑",exact:true}).click();
  await editor.locator('button[data-focus="rotation"]').click();
  assert.equal(await page.evaluate(()=>window.__FURNITURE_SMOKE__.layer.root.children.length),9,`${label}: all nine real 3D models render`);
  assert.equal(await editor.getByRole("button",{name:"저장",exact:true}).isEnabled(),true);
  await editor.getByRole("button",{name:"저장",exact:true}).click();
  await page.waitForFunction(()=>window.__FURNITURE_SMOKE__.client.state().error==="UNAVAILABLE");
  assert.equal(await page.evaluate(()=>window.__FURNITURE_SMOKE__.client.state().dirty),true,`${label}: lost save response keeps draft`);
  await editor.getByRole("button",{name:"저장",exact:true}).click();
  await page.waitForFunction(()=>!window.__FURNITURE_SMOKE__.client.state().pending&&!window.__FURNITURE_SMOKE__.client.state().dirty);
  const saves = await page.evaluate(()=>window.__FURNITURE_SMOKE__.calls.filter(row=>row.name.startsWith("save")));
  assert.equal(saves.length,2);assert.deepEqual(saves[0],saves[1],`${label}: identical snapshot retry`);
  await editor.getByRole("button",{name:"완료",exact:true}).click();
  await page.evaluate(async()=>{const f=window.__FURNITURE_SMOKE__;f.client.reset();await f.client.bind(f.roomId);f.ui.openEditor();});
  assert.equal(await page.evaluate(()=>window.__FURNITURE_SMOKE__.client.state().objects.length),9,`${label}: reload restores saved layout`);
  await editor.locator('select[data-focus="selection"]').selectOption(chairId);
  await editor.getByRole("button",{name:"회수",exact:true}).click();
  await editor.getByRole("button",{name:"닫기",exact:true}).click();
  await editor.getByRole("button",{name:"변경 버리고 닫기",exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__FURNITURE_SMOKE__.layer.root.children.length),9,`${label}: discard restores 3D layout`);
  await page.evaluate(()=>window.__FURNITURE_SMOKE__.ui.openEditor());
  await editor.locator('select[data-focus="selection"]').selectOption(chairId);
  await editor.getByRole("button",{name:"회수",exact:true}).click();
  await editor.getByRole("button",{name:"저장",exact:true}).click();
  await page.waitForFunction(()=>!window.__FURNITURE_SMOKE__.client.state().pending&&!window.__FURNITURE_SMOKE__.client.state().dirty);
  await editor.getByRole("button",{name:"완료",exact:true}).click();
  const result = await page.evaluate(async()=>{
    const f=window.__FURNITURE_SMOKE__;f.client.reset();await f.client.bind(f.roomId);
    const restored=f.client.state().objects.length,quantityUnchanged=f.inventory.snapshot.items.every(row=>row.quantity===1);
    f.client.reset();f.visitor();await f.client.bind(f.roomId);
    const visitorDenied=f.ui.openEditor()===false&&await f.client.save(f.inventory.snapshot.items)===false;
    f.client.reset();f.ui.dispose();f.layer.root.destroy();f.originalEditor.id="furniture-editor";window.__INHAGAME_P0__.controller.inputEnabled=f.enabled;
    const noLeak=f.room.children.length===f.baselineChildren;delete window.__FURNITURE_SMOKE__;
    return {restored,quantityUnchanged,visitorDenied,noLeak};
  });
  assert.deepEqual(result,{restored:8,quantityUnchanged:true,visitorDenied:true,noLeak:true},`${label}: recall save, visitor guard, ownership and cleanup`);
  console.log(`furniture module smoke ${label}: nine models, lost-response retry, reload, recall and visitor guard PASS (in-memory authority)`);
}

async function runLoop(smoke, { page, fatalError }, viewport, label) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(300);
  const anchors = await page.evaluate(async () => {
    const dorm = await import("/src/dorm1-layout.js");
    const lobby = await import("/src/rooms/dorm1-lobby-layout.js");
    const personal = await import("/src/rooms/personal-room-layout.js");
    return {
      entrance: dorm.DORM_1_ENTRANCE.position,
      campusReturn: dorm.DORM_1_CAMPUS_RETURN.position,
      lobbyExit: lobby.DORM_1_LOBBY_EXIT.position,
      myRoom: lobby.DORM_1_LOBBY_MY_ROOM.position,
      myRoomReturn: lobby.DORM_1_LOBBY_MY_ROOM_RETURN,
      personalExit: personal.PERSONAL_ROOM_BASIC_EXIT.position
    };
  });
  const baseline = await status(page);
  const report = [];
  let hud = null;

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    // 1. Campus → 제1생활관 entrance.
    await standAt(page, { ...anchors.entrance, y: 1.6 });
    // 2. Entrance → Dorm Lobby.
    await useDoor(page, fatalError, { id: "room-door", label: /제1생활관 들어가기/, space: "ROOM_DORM1_LOBBY",
      name: `${label}#${cycle} entrance` });
    const lobby = await status(page);
    assert.equal(lobby.bodySpace, "ROOM_DORM1_LOBBY");
    assert.match(lobby.zoneLabel, /제1생활관 로비/);
    assert.equal(lobby.placeZone === null || typeof lobby.placeZone === "string", true);

    // 3. Lobby '내 방' door: guest stays in the lobby with a login hint (no authority offline).
    await page.waitForTimeout(900);
    await standAt(page, { ...anchors.myRoom, y: 1.15 });
    await waitFor(page, fatalError, () => {
      const active = window.__INHAGAME_P0__.contextActions.active;
      return active?.id === "personal-room-door" && /내 방 들어가기/.test(active.label ?? "");
    }, null, `${label}#${cycle} my-room door action`);
    await pressF(page);
    await waitFor(page, fatalError, () => !document.getElementById("follow-status")?.hidden
      && /로그인/.test(document.getElementById("follow-status")?.textContent ?? ""), null, `${label}#${cycle} guest hint`);
    assert.equal((await status(page)).space, "ROOM_DORM1_LOBBY", "guest never enters a personal room");

    // 4. Owner path (authority resolved): the same nested transition main.js performs.
    const entered = await page.evaluate(ret => window.__INHAGAME_P0__.rooms.enterNested("ROOM_PERSONAL_BASIC", {
      fromRoomId: "ROOM_DORM1_LOBBY", returnPosition: ret.position, returnYaw: ret.yaw,
      metadata: { personalRoomId: "00000000-0000-4000-8000-000000000000" }
    }), anchors.myRoomReturn);
    assert.equal(entered, true, "nested personal room transition accepted");
    await waitFor(page, fatalError, () => window.__INHAGAME_P0__.getStatus().space === "ROOM_PERSONAL_BASIC", null,
      `${label}#${cycle} personal room entered`);
    const room = await status(page);
    assert.equal(room.roomStatus.parentRoomId, "ROOM_DORM1_LOBBY");
    assert.match(room.zoneLabel, /내 방/);
    assert.equal(room.audioZone, "PERSONAL_ROOM", "audio binds the personal room zone");
    if (cycle === 0) { hud = await checkRoomHud(page, label); await checkFurniture(page,label); }

    // 5. Personal Room → Dorm Lobby return anchor (never campus).
    await page.waitForTimeout(900);
    await standAt(page, { ...anchors.personalExit, y: 1.15 });
    await useDoor(page, fatalError, { id: "room-door", label: /생활관 로비로 나가기/, space: "ROOM_DORM1_LOBBY",
      name: `${label}#${cycle} personal exit` });
    const back = await page.evaluate(() => window.__INHAGAME_P0__.player.getLocalPosition().toJSON?.()
      ?? (p => [p.x, p.y, p.z])(window.__INHAGAME_P0__.player.getLocalPosition()));
    assert.ok(Math.hypot(back[0] - anchors.myRoomReturn.position.x, back[2] - anchors.myRoomReturn.position.z) < 0.6,
      `returned at lobby my-room anchor: ${back}`);

    // 6. Dorm Lobby → Campus return anchor.
    await page.waitForTimeout(900);
    await standAt(page, { ...anchors.lobbyExit, y: 1.15 });
    await useDoor(page, fatalError, { id: "room-door", label: /캠퍼스로 나가기/, space: "campus",
      name: `${label}#${cycle} lobby exit` });
    const campus = await status(page);
    assert.equal(campus.bodySpace, null);
    assert.equal(await page.evaluate(() => document.getElementById("room-hud").hidden), true, "room HUD hidden outside rooms");
    assert.equal(campus.placeZone, "AREA_DORM_SOUTH", "campus return resolves the dorm place zone");
    await page.waitForTimeout(900);
    report.push({ cycle, lobbyAudio: lobby.audioZone, roomAudio: room.audioZone, campusAudio: campus.audioZone,
      roomMinimap: room.minimap, rootChildren: campus.rootChildren });
  }

  const end = await status(page);
  assert.equal(end.roomStats.enters - baseline.roomStats.enters, CYCLES);
  assert.equal(end.roomStats.nestedEnters - baseline.roomStats.nestedEnters, CYCLES);
  assert.equal(end.roomStats.nestedExits - baseline.roomStats.nestedExits, CYCLES);
  assert.equal(end.roomStats.exits - baseline.roomStats.exits, CYCLES);
  assert.equal(end.rootChildren, report[0].rootChildren, "no scene entities accumulate across cycles");
  assert.equal(end.inputEnabled, true);
  assert.deepEqual(smoke.problems, [], `page problems: ${smoke.problems.join("\n")}`);
  return { hud, cycles: report.map(({ cycle, roomAudio, rootChildren }) => ({ cycle, roomAudio, rootChildren })) };
}

const smoke = await startSmoke();
try {
  // One boot for both viewports: the GPU-less CI lane pays ~7 min for the first campus boot.
  const booted = await boot(smoke, { width: 1280, height: 720 });
  const desktop = await runLoop(smoke, booted, { width: 1280, height: 720 }, "desktop");
  const phone = await runLoop(smoke, booted, { width: 360, height: 740 }, "phone360");
  const landscape = await runLoop(smoke, booted, { width: 844, height: 390 }, "phone-landscape");
  await booted.page.close();
  console.log(JSON.stringify({ desktop, phone, landscape }, null, 2));
  console.log(`world housing smoke: PASS in ${((Date.now() - started) / 1000).toFixed(1)}s (${CYCLES} cycles × 3 viewports)`);
} finally {
  await smoke.close();
}
