// INHA WORLD · Campus Daily Quiz panel (P1e). Presentation only: it renders the server state from the
// daily quiz client and forwards "start" and the picked option. The reward lines come from the server
// reward preview; correctness comes from the server's lastAnswer. No RPC, date or scoring here.

import { DAILY_QUIZ_STATE, DAILY_QUIZ_STATUS } from "./daily-quiz-client.js";

const formatCount = (value) => Number(value).toLocaleString("en-US");

/** Reward lines from the server preview: 🪙 N 인덕코인 / ✨ N EXP (or "+N …" once earned). */
export function rewardLines(preview, { earned = false } = {}) {
  return (preview ?? []).map((entry) => {
    const amount = formatCount(entry.amount);
    if (entry.grantType === "CURRENCY") return earned ? `+${amount} 인덕코인` : `🪙 ${amount} 인덕코인`;
    if (entry.grantType === "EXP") return earned ? `+${amount} EXP` : `✨ ${amount} EXP`;
    return null;
  }).filter(Boolean);
}

export const DAILY_QUIZ_TEXT = Object.freeze({
  title: "📚 오늘의 캠퍼스 퀴즈",
  intro: "오늘의 퀴즈",
  rule: "3문제 중 2개 정답 시 보상",
  start: "퀴즈 시작",
  correct: "정답이에요!",
  wrong: "아쉽지만 오답이에요.",
  passed: "오늘의 퀴즈 완료!",
  failed: "오늘의 퀴즈 종료",
  tomorrow: "내일 다시 도전할 수 있어요",
  signedOut: "로그인한 INHAGAME 계정만 오늘의 퀴즈에 참여할 수 있어요.",
  loading: "오늘의 퀴즈를 불러오는 중…",
  unavailable: "오늘의 퀴즈를 불러오지 못했어요.",
  retry: "다시 시도",
  refused: "이미 처리된 답이에요. 최신 상태로 다시 불러왔어요.",
  failedWrite: "답을 저장하지 못했어요. 다시 시도해 주세요."
});

export function createDailyQuizPanel({ panel, quiz, onOpenChange = () => {}, doc = globalThis.document } = {}) {
  if (!panel || !quiz) throw new Error("Daily quiz panel requires its panel and quiz client");

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  let open = false;
  let closeButton = null;
  let bodyElement = null;
  let opener = null;
  let renderedAccount = quiz.accountId;
  let renderedView = null;
  const focusTargets = new Map();
  let notice = null;
  let noticeEpoch = 0;
  let accountId = quiz.accountId;

  // Pending controls remain disabled. A temporary, non-Tab-stop anchor preserves their
  // semantic identity until the same action is available again (as in the wardrobe panel).
  function trackAction(control, key, anchor = control) {
    control.dataset.focusKey = key;
    if (anchor !== control) anchor.tabIndex = -1;
    focusTargets.set(key, { control, anchor });
    return control;
  }

  function button(text, className, onClick, { disabled = false } = {}) {
    const node = el("button", className, text);
    node.type = "button";
    node.disabled = disabled;
    node.addEventListener("click", () => { if (!node.disabled) onClick(); });
    return node;
  }

  async function run(action) {
    notice = null;
    const epoch = ++noticeEpoch;
    const { rewardDate, runId } = quiz.snapshot ?? {};
    const result = await action();
    if (!open || epoch !== noticeEpoch) return;
    if (result.outcome === "REFUSED") notice = { text: DAILY_QUIZ_TEXT.refused };
    else if (result.outcome === "FAILED") notice = { text: DAILY_QUIZ_TEXT.failedWrite, rewardDate, runId };
    render();
  }

  function renderQuiz(body, snapshot) {
    const busy = quiz.pending;
    const last = snapshot.lastAnswer;
    if (last) {
      body.append(el("p", `daily-quiz-feedback ${last.correct ? "daily-quiz-correct" : "daily-quiz-wrong"}`,
        last.correct ? DAILY_QUIZ_TEXT.correct : DAILY_QUIZ_TEXT.wrong));
    }
    if (snapshot.status === DAILY_QUIZ_STATUS.AVAILABLE) {
      const card = el("div", "inventory-item daily-quiz-card");
      card.append(el("strong", "inventory-item-name", DAILY_QUIZ_TEXT.intro),
        el("p", "inventory-item-description", DAILY_QUIZ_TEXT.rule));
      const rewards = el("ul", "daily-quiz-rewards");
      rewards.append(...rewardLines(snapshot.rewardPreview).map((line) => el("li", "", line)));
      card.append(rewards);
      body.append(card, trackAction(button(busy ? "시작하는 중…" : DAILY_QUIZ_TEXT.start, "shop-offer-buy daily-quiz-start",
        () => run(() => quiz.start()), { disabled: busy }), `start:${snapshot.rewardDate}`, card));
      return;
    }
    if (snapshot.status === DAILY_QUIZ_STATUS.ACTIVE) {
      const q = snapshot.question;
      const card = el("div", "inventory-item daily-quiz-card");
      card.dataset.questionId = q.questionId;
      card.append(el("span", "daily-quiz-step", `문제 ${q.index + 1} / ${snapshot.progress.total}`),
        el("p", "daily-quiz-prompt", q.prompt));
      const options = el("div", "daily-quiz-options");
      q.options.forEach((option, index) => {
        const node = button(option, "shop-offer-buy daily-quiz-option", () => run(() => quiz.answer(index)), { disabled: busy });
        node.dataset.index = String(index);
        options.append(trackAction(node, `answer:${snapshot.rewardDate}:${snapshot.runId}:${q.questionId}:${index}`, card));
      });
      card.append(options);
      body.append(card);
      return;
    }
    const passed = snapshot.status === DAILY_QUIZ_STATUS.PASSED;
    const card = el("div", `inventory-item daily-quiz-card daily-quiz-${passed ? "passed" : "failed"}`);
    card.append(el("strong", "inventory-item-name", passed ? DAILY_QUIZ_TEXT.passed : DAILY_QUIZ_TEXT.failed),
      el("p", "inventory-item-description", `${snapshot.progress.correct} / ${snapshot.progress.total} 정답`));
    if (passed) {
      const rewards = el("ul", "daily-quiz-rewards");
      rewards.append(...rewardLines(snapshot.rewardPreview, { earned: true }).map((line) => el("li", "", line)));
      card.append(rewards);
    }
    card.append(el("p", "inventory-item-description", DAILY_QUIZ_TEXT.tomorrow));
    body.append(card);
  }

  function render() {
    if (!open) return;
    const snapshot = quiz.state === DAILY_QUIZ_STATE.READY ? quiz.snapshot : null;
    const hadFocus = panel.contains?.(doc.activeElement) ?? false;
    const accountChanged = renderedAccount !== quiz.accountId;
    const focusKey = !accountChanged && hadFocus ? doc.activeElement?.dataset?.focusKey : null;
    const view = JSON.stringify([snapshot?.rewardDate, snapshot?.runId, snapshot?.question?.questionId]);
    const resetScroll = accountChanged || view !== renderedView;
    const scrollTop = resetScroll ? 0 : bodyElement?.scrollTop ?? 0;
    const scrollLeft = resetScroll ? 0 : bodyElement?.scrollLeft ?? 0;
    const panelScrollTop = resetScroll ? 0 : panel.scrollTop ?? 0;
    const panelScrollLeft = resetScroll ? 0 : panel.scrollLeft ?? 0;
    renderedAccount = quiz.accountId;
    renderedView = view;
    focusTargets.clear();
    // A trusted terminal readback may precede the awaited failed-write outcome.
    // Only that run's failure hint is obsolete; other notices remain meaningful.
    if (notice?.text === DAILY_QUIZ_TEXT.failedWrite && snapshot?.rewardDate === notice.rewardDate && snapshot?.runId === notice.runId &&
        (snapshot?.status === DAILY_QUIZ_STATUS.PASSED || snapshot?.status === DAILY_QUIZ_STATUS.FAILED)) notice = null;
    const head = el("div", "shop-panel-head");
    const titles = el("div", "shop-panel-titles");
    const title = el("h2", "", DAILY_QUIZ_TEXT.title);
    title.id = "daily-quiz-panel-title";
    titles.append(title);
    closeButton = el("button", "profile-close", "×");
    closeButton.type = "button";
    trackAction(closeButton, "close");
    closeButton.setAttribute("aria-label", "오늘의 퀴즈 닫기");
    closeButton.addEventListener("click", () => setOpen(false));
    head.append(titles, closeButton);

    const body = el("div", "shop-panel-body daily-quiz-body");
    if (quiz.state === DAILY_QUIZ_STATE.SIGNED_OUT) {
      body.append(el("p", "shop-empty", DAILY_QUIZ_TEXT.signedOut));
    } else if (quiz.state === DAILY_QUIZ_STATE.LOADING) {
      body.append(el("p", "shop-empty", DAILY_QUIZ_TEXT.loading));
    } else if (!snapshot) {
      body.append(el("p", "shop-empty", DAILY_QUIZ_TEXT.unavailable),
        trackAction(button(DAILY_QUIZ_TEXT.retry, "shop-retry", () => void quiz.refresh("retry")), "retry"));
    } else {
      renderQuiz(body, snapshot);
    }
    if (notice) body.append(el("p", "shop-hint", notice.text));
    panel.dataset.state = quiz.state;
    panel.dataset.quiz = snapshot?.status ?? "";
    panel.replaceChildren(head, body);
    bodyElement = body;
    // Only restore focus owned by this panel at render time. A new question/day/account or a
    // removed control falls back to Close, never to an unrelated answer with the same index.
    if (hadFocus) {
      const action = focusTargets.get(focusKey);
      const target = action ? (action.control.disabled ? action.anchor : action.control) : closeButton;
      if (action) target.dataset.focusKey = focusKey;
      target.focus?.({ preventScroll: true });
    }
    body.scrollTop = scrollTop;
    body.scrollLeft = scrollLeft;
    panel.scrollTop = panelScrollTop;
    panel.scrollLeft = panelScrollLeft;
  }

  function setOpen(next) {
    const value = Boolean(next);
    if (value === open) return open;
    const focused = doc.activeElement;
    const restoreOpener = !value && (panel.contains?.(focused) ?? false);
    if (value) opener = focused;
    noticeEpoch += 1;
    open = value;
    panel.hidden = !open;
    if (!open) {
      notice = null;
      panel.replaceChildren();
      bodyElement = null;
      panel.scrollTop = 0;
      panel.scrollLeft = 0;
      focusTargets.clear();
      onOpenChange(false);
      // Respect an explicit focus handoff performed by the close callback.
      if (restoreOpener && (!doc.activeElement || doc.activeElement === doc.body || doc.activeElement === focused)
        && opener?.isConnected !== false && !opener?.disabled && !opener?.closest?.("[hidden], [inert]")) {
        opener?.focus?.({ preventScroll: true });
      }
      opener = null;
      return false;
    }
    render();
    onOpenChange(true);
    closeButton?.focus?.();
    if (quiz.accountId) void quiz.refresh("open");
    return true;
  }

  quiz.onChange(() => {
    if (accountId !== quiz.accountId) {
      accountId = quiz.accountId;
      noticeEpoch += 1;
      notice = null;
    }
    render();
  });
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  doc.addEventListener("keydown", (event) => {
    if (open && event.code === "Escape") setOpen(false);
  });

  return {
    setOpen,
    render,
    get open() { return open; },
    status() { return { open, state: quiz.state, quiz: quiz.snapshot?.status ?? null }; }
  };
}
