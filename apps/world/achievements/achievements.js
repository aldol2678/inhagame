(() => {
  'use strict';
  const client = window.supabase?.createClient?.(
    ((globalThis.__INHAGAME_PUBLIC_SUPABASE__||{}).url),
    ((globalThis.__INHAGAME_PUBLIC_SUPABASE__||{}).publishableKey)
  );
  const $ = id => document.getElementById(id);
  let version = 0, userId = null;
  function status(message) { $('achievement-status').textContent = message; }
  function date(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return '날짜 확인 중';
    return new Intl.DateTimeFormat('ko-KR', { dateStyle:'medium' }).format(new Date(value));
  }
  function item(tag, value, className) {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  }
  function clear() {
    version++;
    userId = null;
    $('achievement-content').hidden = true;
    $('achievement-login').hidden = true;
    $('achievement-list').replaceChildren();
  }
  function render(data) {
    if (!Number.isInteger(data?.earnedCount) || !Array.isArray(data.achievements)) {
      throw Error('업적 응답 오류');
    }
    $('achievement-count').textContent = String(data.earnedCount) + '개';
    const list = $('achievement-list');
    list.replaceChildren();
    for (const achievement of data.achievements) {
      const card = document.createElement('article');
      card.className = 'card achievement-card';
      card.dataset.earned = achievement.earned === true ? 'true' : 'false';
      card.append(item('span', achievement.earned === true ? '획득' : '미획득', 'badge'));
      card.append(item('h3', achievement.title));
      card.append(item('p', achievement.description));
      if (achievement.earned === true) {
        card.append(item('p', '근거 · ' + achievement.evidence));
        card.append(item('p', '기록일 · ' + date(achievement.earnedAt)));
      } else {
        card.append(item('p', typeof achievement.requirement === 'string' && achievement.requirement.trim() ?
          achievement.requirement : '계정에 Classic 기록을 남기면 획득해요.'));
      }
      list.append(card);
    }
    $('achievement-content').hidden = false;
    status('');
  }
  async function load() {
    const mine = ++version;
    $('achievement-content').hidden = true;
    $('achievement-login').hidden = true;
    $('achievement-retry').hidden = true;
    status('업적을 불러오는 중…');
    if (!client) {
      status('계정 서비스를 불러오지 못했습니다. 다시 시도해 주세요.');
      $('achievement-retry').hidden = false;
      return;
    }
    try {
      const { data: auth, error: authError } = await client.auth.getUser();
      if (mine !== version) return;
      if (authError && authError.name !== 'AuthSessionMissingError') throw authError;
      const person = auth?.user;
      if (!person?.id || person.is_anonymous === true || !person.email) {
        clear();
        $('achievement-login').hidden = false;
        status('로그인이 필요합니다.');
        return;
      }
      userId = person.id;
      const { data, error } = await client.rpc('get_my_achievements');
      if (mine !== version || userId !== person.id) return;
      if (error) throw error;
      render(data);
    } catch (error) {
      if (mine !== version) return;
      console.warn('Achievement load failed', error);
      $('achievement-content').hidden = true;
      status('업적을 불러오지 못했습니다. 로그인 상태를 확인하고 다시 시도해 주세요.');
      $('achievement-retry').hidden = false;
    }
  }
  $('achievement-retry').addEventListener('click', () => void load());
  if (client) client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || session?.user?.id && userId && session.user.id !== userId) clear();
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') setTimeout(() => void load(), 0);
  });
  void load();
})();

