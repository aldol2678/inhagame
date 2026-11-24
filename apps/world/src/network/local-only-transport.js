// INHA WORLD — offline fallback transport (Firebase + Neon account rebuild, 2026-11-23).
//
// 오프라인 폴백 — Realtime 이관(C그룹 범위)이 아니며, 외부 전송 없이도 세션이 열리게 하는 최소 장치.
// Realtime transport가 사라진 뒤에도 world-online의 게스트/회원 세션이 열리고
// NetworkManager.start()가 throw하지 않게, NetworkTransport 계약(transport.js의 11개 메소드)을
// 만족하는 no-op 구현이다. 연결을 열지 않고, 채널에 들어가지 않으며, 아무것도 발행하지 않고,
// "connected"를 보고하지도 않는다. 따라서 NetworkManager는 CONNECTING → RECONNECTING →
// OFFLINE으로 스스로 수렴하고, 로컬 플레이는 그대로 계속된다. 원격 플레이어가 보이지 않는 것은
// 이 폴백의 의도된 동작이다 — 실시간 동기화는 별도(C그룹) 결정 뒤에 붙는다.

import { TRANSPORT_METHODS } from "./transport.js";

export const LOCAL_ONLY_TRANSPORT_METHODS = TRANSPORT_METHODS;

export class LocalOnlyTransport {
  constructor(_options = {}) {
    this.status = "disconnected";
    this._presenceHandlers = new Set();
    this._poseHandlers = new Set();
    this._actionHandlers = new Set();
    this._statusHandlers = new Set();
  }

  // World status() reads this; offline fallback has no channels.
  get liveChannelCount() { return 0; }

  connect() { return undefined; }
  disconnect() { return undefined; }
  joinPlaceZone() { return undefined; }
  leavePlaceZone() { return undefined; }
  publishPresence() { return undefined; }
  publishPose() { return undefined; }
  publishAction() { return undefined; }

  subscribePresence(handler) { return this._subscribe(this._presenceHandlers, handler); }
  subscribePose(handler) { return this._subscribe(this._poseHandlers, handler); }
  subscribeAction(handler) { return this._subscribe(this._actionHandlers, handler); }
  subscribeStatus(handler) { return this._subscribe(this._statusHandlers, handler); }

  _subscribe(set, handler) {
    // Handlers are kept only so unsubscribe works; they are never invoked —
    // this transport never reports a status, presence, pose or action event.
    if (typeof handler === "function") set.add(handler);
    return () => { set.delete(handler); };
  }

  // stopSession() calls transport.destroy?.(); a no-op here.
  destroy() {
    this._presenceHandlers.clear();
    this._poseHandlers.clear();
    this._actionHandlers.clear();
    this._statusHandlers.clear();
  }
}
