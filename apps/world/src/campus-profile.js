import * as pc from "playcanvas";
import { menuReturnFocus } from "./campus-hud.js";
import { renderStaffName } from "./staff-badges.js";

// Nickname authority: the INHAGAME profile (profiles.nickname). The World only displays it;
// there is no in-World nickname editing for members or guests. Guests play offline as 인덕이.
export const GUEST_NICKNAME = "인덕이";

export function createCampusProfile(player, camera, canvas, { onOpenChange = () => {} } = {}) {
  const open = document.getElementById("open-profile");
  const close = document.getElementById("close-profile");
  const panel = document.getElementById("profile-panel");
  const label = document.getElementById("nameplate");
  const name = document.getElementById("profile-name");
  const source = document.getElementById("profile-source");
  const link = document.getElementById("profile-link");
  let nickname = GUEST_NICKNAME;
  let userId = null;
  let signedIn = false;

  function render() {
    renderStaffName(label, nickname, userId);
    renderStaffName(name, nickname, userId);
    if (source) source.textContent = signedIn
      ? "INHAGAME 계정 닉네임이에요. 다른 플레이어에게도 이 이름이 보여요."
      : "게스트로 둘러보는 중이에요. 로그인하면 계정 닉네임으로 온라인에 참여해요.";
    if (link) {
      link.textContent = signedIn ? "INHAGAME 프로필에서 닉네임 바꾸기" : "INHAGAME 로그인";
      link.href = signedIn ? "/profile/" : "/";
    }
  }
  render();
  let panelOpen = panel.hidden === false;

  function setOpen(next, { focus = true } = {}) {
    const value = Boolean(next);
    if (value === panelOpen) return panelOpen;
    panelOpen = value;
    panel.hidden = !panelOpen;
    onOpenChange(panelOpen);
    if (panelOpen) {
      if (focus) close.focus?.();
    } else if (focus) {
      menuReturnFocus(open, document.body?.dataset?.lobbyShell === "true"
        ? document.getElementById("lobby-menu-toggle")
        : document.getElementById("hud-menu-toggle"))?.focus?.();
    }
    return panelOpen;
  }

  open.addEventListener("click", () => setOpen(true));
  close.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.code === "Escape" && panelOpen) setOpen(false);
  });

  const point = new pc.Vec3();
  return {
    get nickname() { return nickname; },
    get signedIn() { return signedIn; },
    get open() { return panelOpen; },
    setOpen,
    // identity: { userId, displayName } from the online layer, or null when signed out.
    setIdentity(identity) {
      signedIn = !!identity;
      userId = identity?.userId ?? null;
      nickname = identity?.displayName || GUEST_NICKNAME;
      render();
    },
    update(mounted, nameplateHeight = mounted ? 2.4 : 1.56, firstPerson = false) {
      if (firstPerson) { label.hidden = true; return; }
      const position = player.getPosition();
      point.set(position.x, position.y + nameplateHeight, position.z);
      const projected = camera.camera.worldToScreen(point);
      const visible = projected.x >= 0 && projected.x <= canvas.clientWidth &&
        projected.y >= 0 && projected.y <= canvas.clientHeight;
      label.hidden = !visible;
      if (visible) {
        label.style.left = `${projected.x + canvas.getBoundingClientRect().left}px`;
        label.style.top = `${projected.y + canvas.getBoundingClientRect().top}px`;
      }
    }
  };
}
