import { FURNITURE_BY_ID, ROOM_FURNITURE, SURFACE_NAMES, FURNITURE_ERRORS, firstFurniturePosition,
  positionOnSurface, validateFurniture, canonicalFurniture, FURNITURE_LIMIT } from "./furniture-layout.js";
import { PERSONAL_ROOM_BASIC, PERSONAL_ROOM_BASIC_FURNITURE, PERSONAL_ROOM_PLACEMENT_ENVELOPE } from "./personal-room-layout.js";

// DOM-only editor: tap the plan or use the same movement buttons on desktop and mobile.
// The client keeps the draft; closing a dirty draft always offers keep editing / discard.
export function createFurnitureEditor({ client, inventory, onOpenChange = () => {}, doc = document }) {
  const panel = doc.createElement("section"); panel.id = "furniture-editor"; panel.hidden = true;
  panel.className = "furniture-editor"; panel.tabIndex = -1; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "내 방 꾸미기"); doc.body.append(panel);
  const backdrop = doc.createElement("div"); backdrop.className = "furniture-editor-backdrop"; backdrop.hidden = true; doc.body.append(backdrop);
  let selected = null, message = "", closing = null, previousFocus = null;
  // History belongs to one open editor session, never to the inventory or server snapshot.
  // A successful save establishes a new checkpoint; a failed save keeps the whole draft/history.
  const HISTORY_LIMIT = 100;
  let undo = [], redo = [], session = 0, disposed = false;
  const capture = (state = client.state(), selection = selected) => ({
    objects: state.objects.map(object => ({ ...object })),
    selected: state.objects.some(object => object.id === selection) ? selection : null
  });
  const sameObjects = (a, b) => JSON.stringify(canonicalFurniture(a)) === JSON.stringify(canonicalFurniture(b));
  function clearHistory() { undo = []; redo = []; }
  function resetSession() { session++; clearHistory(); selected = null; message = ""; closing = null; }
  function editable(state = client.state()) { return !disposed && !panel.hidden && state.editing && !closing && !state.pending; }
  function edit(objects, nextSelected = selected) {
    const state = client.state();
    if (!editable(state) || sameObjects(objects, state.objects)) return false;
    const before = capture(state), previousUndo = undo, previousRedo = redo;
    undo = [...undo, before].slice(-HISTORY_LIMIT); redo = []; selected = nextSelected; message = "";
    // edit emits synchronously, so publish history first to render the right button state.
    if (client.edit(objects)) return true;
    undo = previousUndo; redo = previousRedo; selected = before.selected; render(); return false;
  }
  function restoreHistory(direction) {
    const state = client.state(), source = direction === "undo" ? undo : redo;
    if (!editable(state) || !source.length) return false;
    const target = source.at(-1), currentCounts = new Map(), targetCounts = new Map();
    for (const object of state.objects) currentCounts.set(object.itemId, (currentCounts.get(object.itemId) ?? 0) + 1);
    for (const object of target.objects) targetCounts.set(object.itemId, (targetCounts.get(object.itemId) ?? 0) + 1);
    // Inventory may have refreshed since this step. Never restore additional unowned copies.
    // Removals/moves still work so an already-invalid draft can be repaired.
    const addsUnowned = [...targetCounts].some(([itemId, count]) => count > (currentCounts.get(itemId) ?? 0)
      && (inventory.state !== "READY" || count > (owned().find(item => item.itemId === itemId)?.quantity ?? 0)));
    if (target.objects.length > FURNITURE_LIMIT || addsUnowned) {
      message = inventory.state === "READY" ? "현재 보유한 수량으로는 이 배치를 복원할 수 없어요." : "보유 가구 확인이 끝나면 다시 시도해 주세요.";
      render(); return false;
    }
    const before = capture(state), previousUndo = undo, previousRedo = redo;
    if (direction === "undo") { undo = undo.slice(0, -1); redo = [...redo, before].slice(-HISTORY_LIMIT); }
    else { redo = redo.slice(0, -1); undo = [...undo, before].slice(-HISTORY_LIMIT); }
    selected = target.selected; message = direction === "undo" ? "이전 배치로 되돌렸어요." : "배치를 다시 적용했어요.";
    if (client.edit(target.objects)) return true;
    undo = previousUndo; redo = previousRedo; selected = before.selected; render(); return false;
  }
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
    resetSession(); panel.hidden = true; backdrop.hidden = true; client.cancel(); onOpenChange(false);
    previousFocus?.focus?.({ preventScroll: true }); action?.();
  }
  function forceClose() {
    resetSession(); panel.hidden = true; backdrop.hidden = true; client.cancel({ force: true }); onOpenChange(false);
  }
  function requestClose(action = null) {
    if (panel.hidden) { action?.(); return true; }
    if (client.state().pending) { message = "저장 결과를 확인 중이에요. 잠시만 기다려 주세요."; render(); return false; }
    if (client.state().dirty) { closing = { action }; render(); return false; }
    closeNow(action); return true;
  }
  function changeObject(patch) {
    const state = client.state(); if (!editable(state)) return;
    const object = state.objects.find(object => object.id === selected); if (!object) return;
    message = "";
    const next = { ...object, ...patch };
    edit(state.objects.map(row => row.id === selected ? next : row));
  }
  function move(dx, dz) {
    const object = client.state().objects.find(row => row.id === selected); if (!object) return;
    changeObject(positionOnSurface(object.surface, object.x + dx, object.z + dz, object.yaw));
  }
  function add(itemId) {
    if (!editable() || inventory.state !== "READY") return;
    const state = client.state(), item = FURNITURE_BY_ID.get(itemId);
    if (!item || state.objects.length >= FURNITURE_LIMIT) return;
    let position = null;
    for (const surface of item.surfaces) { position = firstFurniturePosition(itemId, surface, state.objects, owned()); if (position) break; }
    if (!position) { message = "보유 수량 또는 놓을 공간을 확인해 주세요."; render(); return; }
    const object = { ...position, id: globalThis.crypto.randomUUID() };
    edit([...state.objects, object], object.id);
  }
  function render() {
    if (panel.hidden) return;
    const focusKey = panel.contains(doc.activeElement) ? doc.activeElement?.dataset?.focus : null;
    const state = client.state(), items = owned(), object = state.objects.find(row => row.id === selected);
    const validation = validateFurniture(state.objects, inventory.state === "READY" ? items : null);
    const locked = !editable(state);
    panel.replaceChildren();
    const header = node("header"); header.append(node("h2", "내 방 꾸미기"), button("닫기", () => requestClose(), state.pending)); panel.append(header);
    panel.append(node("p", "가구를 선택하고 평면도를 눌러 옮겨요. 기본 침대·책상은 고정 시설이에요.", "furniture-help"));
    const history = node("div", undefined, "furniture-history"); history.setAttribute("role", "group"); history.setAttribute("aria-label", "배치 실행 기록");
    const undoButton = button("↶ 되돌리기", () => restoreHistory("undo"), locked || !undo.length, "undo");
    const redoButton = button("↷ 다시 실행", () => restoreHistory("redo"), locked || !redo.length, "redo");
    undoButton.setAttribute("aria-keyshortcuts", "Control+Z Meta+Z"); redoButton.setAttribute("aria-keyshortcuts", "Control+Shift+Z Meta+Shift+Z Control+Y");
    undoButton.title = "되돌리기 (Ctrl/⌘+Z)"; redoButton.title = "다시 실행 (Ctrl/⌘+Shift+Z, Ctrl+Y)";
    history.append(undoButton, redoButton); panel.append(history);
    panel.append(node("p", "최근 100단계를 되돌릴 수 있어요. 저장하면 실행 기록이 새로 시작돼요.", "furniture-history-help"));
    const { halfWidth: mapW, halfDepth: mapD } = PERSONAL_ROOM_BASIC;
    const placement = PERSONAL_ROOM_PLACEMENT_ENVELOPE.floor;
    const map = svgNode("svg", { viewBox: `${-mapW} ${-mapD} ${2*mapW} ${2*mapD}`, preserveAspectRatio: "none", role: "group", "aria-label": "방 평면도. 위쪽은 창문, 아래쪽은 출입문" });
    map.classList.add("furniture-plan");
    map.append(svgNode("rect", { x: -mapW, y: -mapD, width: 2*mapW, height: 2*mapD, fill: "#ebdbc5" }));
    map.append(svgNode("rect", { x: placement.minX, y: -placement.maxZ, width: placement.maxX-placement.minX, height: placement.maxZ-placement.minZ,
      fill: "#fffaf2", opacity: .28, stroke: "#8b765f", "stroke-width": .035, "stroke-dasharray": ".16 .12" }));
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
    const north = svgNode("text", { x: .5, y: -mapD+.5, "text-anchor": "middle", "font-size": .26, "pointer-events": "none" }); north.textContent = "창문"; map.append(north);
    const exit = svgNode("text", { x: 0, y: mapD-.35, "text-anchor": "middle", "font-size": .26, "pointer-events": "none" }); exit.textContent = "출입문 · 비워두기"; map.append(exit);
    map.addEventListener("click", event => {
      if (locked) return;
      const hit = event.target.closest?.("[data-object-id]");
      if (hit) { selected = hit.dataset.objectId; message = ""; render(); return; }
      if (!object) return;
      const rect = map.getBoundingClientRect(); if (!rect.width || !rect.height) return;
      const x = -mapW + (event.clientX-rect.left)/rect.width*(2*mapW);
      const z = mapD - (event.clientY-rect.top)/rect.height*(2*mapD);
      if (object.surface === "floor" && (x < placement.minX || x > placement.maxX || z < placement.minZ || z > placement.maxZ)) {
        message = "가구를 놓을 수 있는 바닥 범위 밖이에요. 평면도 안쪽을 선택해 주세요.";
        render(); return;
      }
      changeObject(positionOnSurface(object.surface,x,z,object.yaw));
    }); panel.append(map);
    const choices = node("div", undefined, "furniture-owned");
    for (const item of ROOM_FURNITURE) {
      const quantity = items.find(row => row.itemId === item.itemId)?.quantity ?? 0;
      if (!quantity) continue;
      const placed = state.objects.filter(row => row.itemId === item.itemId).length;
      choices.append(button(`${item.name} (${placed}/${quantity}) +`, () => add(item.itemId), locked || placed >= quantity || state.objects.length >= FURNITURE_LIMIT, item.itemId));
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
      controls.append(button("회수", () => edit(client.state().objects.filter(row => row.id !== object.id), null), locked)); panel.append(controls);
    }
    const note = node("p", FURNITURE_ERRORS[state.error] ?? (validation ? FURNITURE_ERRORS[validation] : message || (state.dirty ? "변경한 배치를 저장해 주세요." : "저장된 배치예요.")), "furniture-note");
    note.setAttribute("role", "status"); note.setAttribute("aria-live", "polite"); panel.append(note);
    if (closing) {
      const confirmation = node("div", undefined, "furniture-confirm"); confirmation.append(node("p", "저장하지 않은 배치를 버리고 닫을까요?"));
      confirmation.append(button("계속 꾸미기", () => { closing = null; render(); }), button("변경 버리고 닫기", () => closeNow(closing.action))); panel.append(confirmation);
    } else {
      const footer = node("footer"); footer.append(button(state.pending ? "저장 중…" : "저장", async () => {
        if (!editable()) return;
        const savingSession = session;
        message = ""; const saved = await client.save(items);
        if (disposed || panel.hidden || savingSession !== session) return;
        if (saved) { clearHistory(); message = "저장했어요. 다음에 들어와도 그대로예요."; }
        else if (client.state().error === "ITEM_NOT_OWNED") void inventory.refresh("furniture-save"); render();
      }, state.pending || !!validation || inventory.state !== "READY"));
      footer.append(button("완료", () => requestClose(), state.pending)); panel.append(footer);
    }
    if (focusKey) {
      const buttons = [...panel.querySelectorAll("[data-focus]")];
      const preferred = buttons.find(el => el.dataset.focus === focusKey && !el.disabled);
      const historyFallback = ["undo", "redo"].includes(focusKey) && buttons.find(el => ["undo", "redo"].includes(el.dataset.focus) && !el.disabled);
      (preferred || historyFallback || buttons.find(el => !el.disabled) || panel).focus({ preventScroll: true });
    }
  }
  panel.addEventListener("keydown", event => {
    // Keep native text/select editing and IME composition intact. Buttons and the panel own
    // the familiar desktop shortcuts; every action is also available as a 44px touch button.
    const target = event.target, nativeControl = ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName)
      || target?.isContentEditable;
    const key = event.key?.toLowerCase();
    if (!nativeControl && !event.isComposing && !event.altKey && (event.ctrlKey || event.metaKey)) {
      const isZ = key === "z" || event.code === "KeyZ", isY = key === "y" || event.code === "KeyY";
      if (isZ || (isY && event.ctrlKey && !event.shiftKey)) {
        event.preventDefault();
        if (!event.repeat) restoreHistory(isZ && !event.shiftKey ? "undo" : "redo");
      }
    }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); requestClose(); }
    if (event.key === "Tab") {
      const focusable = [...panel.querySelectorAll("button:not(:disabled),select:not(:disabled)")];
      const next = event.shiftKey ? focusable.at(-1) : focusable[0], boundary = event.shiftKey ? focusable[0] : focusable.at(-1);
      if (!focusable.length || doc.activeElement === panel || doc.activeElement === boundary || !panel.contains(doc.activeElement)) {
        event.preventDefault(); (next || panel).focus();
      }
    }
    // Gameplay handlers must not consume editor keys, including typing/select navigation.
    event.stopPropagation();
  });
  const unsubscribe = inventory.onChange(() => render());
  return {
    get open() { return !panel.hidden; },
    openEditor() {
      if (disposed) return false;
      if (!panel.hidden) return true;
      if (!client.begin()) return false;
      previousFocus = doc.activeElement; resetSession();
      panel.hidden = false; backdrop.hidden = false; onOpenChange(true); render(); panel.querySelector("button")?.focus();
      void inventory.refresh("furniture-open"); return true;
    },
    requestClose,
    forceClose,
    update(state) { if (!state.editing && !panel.hidden) { resetSession(); panel.hidden = true; backdrop.hidden = true; onOpenChange(false); } render(); },
    dispose() { if (!panel.hidden) forceClose(); disposed = true; resetSession(); unsubscribe(); panel.remove(); backdrop.remove(); }
  };
}
