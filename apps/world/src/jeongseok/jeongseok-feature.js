import { createJeongseokAccessClient } from "./access-client.js";
import { createJeongseokGateController, GATE_STATE } from "./gate-controller.js";
import { createJeongseokGatePanel, createGateCues, gateContextAction } from "./gate-panel.js";
import { JEONGSEOK_GATE, nearJeongseokGate } from "./gate-layout.js";

// JSL-A integration. Closed unless the caller enables it; even then the server gate policy and pass
// product decide everything (they ship COMING_SOON). The interior is JSL-B: an entry attempt is
// re-verified by the server and then reported as PENDING_JSL_B. No room, teleport or Realtime
// channel is opened here, so nothing can be reached by skipping the gate.
export const JEONGSEOK_INTERIOR_STATUS = "PENDING_JSL_B";
const TAG_STATES = new Set([GATE_STATE.SCANNING, GATE_STATE.GRANTED, GATE_STATE.OPENING]);
const GUIDE_STATES = new Set([GATE_STATE.NEEDS_PASS, GATE_STATE.EXPIRED, GATE_STATE.INSUFFICIENT_FUNDS]);
// An unresolved purchase keeps the guidance open so "same request" recovery stays reachable.
const isGuide = view => GUIDE_STATES.has(view.state) || (view.state === GATE_STATE.UNKNOWN && view.purchaseRecovery);

export function createJeongseokFeature({ getClient, isEnabled = () => false, audio = null, getPhone = () => null,
  storage = () => null, doc = document, gate: gateLayout = JEONGSEOK_GATE, timings } = {}) {
  const access = createJeongseokAccessClient({ getClient, storage });
  const panel = createJeongseokGatePanel({ doc });
  let near = false, phoneOwned = false, previous = GATE_STATE.IDLE;
  const gate = createJeongseokGateController({
    access, isEnabled, onCue: createGateCues({ audio }), timings,
    onEnter: () => ({ status: JEONGSEOK_INTERIOR_STATUS }),
    onChange: view => {
      panel.render(view);
      const phone = getPhone();
      // Tag on the Student ID screen, then return to where the player was.
      if (TAG_STATES.has(view.state) && !phoneOwned && phone?.openJeongseok({ tag: true })) phoneOwned = true;
      // A fresh check that needs a pass opens the guidance once; later refusals reuse the open view.
      if (isGuide(view) && previous === GATE_STATE.CHECKING && !phoneOwned && phone?.openJeongseok({ tag: false })) phoneOwned = true;
      previous = view.state;
      if (view.state === GATE_STATE.READY_TO_ENTER || (!TAG_STATES.has(view.state) && !isGuide(view) &&
          view.state !== GATE_STATE.PURCHASING && view.state !== GATE_STATE.CHECKING)) {
        if (phoneOwned) { phoneOwned = false; phone?.endJeongseok(); }
      }
      phone?.refresh();
    }
  });
  access.onChange(() => getPhone()?.refresh());

  function trigger() {
    const view = gate.snapshot();
    if (view.state === GATE_STATE.READY_TO_ENTER) return void gate.enter();
    if (isGuide(view)) {
      // Guidance and confirmation are Phone UI; the purchase itself is gated on this reader.
      if (getPhone()?.openJeongseok({ tag: false })) phoneOwned = true;
      return;
    }
    void gate.start();
  }

  return { access, gate, panel, layout: gateLayout,
    isEnabled,
    /** Context Action slot for the reader, or null away from it / while closed on the client. */
    contextAction({ position, grounded = true, mounted = false, inside = false }) {
      const distance = isEnabled() && !inside && !mounted && grounded ? nearJeongseokGate(position, gateLayout) : null;
      const isNear = distance !== null;
      if (isNear !== near) {
        near = isNear; panel.setNear(near, gate.snapshot());
        if (!near) gate.reset();
      }
      return isNear ? gateContextAction(gate.snapshot(), { distance, trigger }) : null;
    },
    /** Phone Student ID view model: server snapshot + gate state; never a local right. */
    phoneView: () => ({ enabled: isEnabled(), access: access.view(), gate: gate.snapshot(), atReader: near }),
    purchase: () => gate.purchase(),
    refresh: () => access.refresh("phone"),
    cancel() { gate.reset(); if (phoneOwned) { phoneOwned = false; getPhone()?.endJeongseok(); } },
    phoneClosed() { phoneOwned = false; },
    setAccount(userId) { gate.accountChanged(); phoneOwned = false; return access.setAccount(isEnabled() ? userId : null); },
    destroy() { gate.destroy(); panel.destroy(); }
  };
}
