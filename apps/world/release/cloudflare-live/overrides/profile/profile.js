(() => {
  'use strict';
  // Firebase + Neon 계정 재구축 (2026-11-23): 구 계정 연동을 전부 제거하고 fetch + localStorage로
  // 프로필을 읽는다. 디바이스 세션 id는 localStorage 'inhaworld-firebase-session-v1'에서 읽어
  // X-Session-Id로 보낸다. GET /api/auth/firebase/me → guest:false일 때만
  // GET /api/world-profile 한 번으로 profile/games/achievements를 받는다.
  const FIREBASE_SESSION_KEY = 'inhaworld-firebase-session-v1';
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
  function readDeviceSessionId() {
    try {
      const value = window.localStorage?.getItem(FIREBASE_SESSION_KEY);
      return typeof value === 'string' && value ? value : null;
    } catch {
      return null;
    }
  }
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
  // 업적은 load()가 받은 /api/world-profile 응답의 data.achievements
  // (= get_my_achievements 결과 {earnedCount, achievements})에서 렌더링한다.
  // 별도 RPC/요청을 보내지 않으므로, 재시도 버튼은 같은 응답을 다시 그린다.
  function loadAchievements() {
    const mine = version, id = userId;
    if (!id || !current) return;
    clearAchievements();
    try {
      const data = current.achievements;
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
    const sessionId = readDeviceSessionId();
    if (!sessionId) {
      reset(); $('profile-login').hidden = false; status('로그인이 필요합니다.'); return;
    }
    let me;
    try {
      const response = await fetch('/api/auth/firebase/me', {
        headers: { 'X-Session-Id': sessionId }
      });
      if (!response.ok) {
        reset(); $('profile-login').hidden = false; status('로그인이 필요합니다.'); return;
      }
      me = await response.json();
    } catch (error) {
      if (mine !== version) return;
      console.warn('Profile auth check failed', error);
      reset(); status('로그인 상태를 확인할 수 없습니다. 다시 시도해 주세요.'); return;
    }
    if (mine !== version) return;
    if (!me || me.guest === true || !me.profileUserId) {
      reset(); $('profile-login').hidden = false; status('로그인이 필요합니다.'); return;
    }
    if (userId && userId !== me.profileUserId) {
      current = null; $('profile-content').hidden = true; $('profile-edit').hidden = true;
      clearAchievements();
    }
    userId = me.profileUserId;
    try {
      const [read, list] = await Promise.all([
        fetch('/api/world-profile', { headers: { 'X-Session-Id': sessionId } }).then(async response => {
          if (response.status === 409) {
            const error = Error('프로필이 아직 없어요.');
            error.code = 'PROFILE_REQUIRED';
            throw error;
          }
          if (!response.ok) throw Error('프로필을 불러오지 못했습니다.');
          return response.json();
        }),
        fetch('/data/game-catalog.json', { cache:'no-cache' }).then(response => {
          if (!response.ok) throw Error('카탈로그를 불러오지 못했습니다.');
          return response.json();
        })
      ]);
      if (mine !== version) return;
      if (!read?.profile || !Array.isArray(read.games)) throw Error('프로필 응답 오류');
      // 학과 목록 엔드포인트가 없어 departments는 빈 채로 둔다. 편집 폼에는 현재 학과만 넣는다.
      current = read; catalog = safeCatalog(list); departments = [];
      render();
      loadAchievements();
      telemetry?.track('profile_view', 'profile');
    } catch (error) {
      if (mine !== version) return;
      console.warn('Profile load failed', error);
      $('profile-content').hidden = true;
      status(error?.code === 'PROFILE_REQUIRED'
        ? '프로필이 아직 없어요. 캠퍼스에서 프로필을 먼저 만들어 주세요.'
        : '프로필을 불러오지 못했습니다. 새로고침해 다시 시도해 주세요.');
    }
  }
  $('edit-open').addEventListener('click', () => {
    if (!current) return;
    const p = current.profile, form = $('profile-edit-form');
    form.elements.nickname.value = p.nickname;
    form.elements.title.value = p.title || '';
    const selector = form.elements.department;
    selector.replaceChildren(new Option('학과 미선택', ''));
    // 학과 목록 엔드포인트가 없으므로 현재 학과만 선택지로 넣는다.
    if (p.department) {
      selector.add(new Option(p.department, p.departmentId == null ? '' : String(p.departmentId)));
    }
    selector.value = p.departmentId == null ? '' : String(p.departmentId);
    if (selector.selectedIndex < 0) selector.value = '';
    form.elements.avatar.value = avatars[p.avatar] ? p.avatar : 'classic';
    $('edit-status').textContent = '';
    $('profile-edit').hidden = false;
    telemetry?.track('profile_edit_open','profile');
  });
  $('edit-cancel').addEventListener('click', () => { $('profile-edit').hidden = true; });
  $('profile-edit-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('[type=submit]');
    if (!current || !userId || !form.reportValidity()) return;
    const nickname = form.elements.nickname.value.trim();
    const title = form.elements.title.value.trim();
    const department = form.elements.department.value;
    const avatar = form.elements.avatar.value;
    const currentDepartmentId = current.profile.departmentId == null ? '' : String(current.profile.departmentId);
    if (!/^[0-9A-Za-z가-힣_ -]{2,12}$/.test(nickname) ||
      title.length > 40 || !Object.hasOwn(avatars,avatar) ||
      (department && department !== currentDepartmentId)) {
      $('edit-status').textContent = '입력값을 확인해 주세요.'; return;
    }
    // 프로필 수정 엔드포인트가 없으므로 저장하지 않는다.
    $('edit-status').textContent = '프로필 편집은 준비 중입니다.';
    button.disabled = false;
  });
  $('profile-achievement-retry').addEventListener('click', () => loadAchievements());
  // 기존 onAuthStateChange 구독은 제거. 포털의 로그인/로그아웃은
  // 'inhaworld-auth-changed' 커스텀 이벤트로 알린다.
  window.addEventListener('inhaworld-auth-changed', () => { void load(); });
  void load();
})();
