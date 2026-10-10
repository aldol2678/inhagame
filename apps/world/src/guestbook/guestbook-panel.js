import { GuestbookError } from "./guestbook-client.js";

const AVATAR = Object.freeze({ classic: "🦆", scholar: "🎓", explorer: "🧭", star: "⭐" });

const messageFor = (error) => {
  const code = error instanceof GuestbookError ? error.code : "FAILED";
  if (code === "SIGNED_OUT" || code === "PERMANENT_ACCOUNT_REQUIRED") return "로그인한 계정만 방명록을 이용할 수 있어요.";
  if (code === "ACCOUNT_UNAVAILABLE") return "현재 이 계정으로는 방명록을 이용할 수 없어요.";
  if (code === "SOCIAL_RESTRICTED") return "운영 조치로 월드 상호작용 기능이 일시 제한되어 있어요.";
  if (code === "DAILY_LIMIT_REACHED") return "오늘은 방명록을 3개까지 남길 수 있어요.";
  if (code === "GUESTBOOK_COOLDOWN") return "새 방명록은 60초 간격으로 남길 수 있어요.";
  if (code === "ENTRY_UNAVAILABLE") return "이 글은 더 이상 수정하거나 삭제할 수 없어요.";
  if (code === "INVALID_CONTENT") return "1자 이상 150자 이하로 작성해 주세요.";
  return "방명록을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
};

const formatTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(date);
};

export function createGuestbookPanel({
  panel,
  guestbook,
  onOpenProfile = () => false,
  onOpenChange = () => {},
  doc = document
}) {
  if (!panel) throw new Error("Guestbook panel is required");

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  let open = false;
  let board = null;
  let hint = "";
  let loading = false;
  let saving = false;
  let saveOwner = null;
  let draft = "";
  let editingId = null;
  let editTarget = null;
  let loadEpoch = 0;
  let lifecycle = 0;
  let recoveryFocus = null;
  let accountId; // undefined keeps availability-only callers compatible
  const available = () => accountId !== null && guestbook.available;
  const currentView = (epoch) => epoch === lifecycle && open && available();
  const stale = (error) => error instanceof GuestbookError && error.code === "STALE";

  const editingEntry = () => board?.entries.find((entry) => entry.id === editingId)
    // Reopening reads page one. An older selected entry can still be on a later
    // page; keep its edit identity until the complete result excludes it.
    ?? (board?.hasMore && editTarget?.id === editingId ? editTarget : null);

  function startEdit(entry) {
    if (!entry?.mine || saving) return;
    editingId = entry.id;
    editTarget = entry;
    draft = entry.content;
    hint = "";
    render();
  }

  function cancelEdit() {
    editingId = null;
    editTarget = null;
    draft = "";
    hint = "";
    render();
  }

  async function removeEntry(entry) {
    if (!entry?.mine || saving) return;
    const epoch = lifecycle;
    const request = {};
    saveOwner = request;
    saving = true;
    hint = "";
    render();
    try {
      await guestbook.remove(entry.id);
      if (!currentView(epoch)) return;
      if (editingId === entry.id) {
        editingId = null;
        editTarget = null;
        draft = "";
      }
      hint = "방명록을 삭제했어요.";
      await refresh();
    } catch (error) {
      if (currentView(epoch) && !stale(error)) hint = messageFor(error);
    } finally {
      if (saveOwner === request) {
        saveOwner = null;
        saving = false;
        if (open) render();
      }
    }
  }

  function renderEntry(entry) {
    const epoch = lifecycle;
    const item = el("article", "guestbook-entry");
    item.dataset.entryId = entry.id;

    const head = el("div", "guestbook-entry-head");
    const identity = el("button", "guestbook-entry-identity guestbook-profile-button");
    identity.type = "button";
    identity.setAttribute("aria-label", `${entry.nickname} 프로필 보기`);
    identity.title = "프로필 보기";
    identity.append(el("span", "guestbook-avatar", AVATAR[entry.avatar] ?? AVATAR.classic));
    identity.append(el("strong", "", entry.nickname));
    if (entry.inhaVerified) {
      const badge = el("span", "guestbook-verified", "✓ 인하대");
      badge.setAttribute("aria-label", "인하대 인증");
      identity.append(badge);
    }
    if (entry.mine) identity.append(el("span", "guestbook-mine", "내 글"));
    identity.append(el("span", "guestbook-profile-chevron", "›"));
    identity.addEventListener("click", () => { if (currentView(epoch)) void onOpenProfile(entry); });

    head.append(identity);
    head.append(el("time", "guestbook-time", formatTime(entry.updatedAt ?? entry.createdAt)));
    item.append(head, el("p", "guestbook-content", entry.content));

    if (entry.mine) {
      const actions = el("div", "guestbook-entry-actions");
      const edit = el("button", "guestbook-entry-edit", editingId === entry.id ? "수정 중" : "수정");
      edit.type = "button";
      edit.disabled = saving;
      edit.addEventListener("click", () => { if (currentView(epoch)) startEdit(entry); });
      const remove = el("button", "guestbook-entry-delete", "삭제");
      remove.type = "button";
      remove.disabled = saving;
      remove.addEventListener("click", () => { if (currentView(epoch)) void removeEntry(entry); });
      actions.append(edit, remove);
      item.append(actions);
    }
    return item;
  }

  function renderEditor() {
    const epoch = lifecycle;
    const editing = editingEntry();
    const wrap = el("section", "guestbook-editor");
    wrap.append(el("h3", "", editing ? "내 글 수정" : "방명록 남기기"));

    const rate = editing
      ? "수정은 오늘 작성 횟수에 포함되지 않아요."
      : `오늘 ${board.dailyUsed}/${board.dailyLimit}개 · 새 글은 60초 간격` +
        (board.cooldownRemainingSeconds > 0 ? ` · 약 ${board.cooldownRemainingSeconds}초 후 작성 가능` : "");
    wrap.append(el("p", "guestbook-rate", rate));

    const createBlocked = !editing && board.dailyRemaining <= 0;
    const textarea = el("textarea", "guestbook-textarea");
    textarea.maxLength = 150;
    textarea.rows = 3;
    textarea.placeholder = createBlocked
      ? "오늘 작성 가능한 방명록 3개를 모두 남겼어요."
      : editing ? "내용을 수정해 주세요." : "인하월드에 한마디 남겨보세요.";
    textarea.value = draft;
    textarea.disabled = saving || createBlocked;
    textarea.addEventListener("input", () => {
      if (!currentView(epoch)) return;
      draft = textarea.value;
      counter.textContent = `${draft.length}/150`;
      save.disabled = saving || createBlocked || draft.trim().length < 1;
    });

    const footer = el("div", "guestbook-editor-footer");
    const counter = el("span", "guestbook-counter", `${draft.length}/150`);
    const actions = el("span", "guestbook-editor-actions");

    if (editing) {
      const cancel = el("button", "guestbook-cancel", "취소");
      cancel.type = "button";
      cancel.disabled = saving;
      cancel.addEventListener("click", () => { if (currentView(epoch)) cancelEdit(); });
      actions.append(cancel);
    }

    const save = el("button", "guestbook-save", editing ? "수정 저장" : "남기기");
    save.type = "button";
    save.disabled = saving || createBlocked || draft.trim().length < 1;
    save.addEventListener("click", async () => {
      if (!currentView(epoch) || saving) return;
      const request = { draftSubmitted: true };
      saveOwner = request;
      saving = true;
      hint = "";
      render();
      try {
        if (editing) {
          await guestbook.update(editing.id, draft);
          if (!currentView(epoch)) return;
          editingId = null;
          editTarget = null;
          draft = "";
          hint = "방명록을 수정했어요.";
        } else {
          await guestbook.create(draft);
          if (!currentView(epoch)) return;
          draft = "";
          hint = "새 방명록을 남겼어요.";
        }
        await refresh();
      } catch (error) {
        if (currentView(epoch) && !stale(error)) hint = messageFor(error);
      } finally {
        if (saveOwner === request) {
          saveOwner = null;
          saving = false;
          if (open) render();
        }
      }
    });

    actions.append(save);
    footer.append(counter, actions);
    wrap.append(textarea, footer);

    if (createBlocked) {
      wrap.append(el("p", "guestbook-limit-note", "오늘 작성 횟수는 삭제해도 다시 늘어나지 않아요."));
    }
    return { element: wrap, textarea };
  }

  function render() {
    const restoreRecoveryFocus = recoveryFocus && doc.activeElement === recoveryFocus;
    recoveryFocus = null;
    panel.replaceChildren();

    const head = el("div", "guestbook-panel-head");
    const titles = el("div", "guestbook-panel-titles");
    titles.append(el("h2", "", "📖 정문 방명록"), el("p", "", "인하월드에 남겨진 발자국"));
    const close = el("button", "profile-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "방명록 닫기");
    close.addEventListener("click", () => void setOpen(false));
    head.append(titles, close);
    panel.append(head);

    if (!available()) {
      panel.append(el("p", "guestbook-empty", "로그인한 계정만 방명록을 볼 수 있어요."));
      return;
    }
    if (!board) {
      const epoch = lifecycle;
      const status = el("p", "guestbook-empty guestbook-load-status", loading
        ? "방명록을 불러오는 중…" : hint || "방명록을 불러오지 못했어요.");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.tabIndex = -1;
      const retry = el("button", "guestbook-more guestbook-retry", loading ? "불러오는 중…" : "다시 불러오기");
      retry.type = "button";
      retry.disabled = loading;
      retry.addEventListener("click", () => {
        if (!currentView(epoch) || loading || board) return;
        hint = "";
        void refresh();
      });
      panel.append(status, retry);
      recoveryFocus = loading ? status : retry;
      if (restoreRecoveryFocus) recoveryFocus.focus();
      return;
    }

    if (editingId && !editingEntry()) {
      editingId = null;
      editTarget = null;
      draft = "";
    }

    const editor = renderEditor();
    panel.append(editor.element);
    if (restoreRecoveryFocus) (editor.textarea.disabled ? close : editor.textarea).focus();

    const list = el("div", "guestbook-list");
    if (!board.entries.length) {
      list.append(el("p", "guestbook-empty", "아직 남겨진 글이 없어요. 첫 발자국을 남겨보세요."));
    } else {
      for (const entry of board.entries) list.append(renderEntry(entry));
    }
    panel.append(list);

    if (board.hasMore && board.nextBefore) {
      const more = el("button", "guestbook-more", loading ? "불러오는 중…" : "이전 글 더 보기");
      more.type = "button";
      more.disabled = loading;
      more.addEventListener("click", () => void loadMore());
      panel.append(more);
    }
    if (hint) panel.append(el("p", "guestbook-hint", hint));
  }

  async function refresh() {
    if (!open || !available()) return null;
    // Retry is read-only and single-flight. A post-write refresh can still replace
    // an older paginated read when an existing board is visible.
    if (loading && !board) return null;
    const view = lifecycle;
    const epoch = ++loadEpoch;
    loading = true;
    render();
    try {
      const next = await guestbook.load();
      if (epoch === loadEpoch && currentView(view)) board = next;
    } catch (error) {
      if (epoch === loadEpoch && currentView(view) && !stale(error)) {
        board = null;
        hint = messageFor(error);
      }
    } finally {
      if (epoch === loadEpoch) {
        loading = false;
        render();
      }
    }
    return board;
  }

  async function loadMore() {
    if (!open || !available() || loading || !board?.hasMore || !board.nextBefore) return board;
    const view = lifecycle;
    const epoch = ++loadEpoch;
    loading = true;
    render();
    try {
      const next = await guestbook.load({ before: board.nextBefore });
      if (epoch === loadEpoch && currentView(view)) {
        const seen = new Set(board.entries.map((entry) => entry.id));
        board = Object.freeze({
          ...next,
          entries: Object.freeze([...board.entries, ...next.entries.filter((entry) => !seen.has(entry.id))])
        });
      }
    } catch (error) {
      if (epoch === loadEpoch && currentView(view) && !stale(error)) hint = messageFor(error);
    } finally {
      if (epoch === loadEpoch) {
        loading = false;
        render();
      }
    }
    return board;
  }

  function setOpen(next) {
    if (next && !available()) return Promise.resolve(false);
    const nextOpen = Boolean(next);
    const changed = open !== nextOpen;
    if (!changed) return Promise.resolve(true);
    const epoch = ++lifecycle;
    loadEpoch += 1;
    open = nextOpen;
    board = null;
    hint = "";
    // Retain only unsent same-account drafts. A submitted write may already have
    // committed, so closing it keeps the existing no-replay behavior.
    if (saving && saveOwner?.draftSubmitted) {
      draft = "";
      editingId = null;
      editTarget = null;
    }
    recoveryFocus = null;
    loading = false;
    panel.hidden = !open;
    panel.replaceChildren();
    // Publish after invalidating the old view. Reentrant close/open/account callbacks
    // own the new view; this call must not clear or refresh it afterwards.
    if (changed) onOpenChange(open);
    if (epoch !== lifecycle) return Promise.resolve(false);
    if (!open) return Promise.resolve(true);
    render();
    return refresh().then(() => epoch === lifecycle && open);
  }

  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  doc.addEventListener("keydown", (event) => {
    if (!open || event.code !== "Escape") return;
    if (editingId && board) cancelEdit();
    else void setOpen(false);
  });

  return {
    get open() { return open; },
    get data() { return board; },
    get editingId() { return editingId; },
    setOpen,
    refresh,
    loadMore,
    setAvailable(isAvailable, nextAccountId = accountId) {
      // Use the identity callback's id (or null), never the transport's stale getter.
      if (nextAccountId !== accountId || !isAvailable) {
        draft = "";
        editingId = null;
        editTarget = null;
      }
      if (nextAccountId !== accountId) {
        accountId = nextAccountId;
        saveOwner = null;
        saving = false;
        guestbook.setAccount?.(nextAccountId);
        void setOpen(false);
      } else if (!isAvailable) void setOpen(false);
    }
  };
}
