import { readGuestSessionId } from '../activity/session-id.js';
import { formatProgression } from '../progression/progression-hud.js';

export const STUDENT_AVATARS = Object.freeze({ classic: '🦆', scholar: '📚', explorer: '🧭', star: '⭐' });
export const STUDENT_PROFILE_API_PATH = '/api/world-profile';
// Read-only projection of the profile endpoint; never infers EXP or writes profile data.
//
// AUTH (migrated 2026-11-13, Tier 4 guest-open; snapshot import 2026-11-23): the read
// authenticates with the snapshot session id in the `X-Session-Id` header only — no other
// credential header is sent. The id is read lazily by readGuestSessionId()
// (activity/session-id.js: localStorage 'inhaworld-firebase-session-v1', fallback
// 'inhaworld-guest-session-v1'; null when absent — never fabricated). One GET returns both
// the profile and the achievements the two old reads fetched separately.
// Before: getClient() returned the signed-in permanent-account client and refresh() called its
// rpc('get_my_profile') then rpc('get_my_achievements') with that account's session. That path
// is gone; only the transport changed — snapshot shape, badge filtering and epoch guards are
// unchanged. States: GUEST (no identity) / LOADING / READY / NO_PROFILE (server answered 409
// PROFILE_REQUIRED: no profile exists for this session) / UNAVAILABLE.
export function createStudentId({
  getSessionId = readGuestSessionId,
  fetcher = (...args) => globalThis.fetch(...args),
  endpoint = STUDENT_PROFILE_API_PATH,
  getIdentity, getProgression, onChange = () => {}
}) {
  let epoch = 0, data = null, badges = [], state = 'GUEST', badgeState = 'EMPTY';
  const snapshot = () => {
    const identity = getIdentity(), p = data?.profile;
    const progress = getProgression();
    return { state, badgeState, nickname: identity?.displayName || '인덕이', department: p?.department || '소속 미설정',
      title: p?.title || '칭호 미설정', avatar: STUDENT_AVATARS[p?.avatar] || STUDENT_AVATARS.classic,
      progression: progress?.state === 'READY' ? formatProgression(progress.snapshot) : null,
      progressionState: progress?.state ?? 'SIGNED_OUT', badges: badges.slice(0, 3),
      playedGames: Number.isInteger(data?.stats?.playedGames) ? data.stats.playedGames : null,
      // Existing Hub mail badge (mailbox ownership only); null when not read, never guessed.
      inhaMailVerified: typeof p?.inhaVerified === 'boolean' ? p.inhaVerified : null };
  };
  async function refresh() {
    const mine = ++epoch, id = getIdentity()?.userId;
    data = null; badges = []; badgeState = 'EMPTY'; state = id ? 'LOADING' : 'GUEST'; onChange();
    if (!id) return snapshot();
    const current = () => mine === epoch && id === getIdentity()?.userId;
    let sessionId = null;
    try {
      const value = await getSessionId?.();
      sessionId = typeof value === "string" && value ? value : null;
    } catch { sessionId = null; }
    if (!sessionId) { if (current()) state = 'UNAVAILABLE'; return snapshot(); }
    try {
      const response = await fetcher(endpoint, { headers: { "X-Session-Id": sessionId } });
      if (!current()) return null;
      if (response.status === 409) {
        // PROFILE_REQUIRED: the session has no profile yet. Profile-missing is a
        // distinct state from a failed read — the card shows "no profile" defaults.
        data = null; state = 'NO_PROFILE'; badgeState = 'EMPTY';
        if (current()) onChange();
        return snapshot();
      }
      if (!response.ok) throw Error('unavailable');
      const payload = await response.json();
      if (!current()) return null;
      if (!payload || typeof payload !== 'object' || !payload.profile) throw Error('unavailable');
      data = payload; state = 'READY';
    } catch { if (current()) state = 'UNAVAILABLE'; }
    if (!current()) return null;
    badgeState = 'LOADING'; onChange();
    try {
      // /api/world-profile의 achievements는 get_my_achievements 결과 객체
      // {earnedCount, achievements: [...]}다 (배열이 아님). Tier 4 원본이 배열로
      // 읽던 부분을 스냅샷/Worker 응답 형태에 맞게 손으로 조정했다.
      const result = data?.achievements;
      if (!Number.isInteger(result?.earnedCount) || result.earnedCount < 0 ||
          !Array.isArray(result?.achievements)) throw Error('unavailable');
      badges = result.achievements.filter(a => a?.earned === true && typeof a.title === 'string')
        .sort((a,b) => (Date.parse(b.earnedAt) || 0) - (Date.parse(a.earnedAt) || 0)).slice(0, 3);
      badgeState = 'READY';
    } catch { if (current()) badgeState = 'UNAVAILABLE'; }
    if (current()) onChange();
    return snapshot();
  }
  return Object.freeze({ snapshot, refresh, invalidate() { epoch++; data = null; badges = []; state = 'GUEST'; badgeState = 'EMPTY'; } });
}
