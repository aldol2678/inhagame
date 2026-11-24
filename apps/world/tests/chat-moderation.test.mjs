// INHA WORLD — campus local-chat profanity filter unit test.
// Run: node --test tests/chat-moderation.test.mjs
// (Node, no dependencies, no network.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatComposer, ChatFeed } from '../src/online/local-chat.js';
import {
  CHAT_BANNED_WORDS,
  chatHasBannedWord,
  chatModeration,
  normalizeChatFilterText,
} from '../src/online/chat-moderation.js';

test('word list matches the DB seed (47 words)', () => {
  assert.equal(CHAT_BANNED_WORDS.length, 47);
  for (const w of ['씨발', '병신', 'ㅅㅂ', '쪽바리', 'fuck', 'asshole']) {
    assert.ok(CHAT_BANNED_WORDS.includes(w), w);
  }
  // Bare "년" was deliberately excluded in word-alchemy patch35 (소년연금술사
  // false positive), so it must not be here either.
  assert.ok(!CHAT_BANNED_WORDS.includes('년'));
});

test('normalize strips separators, leet and runs (word-alchemy port)', () => {
  assert.equal(normalizeChatFilterText('시 발'), '시발');
  assert.equal(normalizeChatFilterText('씨씨발'), '씨발');
  assert.equal(normalizeChatFilterText('f u c k'), 'fuck');
  assert.equal(normalizeChatFilterText('fuuck'), 'fuck');
  assert.equal(normalizeChatFilterText('SH1T'), 'shit');
});

test('chatHasBannedWord: direct, bypassed, and clean text', () => {
  assert.equal(chatHasBannedWord('아 씨발 진짜'), true);
  assert.equal(chatHasBannedWord('시 발'), true);
  assert.equal(chatHasBannedWord('씨씨발'), true);
  assert.equal(chatHasBannedWord('f u c k'), true);
  assert.equal(chatHasBannedWord('ㅅㅂ'), true);
  assert.equal(chatHasBannedWord('안녕하세요 오늘 날씨 좋네요'), false);
  assert.equal(chatHasBannedWord('소년연금술사'), false);
  assert.equal(chatHasBannedWord(''), false);
});

function fakeClock() {
  let now = 1000;
  return { now: () => now, tick: (ms) => { now += ms; } };
}

test('ChatComposer with the filter: banned is moderated, clean is sent', () => {
  const clock = fakeClock();
  const sent = [];
  const chat = new ChatComposer({
    clock,
    send: (text) => { sent.push(text); return true; },
    moderation: chatModeration,
    canSend: () => true,
  });
  assert.deepEqual(chat.submit('씨발'), { result: 'moderated' });
  assert.equal(chat.stats.moderated, 1);
  assert.deepEqual(sent, []);
  assert.deepEqual(chat.submit('안녕하세요'), { result: 'sent', text: '안녕하세요' });
  assert.deepEqual(sent, ['안녕하세요']);
});

test('ChatFeed with the filter: banned incoming is dropped, clean is shown', () => {
  const clock = fakeClock();
  const feed = new ChatFeed({ clock, moderation: chatModeration });
  feed.setPlaceZone('zone-a');
  const sender = { sessionId: 's1', userId: 'u1', displayName: '테스트', placeZoneId: 'zone-a' };
  const at = { x: 0, y: 0, z: 0 };
  assert.equal(
    feed.receive({ sender, placeZoneId: 'zone-a', text: '시발', position: at, receiverPosition: at }),
    'moderated',
  );
  assert.equal(feed.entries.length, 0);
  assert.equal(feed.stats.moderated, 1);
  assert.equal(
    feed.receive({ sender, placeZoneId: 'zone-a', text: '안녕하세요', position: at, receiverPosition: at }),
    'shown',
  );
  assert.equal(feed.entries.length, 1);
});
