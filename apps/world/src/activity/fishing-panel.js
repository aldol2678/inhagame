// INHA WORLD · Inkyung fishing panel. Presentation only: the bite window, the result, the catch and
// the Fishing XP all come from the server through fishing-client.js. The client shows the server's
// own timing (its bite moment, estimated with the start round trip) and sends only HOOK / CANCEL;
// the server decides the outcome at receipt.

import { FISHING_CLIENT_STATE } from "./fishing-client.js";
import { getFishingSpot } from "./fishing-spots.js";

export const FISHING_TEXT = Object.freeze({
  title: "🎣 인경호 낚시",
  signedOut: "로그인한 INHAGAME 계정으로 낚시할 수 있어요.",
  unavailable: "지금은 낚시를 할 수 없어요.",
  checking: "낚시터를 준비하는 중…",
  cast: "🎣 낚싯대 던지기",
  castAgain: "🎣 다시 던지기",
  waiting: "찌를 지켜보는 중… 입질이 오면 당기세요.",
  bite: "입질이 왔어요! 지금 당기세요!",
  late: "찌가 잠잠해졌어요…",
  hook: "당기기",
  hookNow: "지금 당기기!",
  reel: "릴 감기",
  cancel: "그만두기",
  working: "처리하는 중…",
  settle: "보상 받기",
  hint: "Space · F 로도 당길 수 있어요."
});

const RESULT_TEXT = Object.freeze({
  CAUGHT: "🐟 붕어를 낚았어요!",
  PREMATURE_HOOK: "너무 일찍 당겼어요. 입질을 기다려 보세요.",
  MISSED_BITE: "입질을 놓쳤어요.",
  ATTEMPT_EXPIRED: "시간이 지나 낚싯대를 거뒀어요.",
  PLAYER_CANCELLED: "낚싯대를 거뒀어요."
});

const ERROR_TEXT = Object.freeze({
  FISHING_RATE_LIMITED: "잠시 후 다시 던질 수 있어요.",
  ATTEMPT_ALREADY_ACTIVE: "진행 중인 낚시가 있어요.",
  FISHING_UNAVAILABLE: "지금은 낚시를 할 수 없어요.",
  FISHING_DISABLED: "지금은 낚시를 할 수 없어요.",
  NETWORK: "연결이 불안정해요. 다시 시도해 주세요."
});

export const FISHING_PHASE = Object.freeze({
  IDLE: "IDLE", WAITING: "WAITING", BITE: "BITE", LATE: "LATE", RESULT: "RESULT"
});

/** Presentation phase of an attempt at an estimated server time. */
export function fishingPhase(attempt, serverNowMs) {
  if (!attempt) return FISHING_PHASE.IDLE;
  if (attempt.status !== "ACTIVE") return FISHING_PHASE.RESULT;
  if (serverNowMs < attempt.biteAtMs) return FISHING_PHASE.WAITING;
  if (serverNowMs < attempt.hookDeadlineMs) return FISHING_PHASE.BITE;
  return FISHING_PHASE.LATE;
}

export function fishingSkillLine(skill) {
  if (!skill) return null;
  return skill.nextLevelXp === null ? `낚시 Lv ${skill.level} · 최고 레벨 · XP ${skill.totalXp}`
    : `낚시 Lv ${skill.level} · XP ${skill.totalXp} / ${skill.nextLevelXp}`;
}

export function createFishingPanel({
  panel, fishing, onOpenChange = () => {}, onSettled = () => {}, doc = globalThis.document,
  setInterval: every = globalThis.setInterval?.bind(globalThis),
  clearInterval: stop = globalThis.clearInterval?.bind(globalThis)
} = {}) {
  if (!panel || !fishing) throw new Error("Fishing panel requires its panel and fishing client");

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (className, text, onClick, disabled = false) => {
    const node = el("button", className, text);
    node.type = "button";
    node.disabled = disabled;
    node.addEventListener("click", () => { if (!node.disabled) onClick(); });
    return node;
  };

  let open = false;
  let spot = null;
  let notice = null;
  let primary = null;
  let timer = null;
  let renderedPhase = null;

  function noticeFor(result) {
    if (!result?.error || result.outcome === "STALE" || result.outcome === "BUSY") return null;
    return ERROR_TEXT[result.error] ?? "낚시를 진행하지 못했어요. 다시 시도해 주세요.";
  }

  async function act(task) {
    notice = null;
    const result = await task();
    notice = noticeFor(result);
    if (result?.outcome === "SETTLED") onSettled(fishing.read);
    render();
    return result;
  }

  const cast = () => act(async () => {
    fishing.dismiss();
    return fishing.start((spot ?? getFishingSpot(fishing.attempt?.sourceRef))?.sourceRef);
  });
  const hook = () => act(() => fishing.hook());
  const cancel = () => act(() => fishing.cancel());
  const settle = () => act(() => fishing.refresh());

  function renderResult(body, attempt) {
    const reason = attempt.result?.reason;
    body.append(el("p", "fishing-result", RESULT_TEXT[reason] ?? reason ?? ""));
    if (attempt.status === "SUCCEEDED") {
      const read = fishing.read;
      const settled = read?.attempt?.attemptId === attempt.attemptId && read.settlement === "SETTLED";
      if (settled) {
        body.append(el("p", "fishing-reward",
          `+${attempt.result.catch.lifeXp} 낚시 XP · 붕어 ${read.carpQuantity}마리 보유`));
      } else {
        body.append(button("shop-retry fishing-settle", FISHING_TEXT.settle, () => void settle(), fishing.busy !== null));
      }
    }
    primary = button("shop-offer-buy fishing-cast", FISHING_TEXT.castAgain, () => void cast(), fishing.busy !== null);
    body.append(primary);
  }

  function renderActive(body, attempt, phase) {
    const text = phase === FISHING_PHASE.WAITING ? FISHING_TEXT.waiting
      : phase === FISHING_PHASE.BITE ? FISHING_TEXT.bite : FISHING_TEXT.late;
    const bobber = el("div", "fishing-bobber", phase === FISHING_PHASE.BITE ? "💦" : "🎐");
    bobber.dataset.phase = phase;
    body.append(bobber, el("p", "fishing-status", text));
    const label = phase === FISHING_PHASE.WAITING ? FISHING_TEXT.hook
      : phase === FISHING_PHASE.BITE ? FISHING_TEXT.hookNow : FISHING_TEXT.reel;
    const busy = fishing.busy !== null;
    primary = button("shop-offer-buy fishing-hook", busy ? FISHING_TEXT.working : label, () => void hook(), busy);
    body.append(primary, button("shop-retry fishing-cancel", FISHING_TEXT.cancel, () => void cancel(), busy),
      el("p", "shop-hint", FISHING_TEXT.hint));
  }

  function render() {
    if (!open) return;
    primary = null;
    const attempt = fishing.attempt;
    const phase = fishingPhase(attempt, fishing.serverNow());
    renderedPhase = phase;
    const head = el("div", "shop-panel-head");
    const titles = el("div", "shop-panel-titles");
    const title = el("h2", "", FISHING_TEXT.title);
    title.id = "fishing-title";
    titles.append(title);
    const where = getFishingSpot(attempt?.status === "ACTIVE" ? attempt.sourceRef : spot?.sourceRef);
    if (where) titles.append(el("p", "shop-panel-level", where.label));
    const close = el("button", "profile-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "낚시 닫기");
    close.addEventListener("click", () => setOpen(false));
    head.append(titles, close);

    const body = el("div", "shop-panel-body fishing-body");
    if (fishing.state === FISHING_CLIENT_STATE.SIGNED_OUT) body.append(el("p", "shop-empty", FISHING_TEXT.signedOut));
    else if (fishing.state === FISHING_CLIENT_STATE.CHECKING) body.append(el("p", "shop-empty", FISHING_TEXT.checking));
    else if (fishing.state !== FISHING_CLIENT_STATE.READY) body.append(el("p", "shop-empty", FISHING_TEXT.unavailable));
    else {
      const skillLine = fishingSkillLine(fishing.read?.skill);
      if (skillLine) body.append(el("p", "inventory-item-description fishing-skill", skillLine));
      if (phase === FISHING_PHASE.IDLE) {
        primary = button("shop-offer-buy fishing-cast", fishing.busy === "start" ? FISHING_TEXT.working : FISHING_TEXT.cast,
          () => void cast(), fishing.busy !== null || !spot);
        body.append(primary);
      } else if (phase === FISHING_PHASE.RESULT) renderResult(body, attempt);
      else renderActive(body, attempt, phase);
    }
    if (notice) body.append(el("p", "shop-hint fishing-notice", notice));
    panel.dataset.phase = phase;
    panel.dataset.state = fishing.state;
    panel.replaceChildren(head, body);
    primary?.focus?.();
    syncTimer();
  }

  // While an attempt is ACTIVE the phase follows the server's bite window; re-render only on change.
  function syncTimer() {
    const needed = open && fishing.attempt?.status === "ACTIVE";
    if (needed && timer === null && every) {
      timer = every(() => {
        if (fishingPhase(fishing.attempt, fishing.serverNow()) !== renderedPhase) render();
      }, 50);
    } else if (!needed && timer !== null) {
      stop?.(timer);
      timer = null;
    }
  }

  function setOpen(next, nextSpot = null) {
    const value = Boolean(next);
    if (value && nextSpot) spot = nextSpot;
    if (value === open) { if (open) render(); return open; }
    open = value;
    panel.hidden = !open;
    if (!open) {
      notice = null;
      syncTimer();
      panel.replaceChildren();
      onOpenChange(false);
      return false;
    }
    render();
    onOpenChange(true);
    // Opening re-reads the latest attempt (an active cast or an unsettled catch survives a reload).
    if (fishing.available) void fishing.refresh().then(result => {
      if (result?.outcome === "SETTLED") onSettled(fishing.read);
      render();
    });
    return true;
  }

  fishing.onChange(() => render());
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  doc.addEventListener("keydown", (event) => {
    if (!open) return;
    if (event.code === "Escape") { setOpen(false); return; }
    // A focused button activates natively on Space / Enter; F (and Space elsewhere) presses the primary one.
    const tag = event.target?.tagName;
    if ((event.code === "KeyF" || (event.code === "Space" && tag !== "BUTTON")) && !event.repeat &&
        primary && !primary.disabled && !["INPUT", "TEXTAREA", "SELECT"].includes(tag)) {
      event.preventDefault();
      primary.click();
    }
  });

  return {
    setOpen,
    render,
    get open() { return open; },
    get spot() { return spot; },
    status() {
      return { open, spot: spot?.sourceRef ?? null, phase: renderedPhase, notice };
    }
  };
}
