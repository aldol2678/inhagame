// Contract between the population heartbeat (server-side "is this account still allowed?") and the
// Realtime layer. Pure glue so main.js and the tests exercise the same code.
//
//   revoked    -> terminal: online.stop(); nothing can reconnect until a reload.
//   unverified -> recoverable hold: online.suspend(); no Realtime session may be created meanwhile.
//   verified   -> online.resume(): reconnect through the normal auth path.
//
// Grace is applied by the heartbeat (WORLD_VERIFY_GRACE_MS). This module never invents a revocation
// from a timeout: an unreachable server only ever suspends, a server answer of REVOKED stops.

export const WORLD_SESSION_NOTICE = Object.freeze({
  revoked: "관리자가 월드 접속을 종료했습니다. 차단 해제 후 새로고침하세요."
});

export function createWorldSessionGuard({ getOnline, setNotice = () => {} } = {}) {
  const online = () => { try { return getOnline?.() ?? null; } catch { return null; } };
  return Object.freeze({
    onRevoked() {
      online()?.stop?.();
      setNotice(WORLD_SESSION_NOTICE.revoked);
    },
    onUnverified() { return online()?.suspend?.("heartbeat-unverified") === true; },
    onVerified() { return online()?.resume?.() === true; }
  });
}
