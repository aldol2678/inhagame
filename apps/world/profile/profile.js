(() => {
  'use strict';
  const client = window.supabase?.createClient?.(
    ((globalThis.__INHAGAME_PUBLIC_SUPABASE__||{}).url),
    ((globalThis.__INHAGAME_PUBLIC_SUPABASE__||{}).publishableKey)
  );
  const $ = id => document.getElementById(id);
  const telemetry = window.InhaHubTelemetry;
  const avatars = Object.freeze({ classic:'🦆', scholar:'📚', explorer:'🧭', star:'⭐' });
  const slugToCatalog = Object.freeze({
    'inha-duck':'classic', induckup:'induckup', 'inha-duck-survival':'survival'
  });
  const allowedOrigins = new Set([
    'https://duck.inhagame.app','https://induckup.inhagame.app',
    'https://survival.inhagame.app','https://grow.inhagame.app'
  ]);
  let version = 0, userId = null, current = null, departments = [], catalog = [];
  function status(message) { $('profile-status').textContent = message; }
  function date(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return '확인 중';
    return new Intl.DateTimeFormat('ko-KR', { dateStyle:'medium' }).format(new Date(value));
  }
  function safeCatalog(payload) {
    if (payload?.schemaVersion !== 1 || !Array.isArray(payload.games)) throw Error('카탈로그 오류');
    const ids = new Set();
    return payload.games.map(game => {
      if (!game || typeof game.id !== 'string' || !/^[a-z0-9-]+$/.test(game.id) ||
        ids.has(game.id) || typeof game.title !== 'string' || !game.title.trim() ||
        !Number.isInteger(game.sortOrder) || !['playable','planned'].includes(game.status)) throw Error('카탈로그 오류');
      ids.add(game.id);
      const raw = game.playUrl;
      let playUrl = null;
      if (raw === '/campus/?lobby=1') playUrl = raw;
      else if (typeof raw === 'string') {
        const url = new URL(raw);
        if (allowedOrigins.has(url.origin) && !url.username && !url.password &&
          !url.search && !url.hash) playUrl = url.href;
      }
      if (game.status === 'playable' && !playUrl || game.status === 'planned' && raw != null) throw Error('카탈로그 오류');
      return { id:game.id, title:game.title, status:game.status, sortOrder:game.sortOrder, playUrl };
    }).sort((a,b)=>a.sortOrder-b.sortOrder || a.id.localeCompare(b.id));
  }
  function item(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function renderGames() {
    const container = $('profile-games');
    container.replaceChildren();
    const byId = new Map(current.games.map(game => [slugToCatalog[game.slug] || game.slug, game]));
    for (const game of catalog) {
      const summary = byId.get(game.id);
      const card = document.createElement('article');
      card.className = 'card';
      card.append(item('h3', game.title));
      const playable = game.status === 'playable' && !!game.playUrl;
      const played = !!summary?.played;
      card.append(item('span', !playable ? '준비 중' : !summary ? '기록 연결 준비 중' :
        played ? '플레이한 게임' : '아직 플레이하지 않았어요', 'badge'));
      if (played) {
        card.append(item('p', summary.headline?.label ?
          summary.headline.label + ' · ' + summary.headline.value : '기록 연결 준비 중'));
        if (summary.subline?.label) card.append(item('p', summary.subline.label + ' · ' + summary.subline.value));
        card.append(item('p', '최근 활동 · ' + date(summary.lastPlayedAt)));
      } else if (playable && summary) {
        card.append(item('p', '첫 플레이 기록이 연결되면 이곳에 표시돼요.'));
      } else if (playable) {
        card.append(item('p', '계정 기록이 연결되면 이곳에서 활동을 볼 수 있어요.'));
      }
      if (playable) {
        const link = item('a', !summary || played ? '게임으로 이동 →' : '첫 플레이 →', 'secondary');
        link.href = game.playUrl;
        if (game.playUrl.startsWith('https://')) link.rel = 'noopener noreferrer';
        link.addEventListener('click', () => {
          const id = telemetry?.track('profile_game_click', 'profile', game.id);
          if (id) {
            const url = new URL(link.href, location.href);
            url.searchParams.set('ih_entry', id);
            link.href = url.href;
          }
        });
        card.append(link);
      }
      container.append(card);
    }
  }
  function render() {
    const p = current.profile;
    $('profile-avatar').textContent = avatars[p.avatar] || avatars.classic;
    $('profile-nickname').textContent = p.nickname;
    $('profile-department').textContent = p.department || '학과 미선택';
    $('profile-title').textContent = p.title || '칭호 미설정';
    $('profile-badge').hidden = p.inhaVerified !== true;
    $('profile-summary').textContent = current.stats.playedGames + '개 게임 플레이' +
      (current.games.some(g=>g.lastPlayedAt) ?
        ' · 최근 활동 ' + date(current.games.filter(g=>g.lastPlayedAt)
          .sort((a,b)=>Date.parse(b.lastPlayedAt)-Date.parse(a.lastPlayedAt))[0].lastPlayedAt) : '');
    $('profile-joined').textContent = date(p.joinedAt);
    $('profile-verified').textContent = p.inhaVerified ? '완료' : '미완료';
    renderGames();
    $('profile-content').hidden = false;
    $('profile-login').hidden = true;
    status('');
  }
  function clearAchievements() {
    $('profile-achievement-result').hidden = true;
    $('profile-achievement-retry').hidden = true;
    $('profile-achievement-status').textContent = '업적을 불러오는 중…';
    $('profile-achievement-count').textContent = '';
    $('profile-achievement-title').textContent = '';
    $('profile-achievement-description').textContent = '';
    $('profile-achievement-date').textContent = '';
  }
  async function loadAchievements() {
    const mine = version, id = userId;
    if (!id || !current) return;
    clearAchievements();
    try {
      const { data, error } = await client.rpc('get_my_achievements');
      if (mine !== version || userId !== id) return;
      if (error) throw error;
      if (!Number.isInteger(data?.earnedCount) || data.earnedCount < 0 ||
          !Array.isArray(data.achievements)) throw Error('업적 응답 오류');
      const earned = data.achievements.filter(a => a?.earned === true);
      if (earned.length !== data.earnedCount || earned.some(a =>
          typeof a.key !== 'string' || typeof a.title !== 'string' ||
          typeof a.description !== 'string' || !a.title.trim())) {
        throw Error('업적 응답 오류');
      }
      earned.sort((a,b) => (Date.parse(b.earnedAt) || 0) -
        (Date.parse(a.earnedAt) || 0) || a.key.localeCompare(b.key));
      $('profile-achievement-count').textContent = data.earnedCount + '개 획득한 업적';
      const representative = earned[0];
      $('profile-achievement-title').hidden = !representative;
      $('profile-achievement-description').hidden = !representative;
      $('profile-achievement-date').hidden = !representative;
      $('profile-achievement-empty').hidden = !!representative;
      if (representative) {
        $('profile-achievement-title').textContent = representative.title;
        $('profile-achievement-description').textContent = representative.description;
        $('profile-achievement-date').textContent = '기록일 · ' + date(representative.earnedAt);
      }
      $('profile-achievement-result').hidden = false;
      $('profile-achievement-status').textContent = '';
    } catch (error) {
      if (mine !== version || userId !== id) return;
      console.warn('Profile achievement load failed', error);
      $('profile-achievement-status').textContent = '업적을 불러오지 못했어요.';
      $('profile-achievement-retry').hidden = false;
    }
  }
  function reset() {
    version++;
    userId = null; current = null; departments = []; catalog = [];
    $('profile-content').hidden = true;
    $('profile-edit').hidden = true;
    $('profile-games').replaceChildren();
    clearAchievements();
  }
  async function load() {
    const mine = ++version;
    status('프로필을 불러오는 중…');
    if (!client) { reset(); status('계정 서비스를 불러오지 못했습니다. 새로고침해 주세요.'); return; }
    const { data: auth, error: authError } = await client.auth.getUser();
    if (mine !== version) return;
    if (authError && authError.name !== 'AuthSessionMissingError') {
      reset(); status('로그인 상태를 확인할 수 없습니다. 다시 시도해 주세요.'); return;
    }
    const person = auth?.user;
    if (!person?.id || person.is_anonymous === true || !person.email) {
      reset(); $('profile-login').hidden = false; status('로그인이 필요합니다.'); return;
    }
    if (userId && userId !== person.id) {
      current = null; $('profile-content').hidden = true; $('profile-edit').hidden = true;
      clearAchievements();
    }
    userId = person.id;
    try {
      const [read, list, options] = await Promise.all([
        client.rpc('get_my_profile'),
        fetch('/data/game-catalog.json', { cache:'no-cache' }).then(response => {
          if (!response.ok) throw Error('카탈로그를 불러오지 못했습니다.');
          return response.json();
        }),
        client.from('departments').select('id,name').eq('active',true).order('sort_order')
      ]);
      if (mine !== version) return;
      if (read.error) throw read.error;
      if (options.error) throw options.error;
      if (!read.data?.profile || !Array.isArray(read.data.games)) throw Error('프로필 응답 오류');
      current = read.data; catalog = safeCatalog(list); departments = options.data || [];
      render();
      void loadAchievements();
      telemetry?.track('profile_view', 'profile');
    } catch (error) {
      if (mine !== version) return;
      console.warn('Profile load failed', error);
      $('profile-content').hidden = true;
      status('프로필을 불러오지 못했습니다. 새로고침해 다시 시도해 주세요.');
    }
  }
  $('edit-open').addEventListener('click', () => {
    if (!current) return;
    const p = current.profile, form = $('profile-edit-form');
    form.elements.nickname.value = p.nickname;
    form.elements.title.value = p.title || '';
    const selector = form.elements.department;
    selector.replaceChildren(new Option('학과 미선택', ''));
    for (const d of departments) selector.add(new Option(d.name, String(d.id)));
    selector.value = p.departmentId == null ? '' : String(p.departmentId);
    if (selector.selectedIndex < 0) selector.value = '';
    form.elements.avatar.value = avatars[p.avatar] ? p.avatar : 'classic';
    $('edit-status').textContent = '';
    $('profile-edit').hidden = false;
    telemetry?.track('profile_edit_open','profile');
  });
  $('edit-cancel').addEventListener('click', () => { $('profile-edit').hidden = true; });
  $('profile-edit-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('[type=submit]');
    if (!current || !userId || !form.reportValidity()) return;
    const id = userId, before = version;
    const nickname = form.elements.nickname.value.trim();
    const title = form.elements.title.value.trim();
    const department = form.elements.department.value;
    const avatar = form.elements.avatar.value;
    if (!/^[0-9A-Za-z가-힣_ ]{2,12}$/.test(nickname) ||
      title.length > 40 || !Object.hasOwn(avatars,avatar) ||
      department && !departments.some(d=>String(d.id)===department)) {
      $('edit-status').textContent = '입력값을 확인해 주세요.'; return;
    }
    button.disabled = true;
    $('edit-status').textContent = '저장하는 중…';
    const { data, error } = await client.from('profiles')
      .update({ nickname, title:title || null, department_id:department ? Number(department) : null,
        avatar_key:avatar, updated_at:new Date().toISOString() })
      .eq('user_id', id).select('user_id').single();
    button.disabled = false;
    if (before !== version || userId !== id) return;
    if (error || data?.user_id !== id) {
      $('edit-status').textContent = '저장하지 못했습니다. 다시 시도해 주세요.'; return;
    }
    telemetry?.track('profile_edit_save','profile');
    $('edit-status').textContent = '저장했습니다.';
    await load();
    if (userId === id) $('profile-edit').hidden = true;
  });
  $('profile-achievement-retry').addEventListener('click', () => void loadAchievements());
  if (client) client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || session?.user?.id && userId && session.user.id !== userId) reset();
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') setTimeout(() => void load(),0);
  });
  void load();
})();
