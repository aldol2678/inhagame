import test from "node:test";
import assert from "node:assert/strict";
import { createFakeDocument } from "./support/fake-dom.mjs";
import { createShopClient } from "../src/shop/shop-client.js";
import { createShopPanel } from "../src/shop/shop-panel.js";
import { furnitureShopTabs, filterFurnitureShopOffers, furnitureShopCategory } from "../src/shop/furniture-shop-categories.js";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const offer = (itemId, listingId, price, requiredLevel = 1, purchasable = true, unavailableReason = null) => ({
  itemId, listingId, price, requiredLevel, purchasable, unavailableReason,
  currencyId: "currency.induck_coin", quantity: 1, purchaseLimit: null,
  startAt: null, endAt: null, status: "ACTIVE"
});
const CUSHION = offer("furniture.induck_cushion", "dorm.cushion", 220);
const LAMP = offer("furniture.dorm_desk_lamp", "dorm.lamp", 280, 2);
const POSTER = offer("furniture.campus_map_poster", "dorm.poster", 360, 4, false, "LEVEL_REQUIRED");
const rows = [CUSHION, LAMP, POSTER];
const walk = (n, out = []) => { out.push(n); for (const child of n.children ?? []) walk(child, out); return out; };
const named = (root, className) => walk(root).filter(n => (n.className ?? "").split(" ").includes(className));
const text = root => walk(root).map(n => n.textContent).join(" ");
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

async function fixture(offers = rows) {
  const doc = createFakeDocument();
  const panel = doc.createElement("section");
  const calls = [];
  const client = {
    rpc(name, args) {
      calls.push({name,args});
      if (name === "get_world_shop_v1") return Promise.resolve({data:{
        shopId: "shop.dorm_furniture", displayName: "생활관 가구점", status:"ACTIVE", playerLevel: 3,
        offers
      }, error:null});
      throw Error("Unexpected RPC " + name);
    }
  };
  const shop = createShopClient({getClient:()=>client,shopId:"shop.dorm_furniture",createKey:()=> "showroom:test"});
  shop.select = id => id === "shop.dorm_furniture";
  const ui = createShopPanel({shop,panel,doc});
  shop.setAccount(ACCOUNT);
  ui.openShop("shop.dorm_furniture");
  await flush(); await flush();
  return {doc,panel,calls,shop,ui};
}

test("categories are derived only from actual server offers, not invented stock", () => {
  assert.equal(furnitureShopCategory(CUSHION.itemId), "bedding");
  assert.equal(furnitureShopCategory(LAMP.itemId), "light");
  assert.deepEqual(furnitureShopTabs(rows).map(tab => tab.id), ["all","bedding","light","wall"]);
  assert.deepEqual(filterFurnitureShopOffers(rows,"light"),[LAMP]);
  assert.deepEqual(filterFurnitureShopOffers(rows,"all"),rows);
});

test("dorm showroom creates real offer cards, removes size paragraphs and filters without RPC", async () => {
  const h = await fixture();
  assert.equal(h.panel.dataset.presentation, "furniture-showroom");
  assert.equal(named(h.panel,"shop-showroom-card").length, 3);
  assert.equal(named(h.panel,"shop-showroom-view").length, 3);
  assert.equal(named(h.panel,"shop-offer-buy").length, 3);
  assert.doesNotMatch(text(h.panel), /크기/);
  assert.equal(h.calls.filter(c=>c.name==="get_world_shop_v1").length,1);
  const lightTab = named(h.panel,"shop-showroom-tab").find(tab => tab.dataset.category === "light");
  lightTab.click();
  assert.equal(named(h.panel,"shop-showroom-card").length, 1);
  assert.match(text(h.panel), /생활관 스탠드/);
  assert.doesNotMatch(text(h.panel), /인덕 쿠션/);
  assert.equal(h.calls.filter(c=>c.name==="get_world_shop_v1").length,1);
});

test("details show actual listing metadata and location; browsing/rotation never purchases", async () => {
  const h = await fixture();
  const card = named(h.panel,"shop-showroom-card")[0];
  const view = named(card,"shop-showroom-view")[0];
  view.click();
  assert.equal(named(h.panel,"shop-showroom-detail").length,1);
  assert.match(text(h.panel), /인덕 쿠션/);
  assert.match(text(h.panel), /놓을 곳: 바닥 · 침대 위/);
  assert.doesNotMatch(text(h.panel), /크기/);
  named(h.panel,"shop-showroom-rotate")[0].click();
  assert.equal(h.calls.length,1, "preview is read-only");
  named(h.panel,"shop-showroom-back")[0].click();
  assert.equal(named(h.panel,"shop-showroom-card").length,3);
});

test("server locks remain authoritative in showroom detail and card", async () => {
  const h = await fixture();
  const poster = named(h.panel,"shop-showroom-card").find(n=>n.dataset.listingId === POSTER.listingId);
  assert.equal(named(poster,"shop-offer-buy")[0].disabled,true);
  named(poster,"shop-showroom-view")[0].click();
  assert.match(text(h.panel), /Lv[.]4 필요/);
  assert.equal(named(h.panel,"shop-offer-buy")[0].disabled,true);
});

test("account switch removes the old showroom list and detail", async () => {
  const h = await fixture();
  named(h.panel,"shop-showroom-view")[0].click();
  h.shop.setAccount("22222222-2222-4222-8222-222222222222");
  assert.equal(named(h.panel,"shop-showroom-detail").length,0);
  assert.equal(named(h.panel,"shop-showroom-card").length,0);
  assert.match(text(h.panel), /상점을 불러오는 중/);
});
