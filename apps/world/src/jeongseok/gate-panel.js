import { GATE_STATE } from "./gate-controller.js";
import { PURCHASE_ERRORS } from "./access-client.js";

// Non-modal HUD reader. It claims no input: F / the mobile Context Action drive the controller,
// and purchase confirmation lives in the Phone Student ID app. Light and sound are presentation.
export const GATE_MESSAGES = Object.freeze({
  IDLE: "학생증 또는 방문증을 가상 리더기에 태그하세요.",
  CHECKING: "서버에서 출입 자격을 확인하고 있어요…",
  SCANNING: "학생증 앱을 리더기에 태그하는 중…",
  GRANTED: "확인됐어요. 출입을 승인합니다.",
  OPENING: "게이트가 열리고 있어요.",
  READY_TO_ENTER: "게이트가 열렸어요.",
  NEEDS_PASS: "방문증이 필요해요. 학생증 앱에서 방문증 안내를 확인하세요.",
  PURCHASING: "방문증 발급 결과를 확인하고 있어요…",
  INSUFFICIENT_FUNDS: "인덕코인이 부족해 방문증을 발급할 수 없어요.",
  EXPIRED: "방문증 유효기간이 끝났어요. 새 방문증이 필요해요.",
  AUTH_REQUIRED: "정식 계정으로 로그인하면 출입할 수 있어요. 캠퍼스 탐험은 그대로 이용할 수 있어요.",
  ACCOUNT_BLOCKED: "현재 계정 상태로는 출입할 수 없어요.",
  UNKNOWN: "출입 자격을 확인하지 못했어요. 새 입장은 막혀 있어요. 다시 시도해 주세요.",
  DISABLED: "정석학술정보관 출입이 지금은 열려 있지 않아요."
});
export const ENTRY_NOTICES = Object.freeze({
  PENDING_JSL_B: "출입 자격이 서버에서 다시 확인됐어요. 실내 공간은 아직 준비 중이에요.",
  FAILED: "입장을 시작하지 못했어요. 다시 시도해 주세요.",
  ISSUED: "방문증이 발급됐어요.", RECOVERED: "이전에 발급된 방문증을 확인했어요."
});
const LIGHT = Object.freeze({ GRANTED: "green", OPENING: "green", READY_TO_ENTER: "green", SCANNING: "scan", CHECKING: "scan", PURCHASING: "scan" });

/** Context Action entry for the reader, by state. */
export function gateContextAction(view, { distance, trigger }) {
  const label = view.state === GATE_STATE.READY_TO_ENTER ? "정석 입장"
    : [GATE_STATE.NEEDS_PASS, GATE_STATE.EXPIRED, GATE_STATE.INSUFFICIENT_FUNDS].includes(view.state) ? "방문증 안내"
      : view.state === GATE_STATE.UNKNOWN ? "출입 다시 확인"
        : "학생증 태그";
  return { id: "jeongseok-gate", icon: view.state === GATE_STATE.READY_TO_ENTER ? "🚪" : "🎓", label,
    priority: 155, distance, pressed: view.busy, trigger };
}

export function gateMessage(view) {
  let text = GATE_MESSAGES[view.state] ?? GATE_MESSAGES.UNKNOWN;
  if (view.state === GATE_STATE.INSUFFICIENT_FUNDS && Number.isSafeInteger(view.offer?.shortfall))
    text = `인덕코인이 ${view.offer.shortfall}개 부족해요.`;
  if (view.state === GATE_STATE.DISABLED && view.decision === "COMING_SOON") text = "정석학술정보관 출입은 준비 중이에요.";
  if (view.state === GATE_STATE.GRANTED || view.state === GATE_STATE.OPENING)
    text = view.via === "INHA_MAIL" ? "인하대 이메일 인증 학생증 · 무료 출입 승인" : "가상 정석 방문증 · 출입 승인";
  const notice = ENTRY_NOTICES[view.notice] ?? (view.notice && PURCHASE_ERRORS[view.notice]);
  return notice && view.state !== GATE_STATE.INSUFFICIENT_FUNDS ? `${text} ${notice}` : text;
}

export function createJeongseokGatePanel({ doc = document } = {}) {
  const root = doc.createElement("section");
  root.id = "jeongseok-gate"; root.className = "jeongseok-gate"; root.hidden = true;
  root.setAttribute("aria-label", "정석학술정보관 가상 출입 리더기");
  const reader = doc.createElement("div"); reader.className = "jeongseok-gate-reader";
  const light = doc.createElement("span"); light.className = "jeongseok-gate-light"; light.setAttribute("aria-hidden", "true");
  const card = doc.createElement("span"); card.className = "jeongseok-gate-card"; card.setAttribute("aria-hidden", "true"); card.textContent = "🎓";
  reader.append(light, card);
  const title = doc.createElement("strong"); title.textContent = "정석학술정보관 출입";
  const status = doc.createElement("p"); status.className = "jeongseok-gate-status";
  status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const note = doc.createElement("small");
  note.textContent = "게임 전용 가상 리더기 · 실제 학생증·학교 출입과 무관 · 임시 위치";
  root.append(reader, title, status, note);
  doc.body.append(root);
  let near = false, last = "";
  function render(view) {
    root.hidden = !near && view.state === GATE_STATE.IDLE;
    root.dataset.state = view.state;
    root.dataset.light = LIGHT[view.state] ?? (view.state === GATE_STATE.IDLE ? "idle" : "red");
    card.textContent = view.via === "VISITOR_PASS" || [GATE_STATE.NEEDS_PASS, GATE_STATE.EXPIRED].includes(view.state) ? "🪪" : "🎓";
    const text = gateMessage(view);
    if (text !== last) { status.textContent = text; last = text; }
  }
  return { root, render,
    setNear(value, view) { near = value === true; render(view); },
    destroy() { root.remove(); } };
}

// Short procedural reader cues routed through worldAudio.playCue (its master volume / mute).
const TONES = Object.freeze({
  scan: [[880, .06]], grant: [[988, .09], [1319, .14]], deny: [[220, .22]], open: [[392, .12], [523, .16]]
});
export function createGateCues({ audio } = {}) {
  return name => {
    const tones = TONES[name];
    if (!tones || !audio?.playCue) return false;
    return audio.playCue((context, output) => {
      let at = context.currentTime;
      for (const [frequency, duration] of tones) {
        const osc = context.createOscillator(), gain = context.createGain();
        osc.type = name === "deny" ? "square" : "sine";
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(name === "deny" ? 0.05 : 0.08, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        osc.connect(gain); gain.connect(output);
        osc.onended = () => { osc.disconnect(); gain.disconnect(); };
        osc.start(at); osc.stop(at + duration + 0.02);
        at += duration + 0.03;
      }
    });
  };
}
