// INHA WORLD · 캠퍼스 출석부 panel (P1f). Presentation only: the month, today, the attended dates, the
// count and the milestones all come from the server status. The calendar is laid out from the server
// month (plain date arithmetic on that string, never the device clock). Only the explicit button claims.

import { ATTENDANCE_STATE } from "./attendance-client.js";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "2026-09" → "2026년 9월". */
export function monthLabel(month) {
  const [year, value] = month.split("-").map(Number);
  return `${year}년 ${value}월`;
}

/** Calendar cells for the server month: leading blanks, then 1..N with attended / today / future flags. */
export function calendarCells(snapshot) {
  const [year, month] = snapshot.month.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const attended = new Set(snapshot.attendedDates.map((d) => Number(d.slice(8, 10))));
  const today = Number(snapshot.rewardDate.slice(8, 10));
  const cells = Array.from({ length: first }, () => null);
  for (let day = 1; day <= days; day += 1) {
    cells.push(Object.freeze({ day, attended: attended.has(day), today: day === today, future: day > today }));
  }
  return cells;
}

export const ATTENDANCE_TEXT = Object.freeze({
  title: "📅 캠퍼스 출석부",
  claim: "오늘 출석하기",
  claiming: "출석하는 중…",
  done: "✅ 오늘 출석 완료",
  signedOut: "로그인한 INHAGAME 계정만 출석부를 사용할 수 있어요.",
  loading: "출석부를 불러오는 중…",
  unavailable: "출석부를 불러오지 못했어요.",
  retry: "다시 시도",
  failed: "출석을 저장하지 못했어요. 다시 시도해 주세요.",
  allDone: "이번 달 누적 보상을 모두 받았어요"
});

export function createAttendancePanel({ panel, attendance, onOpenChange = () => {}, doc = globalThis.document } = {}) {
  if (!panel || !attendance) throw new Error("Attendance panel requires its panel and attendance client");

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  let open = false;
  let closeButton = null;
  let notice = null;

  function renderSnapshot(body, s) {
    const summary = el("div", "inventory-item attendance-summary");
    if (s.claimedToday) {
      summary.append(el("strong", "inventory-item-name attendance-done", ATTENDANCE_TEXT.done));
      summary.append(el("p", "inventory-item-description", s.nextMilestone
        ? `다음 보상: ${s.nextMilestone.days}일 출석까지 ${s.nextMilestone.days - s.attendedDays}일`
        : ATTENDANCE_TEXT.allDone));
    } else {
      const rewards = el("ul", "attendance-rewards");
      rewards.append(el("li", "", `오늘 출석 🪙 +${s.dailyCoin}`));
      if (s.nextMilestone) rewards.append(el("li", "", `누적 ${s.nextMilestone.days}일 🪙 +${s.nextMilestone.bonusCoin}`));
      const button = el("button", "shop-offer-buy attendance-claim", attendance.pending ? ATTENDANCE_TEXT.claiming : ATTENDANCE_TEXT.claim);
      button.type = "button";
      button.disabled = attendance.pending;
      button.addEventListener("click", async () => {
        if (button.disabled) return;
        notice = null;
        const result = await attendance.claim();
        if (result.outcome === "FAILED" || result.outcome === "REFUSED") notice = ATTENDANCE_TEXT.failed;
        render();
      });
      summary.append(rewards, button);
    }
    body.append(summary);

    const steps = el("ul", "attendance-milestones");
    for (const m of s.milestones) {
      const row = el("li", `attendance-milestone${m.claimed ? " attendance-milestone-claimed" : ""}`);
      row.dataset.days = String(m.days);
      row.append(el("span", "", `${m.days}일`), el("span", "", m.claimed ? "✓" : "○"), el("span", "", `+${m.bonusCoin}`));
      steps.append(row);
    }
    body.append(steps);

    const grid = el("div", "attendance-calendar");
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", `${monthLabel(s.month)} 출석 달력`);
    for (const w of WEEKDAYS) grid.append(el("span", "attendance-weekday", w));
    for (const cell of calendarCells(s)) {
      if (!cell) { grid.append(el("span", "attendance-day attendance-blank", "")); continue; }
      const classes = ["attendance-day"];
      if (cell.attended) classes.push("attendance-stamped");
      if (cell.today) classes.push("attendance-today");
      if (cell.future) classes.push("attendance-future");
      const node = el("span", classes.join(" "), cell.attended ? "🐥" : String(cell.day));
      node.dataset.day = String(cell.day);
      node.setAttribute("aria-label", `${cell.day}일${cell.attended ? " 출석" : ""}`);
      grid.append(node);
    }
    body.append(grid);
  }

  function render() {
    if (!open) return;
    const snapshot = attendance.state === ATTENDANCE_STATE.READY ? attendance.snapshot : null;
    const head = el("div", "shop-panel-head");
    const titles = el("div", "shop-panel-titles");
    const title = el("h2", "", ATTENDANCE_TEXT.title);
    title.id = "attendance-panel-title";
    titles.append(title);
    if (snapshot) {
      titles.append(el("p", "shop-panel-level", monthLabel(snapshot.month)),
        el("p", "shop-panel-wallet attendance-count", `이번 달 ${snapshot.attendedDays}일 출석`));
    }
    closeButton = el("button", "profile-close", "×");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "출석부 닫기");
    closeButton.addEventListener("click", () => setOpen(false));
    head.append(titles, closeButton);

    const body = el("div", "shop-panel-body attendance-body");
    if (attendance.state === ATTENDANCE_STATE.SIGNED_OUT) body.append(el("p", "shop-empty", ATTENDANCE_TEXT.signedOut));
    else if (attendance.state === ATTENDANCE_STATE.LOADING) body.append(el("p", "shop-empty", ATTENDANCE_TEXT.loading));
    else if (!snapshot) {
      const retry = el("button", "shop-retry", ATTENDANCE_TEXT.retry);
      retry.type = "button";
      retry.addEventListener("click", () => void attendance.refresh("retry"));
      body.append(el("p", "shop-empty", ATTENDANCE_TEXT.unavailable), retry);
    } else renderSnapshot(body, snapshot);
    if (notice) body.append(el("p", "shop-hint", notice));
    panel.dataset.state = attendance.state;
    panel.dataset.claimed = snapshot ? String(snapshot.claimedToday) : "";
    panel.replaceChildren(head, body);
  }

  function setOpen(next) {
    const value = Boolean(next);
    if (value === open) return open;
    open = value;
    panel.hidden = !open;
    if (!open) {
      notice = null;
      panel.replaceChildren();
      onOpenChange(false);
      return false;
    }
    render();
    onOpenChange(true);
    closeButton?.focus?.();
    // Opening re-reads the status; it never claims.
    if (attendance.accountId) void attendance.refresh("open");
    return true;
  }

  attendance.onChange(() => render());
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  doc.addEventListener("keydown", (event) => {
    if (open && event.code === "Escape") setOpen(false);
  });

  return {
    setOpen,
    render,
    get open() { return open; },
    status() { return { open, state: attendance.state, claimedToday: attendance.snapshot?.claimedToday ?? null }; }
  };
}
