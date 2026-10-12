import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRoomChat, parseRoomChatMessage, validRoomChatContext } from '../src/rooms/room-chat.js';
import { createChatPanel } from '../src/online/chat-panel.js';
import { createFakeDocument } from './support/fake-dom.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const room = id(100), otherRoom = id(101), owner = id(1), friend = id(2), stranger = id(3);
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const context = (n, roomId = room) => ({ kind: 'personal', roomId, sessionId: id(n) });

function fixture() {
  const clock = { t: 1000, now() { return this.t; } };
  const leases = new Map(), channels = [], calls = [], denied = new Set([stranger]), blocks = new Set();
  let serial = 1000, failing = false, gate = null, responseGate = null;
  const pair = (a, b) => [a, b].sort().join(':');
  const allowed = (u) => !denied.has(u);
  const dataFor = l => ({ version: 1, allowed: true, leaseId: l.id, kind: l.kind, roomId: l.roomId,
    sessionId: l.sessionId, userId: l.userId, topic: `world:room-chat:${l.id}`, ttlMs: 30000 });
  const client = userId => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: userId, is_anonymous: false }, access_token: 'fixture-token' } } }) },
    realtime: { setAuth: async () => {} },
    async rpc(name, args) {
      calls.push({ userId, name, args });
      if (gate?.name === name) await gate.promise;
      if (failing) return { error: { message: 'unavailable' } };
      if (name === 'join_world_room_chat_v1') {
        if (!allowed(userId)) return { data: { allowed: false } };
        for (const [key, l] of leases) if (l.userId === userId) leases.delete(key);
        const l = { id: id(++serial), userId, kind: args.p_kind, roomId: args.p_room, sessionId: args.p_session, expires: clock.t + 30000, sent: [] };
        leases.set(l.id, l); return { data: dataFor(l) };
      }
      const l = leases.get(args.p_lease);
      if (!l || l.userId !== userId || l.expires <= clock.t || !allowed(userId)) return { data: { allowed: false, ok: false, reason: 'denied' } };
      if (name === 'leave_world_room_chat_v1') { leases.delete(l.id); return { data: true }; }
      if (name === 'renew_world_room_chat_v1') { l.expires = clock.t + 30000; return { data: dataFor(l) }; }
      if (name === 'send_world_room_chat_v1') {
        l.sent = l.sent.filter(t => clock.t - t < 5000);
        if (l.sent.length >= 3) return { data: { ok: false, reason: 'rate_limited' } };
        l.sent.push(clock.t);
        const message = { v: 1, id: id(++serial), kind: l.kind, roomId: l.roomId, sessionId: l.sessionId,
          userId, name: userId === owner ? '방주인' : '친구', text: args.p_text };
        for (const target of leases.values()) if (target.userId !== userId && target.kind === l.kind && target.roomId === l.roomId &&
          allowed(target.userId) && target.expires > clock.t && !blocks.has(pair(userId, target.userId))) {
          for (const c of channels) if (!c.removed && c.topic === dataFor(target).topic) c.receive({ payload: message });
        }
        if (responseGate) await responseGate;
        return { data: { ok: true, message } };
      }
      return { error: { message: 'missing rpc' } };
    },
    channel(topic, options) {
      const c = { topic, options, userId, removed: false, on(_type, _event, receive) { this.receive = receive; return this; },
        subscribe(callback) { this.status = callback; queueMicrotask(() => { if (!this.removed) callback('SUBSCRIBED'); }); return this; } };
      channels.push(c); return c;
    },
    removeChannel(c) { c.removed = true; }
  });
  const make = userId => {
    let identity = { userId }, c = client(userId);
    const chat = createRoomChat({ getClient: () => c, getIdentity: () => identity, clock, windowTarget: null,
      isBlocked: u => blocks.has(pair(identity?.userId, u)) });
    return { chat, get channel() { return channels.findLast(x => !x.removed && x.userId === identity?.userId); },
      setIdentity(u) { identity = u ? { userId: u } : null; c = u ? client(u) : null; } };
  };
  return { clock, leases, channels, calls, denied, make, block: (a,b) => blocks.add(pair(a,b)),
    deferResponse() { let release; responseGate = new Promise(r => { release = r; }); return () => { responseGate = null; release(); }; },
    fail: value => { failing = value; }, defer(name) { let release; gate = { name, promise: new Promise(r => { release = r; }) }; return () => { gate = null; release(); }; } };
}
async function join(f, userId, n, roomId = room) {
  const p = f.make(userId); assert.equal(await p.chat.enter(context(n, roomId)), true); await flush();
  assert.equal(p.chat.status().phase, 'READY'); return p;
}

test('strict personal/club contexts and sender envelopes reject malformed or cross-room messages', () => {
  assert.equal(validRoomChatContext(context(20)), true);
  assert.equal(validRoomChatContext({ ...context(20), kind: 'club', roomId: 'ROOM_CLUBHOUSE_01' }), true);
  for (const c of [{ ...context(20), roomId: 'AREA_MAIN' }, { ...context(20), sessionId: 'spoof' }, { ...context(20), kind: 'campus' }])
    assert.equal(validRoomChatContext(c), false);
  const msg = { v: 1, id: id(99), ...context(20), userId: owner, name: '방주인', text: '안녕' };
  assert.equal(parseRoomChatMessage(msg, context(20)).text, '안녕');
  for (const m of [{ ...msg, roomId: otherRoom }, { ...msg, kind: 'club' }, { ...msg, userId: 'bad' }, { ...msg, text: 'a'.repeat(121) }, { ...msg, text: '\u202Eevil' }, { ...msg, name: [] }])
    assert.equal(parseRoomChatMessage(m, context(20)), null);
});

test('owner/visitor exchange server-certified text and bubbles, no distance filter or client broadcast', async () => {
  const f = fixture(), a = await join(f, owner, 20), b = await join(f, friend, 21);
  assert.equal((await a.chat.submit(' 안녕 👋 ')).result, 'sent');
  assert.deepEqual(b.chat.feed.entries.map(e => [e.userId,e.name,e.text]), [[owner,'방주인','안녕 👋']]);
  assert.equal(b.chat.bubbleFor(id(20), owner), '방주인: 안녕 👋');
  assert.equal(b.chat.bubbleFor(id(20), stranger), null, 'unverified avatar user ID cannot receive this bubble');
  assert.equal(a.chat.ownBubble(), '안녕 👋');
  const send = f.calls.find(c => c.name === 'send_world_room_chat_v1');
  assert.deepEqual(Object.keys(send.args).sort(), ['p_lease','p_text'], 'caller cannot supply a sender, nickname or destination');
  assert.equal(f.channels.every(c => c.options.config.private && !c.send), true);
  f.clock.t += 4000; assert.equal(b.chat.bubbleFor(id(20), owner), null);
});

test('stranger, missing server contract, account mismatch fail closed without any public fallback', async () => {
  const f = fixture(), s = f.make(stranger);
  assert.equal(await s.chat.enter(context(23)), false); assert.equal(f.channels.length, 0);
  assert.equal((await s.chat.submit('no')).result, 'room_unavailable');
  f.fail(true); const a = f.make(owner); assert.equal(await a.chat.enter(context(20)), false);
  assert.equal(f.channels.length, 0); assert.equal(a.chat.status().phase, 'UNAVAILABLE');
  a.setIdentity(null); a.chat.update(); assert.equal(a.chat.status().active, false);
});

test('room/campus isolation, bilateral blocks and permission loss hold even with an old live inbox', async () => {
  const f = fixture(), a = await join(f, owner, 20), b = await join(f, friend, 21);
  const c = await join(f, id(4), 22, otherRoom);
  await a.chat.submit('room only'); assert.equal(c.chat.feed.entries.length, 0);
  f.block(owner, friend); await a.chat.submit('blocked'); assert.equal(b.chat.feed.entries.length, 1);
  b.chat.removeSender(owner); assert.equal(b.chat.feed.entries.length, 0); assert.equal(b.chat.bubbleFor(id(20), owner), null);
  f.denied.add(friend); await a.chat.submit('revoked'); assert.equal(b.chat.feed.entries.length, 0);
  assert.equal(await b.chat.revalidateNow(), false); assert.equal(b.chat.canChat, false);
  assert.equal(b.chat.status().phase, 'UNAVAILABLE');
});

test('send normalization, Unicode length, pending suppression, server rate limits and XSS as inert text', async () => {
  const f = fixture(), a = await join(f, owner, 20), b = await join(f, friend, 21);
  assert.equal((await a.chat.submit('👋'.repeat(121))).result, 'too_long');
  assert.equal((await a.chat.submit('  ')).result, 'empty');
  assert.equal((await a.chat.submit('<img src=x onerror=alert(1)>')).result, 'sent');
  assert.equal(b.chat.feed.entries[0].text, '<img src=x onerror=alert(1)>');
  await a.chat.submit('2'); await a.chat.submit('3');
  assert.equal((await a.chat.submit('4')).result, 'rate_limited');
  f.clock.t += 5001;
  const release = f.defer('send_world_room_chat_v1'); const pending = a.chat.submit('new');
  assert.equal((await a.chat.submit('duplicate')).result, 'pending'); release(); await pending;
});

test('leave, room switch, account switch, page lifecycle and stale async responses never restore old content', async () => {
  const f = fixture(), a = await join(f, owner, 20), b = await join(f, friend, 21);
  await a.chat.submit('before'); const oldChannel = f.channels[1];
  b.chat.stop(); assert.equal(b.chat.feed.entries.length, 0); assert.equal(oldChannel.removed, true);
  oldChannel.receive({ payload: { v: 1,id:id(77),...context(20),userId:owner,name:'방주인',text:'late' } });
  assert.equal(b.chat.feed.entries.length, 0);
  const release = f.defer('join_world_room_chat_v1'); const joining = b.chat.enter(context(30));
  b.setIdentity(stranger); b.chat.stop(); release(); assert.equal(await joining, false);
  assert.equal(b.chat.feed.entries.length, 0); assert.equal(b.chat.status().active, false);
  a.setIdentity(friend); a.chat.update(); assert.equal(a.chat.status().active, false); assert.equal(a.chat.ownBubble(), null);
});

test('disconnect clears transcript; reconnection revalidates before READY; expired/failed leases never send', async () => {
  const f = fixture(), a = await join(f, owner, 20);
  await a.chat.submit('before'); const old = a.channel; old.status('CHANNEL_ERROR');
  assert.equal(a.chat.feed.entries.length, 0); assert.equal((await a.chat.submit('offline')).result, 'room_unavailable');
  f.clock.t += 5000; a.chat.update(); await flush(); assert.equal(a.chat.canChat, true);
  assert.notEqual(a.channel, old); assert.equal(old.removed, true);
  old.receive({ payload: { v: 1, id: id(88), ...context(21), userId: friend, name: '친구', text: 'late old connection' } });
  assert.equal(a.chat.feed.entries.length, 0, 'removed channel callback cannot restore an old transcript after reconnect');
  f.fail(true); await a.chat.revalidateNow(); assert.equal(a.chat.canChat, false);
  f.fail(false); f.clock.t += 5000; a.chat.update(); await flush();
  f.clock.t += 30001; a.chat.update(); assert.equal(a.chat.canChat, false);
});

test('async composer preserves focus/draft on failure; source reset fences old acknowledgements', async () => {
  const doc = createFakeDocument(); const input = doc.createElement('input'), hint = doc.createElement('p'), feedList = doc.createElement('ul');
  let release, sends = 0;
  const chat = { signedIn: true, submit: () => { sends++; return new Promise(r => { release = r; }); } };
  let source = chat;
  const panel = createChatPanel({ doc, input, hint, feedList, toggle: doc.createElement('button'), form: doc.createElement('form'), getChat: () => source });
  panel.setOpen(true); input.value = 'hello'; const pending = panel.send();
  assert.equal(panel.send(), 'pending'); assert.equal(sends, 1);
  release({ result: 'rate_limited' }); assert.equal(await pending, 'rate_limited'); assert.equal(panel.open, true); assert.equal(input.value, 'hello');
  const next = panel.send(); panel.reset(); source = { signedIn: true, submit: () => ({ result: 'sent' }) };
  panel.setOpen(true); input.value = 'new room draft'; release({ result: 'sent' });
  assert.equal(await next, 'cancelled'); assert.equal(input.value, 'new room draft'); assert.equal(panel.open, true);
  panel.renderFeed([{ name: '<script>', text: '<img src=x onerror=evil()>' }]);
  assert.equal(feedList.children[0].children[1].textContent, '<img src=x onerror=evil()>');
});

test('main routes room chat, clears source/account state and keeps campus feed out of room UI', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /getChat: activeChat/); assert.match(main, /activeChat\(\)\?\.ownBubble/);
  assert.match(main, /rooms\.onChange\(\(\) => \{ roomChat\.stop\(\); chatPanel\.reset\(\); \}\)/);
  assert.match(main, /if \(activeChat\(\) === online\.chat\)/); assert.match(main, /roomChat\?\.stop\(\);\s*chatPanel\.reset\(\)/);
});

test('same session UUID from another certified user cannot replace victim or own bubble text', async () => {
  const f = fixture(), a = await join(f, owner, 20), b = await join(f, friend, 21);
  const attacker = await join(f, id(4), 20); // personal Presence IDs are client chosen
  await a.chat.submit('real owner'); await attacker.chat.submit('forged');
  assert.equal(b.chat.bubbleFor(id(20), owner), '방주인: real owner');
  assert.equal(b.chat.bubbleFor(id(20), id(4)), '친구: forged');
  assert.equal(a.chat.ownBubble(), 'real owner');
  assert.equal(b.chat.feed.entries.at(-1).userId, id(4), 'feed remains attributed to real authenticated caller');
  b.chat.removeSender(id(4));
  assert.equal(b.chat.bubbleFor(id(20), owner), '방주인: real owner', 'blocking a duplicate SID cannot erase another user bubble');
  assert.equal(b.chat.bubbleFor(id(20), id(4)), null);
});

test('valid-lease renewal never drops incoming messages or an already accepted send acknowledgement', async () => {
  const f = fixture(), a = await join(f, owner, 20), b = await join(f, friend, 21);
  const release = f.defer('renew_world_room_chat_v1');
  const renewal = a.chat.revalidateNow();
  assert.equal(a.chat.canChat, true, 'existing lease remains usable until its deadline');
  await b.chat.submit('during renewal');
  assert.equal(a.chat.feed.entries.at(-1).text, 'during renewal');
  assert.equal((await a.chat.submit('own ack during renewal')).result, 'sent');
  assert.equal(a.chat.ownBubble(), 'own ack during renewal');
  release(); assert.equal(await renewal, true);
  const releaseLate = f.defer('renew_world_room_chat_v1'); const late = a.chat.revalidateNow();
  a.channel.status('CHANNEL_ERROR'); releaseLate(); await late;
  assert.equal(a.chat.status().phase, 'UNAVAILABLE', 'late success cannot reopen a failed channel');
  assert.equal(a.chat.canChat, false);
});

test('late joins release their own lease before a newer room join; stopped join leaves no ghost membership', async () => {
  const f = fixture(), a = f.make(owner);
  const release = f.defer('join_world_room_chat_v1'); const old = a.chat.enter(context(20)); await flush();
  const next = a.chat.enter(context(21, otherRoom)); release(); await old; await next; await flush();
  assert.equal(a.chat.status().roomId, otherRoom); assert.equal(a.chat.canChat, true);
  assert.equal(f.leases.size, 1); assert.equal([...f.leases.values()][0].roomId, otherRoom);
  a.chat.stop(); await flush(); assert.equal(f.leases.size, 0);
  const releaseStopped = f.defer('join_world_room_chat_v1'); const joining = a.chat.enter(context(30)); await flush();
  a.chat.stop(); releaseStopped(); assert.equal(await joining, false); await flush();
  assert.equal(f.leases.size, 0); assert.equal(a.chat.status().active, false);
});

test('late acknowledgement from a lost connection cannot repopulate a fresh room transcript', async () => {
  const f = fixture(), a = await join(f, owner, 20), b = await join(f, friend, 21);
  const release = f.deferResponse(); const pending = a.chat.submit('accepted before disconnect'); await flush();
  assert.equal(b.chat.feed.entries.length, 1, 'server already delivered the message');
  a.channel.status('CHANNEL_ERROR'); f.clock.t += 5000; a.chat.update(); await flush();
  assert.equal(a.chat.canChat, true); assert.equal(a.chat.feed.entries.length, 0);
  release(); assert.equal((await pending).result, 'cancelled');
  assert.equal(a.chat.feed.entries.length, 0); assert.equal(a.chat.ownBubble(), null);
});

test('reused input accurately labels room scope and restores the campus distance label', () => {
  const doc = createFakeDocument(), input = doc.createElement('input');
  const panel = createChatPanel({doc,input,hint:doc.createElement('p'),feedList:doc.createElement('ul'),
    toggle:doc.createElement('button'),form:doc.createElement('form'),getChat:()=>({signedIn:true})});
  panel.setRoomScope(true); assert.equal(input.placeholder,'이 방 참가자에게 말하기');
  assert.equal(input.getAttribute('aria-label'),'이 방 참가자에게 채팅');
  panel.setRoomScope(false); assert.equal(input.placeholder,'근처 15m에 말하기');
});
