// One URL policy and catalog contract for the static generator and the browser hub.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InhaGameCatalog = api;
})(globalThis, function () {
  'use strict';
  // Adding a playable game requires explicit review of this ID -> exact URL map.
  const playUrls = Object.freeze({
    classic: 'https://duck.inhagame.app/',
    induckup: 'https://induckup.inhagame.app/',
    survival: 'https://survival.inhagame.app/',
    'induck-grow': 'https://grow.inhagame.app/'
  });
  const genres = new Set(['아케이드', '액션', '시뮬레이션', '퍼즐', '전략', 'RPG', '기타']);
  const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  function checkedPlayUrl(value, id) {
    if (id === 'campus') return value === '/campus/?lobby=1' ? value : null;
    if (!Object.hasOwn(playUrls, id) || value !== playUrls[id]) return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password &&
        url.pathname === '/' && !url.search && !url.hash && url.href === value ? value : null;
    } catch { return null; }
  }
  function readCatalog(payload) {
    if (payload?.schemaVersion !== 1 || !Array.isArray(payload.games) || !payload.games.length) {
      throw new Error('Unknown game catalog format');
    }
    const seen = new Set();
    return payload.games.map(game => {
      if (!game || typeof game.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(game.id) ||
          seen.has(game.id) || !text(game.title, 60) || !text(game.description, 160) ||
          !Number.isInteger(game.sortOrder) || game.sortOrder < 0 ||
          !['playable', 'planned'].includes(game.status)) throw new Error('Invalid game catalog entry');
      seen.add(game.id);
      const playUrl = game.status === 'playable' ? checkedPlayUrl(game.playUrl, game.id) : null;
      if (game.status === 'playable' && !playUrl || game.status === 'planned' && game.playUrl != null) {
        throw new Error('Invalid game link or status: ' + game.id);
      }
      if (game.id !== 'campus') {
        const p = game.platform;
        if (!p || !genres.has(p.genre) || !text(p.label, 30) ||
            p.posterLabel != null && !text(p.posterLabel, 30) ||
            p.coverImage !== '/assets/hub/' + game.id + '-concept.svg') {
          throw new Error('Invalid cover/genre: ' + game.id);
        }
      }
      return { ...game, playUrl };
    }).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id, 'en'));
  }
  function gameIdForUrl(value) {
    const url = new URL(value);
    return Object.keys(playUrls).find(id => new URL(playUrls[id]).origin === url.origin) || null;
  }
  return Object.freeze({ readCatalog, checkedPlayUrl, gameIdForUrl });
});
