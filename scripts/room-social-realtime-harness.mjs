// Raw Phoenix WebSocket observation, restricted to the checked-in disposable Supabase API.
// No application decoder, nonce filter, or UI is in the receive path. Never log frames/tokens.
// Protocol reference: https://supabase.com/docs/guides/realtime/protocol (v1 text frames).
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { waitUntil } from './room-social-pg-harness.mjs';

export function assertLocalApi(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('ROOM_SOCIAL_LOCAL_API_REQUIRED'); }
  assert.equal(url.protocol, 'http:');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'loopback API only');
  assert.equal(url.port, '54321', 'checked-in disposable API port only');
  assert.equal(url.pathname, '/'); assert.equal(url.search, ''); assert.equal(url.hash, '');
  assert.equal(url.username, ''); assert.equal(url.password, '');
  return url;
}
export function fixtureJwt(sub, secret) {
  assert.match(sub, /^[0-9a-f-]{36}$/); assert.ok(secret, 'local fixture signing secret required');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const claims = encode({ sub, aud: 'authenticated', role: 'authenticated', is_anonymous: false,
    session_id: randomUUID(), iat: now, exp: now + 600 });
  return `${header}.${claims}.${createHmac('sha256', secret).update(`${header}.${claims}`).digest('base64url')}`;
}
export async function connectRawReceiver({ apiUrl, anonKey, token }) {
  const url = assertLocalApi(apiUrl); assert.ok(anonKey && token, 'local fixture credentials required');
  url.protocol = 'ws:'; url.pathname = '/realtime/v1/websocket';
  url.searchParams.set('apikey', anonKey); url.searchParams.set('vsn', '1.0.0');
  const socket = new WebSocket(url), frames = [], replies = new Map(), joined = new Set(), stopped = new Set();
  let nextRef = 0, failed = false, closed = false;
  socket.addEventListener('error', () => { failed = true; });
  socket.addEventListener('close', () => { closed = true; });
  socket.addEventListener('message', message => {
    let frame;
    try { frame = JSON.parse(String(message.data)); } catch { failed = true; return; }
    frames.push(frame); // Observe the full raw frame before any application-level interpretation.
    if (['phx_close','phx_error'].includes(frame.event)) stopped.add(frame.topic);
    if (frame.event === 'phx_reply') replies.set(String(frame.ref), frame.payload);
  });
  try {
    await waitUntil(() => {
      if (failed || closed) throw new Error('LOCAL_REALTIME_CONNECT_FAILED');
      return socket.readyState === WebSocket.OPEN;
    }, { timeoutMs: 10000, description: 'raw local Realtime socket opens' });
  } catch (error) { socket.close(); throw error; }
  const heartbeat = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++nextRef) }));
  }, 5000);
  heartbeat.unref?.();
  const assertOpen = () => {
    assert.equal(failed, false, 'raw WebSocket must remain healthy');
    assert.equal(closed, false, 'retained subscriber must not disconnect');
    assert.equal(socket.readyState, WebSocket.OPEN);
  };
  const join = async topic => {
    assert.match(topic, /^world:(?:club:ROOM_CLUBHOUSE_01:|room-chat:)[0-9a-f-]{36}$/);
    assertOpen(); const ref = String(++nextRef);
    socket.send(JSON.stringify({ topic: `realtime:${topic}`, event: 'phx_join', ref, join_ref: ref,
      payload: { config: { private: true, broadcast: { ack: true, self: false, replication_ready: true }, presence: { enabled: false }, postgres_changes: [] }, access_token: token } }));
    const reply = await waitUntil(() => { assertOpen(); return replies.get(ref); },
      { timeoutMs: 10000, description: 'private local Realtime subscription reply' });
    assert.equal(reply.status, 'ok', 'private subscription must authorize before the regression starts');
    await waitUntil(() => { assertOpen(); return frames.some(frame => frame.topic === `realtime:${topic}` && frame.event === 'system' && frame.payload?.extension === 'system' && frame.payload?.status === 'ok' && frame.payload?.message === 'Replication connection established'); },
      { timeoutMs: 15000, description: 'provider confirms database-broadcast replication is ready' });
    joined.add(`realtime:${topic}`);
  };
  return { frames, join, assertOpen,
    assertSubscribed: topic => { assertOpen(); assert.ok(joined.has(`realtime:${topic}`)); assert.equal(stopped.has(`realtime:${topic}`),false,'retained raw channel must stay joined'); },
    count: (topic, marker) => frames.filter(frame => frame.topic === `realtime:${topic}` && frame.event === 'broadcast' && JSON.stringify(frame.payload).includes(marker)).length,
    close: () => { clearInterval(heartbeat); socket.close(); } };
}
