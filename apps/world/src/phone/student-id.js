import { formatProgression } from '../progression/progression-hud.js';

export const STUDENT_AVATARS = Object.freeze({ classic: '🦆', scholar: '📚', explorer: '🧭', star: '⭐' });
// Read-only projection of the existing hub RPCs; never infers EXP or writes profile data.
export function createStudentId({ getClient, getIdentity, getProgression, onChange = () => {} }) {
  let epoch = 0, data = null, badges = [], state = 'GUEST', badgeState = 'EMPTY';
  const snapshot = () => {
    const identity = getIdentity(), p = data?.profile;
    const progress = getProgression();
    return { state, badgeState, nickname: identity?.displayName || '인덕이', department: p?.department || '소속 미설정',
      title: p?.title || '칭호 미설정', avatar: STUDENT_AVATARS[p?.avatar] || STUDENT_AVATARS.classic,
      progression: progress?.state === 'READY' ? formatProgression(progress.snapshot) : null,
      progressionState: progress?.state ?? 'SIGNED_OUT', badges: badges.slice(0, 3),
      playedGames: Number.isInteger(data?.stats?.playedGames) ? data.stats.playedGames : null };
  };
  async function refresh() {
    const mine = ++epoch, id = getIdentity()?.userId;
    data = null; badges = []; badgeState = 'EMPTY'; state = id ? 'LOADING' : 'GUEST'; onChange();
    if (!id) return snapshot();
    const current = () => mine === epoch && id === getIdentity()?.userId;
    const client = getClient();
    try {
      if (!client?.rpc) throw Error('unavailable');
      const result = await client.rpc('get_my_profile');
      if (!current()) return null;
      if (result.error || !result.data?.profile) throw Error('unavailable');
      data = result.data; state = 'READY';
    } catch { if (current()) state = 'UNAVAILABLE'; }
    if (!current()) return null;
    badgeState = 'LOADING'; onChange();
    try {
      const result = await client.rpc('get_my_achievements');
      if (!current()) return null;
      if (result.error || !Array.isArray(result.data?.achievements)) throw Error('unavailable');
      badges = result.data.achievements.filter(a => a?.earned === true && typeof a.title === 'string')
        .sort((a,b) => (Date.parse(b.earnedAt) || 0) - (Date.parse(a.earnedAt) || 0)).slice(0, 3);
      badgeState = 'READY';
    } catch { if (current()) badgeState = 'UNAVAILABLE'; }
    if (current()) onChange();
    return snapshot();
  }
  return Object.freeze({ snapshot, refresh, invalidate() { epoch++; data = null; badges = []; state = 'GUEST'; badgeState = 'EMPTY'; } });
}
