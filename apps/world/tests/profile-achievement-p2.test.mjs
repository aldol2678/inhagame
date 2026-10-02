import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../profile/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../profile/profile.js', import.meta.url), 'utf8');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(initialUser, achievementRpc) {
  const nodes = new Map();
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
    nodes.set(match[1], {
      hidden: false, textContent: '', children: [], listeners: {},
      replaceChildren(...children) { this.children = children; },
      append(...children) { this.children.push(...children); },
      addEventListener(event, handler) { this.listeners[event] = handler; }
    });
  }
  nodes.get('profile-achievement-empty').textContent = '아직 획득한 업적이 없어요.';
  let user = initialUser, authChange;
  const profile = { profile: { nickname: '개발자', avatar: 'classic', department: '',
    title: '', inhaVerified: false, joinedAt: '2026-09-01' },
    stats: { playedGames: 0 }, games: [] };
  const client = {
    auth: {
      async getUser() { return { data: { user }, error: null }; },
      onAuthStateChange(callback) { authChange = callback; }
    },
    rpc(name) {
      if (name === 'get_my_profile') return Promise.resolve({ data: profile, error: null });
      assert.equal(name, 'get_my_achievements');
      return achievementRpc(user?.id);
    },
    from(name) {
      assert.equal(name, 'departments');
      return { select() { return this; }, eq() { return this; },
        order() { return Promise.resolve({ data: [], error: null }); } };
    }
  };
  const document = {
    getElementById(id) { const node = nodes.get(id); assert.ok(node, id); return node; },
    createElement() { return { textContent: '', children: [], append(...nodes) {
      this.children.push(...nodes);
    }, addEventListener() {} }; }
  };
  runInNewContext(script, {
    document, window: { supabase: { createClient: () => client } },
    fetch: async () => ({ ok: true, json: async () => ({ schemaVersion: 1, games: [] }) }),
    console: { warn() {} }, setTimeout, URL, location: { href: 'https://inhagame.example/profile' },
    Intl, Date, Object, Option: class {}
  });
  const el = id => nodes.get(id);
  const settle = () => new Promise(resolve => setTimeout(resolve, 15));
  return { el, settle, session(next, event = 'SIGNED_IN') {
    user = next; authChange(event, { user: next });
  } };
}
const userA = { id: 'account-a', email: 'a@example.test', is_anonymous: false };
const userB = { id: 'account-b', email: 'b@example.test', is_anonymous: false };
const award = { earnedCount: 1, achievements: [{ key: 'classic_recorded_v1',
  title: '클래식 입문', description: 'Classic에서 계정 기록을 남겼어요.',
  earned: true, earnedAt: '2026-09-23T00:00:00Z' }] };

test('earned and empty states keep the rest of the profile visible', async () => {
  for (const [data, expected] of [[award, '클래식 입문'],
    [{ earnedCount: 0, achievements: [{ ...award.achievements[0], earned: false }] },
      '아직 획득한 업적이 없어요.']]) {
    const page = fixture(userA, async () => ({ data, error: null }));
    await page.settle();
    assert.equal(page.el('profile-content').hidden, false);
    assert.equal(page.el('profile-nickname').textContent, '개발자');
    assert.equal(page.el('profile-achievement-result').hidden, false);
    assert.equal(page.el('profile-achievement-count').textContent, data.earnedCount + '개 획득한 업적');
    assert.equal((data.earnedCount ? page.el('profile-achievement-title') :
      page.el('profile-achievement-empty')).textContent, expected);
  }
});
test('achievement failure and retry do not take down the profile', async () => {
  let fail = true;
  const page = fixture(userA, async () => fail ?
    ({ data: null, error: Error('offline') }) : ({ data: award, error: null }));
  await page.settle();
  assert.equal(page.el('profile-content').hidden, false);
  assert.equal(page.el('profile-achievement-retry').hidden, false);
  assert.match(page.el('profile-achievement-status').textContent, /불러오지 못했어요/);
  fail = false;
  page.el('profile-achievement-retry').listeners.click();
  await page.settle();
  assert.equal(page.el('profile-achievement-title').textContent, '클래식 입문');
  assert.equal(page.el('profile-achievement-retry').hidden, true);
});
test('account switch drops the old late achievement response', async () => {
  const pending = deferred();
  const page = fixture(userA, id => id === userA.id ? pending.promise :
    Promise.resolve({ data: { earnedCount: 0, achievements: [] }, error: null }));
  await page.settle();
  page.session(userB);
  await page.settle();
  pending.resolve({ data: award, error: null });
  await page.settle();
  assert.equal(page.el('profile-achievement-result').hidden, false);
  assert.equal(page.el('profile-achievement-count').textContent, '0개 획득한 업적');
  assert.equal(page.el('profile-achievement-title').hidden, true);
});
