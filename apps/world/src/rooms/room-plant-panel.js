import { ROOM_PLANT_ITEM, ROOM_PLANT_ERRORS } from "./room-plant-client.js";
const LABEL = Object.freeze({ SPROUT: "새싹", BUD: "봉오리", BLOOM: "활짝 핀 꽃" });

export function createRoomPlantPanel({ client, getRoomState, onPlace = async () => false, onOpenChange = () => {},
  doc = document, win = globalThis.window }) {
  const panel = doc.createElement("section"); panel.id = "room-plant-panel"; panel.className = "furniture-editor";
  panel.hidden = true; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-label", "내 방 화분 키우기");
  const backdrop = doc.createElement("div"); backdrop.className = "furniture-editor-backdrop"; backdrop.hidden = true;
  doc.body.append(backdrop, panel);
  let previousFocus = null, scope = null, targetId = null, signature = "";
  const scopeOf = () => { const s = client.state(); return `${s.accountId}:${s.roomId}:${s.generation}`; };
  const node = (tag, text) => { const e = doc.createElement(tag); e.textContent = text; return e; };
  const button = (text, fn, disabled = false) => {
    const e = node("button", text), expectedScope = scope;
    e.type = "button"; e.disabled = disabled;
    e.addEventListener("click", () => {
      if (!e.disabled && !panel.hidden && scope === expectedScope && scope === scopeOf() && client.available()) fn();
    }); return e;
  };
  function close({ restoreFocus = true } = {}) {
    if (panel.hidden) return true;
    panel.hidden = true; backdrop.hidden = true; scope = null; signature = ""; targetId = null; onOpenChange(false);
    if (restoreFocus) previousFocus?.focus?.({ preventScroll: true }); previousFocus = null; return true;
  }
  function render() {
    if (panel.hidden) return;
    if (!client.available() || scope !== scopeOf()) { close({ restoreFocus: false }); return; }
    const s = client.state(), room = getRoomState();
    if (targetId && !room.objects?.some(o => o.id === targetId && o.itemId === ROOM_PLANT_ITEM)) { close({ restoreFocus: false }); return; }
    const next = JSON.stringify([s, targetId, room.objects?.filter(o => o.itemId === ROOM_PLANT_ITEM)]);
    if (next === signature) return; signature = next;
    const focused = panel.contains(doc.activeElement) ? doc.activeElement?.textContent : null;
    panel.replaceChildren();
    const header = node("header", ""); header.append(node("h2", s.role === "visitor" ? "친구의 작은 꽃" : "내 방 화분 키우기"), button("닫기", close)); panel.append(header);
    panel.append(node("p", "새싹 → 봉오리 → 꽃. 늦게 돌아와도 죽거나 작아지지 않아요."));
    const status = node("p", s.pending ? "결과를 확인 중이에요." : s.error ? ROOM_PLANT_ERRORS[s.error]
      : s.reading ? "서버에서 화분을 확인 중이에요." : ""); status.setAttribute("role", "status"); panel.append(status);
    if (s.retry) panel.append(button("같은 요청 다시 확인", () => void client.retry(), s.pending || s.reading));
    else if (!s.ready || s.needsReadback) panel.append(button("현재 상태 다시 확인", () => void client.refresh(), s.pending || s.reading));
    else if (s.snapshot.featureStatus !== "ACTIVE") panel.append(node("p", ROOM_PLANT_ERRORS.PLANT_UNAVAILABLE));
    else if (s.role === "visitor") {
      const p = s.snapshot.plants.find(p => p.objectId === targetId);
      panel.append(node("p", p ? LABEL[p.stage] : "아직 꽃을 심지 않은 화분이에요."));
      panel.append(node("p", "물주기가 필요할 때 친구의 꽃을 함께 돌볼 수 있어요. 보상 없이 꽃이 자라는 걸 도와줘요."));
      if (p?.canCare) {
        panel.append(button("친구 꽃 물주기", () => void client.care(p.objectId), s.reading || s.pending || !s.visitorCareAvailable));
        if (!s.visitorCareAvailable) panel.append(node("p", "방 연결을 확인하고 있어요. 연결되면 물을 줄 수 있어요."));
      }
      else if (p && p.stage !== "BLOOM") panel.append(node("p", "지금은 자라는 중이에요. 서두르지 않아도 괜찮아요."));
    } else if (!s.snapshot.planterOwned) {
      panel.append(node("p", "무료 재배용 화분을 계정당 한 번 받을 수 있어요. 작은 꽃 한 송이를 심어 방에 남겨 보세요."));
      panel.append(button("첫 화분 받기 · 무료", () => void client.claim(), s.reading || s.pending));
    } else {
      const target = targetId ? room.objects?.find(o => o.id === targetId) : room.objects?.find(o => o.itemId === ROOM_PLANT_ITEM);
      const p = s.snapshot.plant;
      if (!target) {
        panel.append(node("p", p ? `${LABEL[p.stage]}을 보관 중이에요. 다시 배치해도 성장 기록은 남아요.` : "화분을 받았어요. 꾸미기에서 놓을 자리를 고르고 저장해 주세요."));
        panel.append(button("꾸미기에서 배치", () => void onPlace(), s.reading || s.pending || !s.inventoryConfirmed));
      } else if (!p) {
        panel.append(node("p", "이 화분에 작은 꽃 한 송이를 심어요. 다 자란 꽃은 계속 방에 남아요."));
        panel.append(button("꽃 심기", () => void client.plant(target.id), s.reading || s.pending));
      } else {
        panel.append(node("p", LABEL[p.stage]));
        if (p.stage === "BLOOM") panel.append(node("p", "꽃이 활짝 피었어요. 이제 물주기 없이 이 모습을 계속 간직해요."));
        else if (p.canCare) {
          panel.append(node("p", p.revision === 1 ? "물을 주면 성장을 시작해요. 다음 변화는 약 20시간 뒤예요." : "봉오리가 자랐어요. 물을 주면 약 20시간 뒤 꽃이 피어요."));
          panel.append(button("물주기", () => void client.care(target.id), s.reading || s.pending));
        } else if (p.nextStageAt) {
          const hours = Math.max(1, Math.ceil((Date.parse(p.nextStageAt) - Date.parse(s.snapshot.serverNow)) / 3600000));
          panel.append(node("p", `다음 변화까지 약 ${hours}시간. 서두르지 않아도 괜찮아요.`));
        }
      }
    }
    const buttons = [...panel.querySelectorAll("button")];
    (buttons.find(b => b.textContent === focused && !b.disabled) ?? buttons[0])?.focus?.();
  }
  const back = () => close({ restoreFocus: false }); win?.addEventListener?.("popstate", back);
  panel.addEventListener("pointerdown", event => event.stopPropagation()); backdrop.addEventListener("pointerdown", event => event.stopPropagation());
  backdrop.addEventListener("click", () => close());
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === "Tab") {
      const buttons = [...panel.querySelectorAll("button")].filter(b => !b.disabled), first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  return { get open() { return !panel.hidden; },
    openPanel(target = null) {
      client.sync(); if (!client.available() || !panel.hidden) return false;
      previousFocus = doc.activeElement; scope = scopeOf(); targetId = target?.id ?? null; signature = "";
      panel.hidden = false; backdrop.hidden = false; onOpenChange(true); render(); void client.refresh(); return true;
    },
    update: render, close,
    dispose() { close({ restoreFocus: false }); win?.removeEventListener?.("popstate", back); panel.remove(); backdrop.remove(); }
  };
}
