// Compact HUD line for the existing status panel. N counts everyone in the current Place Zone
// according to Presence, INCLUDING the local player (1 = you are alone there).

import { ConnectionState } from "../network/connection-state.js";

export function onlineHudText({ state, count = 0, signedIn = true, guest = false, localSpace = null }) {
  // Club Room P0 interiors are local-only: never show a campus population there.
  if (localSpace) return `${localSpace} · LOCAL`;
  if (!signedIn) return "OFFLINE";
  if (state === ConnectionState.ONLINE) return guest ? `● GUEST · ${count}명` : `● ONLINE · ${count}명`;
  if (state === ConnectionState.CONNECTING) return "◌ CONNECTING";
  if (state === ConnectionState.RECONNECTING) return "◌ RECONNECTING";
  return "OFFLINE";
}

export function createOnlineHud(element) {
  let text = null;
  return {
    render(view) {
      const next = onlineHudText(view);
      if (!element || next === text) return next;
      text = next;
      element.textContent = next;
      element.dataset.state = view.localSpace ? "LOCAL" : view.signedIn ? view.state : "GUEST";
      element.dataset.guest = view.guest ? "true" : "false";
      element.title = view.guest
        ? "게스트로 접속 중이에요. INHAGAME에 로그인하면 채팅과 이모트도 쓸 수 있어요."
        : view.signedIn ? "" : "INHAGAME 계정으로 로그인하면 같은 장소의 플레이어가 보여요.";
      return next;
    }
  };
}
