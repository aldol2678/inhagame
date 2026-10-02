import { FURNITURE_BY_ID, ROOM_FURNITURE, SURFACE_NAMES, FURNITURE_ERRORS, firstFurniturePosition,
  positionOnSurface, validateFurniture } from "./furniture-layout.js";
import { PERSONAL_ROOM_BASIC_FURNITURE } from "./personal-room-layout.js";

// DOM-only editor: tap the plan or use the same movement buttons on desktop and mobile.
// The client keeps the draft; closing a dirty draft always offers keep editing / discard.
export function createFurnitureEditor({ client, inventory, onOpenChange = () => {}, doc = document }) {
  const panel = doc.createElement("section"); panel.id = "furniture-editor"; panel.hidden = true;
  panel.className = "furniture-editor"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "내 방 꾸미기"); doc.body.append(panel);
  const backdrop = doc.createElement("div"); backdrop.className = "furniture-editor-backdrop"; backdrop.hidden = true; doc.body.append(backdrop);
  let selected = null, message = "", closing = null, previousFocus = null;
  const node = (tag, text, className) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
  const button = (text, action, disabled = false, key = text) => {
    const el = node("button", text); el.type = "button"; el.disabled = disabled; el.dataset.focus = key;
    el.addEventListener("click", action); return el;
  };
  const svgNode = (tag, attributes = {}) => {
    const el = doc.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key,value] of Object.entries(attributes)) el.setAttribute(key, String(value)); return el;
  };
  const owned = () => inventory.state === "READY" ? inventory.snapshot?.items ?? [] : [];
  function closeNow(action) {
    closing = null; panel.hidden = true; backdrop.hidden = true; client.cancel(); onOpenChange(false);
    previousFocus?.focus?.({ preventScroll: true }); action?.();
  }
  function requestClose(action = null) {
    if (panel.hidden) { action?.(); return true; }
    if (client.state().pending) { message = "저장 결과를 확인 중이에요. 잠시만 기다려 주세요."; render(); return false; }
    if (client.state().dirty) { closing = { action }; render(); return false; }
    closeNow(action); return true;
  }
  function changeObject(patch) {
    const state = client.state(); if (closing || state.pending) return;
    const object = state.objects.find(object => object.id === selected); if (!object) return;
    message = "";
    const next = { ...object, ...patch };
    client.edit(state.objects.map(row => row.id === selected ? next : row));
  }
  function move(dx, dz) {
    const object = client.state().objects.find(row => row.id === selected); if (!object) return;
    changeObject(positionOnSurface(object.surface, object.x + dx, object.z + dz, object.yaw));
  }
  function add(itemId) {
    if (closing || client.state().pending || inventory.state !== "READY") return;
    const state = client.state(), item = FURNITURE_BY_ID.get(itemId);
    let position = null;
    for (const surface of item.surfaces) { position = firstFurniturePosition(itemId, surface, state.objects, owned()); if (position) break; }
    if (!position) { message = "보유 수량 또는 놓을 공간을 확인해 주세요."; render(); return; }
    const object = { ...position, id: globalThis.crypto.randomUUID() }; selected = object.id; message = "";
    client.edit([...state.objects, object]);
  }
  function render() {
    if (panel.hidden) return;
    const focusKey = panel.contains(doc.activeElement) ? doc.activeElement?.dataset?.focus : null;
    const state = client.state(), items = owned(), object = state.objects.find(row => row.id === selected);
    const validation = validateFurniture(state.objects, inventory.state === "READY" ? items : null);
    const locked = state.pending || closing !== null;
    panel.replaceChildren();
    const header = node("header"); header.append(node("h2", "내 방 꾸미기"), button("닫기", () => requestClose(), state.pending)); panel.append(header);
    panel.append(node("p", "가구를 선택하고 평면도를 눌러 옮겨요. 기본 침대·책상은 고정 시설이에요.", "furniture-help"));
    const map = svgNode("svg", { viewBox: "-5.4 -4.2 10.8 8.4", preserveAspectRatio: "none", role: "group", "aria-label": "방 평면도. 위쪽은 창문, 아래쪽은 출입문" });
    map.classList.add("furniture-plan");
    map.append(svgNode("rect", { x: -5.4, y: -4.2, width: 10.8, height: 8.4, fill: "#ebdbc5" }));
    map.append(svgNode("rect", { x: -.9, y: 2.25, width: 1.8, height: 1.95, fill: "#f5bfa4", opacity: .65 }));
    for (const fixed of PERSONAL_ROOM_BASIC_FURNITURE) {
      map.append(svgNode("rect", { x: fixed.at[0]-fixed.size[0]/2, y: -fixed.at[2]-fixed.size[2]/2, width: fixed.size[0], height: fixed.size[2], fill: fixed.kind === "rug" ? "#a6b6bc" : "#8c7967", opacity: .7 }));
    }
    for (const row of state.objects) {
      const item = FURNITURE_BY_ID.get(row.itemId); if (!item) continue;
      const rect = svgNode("rect", { x: row.x-item.width/2, y: -row.z-item.depth/2, width: item.width, height: Math.max(item.depth,.12),
        transform: `rotate(${row.yaw} ${row.x} ${-row.z})`, fill: row.id === selected ? validation ? "#c94d4d" : "#377ab7" : "#559e78", stroke: "#18324a", "stroke-width": .025, "data-object-id": row.id });
      const title = svgNode("title"); title.textContent = item.name; rect.append(title); map.append(rect);
    }
    const north = svgNode("text", { x: .5, y: -3.7, "text-anchor": "middle", "font-size": .26, "pointer-events": "none" }); north.textContent = "창문"; map.append(north);
    const exit = svgNode("text", { x: 0, y: 3.85, "text-anchor": "middle", "font-size": .26, "pointer-events": "none" }); exit.textContent = "출입문 · 비워두기"; map.append(exit);
    map.addEventListener("click", event => {
      if (locked) return;
      const hit = event.target.closest?.("[data-object-id]");
      if (hit) { selected = hit.dataset.objectId; message = ""; render(); return; }
      if (!object) return;
      const rect = map.getBoundingClientRect(); if (!rect.width || !rect.height) return;
      const x = -5.4 + (event.clientX-rect.left)/rect.width*10.8;
      const z = 4.2 - (event.clientY-rect.top)/rect.height*8.4;
      changeObject(positionOnSurface(object.surface,x,z,object.yaw));
    }); panel.append(map);
    const choices = node("div", undefined, "furniture-owned");
    for (const item of ROOM_FURNITURE) {
      const quantity = items.find(row => row.itemId === item.itemId)?.quantity ?? 0;
      if (!quantity) continue;
      const placed = state.objects.filter(row => row.itemId === item.itemId).length;
      choices.append(button(`${item.name} (${placed}/${quantity}) +`, () => add(item.itemId), locked || placed >= quantity, item.itemId));
    }
    if (!choices.childElementCount) choices.append(node("p", inventory.state === "READY" ? "보유한 배치용 가구가 없어요. 획득한 가구가 여기에 나타나요." : "보유 가구를 확인 중이에요."));
    if (inventory.state === "UNAVAILABLE") choices.append(button("보유 가구 다시 확인", () => void inventory.refresh("furniture"), locked));
    panel.append(choices);
    if (state.objects.length) {
      const label = node("label", "배치한 가구 "); const select = node("select"); select.disabled = locked; select.dataset.focus = "selection";
      select.append(node("option", "가구 선택")); select.firstChild.value = "";
      for (const row of state.objects) { const option = node("option", FURNITURE_BY_ID.get(row.itemId)?.name); option.value = row.id; select.append(option); }
      select.value = selected ?? ""; select.addEventListener("change", () => { selected = select.value || null; render(); }); label.append(select); panel.append(label);
    }
    if (object) {
      const item = FURNITURE_BY_ID.get(object.itemId);
      const controls = node("div", undefined, "furniture-controls");
      const surfaceLabel = node("label", "놓을 곳 "), surface = node("select"); surface.disabled = locked; surface.dataset.focus = "surface";
      for (const key of item.surfaces) { const option = node("option", SURFACE_NAMES[key]); option.value = key; surface.append(option); }
      surface.value = object.surface;
      surface.addEventListener("change", () => {
        const candidate = firstFurniturePosition(object.itemId,surface.value,state.objects.filter(row => row.id !== object.id),items);
        if (candidate) changeObject({ ...candidate, id: object.id });
        else { message = "놓을 공간이 없어요. 다른 가구를 옮겨 주세요."; render(); }
      }); surfaceLabel.append(surface); controls.append(surfaceLabel);
      for (const [text,dx,dz] of [["←",-.25,0],["↑",0,.25],["↓",0,-.25],["→",.25,0]]) {
        const disabledAxis = ["east","west"].includes(object.surface) ? dx !== 0 : ["north","south"].includes(object.surface) ? dz !== 0 : false;
        const arrow = button(text, () => move(dx,dz), locked || disabledAxis); arrow.setAttribute("aria-label", `가구 이동 ${text}`); controls.append(arrow);
      }
      controls.append(button(`회전 ${object.yaw}°`, () => changeObject(positionOnSurface(object.surface,object.x,object.z,object.yaw+45)), locked || !["floor","desk","bed"].includes(object.surface), "rotation"));
      controls.append(button("회수", () => { selected = null; message = ""; client.edit(state.objects.filter(row => row.id !== object.id)); }, locked)); panel.append(controls);
    }
    const note = node("p", FURNITURE_ERRORS[state.error] ?? (validation ? FURNITURE_ERRORS[validation] : message || (state.dirty ? "변경한 배치를 저장해 주세요." : "저장된 배치예요.")), "furniture-note");
    note.setAttribute("role", "status"); note.setAttribute("aria-live", "polite"); panel.append(note);
    if (closing) {
      const confirmation = node("div", undefined, "furniture-confirm"); confirmation.append(node("p", "저장하지 않은 배치를 버리고 닫을까요?"));
      confirmation.append(button("계속 꾸미기", () => { closing = null; render(); }), button("변경 버리고 닫기", () => closeNow(closing.action))); panel.append(confirmation);
    } else {
      const footer = node("footer"); footer.append(button(state.pending ? "저장 중…" : "저장", async () => {
        message = ""; const saved = await client.save(items);
        if (panel.hidden) return;
        if (saved) message = "저장했어요. 다음에 들어와도 그대로예요.";
        else if (client.state().error === "ITEM_NOT_OWNED") void inventory.refresh("furniture-save"); render();
      }, state.pending || !!validation || inventory.state !== "READY"));
      footer.append(button("완료", () => requestClose(), state.pending)); panel.append(footer);
    }
    if (focusKey) [...panel.querySelectorAll("[data-focus]")].find(el => el.dataset.focus === focusKey)?.focus({ preventScroll: true });
  }
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); requestClose(); }
    if (event.key === "Tab") {
      const focusable = [...panel.querySelectorAll("button:not(:disabled),select:not(:disabled)")];
      const next = event.shiftKey ? focusable.at(-1) : focusable[0], boundary = event.shiftKey ? focusable[0] : focusable.at(-1);
      if (doc.activeElement === boundary || !panel.contains(doc.activeElement)) { event.preventDefault(); next?.focus(); }
    }
    // Gameplay handlers must not consume editor keys, including typing/select navigation.
    event.stopPropagation();
  });
  const unsubscribe = inventory.onChange(() => render());
  return {
    get open() { return !panel.hidden; },
    openEditor() {
      if (!panel.hidden) return true;
      if (!client.begin()) return false;
      previousFocus = doc.activeElement; selected = null; message = ""; closing = null;
      panel.hidden = false; backdrop.hidden = false; onOpenChange(true); render(); panel.querySelector("button")?.focus();
      void inventory.refresh("furniture-open"); return true;
    },
    requestClose,
    forceClose() { closing = null; panel.hidden = true; backdrop.hidden = true; client.cancel({ force: true }); onOpenChange(false); },
    update(state) { if (!state.editing && !panel.hidden) { panel.hidden = true; backdrop.hidden = true; closing = null; onOpenChange(false); } render(); },
    dispose() { unsubscribe(); panel.remove(); backdrop.remove(); }
  };
}
