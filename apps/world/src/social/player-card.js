// Compact, read-only Player Inspect card. DOM only; relationship rules live in the database and
// SocialClient. The target is resolved from the trusted remote-player model by session id —
// never from nickname or DOM text. Text is always rendered with textContent.
// Follow (S1-C2) and the Personal Room visit (S1-D2) are injected: the card only asks whether each
// action is available and reports the choice; FollowController / the room visit controller own the
// state, and the server decides whether a room may be visited. Not included on purpose: profile
// editing (own profile → /profile/).

import { AVATARS, REPORT_CATEGORIES, Relationship, SocialError } from "./social-client.js";
import { ACCOMPANY_POIS } from "./accompany-client.js";

export const REPORT_LABELS = Object.freeze({
  spam: "스팸", harassment: "괴롭힘", inappropriate_name: "부적절한 닉네임", other: "기타"
});

const STATE_TEXT = Object.freeze({
  none: "", outgoing: "친구 요청을 보냈어요.", incoming: "친구 요청을 받았어요.", friends: "친구예요.",
  blocked_by_me: "차단한 사용자예요.", unavailable: "지금은 이 사용자와 상호작용할 수 없어요."
});

const ERROR_TEXT = Object.freeze({
  NOT_ALLOWED: "지금은 할 수 없는 요청이에요.", TARGET_UNAVAILABLE: "지금은 이 사용자와 상호작용할 수 없어요.",
  RATE_LIMITED: "신고가 너무 많아요. 잠시 후 다시 시도해 주세요.", SIGNED_OUT: "로그인이 필요해요.",
  SOCIAL_RESTRICTED: "운영 조치로 월드 상호작용 기능이 일시 제한되어 있어요.",
  ALREADY_BUSY: "이미 진행 중인 동행 제안이 있어요.",
  INVALID_DESTINATION: "이 목적지는 함께 갈 수 없어요.",
  FAILED: "잠시 후 다시 시도해 주세요."
});

export const FOLLOW_LABELS = Object.freeze({
  start: "👣 친구 따라가기", stop: "■ 따라가기 중지", switch: "👣 이 친구 따라가기"
});

export const ROOM_VISIT_LABEL = "🏠 방 방문";

const FOLLOW_BLOCKED_TEXT = Object.freeze({
  mounted: "탈것에서 내린 뒤 같이 갈 수 있어요.",
  not_present: "지금은 같이 갈 수 없어요.",
  other_zone: "같은 장소에 있을 때 같이 갈 수 있어요."
});

export function createPlayerCard({ panel, social, getRemote, getSelfUserId, getPlaceZoneId = () => null,
  onRelationshipChange = () => {}, onOpenChange = () => {}, onMessage = null, doc = document,
  accompany = null,
  // { canVisit(userId) → { ok, reason }, onVisit(userId, displayName) → Promise<{ ok, reason }>, reasonText(reason) }
  roomVisit = null,
  follow = { canFollow: () => ({ ok: false, reason: "unsupported" }), isFollowing: () => false, isFollowingAnyone: () => false,
    onFollow: () => false, onStopFollow: () => false } }) {
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  let current = null; // { sessionId, userId, card, reporting }
  let epoch = 0;

  function close() {
    if (!current) return false;
    epoch += 1;
    current = null;
    panel.hidden = true;
    panel.replaceChildren();
    onOpenChange(false);
    return true;
  }

  function button(label, onClick, className = "") {
    const b = el("button", className, label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function render(hint = "") {
    panel.replaceChildren();
    if (!current) return;
    const { card, displayName } = current;
    const head = el("div", "player-card-head");
    head.append(el("span", "player-card-avatar", AVATARS[card?.avatar ?? "classic"] ?? AVATARS.classic));
    const names = el("div", "player-card-names");
    names.append(el("strong", "player-card-nickname", card?.available ? card.nickname : displayName));
    if (card?.available && card.inhaVerified) names.append(el("span", "player-card-verified", "✓ 인하대"));
    if (card?.available && card.title) names.append(el("span", "player-card-title", card.title));
    head.append(names);
    const closeButton = button("×", close, "player-card-close");
    closeButton.setAttribute("aria-label", "닫기");
    panel.append(closeButton, head);

    const state = card?.relationship ?? null;
    const status = el("p", "player-card-status", card ? STATE_TEXT[state] ?? "" : "불러오는 중…");
    status.setAttribute("role", "status");
    panel.append(status);
    const actions = el("div", "player-card-actions");
    const act = (label, op) => button(label, () => run(op));
    if (state === Relationship.NONE) actions.append(act("+ 친구 요청", "request"));
    if (state === Relationship.OUTGOING) actions.append(act("요청 취소", "cancel"));
    if (state === Relationship.INCOMING) actions.append(act("수락", "accept"), act("거절", "reject"));
    if (state === Relationship.FRIENDS) {
      if (accompany) {
        const proposal = button("📍 함께 가기 제안", () => { current.proposing = !current.proposing; render(); }, "player-card-accompany");
        proposal.disabled = !accompany.canPropose(current.userId);
        actions.append(proposal);
      }
      // The ordinary one-sided follow remains separate from an accepted trip.
      if (!accompany?.isActive?.()) {
        const target = current.userId;
        if (follow.isFollowing(target)) {
          actions.append(button(FOLLOW_LABELS.stop, () => { follow.onStopFollow(target); render(); }, "player-card-follow"));
        } else {
          const verdict = follow.canFollow(target) ?? { ok: false };
          const label = follow.isFollowingAnyone() ? FOLLOW_LABELS.switch : FOLLOW_LABELS.start;
          const b = button(label, () => {
            const result = follow.onFollow(target);
            if (result?.ok) close(); else render(FOLLOW_BLOCKED_TEXT[result?.reason] ?? "");
          }, "player-card-follow");
          if (!verdict.ok && FOLLOW_BLOCKED_TEXT[verdict.reason]) {
            b.disabled = true;
            b.title = FOLLOW_BLOCKED_TEXT[verdict.reason];
          }
          actions.append(b);
        }
      }
      if (roomVisit) {
        const target = current.userId;
        const verdict = roomVisit.canVisit(target) ?? { ok: false };
        const visit = button(ROOM_VISIT_LABEL, async () => {
          const opened = current;
          visit.disabled = true;
          const result = await roomVisit.onVisit(target, opened?.displayName ?? null);
          if (current !== opened) return;
          if (result?.ok) close(); else render(roomVisit.reasonText?.(result?.reason) ?? "");
        }, "player-card-room-visit");
        if (!verdict.ok) {
          visit.disabled = true;
          visit.title = roomVisit.reasonText?.(verdict.reason) ?? "";
        }
        actions.append(visit);
      }
      actions.append(act("친구 삭제", "remove"));
    }
    if (card?.available && state && state !== Relationship.BLOCKED_BY_ME && state !== Relationship.UNAVAILABLE &&
        typeof onMessage === "function") {
      actions.append(button("✉ 쪽지 보내기", () => {
        const target = current;
        if (!target) return;
        const opened = onMessage(target.userId);
        if (opened === false && current === target) render("쪽지 작성 화면을 열지 못했어요.");
      }, "player-card-message"));
    }
    if (state === Relationship.BLOCKED_BY_ME) actions.append(act("차단 해제", "unblock"));
    if (state && state !== Relationship.BLOCKED_BY_ME) actions.append(act("차단", "block"));
    if (state) actions.append(button("신고", () => { current.reporting = !current.reporting; render(); }));
    panel.append(actions);

    if (current.proposing && state === Relationship.FRIENDS) {
      const group = el("div", "player-card-proposal");
      const label = el("label", "", "목적지");
      const select = el("select");
      for (const [id, title] of ACCOMPANY_POIS) {
        const option = el("option", "", title); option.value = id; select.append(option);
      }
      label.append(select);
      const submit = button("제안 보내기", async () => {
        const target = current;
        submit.disabled = true;
        try {
          const sent = await accompany.propose(target.userId, select.value);
          if (current !== target) return;
          target.proposing = !sent;
          render(sent ? "함께 가기 제안을 보냈어요." : "지금은 제안할 수 없어요.");
        } catch (error) {
          if (current === target) render(ERROR_TEXT[error instanceof SocialError ? error.code : "FAILED"] ?? "지금은 제안할 수 없어요.");
        }
      });
      group.append(label, submit);
      panel.append(group);
    }

    if (current.reporting) {
      const menu = el("div", "player-card-report");
      menu.setAttribute("role", "group");
      menu.setAttribute("aria-label", "신고 사유");
      for (const category of REPORT_CATEGORIES) menu.append(button(REPORT_LABELS[category], () => report(category)));
      panel.append(menu);
    }
    if (hint) panel.append(el("p", "player-card-hint", hint));
  }

  async function run(op) {
    const target = current;
    if (!target) return;
    try {
      const state = await social[op](target.userId);
      if (current !== target) return;
      target.card = { ...target.card, relationship: state };
      onRelationshipChange(target.userId, state);
      render();
    } catch (error) {
      if (current === target) render(ERROR_TEXT[error instanceof SocialError ? error.code : "FAILED"] ?? ERROR_TEXT.FAILED);
    }
  }

  async function report(category) {
    const target = current;
    if (!target) return;
    try {
      const result = await social.report(target.userId, category, getPlaceZoneId());
      if (current !== target) return;
      target.reporting = false;
      render(result === "duplicate" ? "이미 접수된 신고예요." : "신고가 접수됐어요.");
    } catch (error) {
      if (current === target) render(ERROR_TEXT[error instanceof SocialError ? error.code : "FAILED"] ?? ERROR_TEXT.FAILED);
    }
  }

  async function openTarget({ sessionId = null, userId, displayName = "플레이어" }) {
    if (!userId || !social.available || userId === getSelfUserId()) return false;
    const mine = ++epoch;
    const wasOpen = current !== null;
    current = { sessionId, userId, displayName, card: null, reporting: false };
    panel.hidden = false;
    if (!wasOpen) onOpenChange(true);
    render();
    try {
      const card = await social.profile(userId);
      if (mine !== epoch) return true;
      current.card = card;
      render();
    } catch (error) {
      if (mine === epoch) render(ERROR_TEXT[error instanceof SocialError ? error.code : "FAILED"] ?? ERROR_TEXT.FAILED);
    }
    return true;
  }

  // Open from a live remote session.
  async function open(sessionId) {
    const remote = getRemote(sessionId);
    if (!remote) return false;
    return openTarget({ sessionId, userId: remote.userId, displayName: remote.displayName });
  }

  // Open from any trusted account id, including an offline guestbook author.
  async function openUser(userId, displayName = "플레이어") {
    return openTarget({ userId, displayName });
  }

  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  doc.addEventListener("pointerdown", (event) => {
    if (!current || panel.contains?.(event.target) || event.target?.closest?.(".remote-nameplate")) return;
    close();
  });
  doc.addEventListener("keydown", (event) => {
    if (current && event.code === "Escape") close();
  });

  return {
    open,
    openUser,
    close,
    // Follow state changed elsewhere (context action, manual input): redraw the open card.
    refresh() { if (current) render(); },
    get current() { return current ? { sessionId: current.sessionId, userId: current.userId, card: current.card } : null; }
  };
}

