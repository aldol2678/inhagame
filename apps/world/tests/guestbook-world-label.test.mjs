import test from "node:test";
import assert from "node:assert/strict";
import {
  GUESTBOOK_MARKER_MAX_DISTANCE,
  createGuestbookWorldLabel,
  guestbookMarkerCopy
} from "../src/guestbook/guestbook-world-label.js";

function fakeElement() {
  const nodes = {
    icon: { textContent: "" },
    title: { textContent: "" },
    hint: { textContent: "" }
  };
  const classes = new Set();
  return {
    hidden: true,
    dataset: {},
    style: {
      left: "", top: "", values: {},
      setProperty(k,v){ this.values[k]=v; }
    },
    classList: {
      add(c){classes.add(c);}, remove(c){classes.delete(c);},
      toggle(c,on){ if(on)classes.add(c); else classes.delete(c); },
      contains(c){return classes.has(c);}
    },
    querySelector(sel) {
      if (sel.includes("icon")) return nodes.icon;
      if (sel.includes("title")) return nodes.title;
      if (sel.includes("hint")) return nodes.hint;
      return null;
    },
    nodes
  };
}

test("marker copy emphasizes nearby signed-in interaction", () => {
  assert.deepEqual(guestbookMarkerCopy({ nearby:false, available:true }),
    { icon:"📖", title:"방명록", hint:"한마디 남겨보세요" });
  assert.deepEqual(guestbookMarkerCopy({ nearby:true, available:true }),
    { icon:"📖", title:"방명록", hint:"F · 열기" });
  assert.equal(guestbookMarkerCopy({ nearby:true, available:false }).icon, "🔒");
  assert.equal(GUESTBOOK_MARKER_MAX_DISTANCE, 28);
});

test("world label projects the guestbook anchor and hides outside view distance", () => {
  const element = fakeElement();
  const camera = {
    getPosition: () => ({ x:0, y:0, z:0 }),
    camera: { worldToScreen: p => ({ x:p.x + 100, y:p.y + 100, z:1 }) }
  };
  const canvas = {
    clientWidth: 400, clientHeight: 300,
    getBoundingClientRect: () => ({ left:10, top:20 })
  };
  let position = { x:20, y:1, z:0, clone(){ return { ...this }; } };
  const label = createGuestbookWorldLabel({ element, camera, canvas, getWorldPosition:()=>position });

  assert.equal(label.update({ visible:true, nearby:false, available:true }), true);
  assert.equal(element.hidden, false);
  assert.equal(element.style.left, "130px");
  assert.equal(element.nodes.hint.textContent, "한마디 남겨보세요");

  assert.equal(label.update({ visible:true, nearby:true, available:true }), true);
  assert.equal(element.classList.contains("is-near"), true);
  assert.equal(element.nodes.hint.textContent, "F · 열기");

  position = { x:40, y:1, z:0, clone(){ return { ...this }; } };
  assert.equal(label.update({ visible:true, nearby:false, available:true }), false);
  assert.equal(element.hidden, true);
});
