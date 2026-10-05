(() => {
  "use strict";

  const client = window.InhaHubAccountClient;
  const factory = window.InhaHubFriendsClient?.createHubFriendsClient;
  const DRAFT_KEY = "inhagame-hub-message-draft-v1";

  const signedOut = document.getElementById("hub-friends-signed-out");
  const shell = document.getElementById("hub-friends-shell");
  const status = document.getElementById("hub-friends-status");
  const refreshButton = document.getElementById("hub-friends-refresh");
  const sections = {
    incoming: document.getElementById("hub-friends-incoming"),
    friends: document.getElementById("hub-friends-list"),
    outgoing: document.getElementById("hub-friends-outgoing"),
    blocked: document.getElementById("hub-friends-blocked")
  };
  const counts = {
    incoming: document.getElementById("hub-friends-incoming-count"),
    friends: document.getElementById("hub-friends-count"),
    outgoing: document.getElementById("hub-friends-outgoing-count"),
    blocked: document.getElementById("hub-friends-blocked-count")
  };
  const requestBadges = Array.from(document.querySelectorAll("[data-friend-request-count]"));
  const profileModal = document.getElementById("hub-friend-profile-modal");
  const profileClose = document.getElementById("hub-friend-profile-close");
  const profileAvatar = document.getElementById("hub-friend-profile-avatar");
  const profileName = document.getElementById("hub-friend-profile-name");
  const profileBadge = document.getElementById("hub-friend-profile-badge");
  const profileTitle = document.getElementById("hub-friend-profile-title");
  const profileRelationship = document.getElementById("hub-friend-profile-relationship");
  const profileVerified = document.getElementById("hub-friend-profile-verified");
  const profileActions = document.getElementById("hub-friend-profile-actions");
  const profileStatus = document.getElementById("hub-friend-profile-status");

  if (!client || typeof factory !== "function" || !signedOut || !shell || !status ||
      !profileModal || !profileClose || !profileActions || !profileStatus) {
    if (status) status.textContent = "친구 서비스를 불러올 수 없습니다.";
    return;
  }

  const friends = factory({ rpc: (name, args) => client.rpc(name, args) });
  let epoch = 0;
  let profileEpoch = 0;
  let currentProfile = null;
  let lastProfileTrigger = null;

  const avatar = Object.freeze({ classic:"🦆", scholar:"🎓", explorer:"🧭", star:"⭐" });
  const relationshipText = Object.freeze({
    none:"친구 아님",
    outgoing:"친구 요청 보냄",
    incoming:"친구 요청 받음",
    friends:"친구",
    blocked_by_me:"차단한 사용자",
    unavailable:"이용할 수 없음"
  });

  function errorText(code) {
    if (code === "PERMANENT_ACCOUNT_REQUIRED") return "로그인한 INHAGAME 계정이 필요합니다.";
    if (code === "ACCOUNT_UNAVAILABLE" || code === "SOCIAL_RESTRICTED") return "현재 이 계정으로 친구 기능을 이용할 수 없습니다.";
    if (code === "NOT_ALLOWED" || code === "TARGET_UNAVAILABLE") return "지금은 이 사용자와 친구 작업을 할 수 없습니다.";
    return "친구 작업을 완료하지 못했습니다. 다시 시도해 주세요.";
  }

  function renderRequestBadge(count) {
    const safe = Math.max(0, Number(count) || 0);
    for (const badge of requestBadges) {
      badge.hidden = safe === 0;
      badge.textContent = safe > 99 ? "99+" : String(safe);
      badge.setAttribute("aria-label", `받은 친구 요청 ${safe}개`);
    }
  }

  function setSignedIn(signedIn) {
    signedOut.hidden = signedIn;
    shell.hidden = !signedIn;
    if (!signedIn) {
      renderRequestBadge(0);
      for (const section of Object.values(sections)) section?.replaceChildren();
      status.textContent = "로그인하면 친구 목록을 확인할 수 있습니다.";
    }
  }

  function action(label, run, className = "friend-action") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", async () => {
      button.disabled = true;
      const result = await run();
      button.disabled = false;
      if (result?.outcome === "SUCCESS") {
        await load();
      } else if (result?.outcome !== "STALE") {
        status.textContent = errorText(result?.code);
      }
    });
    return button;
  }

  function openMessageDraft(userId) {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ userId, createdAt: Date.now() }));
      location.hash = "messages";
      window.scrollTo(0, 0);
      return true;
    } catch {
      status.textContent = "쪽지 작성 화면을 열지 못했습니다.";
      return false;
    }
  }


  function closeProfile({ restoreFocus = false } = {}) {
    profileEpoch += 1;
    currentProfile = null;
    profileModal.hidden = true;
    profileActions.replaceChildren();
    profileStatus.textContent = "";
    if (restoreFocus) lastProfileTrigger?.focus?.();
  }

  function profileButton(label, onClick, className = "friend-profile-action") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  async function mutateProfile(op, { confirmText = null } = {}) {
    const target = currentProfile;
    if (!target) return;
    if (confirmText && !window.confirm(confirmText.replace("{name}", target.nickname))) return;
    profileActions.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    const result = await friends[op](target.userId);
    if (currentProfile !== target || result?.outcome === "STALE") return;
    if (result?.outcome !== "SUCCESS") {
      profileActions.querySelectorAll("button").forEach((button) => { button.disabled = false; });
      profileStatus.textContent = errorText(result?.code);
      return;
    }
    closeProfile();
    await load();
  }

  function renderProfile(profile) {
    currentProfile = profile;
    profileAvatar.textContent = avatar[profile.avatar] || avatar.classic;
    profileName.textContent = profile.nickname;
    profileBadge.hidden = !profile.inhaVerified;
    profileTitle.textContent = profile.available ? (profile.title || "칭호 미설정") : "공개 정보 비공개";
    profileRelationship.textContent = relationshipText[profile.relationship] || "확인 중";
    profileVerified.textContent = profile.available ? (profile.inhaVerified ? "인증 완료" : "미인증") : "—";
    profileActions.replaceChildren();
    profileStatus.textContent = "";

    if (!profile.available || profile.relationship === "unavailable") {
      profileStatus.textContent = "지금은 이 사용자와 상호작용할 수 없습니다.";
      return;
    }

    const message = () => {
      const opened = openMessageDraft(profile.userId);
      if (opened) closeProfile();
    };

    if (profile.relationship === "friends") {
      profileActions.append(
        profileButton("✉ 쪽지 보내기", message, "friend-profile-action primary-lite"),
        profileButton("친구 삭제", () => void mutateProfile("remove", { confirmText:"{name}님을 친구에서 삭제할까요?" }),
          "friend-profile-action"),
        profileButton("차단", () => void mutateProfile("block", { confirmText:"{name}님을 차단할까요? 친구 관계와 쪽지 상호작용도 제한됩니다." }),
          "friend-profile-action danger")
      );
    } else if (profile.relationship === "incoming") {
      profileActions.append(
        profileButton("수락", () => void mutateProfile("accept"), "friend-profile-action primary-lite"),
        profileButton("거절", () => void mutateProfile("reject"), "friend-profile-action"),
        profileButton("차단", () => void mutateProfile("block", { confirmText:"{name}님을 차단할까요?" }),
          "friend-profile-action danger")
      );
    } else if (profile.relationship === "outgoing") {
      profileActions.append(
        profileButton("요청 취소", () => void mutateProfile("cancel"), "friend-profile-action"),
        profileButton("차단", () => void mutateProfile("block", { confirmText:"{name}님을 차단할까요?" }),
          "friend-profile-action danger")
      );
    } else if (profile.relationship === "blocked_by_me") {
      profileActions.append(
        profileButton("차단 해제", () => void mutateProfile("unblock"), "friend-profile-action primary-lite")
      );
    } else {
      profileActions.append(
        profileButton("✉ 쪽지 보내기", message, "friend-profile-action primary-lite"),
        profileButton("차단", () => void mutateProfile("block", { confirmText:"{name}님을 차단할까요?" }),
          "friend-profile-action danger")
      );
    }
  }

  async function openProfile(person, trigger) {
    if (!friends.accountId) return;
    lastProfileTrigger = trigger;
    const mine = ++profileEpoch;
    profileModal.hidden = false;
    profileAvatar.textContent = avatar.classic;
    profileName.textContent = "프로필 확인 중";
    profileBadge.hidden = true;
    profileTitle.textContent = "공개 정보를 확인하는 중…";
    profileRelationship.textContent = "확인 중";
    profileVerified.textContent = "확인 중";
    profileActions.replaceChildren();
    profileStatus.textContent = "공개 프로필을 불러오는 중…";
    profileClose.focus();

    const result = await friends.profile(person.userId);
    if (mine !== profileEpoch || result.outcome === "STALE") return;
    if (result.outcome !== "READY") {
      profileStatus.textContent = errorText(result.code);
      return;
    }
    renderProfile(result.profile);
  }

  function personRow(person, kind) {
    const row = document.createElement("article");
    row.className = "hub-friend-row";
    row.dataset.userId = person.userId;

    const icon = document.createElement("span");
    icon.className = "hub-friend-avatar";
    icon.textContent = avatar[person.avatar] || avatar.classic;

    const names = document.createElement("div");
    names.className = "hub-friend-names";
    const strong = document.createElement("strong");
    strong.textContent = (person.inhaVerified ? "🎓 " : "") + person.nickname;
    names.append(strong);
    if (person.title && kind === "friends") {
      const small = document.createElement("small");
      small.textContent = person.title;
      names.append(small);
    }

    const controls = document.createElement("div");
    controls.className = "hub-friend-actions";

    if (kind === "friends") {
      const message = document.createElement("button");
      message.type = "button";
      message.className = "friend-action primary-lite";
      message.textContent = "✉ 쪽지";
      message.addEventListener("click", () => openMessageDraft(person.userId));
      controls.append(
        message,
        action("친구 삭제", () => friends.remove(person.userId), "friend-action danger")
      );
    } else if (kind === "incoming") {
      controls.append(
        action("수락", () => friends.accept(person.userId), "friend-action primary-lite"),
        action("거절", () => friends.reject(person.userId), "friend-action")
      );
    } else if (kind === "outgoing") {
      controls.append(action("요청 취소", () => friends.cancel(person.userId)));
    } else if (kind === "blocked") {
      controls.append(action("차단 해제", () => friends.unblock(person.userId)));
    }

    const profileTrigger = document.createElement("button");
    profileTrigger.type = "button";
    profileTrigger.className = "hub-friend-profile-trigger";
    profileTrigger.setAttribute("aria-label", `${person.nickname} 프로필 보기`);
    profileTrigger.append(icon, names);
    profileTrigger.addEventListener("click", () => void openProfile(person, profileTrigger));

    row.append(profileTrigger, controls);
    return row;
  }

  function render(snapshot) {
    const order = ["incoming", "friends", "outgoing", "blocked"];
    for (const key of order) {
      const list = snapshot[key];
      const container = sections[key];
      counts[key].textContent = String(list.length);
      container.replaceChildren();
      if (!list.length) {
        const empty = document.createElement("p");
        empty.className = "friend-empty";
        empty.textContent = key === "friends" ? "아직 친구가 없습니다." : "없습니다.";
        container.append(empty);
        continue;
      }
      container.append(...list.map((person) => personRow(person, key)));
    }
    renderRequestBadge(snapshot.incoming.length);
  }

  async function load({ quiet = false } = {}) {
    if (!friends.accountId) return;
    const mine = ++epoch;
    if (!quiet) status.textContent = "친구 목록을 불러오는 중…";
    refreshButton.disabled = true;
    const result = await friends.list();
    refreshButton.disabled = false;
    if (mine !== epoch || result.outcome === "STALE") return;
    if (result.outcome !== "READY") {
      status.textContent = errorText(result.code);
      return;
    }
    render(result.snapshot);
    status.textContent = result.snapshot.friends.length
      ? `친구 ${result.snapshot.friends.length}명`
      : "친구를 맺으면 여기에서 관리할 수 있습니다.";
  }

  async function syncIdentity() {
    try {
      const { data, error } = await client.auth.getUser();
      if (error && error.name !== "AuthSessionMissingError") throw error;
      const user = data?.user;
      const accountId = user?.id && user.is_anonymous !== true && user.email ? user.id : null;
      const changed = friends.setAccount(accountId);
      if (changed && !profileModal.hidden) closeProfile();
      setSignedIn(!!accountId);
      if (!accountId) return;
      await load({ quiet: location.hash !== "#friends" });
    } catch (error) {
      console.warn("Hub friends identity unavailable", error);
      friends.setAccount(null);
      setSignedIn(false);
      status.textContent = "계정 상태를 확인할 수 없습니다.";
    }
  }

  refreshButton.addEventListener("click", () => void load());
  window.addEventListener("hashchange", () => {
    if (location.hash === "#friends" && friends.accountId) void load();
  });
  window.addEventListener("pageshow", () => {
    if (friends.accountId) void load({ quiet: location.hash !== "#friends" });
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && friends.accountId) void load({ quiet: location.hash !== "#friends" });
  });

  profileClose.addEventListener("click", () => closeProfile({ restoreFocus:true }));
  profileModal.addEventListener("click", (event) => {
    if (event.target === profileModal) closeProfile({ restoreFocus:true });
  });
  document.addEventListener("keydown", (event) => {
    if (!profileModal.hidden && event.code === "Escape") closeProfile({ restoreFocus:true });
  });

  client.auth.onAuthStateChange(() => { setTimeout(() => void syncIdentity(), 0); });
  void syncIdentity();
})();
