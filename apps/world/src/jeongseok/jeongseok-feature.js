import { createJeongseokAccessClient } from "./access-client.js";
import { createJeongseokGateController, GATE_STATE } from "./gate-controller.js";
import { createJeongseokGatePanel, createGateCues, gateContextAction } from "./gate-panel.js";
import { JEONGSEOK_GATE, JEONGSEOK_GUIDE, nearJeongseokGate } from "./gate-layout.js";

// Everyone can reach the public lobby. The guide sells the server's pass; the separate reader
// freshly verifies a grant before the interior receives it. Proximity is UI safety, not a right.
const TAG_STATES = new Set([GATE_STATE.SCANNING, GATE_STATE.GRANTED, GATE_STATE.OPENING]);

export function createJeongseokFeature({ getClient, isEnabled = () => false, audio = null, getPhone = () => null,
  getContext = null, onEnter = () => ({ status: "UNAVAILABLE" }), storage = () => null,
  doc = document, gate: gateLayout = JEONGSEOK_GATE, guide: guideLayout = JEONGSEOK_GUIDE, timings } = {}) {
  const access = createJeongseokAccessClient({ getClient, storage });
  const panel = createJeongseokGatePanel({ doc });
  let near = false, nearGuide = false, phoneOwned = false, phoneMode = null, lastContext = null;
  // Main supplies a live getter. The last context is only a fallback for engine-free consumers.
  const context = () => { try { return getContext ? getContext() : lastContext; } catch { return null; } };
  function distanceAt(anchor, value = context()) {
    if (!isEnabled() || !value || value.space !== anchor.space || value.mounted || value.busy || value.grounded === false) return null;
    return nearJeongseokGate(value.position, anchor);
  }
  const atReader = () => distanceAt(gateLayout) !== null;
  const atGuide = () => distanceAt(guideLayout) !== null;
  const gate = createJeongseokGateController({
    access, isEnabled, canTag: atReader, canGuide: atGuide, canPurchase: atGuide,
    onCue: createGateCues({ audio }), timings,
    onEnter: snapshot => atReader() ? onEnter(snapshot) : ({ status: "CONTEXT_CHANGED" }),
    onChange: view => {
      panel.render(view);
      const phone = getPhone();
      if (TAG_STATES.has(view.state) && !phoneOwned && phone?.openJeongseok({ tag: true })) {
        phoneOwned = true; phoneMode = "tag";
      }
      // Guidance stays open after issue/recovery. Only reader-owned animations return the Phone.
      if (phoneOwned && phoneMode === "tag" && (view.state === GATE_STATE.READY_TO_ENTER ||
          (!TAG_STATES.has(view.state) && view.state !== GATE_STATE.CHECKING))) {
        phoneOwned = false; phoneMode = null; phone?.endJeongseok();
      }
      phone?.refresh();
    }
  });
  const unsubscribeAccess = access.onChange(() => getPhone()?.refresh());

  function triggerReader() {
    if (!atReader()) return false;
    return gate.snapshot().state === GATE_STATE.READY_TO_ENTER ? gate.enter() : gate.start();
  }
  function triggerGuide() {
    if (!atGuide()) return false;
    // Guests can read login guidance here. Only the server decides account eligibility to buy.
    if (!getPhone()?.openJeongseok({ tag: false })) return false;
    phoneOwned = true; phoneMode = "guide";
    return gate.guide();
  }
  function remember(value) {
    lastContext = value ? { ...value, position: value.position ? { x: value.position.x, z: value.position.z } : null } : null;
  }

  return { access, gate, panel, layout: gateLayout, guideLayout, isEnabled,
    contextAction(options = {}) {
      remember(options);
      const distance = distanceAt(gateLayout, options), isNear = distance !== null;
      if (isNear !== near) {
        near = isNear; panel.setNear(near, gate.snapshot());
        if (!near && phoneMode !== "guide") gate.reset();
        getPhone()?.refresh();
      }
      return isNear ? gateContextAction(gate.snapshot(), { distance, trigger: triggerReader }) : null;
    },
    npcContextAction(options = {}) {
      remember(options);
      const distance = distanceAt(guideLayout, options), isNear = distance !== null;
      if (isNear !== nearGuide) {
        nearGuide = isNear;
        if (!nearGuide && phoneMode === "guide") gate.reset();
        getPhone()?.refresh();
      }
      return isNear ? { id: "jeongseok-guide", icon: "💬", label: "로비 안내 · 방문증", priority: 300,
        distance, pressed: gate.snapshot().busy, trigger: triggerGuide } : null;
    },
    /** Server snapshot + presentation only; Phone cannot turn these flags into a grant. */
    phoneView: () => ({ enabled: isEnabled(), access: access.view(), gate: gate.snapshot(), atReader: atReader(), atGuide: atGuide() }),
    purchase: () => gate.purchase(),
    refresh: () => atGuide() ? gate.guide() : access.refresh("phone"),
    cancel() { gate.reset(); if (phoneOwned) { phoneOwned = false; phoneMode = null; getPhone()?.endJeongseok(); } },
    phoneClosed() { phoneOwned = false; phoneMode = null; },
    setAccount(userId) { gate.accountChanged(); phoneOwned = false; phoneMode = null; return access.setAccount(isEnabled() ? userId : null); },
    destroy() { unsubscribeAccess(); gate.destroy(); panel.destroy(); }
  };
}
