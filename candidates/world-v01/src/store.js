// Local-first store (v0.1). Works with no server at all.
// Keys are namespaced so a later sync layer can migrate them.
const PREFIX = 'inha-v01:';
export const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage full / private mode: keep in-memory only */ }
  },
  nickname() { return this.get('nickname', ''); },
  setNickname(v) { this.set('nickname', v); },
  // Local (offline) session id: only a local-storage key, never sent
  // to the server as proof of ownership. The server issues its own id.
  localSessionId() {
    let id = this.get('local-session', '');
    if (!id) {
      id = 'local-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      this.set('local-session', id);
    }
    return id;
  },
  guestbook(roomId) { return this.get('guestbook:' + roomId, []); },
  addGuestbook(roomId, entry) {
    const list = this.guestbook(roomId);
    list.push(entry);
    this.set('guestbook:' + roomId, list);
    return entry;
  },
  progress() { return this.get('progress', {}); },
  setProgress(questId, status) {
    const p = this.progress();
    p[questId] = { status, updatedAt: new Date().toISOString() };
    this.set('progress', p);
    return p;
  },
};
