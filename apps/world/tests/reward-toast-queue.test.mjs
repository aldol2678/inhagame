// INHA WORLD Progression UX P1c0 · reward toast FIFO queue and LEVEL UP ordering.
// A deterministic fake clock drives the real createToastQueue / createStatusAfterReward /
// createMcm2026EventUi code; nothing here touches progression, reward or wallet state.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TOAST_QUEUE_GAP_MS, createToastQueue, createStatusAfterReward, createMcm2026EventUi,
  rewardToastMessage, shortMcm2026ChipLabel
} from "../src/events/zombie-university-2026/event-ui.js";
import { MCM_2026_PHASE } from "../src/events/zombie-university-2026/event-phase.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

function fakeClock() {
  let now = 0, seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimer(fn, ms) { const id = ++seq; timers.set(id, { at: now + Math.max(0, ms), fn, seq: id }); return id; },
    clearTimer(id) { timers.delete(id); },
    get pending() { return timers.size; },
    /** Advance to `to`, firing timers in time order (FIFO for equal times). */
    advance(ms) {
      const to = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= to).sort((a, b) => a[1].at - b[1].at || a[1].seq - b[1].seq)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].at; next[1].fn();
      }
      now = to;
    }
  };
}
function lane() {
  const clock = fakeClock();
  const element = { hidden: true, textContent: "" };
  const log = [];
  const watch = () => log.push([clock.now(), element.hidden ? null : element.textContent]);
  const queue = createToastQueue({ element, setTimer: (fn, ms) => clock.setTimer(() => { fn(); watch(); }, ms), clearTimer: clock.clearTimer, now: clock.now });
  const say = (text, ms) => { queue.say(text, ms); watch(); };
  return { clock, element, queue, say, log };
}
const G = TOAST_QUEUE_GAP_MS;

test("gap is 150 ms", () => assert.equal(G, 150));

test("1. idle say shows immediately", () => {
  const { element, say } = lane();
  say("A", 4500);
  assert.deepEqual([element.hidden, element.textContent], [false, "A"]);
});

test("2-3. a second say keeps the first on screen; the second follows after the gap", () => {
  const { clock, element, say } = lane();
  say("A", 4500);
  clock.advance(60);
  say("B", 4500);
  assert.equal(element.textContent, "A", "not overwritten");
  clock.advance(4440 - 1);
  assert.deepEqual([element.hidden, element.textContent], [false, "A"], "A keeps its whole 4.5 s");
  clock.advance(1);
  assert.equal(element.hidden, true, "A ends at 4.5 s");
  clock.advance(G - 1);
  assert.equal(element.hidden, true, "gap");
  clock.advance(1);
  assert.deepEqual([element.hidden, element.textContent], [false, "B"]);
});

test("4-6. three toasts: FIFO order, each keeps its duration, gaps between", () => {
  const { clock, say, log } = lane();
  say("A", 4500); say("B", 3200); say("C", 4500);
  clock.advance(20000);
  const shown = log.filter(([, t]) => t !== null).filter((e, i, a) => i === 0 || e[1] !== a[i - 1][1]);
  const hidden = log.filter(([, t]) => t === null).map(([at]) => at);
  assert.deepEqual(shown, [[0, "A"], [4500 + G, "B"], [4500 + G + 3200 + G, "C"]]);
  assert.deepEqual(hidden, [4500, 4500 + G + 3200, 4500 + G + 3200 + G + 4500]);
});

test("identical messages are not merged", () => {
  const { clock, say, log } = lane();
  say("🎁 보상 획득\n+50 EXP", 4500); say("🎁 보상 획득\n+50 EXP", 4500);
  clock.advance(10000);
  const appearances = log.filter(([, t], i) => t !== null && (i === 0 || log[i - 1][1] === null));
  assert.equal(appearances.length, 2, "shown twice, separated by a hide and a gap");
});

test("toast onShow fires when that queued toast actually becomes visible", () => {
  const clock = fakeClock();
  const element = { hidden: true, textContent: "" };
  const shown = [];
  const queue = createToastQueue({
    element,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now
  });
  queue.say("A", 1000, () => shown.push([clock.now(), "A"]));
  queue.say("B", 1000, () => shown.push([clock.now(), "B"]));
  assert.deepEqual(shown, [[0, "A"]], "queued B is not observed before it is visible");
  clock.advance(1000 + G - 1);
  assert.deepEqual(shown, [[0, "A"]]);
  clock.advance(1);
  assert.deepEqual(shown, [[0, "A"], [1000 + G, "B"]]);
});

test("7-8. remainingMs covers the current toast, every queued toast and the gaps; grows on enqueue", () => {
  const { clock, queue, say } = lane();
  assert.equal(queue.remainingMs(), 0, "idle");
  say("A", 4500);
  assert.equal(queue.remainingMs(), 4500);
  clock.advance(1000);
  assert.equal(queue.remainingMs(), 3500);
  say("B", 3200);
  assert.equal(queue.remainingMs(), 3500 + G + 3200);
  say("C", 4500);
  assert.equal(queue.remainingMs(), 3500 + G + 3200 + G + 4500);
  clock.advance(3500 + 50); // inside the A→B gap
  assert.equal(queue.remainingMs(), (G - 50) + 3200 + G + 4500);
  clock.advance(100000);
  assert.equal(queue.remainingMs(), 0, "idle again");
});

test("9. destroy clears the timer and the queue; nothing shows afterwards", () => {
  const { clock, element, queue, say } = lane();
  say("A", 4500); say("B", 4500);
  queue.destroy();
  assert.deepEqual([element.hidden, clock.pending, queue.remainingMs(), queue.length], [true, 0, 0, 0]);
  say("C", 4500);
  clock.advance(20000);
  assert.equal(element.hidden, true, "no toast after destroy");
  // Destroy during the gap as well.
  const other = lane();
  other.say("A", 1000); other.say("B", 1000);
  other.clock.advance(1000 + 10);
  other.queue.destroy();
  other.clock.advance(5000);
  assert.equal(other.element.hidden, true);
});

test("10-12. PREVIEW, REWARD_FAILED and ALREADY_CLAIMED results queue in order with their own durations", () => {
  const { clock, say, log } = lane();
  const results = [
    { status: "PREVIEW", rewardResult: { entries: [] } },
    { status: "REWARD_FAILED", rewardResult: { entries: [] } },
    { status: "ALREADY_CLAIMED", replayed: true, rewardResult: { entries: [{ grantType: "EXP", targetId: "exp.campus", requested: 50, granted: 50, status: "GRANTED" }] } },
    { status: "CLAIMED", rewardResult: { entries: [{ grantType: "EXP", targetId: "exp.campus", requested: 150, granted: 150, status: "GRANTED" }] } }
  ];
  for (const r of results) { const m = rewardToastMessage(r); say(m.text, m.ms); }
  clock.advance(30000);
  const starts = log.filter(([, t]) => t !== null).filter((e, i, a) => i === 0 || e[1] !== a[i - 1][1]);
  assert.deepEqual(starts.map(([, t]) => t.split("\n")[0]),
    ["🧪 QA PREVIEW · 실제 보상은 지급되지 않습니다.", "보상 정산에 실패했어요. 완료 기록은 보존됐으며 다시 시도할 수 있습니다.", "이미 정산된 보상입니다", "🎁 보상 획득"]);
  assert.deepEqual(starts.map(([at]) => at), [0, 3200 + G, 3200 + G + 3200 + G, 3200 + G + 3200 + G + 4500 + G]);
});

test("race: Reward A → LEVEL UP deferred → Reward B enqueued 60 ms later → A, B, then LEVEL UP", () => {
  const { clock, queue, say, log } = lane();
  const statuses = [];
  const showAfter = createStatusAfterReward({ remainingMs: queue.remainingMs, show: (m) => statuses.push([clock.now(), m]),
    setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  say("A · +50 EXP", 4500);           // t=0 landlord
  showAfter("LEVEL UP · Lv.2");       // t≈0 the progression re-read already rose the Level
  clock.advance(60);
  say("B · +150 EXP", 4500);          // t=60 main clear queued after the status wait was computed
  clock.advance(20000);
  const bStart = log.find(([, t]) => t === "B · +150 EXP")[0];
  const bEnd = log.filter(([, t]) => t === null).map(([at]) => at).at(-1);
  assert.deepEqual([bStart, bEnd], [4500 + G, 4500 + G + 4500]);
  assert.equal(statuses.length, 1);
  assert.ok(statuses[0][0] >= bEnd, `LEVEL UP at ${statuses[0][0]} after B ends at ${bEnd}`);
  assert.equal(statuses[0][0], bEnd + G, "LEVEL UP 150 ms after the last reward toast");
});

test("status: idle lane shows at once; a newer deferred status replaces an older unsent one", () => {
  const { clock, queue, say } = lane();
  const statuses = [];
  const showAfter = createStatusAfterReward({ remainingMs: queue.remainingMs, show: (m) => statuses.push([clock.now(), m]),
    setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  showAfter("now");
  assert.deepEqual(statuses, [[0, "now"]]);
  say("A", 4500);
  showAfter("LEVEL UP · Lv.2");
  clock.advance(100);
  showAfter("LEVEL UP · Lv.3");
  clock.advance(10000);
  assert.deepEqual(statuses.slice(1), [[4500 + G, "LEVEL UP · Lv.3"]], "no stale Lv.2 at a strange time");
});

function stubDocument() {
  const made = [];
  const element = (tag) => {
    const children = new Map();
    const el = { tagName: tag, hidden: false, textContent: "", className: "", id: "", style: {}, dataset: {}, innerHTML: "", removed: false,
      setAttribute() {}, addEventListener() {}, append(...nodes) { made.push(...nodes); }, appendChild(node) { made.push(node); },
      remove() { el.removed = true; },
      querySelector(sel) { if (!children.has(sel)) children.set(sel, element("q")); return children.get(sel); } };
    return el;
  };
  const head = element("head"), body = element("body");
  return { made, head, body, createElement: element, getElementById: () => null };
}

test("event UI: showReward queues consecutive rewards on the one toast; destroy leaves nothing scheduled", () => {
  const doc = stubDocument();
  const client = { state: null, preview: false, phase: () => "PRELUDE", presentationNow: () => Date.parse("2026-09-01T00:00:00Z"), onChange: () => () => {} };
  const ui = createMcm2026EventUi({ client, doc });
  const toasts = doc.made.filter((el) => el.className === "mcm26-toast");
  assert.equal(toasts.length, 1, "one toast element");
  const exp = (n) => ({ status: "CLAIMED", rewardResult: { entries: [{ grantType: "EXP", targetId: "exp.campus", requested: n, granted: n, status: "GRANTED" }] } });
  ui.showReward(exp(50));
  ui.showReward(exp(150));
  assert.equal(toasts[0].textContent, "🎁 보상 획득\n+50 EXP", "the second reward does not overwrite the first");
  const remaining = ui.toastRemainingMs();
  assert.ok(remaining > 4500 + TOAST_QUEUE_GAP_MS + 4000 && remaining <= 4500 + TOAST_QUEUE_GAP_MS + 4500, `remaining ${remaining}`);
  assert.equal(doc.made.filter((el) => el.className === "mcm26-toast").length, 1, "still one toast element");
  ui.destroy();
  assert.deepEqual([ui.toastRemainingMs(), toasts[0].hidden, toasts[0].removed], [0, true, true]);
});

test("ended event UI retires the production chip and modal while preview stays inspectable", () => {
  const prodDoc = stubDocument();
  const endedClient = {
    state: { eventState: "ENDED", progress: { stage: "COMPLETED" } },
    preview: false,
    phase: () => MCM_2026_PHASE.ENDED,
    presentationNow: () => Date.parse("2026-10-02T00:00:00+09:00"),
    onChange: () => () => {}
  };
  const prodUi = createMcm2026EventUi({ client: endedClient, doc: prodDoc });
  const prodChip = prodDoc.made.find((el) => el.className === "mcm26-chip");
  const prodModal = prodDoc.made.find((el) => el.className === "mcm26-modal");
  assert.equal(prodChip.hidden, true, "ended production chip is retired");
  assert.equal(prodModal.hidden, true, "ended production modal stays closed");
  assert.equal(prodUi.openInfo(), false, "ended production modal cannot be reopened");
  prodUi.destroy();

  const previewDoc = stubDocument();
  const previewUi = createMcm2026EventUi({ client: { ...endedClient, preview: true }, doc: previewDoc });
  assert.equal(previewDoc.made.find((el) => el.className === "mcm26-chip").hidden, false, "QA preview remains inspectable");
  assert.equal(previewUi.openInfo(), true);
  previewUi.destroy();
});

test("authority untouched: the queue code holds no progression, reward or wallet access", () => {
  const ui = readFileSync(new URL("../src/events/zombie-university-2026/event-ui.js", import.meta.url), "utf8");
  const queue = ui.slice(ui.indexOf("export function createToastQueue"), ui.indexOf("function ensureStyle"));
  assert.doesNotMatch(queue, /progression|wallet|inventory|rpc\(|totalExp|\.level\b/);
});

test("mobile CSS: status and reward toast sit above the social cluster / transport on phones", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf("@media (pointer: coarse) and (max-width: 560px) {\n  .follow-status"));
  assert.match(block, /\.follow-status \{ bottom: max\(212px, calc\(env\(safe-area-inset-bottom\) \+ 184px\)\); \}/);
  assert.match(block, /body:has\(#transport-action:not\(\[hidden\]\)\) \.follow-status \{\s*bottom: max\(286px/);
  assert.match(block, /body\[data-movement-state="MOUNT_FLIGHT"\]:has\(#transport-action:not\(\[hidden\]\)\) \.follow-status \{\s*bottom: max\(374px/);
  assert.doesNotMatch(css, /joystick-large/, "one fixed joystick size");
  const ui = readFileSync(new URL("../src/events/zombie-university-2026/event-ui.js", import.meta.url), "utf8");
  assert.match(ui, /@media\(max-width:560px\)\{\.mcm26-toast\{bottom:max\(212px[^}]*\}body:has\(#transport-action:not\(\[hidden\]\)\) \.mcm26-toast\{bottom:max\(286px/);
  assert.match(ui, /body\[data-movement-state="MOUNT_FLIGHT"\]:has\(#transport-action:not\(\[hidden\]\)\) \.mcm26-toast\{bottom:max\(374px/);
  assert.match(ui, /@media\(max-width:420px\) and \(pointer:coarse\)\{\.mcm26-toast\{bottom:max\(262px/);
  assert.match(ui, /@media\(max-width:420px\)[\s\S]*body\[data-movement-state="MOUNT_FLIGHT"\]:has\(#transport-action:not\(\[hidden\]\)\) \.mcm26-toast\{bottom:max\(340px/);
  assert.doesNotMatch(ui, /joystick-large/);
});


test("mobile event chip keeps phase/status legible in a compact rail badge", () => {
  const P = MCM_2026_PHASE;
  assert.equal(shortMcm2026ChipLabel(P.PRELUDE, null, "1"), "🧟 D-1");
  assert.equal(shortMcm2026ChipLabel(P.WARNING, null, "0"), "⚠️ 00:00");
  assert.equal(shortMcm2026ChipLabel(P.OUTBREAK, { stage: "STARTED", investigated: ["a", "b"] }, "0"), "🧟 2/3");
  assert.equal(shortMcm2026ChipLabel(P.OUTBREAK, { stage: "VENUE_UNLOCKED" }, "0"), "🧟 건물주");
  assert.equal(shortMcm2026ChipLabel(P.OUTBREAK, { stage: "COMPLETED" }, "0"), "🧟 완료");
  assert.equal(shortMcm2026ChipLabel(P.ONSITE_LIVE, null, "0"), "🔴 LIVE");
  assert.equal(shortMcm2026ChipLabel(P.ENDED, null, "0"), "⚫ 종료");
});
