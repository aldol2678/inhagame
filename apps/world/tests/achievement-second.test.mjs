import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../achievements/achievements.js', import.meta.url), 'utf8');

async function renderAwards(achievements) {
  const nodes = new Map();
  const node = () => ({ hidden: false, textContent: '', dataset: {}, children: [], listeners: {},
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    addEventListener(type, callback) { this.listeners[type] = callback; } });
  for (const id of ['achievement-status', 'achievement-content', 'achievement-login',
    'achievement-list', 'achievement-count', 'achievement-retry']) nodes.set(id, node());
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'qa', email: 'qa@example.invalid' } }, error: null }),
      onAuthStateChange() {} },
    rpc: async () => ({ data: { earnedCount: achievements.filter(a => a.earned).length, achievements }, error: null })
  };
  runInNewContext(script, {
    document: { getElementById: id => nodes.get(id), createElement: () => node() },
    window: { supabase: { createClient: () => client } },
    console: { warn() {} }, setTimeout, Date, Intl
  });
  await new Promise(resolve => setTimeout(resolve, 15));
  return nodes;
}

test('the second unearned achievement shows its own server condition', async () => {
  const nodes = await renderAwards([
    { key: 'classic_recorded_v1', title: '클래식 입문', description: '기록', earned: false,
      requirement: '계정에 Classic 기록을 남기면 획득해요.' },
    { key: 'classic_ranked_accepted_v1', title: '랭킹 첫 기록', description: '서버 승인', earned: false,
      requirement: 'Classic 랭킹전 기록이 서버 검사에서 승인되면 획득해요.' }
  ]);
  assert.equal(nodes.get('achievement-count').textContent, '0개');
  const cards = nodes.get('achievement-list').children;
  assert.equal(cards.length, 2);
  assert.match(cards[1].children.at(-1).textContent, /랭킹전 기록이 서버 검사에서 승인/);
  assert.equal(nodes.get('achievement-content').hidden, false);
});

test('earned cards show their own evidence and date', async () => {
  const nodes = await renderAwards([
    { title: '클래식 입문', description: '기록', earned: true, evidence: 'Classic 최고 기록',
      earnedAt: '2026-09-23T00:00:00Z' },
    { title: '랭킹 첫 기록', description: '서버 승인', earned: true,
      evidence: '서버가 승인한 본인 Classic 랭킹전 기록', earnedAt: '2026-09-25T00:00:00Z' }
  ]);
  assert.equal(nodes.get('achievement-count').textContent, '2개');
  assert.match(nodes.get('achievement-list').children[1].children.at(-2).textContent, /서버가 승인한 본인/);
});
