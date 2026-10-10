// Offline synthetic owner/visitor fixtures. No login, private data, RPC write or production request.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
const output = process.env.TROPHY_DISPLAY_QA_OUTPUT || "test-results/trophy-display";
await mkdir(output, { recursive: true });
import { startSmoke } from "./harness.mjs";

const smoke = await startSmoke();
try {
  const page = await smoke.context.newPage();
  const fatal = smoke.watch(page);
  await page.goto(`${smoke.origin}/campus/`, { waitUntil:"domcontentloaded" });
  await Promise.race([page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus?.().loading?.finished===true, null, {timeout:90000}),fatal]);
  await page.evaluate(async () => {
    const { createTrophyDisplay } = await import("/src/rooms/trophy-display.js");
    const { createTrophyDisplayPanel } = await import("/src/rooms/trophy-display-panel.js");
    const { createFurnitureFunctionProvider } = await import("/src/rooms/furniture-functions.js");
    const { createFurnitureLayer } = await import("/src/rooms/furniture-renderer.js");
    const pc = await import("playcanvas");
    const d=window.__INHAGAME_P0__, root=new pc.Entity("trophy_test_root");d.app.root.addChild(root);root.enabled=false;
    const layer=createFurnitureLayer(d.app,root);
    const shelf={id:"11111111-1111-4111-8111-111111111111",itemId:"furniture.dorm_trophy_shelf",x:0,z:0,yaw:0,surface:"floor"};
    layer.setObjects([shelf]);
    const state={space:"ROOM_PERSONAL_BASIC",roomId:"room",accountId:"owner",ownerUserId:"owner",role:"owner",ready:true,objects:[shelf],grounded:true};
    let reads=0,refreshes=0,ui;
    const inventory={accountId:"owner",state:"READY",get snapshot(){reads++;return {items:[{itemId:"badge.main_gate",quantity:1,catalogStatus:"ACTIVE"},{itemId:"memorabilia.mcm_2026_wristband",quantity:1,catalogStatus:"COMING_SOON"}]};},async refresh(){refreshes++;return true;}};
    const display=createTrophyDisplay({inventory,getContext:()=>state,onChange:s=>{layer.setDisplays(s.displays);ui?.update(s);}});
    ui=createTrophyDisplayPanel({display});
    const provider=createFurnitureFunctionProvider({getState:()=>state,getPosition:()=>({x:0,z:1}),handlers:{display:target=>ui.open(target)}});
    window.trophyFixture={state,display,ui,provider,layer,inventory,counts:()=>({reads,refreshes}),children:()=>{
      const walk=e=>[e.name,...e.children.flatMap(walk)];return walk(layer.root);
    }};
  });
  assert.equal(await page.evaluate(()=>window.trophyFixture.children().includes("trophy_cup")),false);
  assert.equal(await page.evaluate(()=>window.trophyFixture.provider.contextAction().trigger()),true);
  const panel=page.locator("#trophy-display-panel").last();
  await panel.getByRole("button",{name:"정문 첫걸음 배지 · 보유 1"}).click();
  assert.equal(await page.evaluate(()=>window.trophyFixture.children().includes("owned_badge")),true);
  await panel.getByRole("button",{name:"일일호프 기념 팔찌 · 보유 1"}).click();
  assert.equal(await page.evaluate(()=>window.trophyFixture.children().includes("owned_wristband_side")),true);
  assert.equal(await page.evaluate(()=>window.trophyFixture.children().includes("owned_badge")),false);
  await page.keyboard.press("Escape");
  assert.equal(await panel.isVisible(),false);
  await page.setViewportSize({width:360,height:740});
  await page.evaluate(()=>window.trophyFixture.provider.contextAction().trigger());
  await panel.getByRole("button",{name:"선반 비우기"}).click();
  const box=await panel.boundingBox();assert.ok(box.x>=0 && box.x+box.width<=360 && box.y+box.height<=740);
  assert.equal(await page.evaluate(()=>window.trophyFixture.children().includes("owned_item_nameplate")),false);
  await page.screenshot({path:path.join(output,"mobile.png")});
  await panel.getByRole("button",{name:"닫기",exact:true}).click();
  const before=await page.evaluate(()=>window.trophyFixture.counts());
  await page.evaluate(()=>{const f=window.trophyFixture;f.state.role="visitor";f.state.ownerUserId="someone-else";f.display.update();f.provider.contextAction().trigger();});
  await panel.getByText("방문 권한으로 가구는 볼 수 있지만 주인의 보유 기념품은 조회하지 않아요. 공개 전시는 아직 지원하지 않아요.").waitFor();
  assert.deepEqual(await page.evaluate(()=>window.trophyFixture.counts()),before);
  await page.evaluate(()=>{const f=window.trophyFixture;f.state.space="campus";f.display.update();});
  assert.equal(await panel.isVisible(),false);
  const errors=smoke.problems.filter(problem=>problem.startsWith("pageerror:"));assert.deepEqual(errors,[]);
  console.log("PASS: actual World boot, empty shelf, owned badge/wristband mesh replacement, 360px UI, close/reopen, visitor no-read and exit cleanup");
} finally { await smoke.close(); }
