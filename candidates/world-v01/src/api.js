// Data access layer (v0.1).
// One interface, three adapters:
//   - ServerAdapter: talks to server/server.mjs when it is reachable.
//   - FutureSyncAdapter: talks to the Cloudflare Worker sync gateway
//     (sync-worker/, Workers + Neon) when SYNC_WORKER_URL is set.
//   - LocalAdapter:  localStorage only, used offline.
// The app picks sync first, then the local server, then local mode.
// Ownership rule (lesson from the earlier pilot): the server, not the
// client, decides who owns a progress row. The Worker issues the
// session id and only that id, in the X-Session-Id header, can read
// or write that session's progress.
import { store } from './store.js';

// Set to the deployed Worker URL after `wrangler deploy`, e.g.
// 'https://inha-v01-sync.<account>.workers.dev'.
// Empty string = sync disabled; the app falls back to local server / local.
const SYNC_WORKER_URL = 'https://inha-v01-sync.aldol-lab.workers.dev';

const SAMPLE_GUESTBOOK = [
  { id: 'sample-001', roomId: 'main-gate', nickname: '[샘플] 첫 방문자', message: '[샘플] 정문 광장에서 시작합니다.', createdAt: '2026-11-06T00:00:00+09:00' },
  { id: 'sample-002', roomId: 'main-building', nickname: '[샘플] 본관 손님', message: '[샘플] 본관 앞마당이 넓네요.', createdAt: '2026-11-06T00:00:00+09:00' },
];

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('http ' + res.status));
  return data;
}

export class ServerAdapter {
  constructor() {
    this.kind = 'server';
    this.sessionId = localStorage.getItem('inha-v01:server-session') || '';
    this.nickname = store.nickname();
  }
  async health() {
    const h = await fetchJson('/api/health');
    return h.ok === true;
  }
  async ensureSession(nickname) {
    if (this.sessionId && this.nickname === nickname) return this.sessionId;
    const data = await fetchJson('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname }),
    });
    this.sessionId = data.sessionId;
    this.nickname = nickname;
    localStorage.setItem('inha-v01:server-session', this.sessionId);
    store.setNickname(nickname);
    return this.sessionId;
  }
  async getRooms() { return (await fetchJson('/api/rooms')).rooms; }
  async getQuests() { return (await fetchJson('/api/quests')).quests; }
  async getGuestbook(roomId) {
    const data = await fetchJson('/api/guestbook?room=' + encodeURIComponent(roomId));
    return data.entries;
  }
  async addGuestbook(roomId, nickname, message) {
    const data = await fetchJson('/api/guestbook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomId, nickname, message }),
    });
    return data.entry;
  }
  async getProgress() {
    const data = await fetchJson('/api/progress', { headers: { 'x-session-id': this.sessionId } });
    const out = {};
    for (const e of data.entries) out[e.questId] = { status: e.status, updatedAt: e.updatedAt };
    return out;
  }
  async completeQuest(questId, evidence) {
    const data = await fetchJson('/api/progress', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-session-id': this.sessionId },
      // No userId is sent. Ownership is the server-issued session header.
      body: JSON.stringify({ questId, evidence: evidence || {} }),
    });
    return { questId, status: data.entry.status, updatedAt: data.entry.updatedAt };
  }
}

export class LocalAdapter {
  constructor() { this.kind = 'local'; }
  async health() { return false; }
  async ensureSession(nickname) {
    store.setNickname(nickname);
    return store.localSessionId();
  }
  async getRooms() {
    const res = await fetch('data/rooms.json');
    return (await res.json()).rooms;
  }
  async getQuests() {
    const res = await fetch('data/quests.json');
    return (await res.json()).quests;
  }
  async getGuestbook(roomId) {
    const local = store.guestbook(roomId);
    const samples = SAMPLE_GUESTBOOK.filter((e) => e.roomId === roomId);
    return [...samples, ...local];
  }
  async addGuestbook(roomId, nickname, message) {
    const entry = { id: 'local-' + Date.now(), roomId, nickname, message, createdAt: new Date().toISOString() };
    return store.addGuestbook(roomId, entry);
  }
  async getProgress() { return store.progress(); }
  async completeQuest(questId) {
    store.setProgress(questId, 'done');
    return { questId, status: 'done', updatedAt: new Date().toISOString() };
  }
}

// Sync gateway adapter (Cloudflare Worker + Neon).
// Same protocol as ServerAdapter, cross-origin. Session id is stored
// under a separate localStorage key so it never collides with the
// local server's session.
export class FutureSyncAdapter {
  constructor() {
    this.kind = 'sync';
    this.base = SYNC_WORKER_URL.replace(/\/$/, '');
    this.sessionId = localStorage.getItem('inha-v01:sync-session') || '';
    this.nickname = store.nickname();
  }
  async health() {
    const h = await fetchJson(`${this.base}/api/health`);
    return h.ok === true && h.mode === 'sync';
  }
  async ensureSession(nickname) {
    if (this.sessionId && this.nickname === nickname) return this.sessionId;
    const data = await fetchJson(`${this.base}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname }),
    });
    this.sessionId = data.sessionId;
    this.nickname = nickname;
    localStorage.setItem('inha-v01:sync-session', this.sessionId);
    store.setNickname(nickname);
    return this.sessionId;
  }
  async getRooms() { return (await fetchJson(`${this.base}/api/rooms`)).rooms; }
  async getQuests() { return (await fetchJson(`${this.base}/api/quests`)).quests; }
  async getGuestbook(roomId) {
    const data = await fetchJson(`${this.base}/api/guestbook?room=` + encodeURIComponent(roomId));
    return data.entries;
  }
  async addGuestbook(roomId, nickname, message) {
    const data = await fetchJson(`${this.base}/api/guestbook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomId, nickname, message }),
    });
    return data.entry;
  }
  async getProgress() {
    const data = await fetchJson(`${this.base}/api/progress`, { headers: { 'x-session-id': this.sessionId } });
    const out = {};
    for (const e of data.entries) out[e.questId] = { status: e.status, updatedAt: e.updatedAt };
    return out;
  }
  async completeQuest(questId, evidence) {
    const data = await fetchJson(`${this.base}/api/progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-session-id': this.sessionId },
      // No userId is sent. Ownership is the server-issued session header.
      body: JSON.stringify({ questId, evidence: evidence || {} }),
    });
    return { questId, status: data.entry.status, updatedAt: data.entry.updatedAt };
  }
}

export async function pickAdapter() {
  if (globalThis.location?.origin === 'https://inhagame.app' && SYNC_WORKER_URL) {
    const sync = new FutureSyncAdapter();
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${sync.base}/api/health`, { signal: controller.signal });
      clearTimeout(t);
      if (res.ok) {
        const h = await res.json().catch(() => ({}));
        if (h.mode === 'sync') return { adapter: sync, mode: 'sync' };
      }
    } catch { /* sync off -> try local server */ }
  }
  const server = new ServerAdapter();
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1500);
    const res = await fetch('/api/health', { signal: controller.signal });
    clearTimeout(t);
    if (res.ok && (await res.json()).ok === true) return { adapter: server, mode: 'online' };
  } catch { /* server off -> local mode */ }
  return { adapter: new LocalAdapter(), mode: 'local' };
}
