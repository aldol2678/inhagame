// Real DOM + production modules, synthetic account/RPC fixtures; no live Auth or DB.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { startSmoke } from './harness.mjs';

const smoke = await startSmoke();
const errors = [];
await smoke.context.route('**/__account-stability', route => route.fulfill({
  contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css">
  <body><button id="open-friends">친구</button><section id="friends-panel" class="profile-panel friend-panel" hidden></section>
  <button id="chat-toggle">채팅</button><section class="chat"><ol id="chat-feed" hidden></ol>
  <form id="chat-form" class="chat-form" hidden><input id="chat-input"><button>보내기</button></form>
  <p id="chat-hint"></p></section><button id="summary"></button></body></html>`
}));
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
    const page = await smoke.context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto(`${smoke.origin}/__account-stability`);
    await page.evaluate(async () => {
      const { SocialClient } = await import('/src/social/social-client.js');
      const { createSocialAccountSession } = await import('/src/social/social-account-session.js');
      const { createFriendPanel } = await import('/src/social/friend-panel.js');
      const { createChatPanel } = await import('/src/online/chat-panel.js');
      const { createLobbyPresenceSummary } = await import('/src/lobby/lobby-presence-summary.js');
      const A = 'a0000000-0000-4000-8000-000000000001';
      const B = 'b0000000-0000-4000-8000-000000000002';
      const X = 'c0000000-0000-4000-8000-000000000003';
      const Y = 'd0000000-0000-4000-8000-000000000004';
      let account = null, finishVisit, pendingList, finishList;
      const rows = id => ({ friends: [{ userId: id === A ? X : Y, nickname: id === A ? 'A 친구' : 'B 친구' }], incoming: [], outgoing: [], blocked: [] });
      const client = { async rpc() {
        if (pendingList) { pendingList = false; return new Promise(resolve => { finishList = () => resolve({ data: rows(A) }); }); }
        return { data: rows(account) };
      } };
      const social = new SocialClient({ getClient: () => client, getSelfUserId: () => account });
      const byId = id => document.getElementById(id);
      const friends = createFriendPanel({ panel: byId('friends-panel'), toggle: byId('open-friends'), social,
        roomVisit: { canVisit: () => ({ ok: true }), onVisit: () => new Promise(resolve => { finishVisit = resolve; }) } });
      const sent = [];
      const chat = createChatPanel({ toggle: byId('chat-toggle'), form: byId('chat-form'), input: byId('chat-input'),
        feedList: byId('chat-feed'), hint: byId('chat-hint'), getChat: () => ({ signedIn: true, submit: text => { sent.push(text); return { result: 'sent' }; } }) });
      const network = { state: 'ONLINE', count: 1, signedIn: true };
      const summary = createLobbyPresenceSummary({ friendsButton: byId('summary'), social,
        getOnline: () => ({ status: () => network, remoteByUser: () => null }) });
      const session = createSocialAccountSession({ social, onFriends: list => summary.setFriends(list),
        onAccountChange: () => { if (friends.open) void friends.setOpen(false); } });
      async function switchTo(id) { account = id; chat.refreshAvailability(id); await session.setAccount(id); }
      window.fixture = { A, B, friends, chat, sent, social, summary, network, switchTo,
        finishVisit: () => finishVisit({ ok: true }),
        beginOldList: () => { pendingList = true; return void session.setAccount(A); },
        finishList: () => finishList(), dispose: () => { session.dispose(); void friends.setOpen(false); } };
      await switchTo(A);
    });
    await page.locator('#chat-toggle').click();
    await page.locator('#chat-input').fill('A의 보내지 않은 문장');
    await page.evaluate(() => fixture.switchTo(fixture.B));
    assert.equal(await page.locator('#chat-input').inputValue(), '');
    assert.equal(await page.locator('#chat-form').isVisible(), false);
    assert.deepEqual(await page.evaluate(() => fixture.sent), []);
    await page.evaluate(() => fixture.switchTo(fixture.A));
    await page.locator('#open-friends').click();
    await page.getByText('A 친구', { exact: true }).waitFor();
    await page.locator('.friend-room-visit').click();
    await page.evaluate(() => fixture.beginOldList());
    await page.evaluate(() => fixture.switchTo(fixture.B));
    await page.locator('#open-friends').click();
    await page.getByText('B 친구', { exact: true }).waitFor();
    await page.evaluate(() => { fixture.finishVisit(); fixture.finishList(); });
    await page.waitForTimeout(30);
    assert.equal(await page.locator('#friends-panel').isVisible(), true);
    assert.equal(await page.getByText('A 친구', { exact: true }).count(), 0);
    assert.equal(await page.getByText('B 친구', { exact: true }).count(), 1);
    await page.evaluate(() => { fixture.network.state = 'RECONNECTING'; fixture.summary.update(); });
    assert.equal(await page.locator('#summary').textContent(), '친구 상태 재연결 중…');
    assert.equal(await page.evaluate(() => fixture.summary.status().sameZoneFriends), null);
    const box = await page.locator('#friends-panel').boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= viewport.width + 1, 'friend panel fits viewport');
    await mkdir('test-results/account-online-stability', { recursive: true });
    await page.screenshot({ path: `test-results/account-online-stability/${viewport.width}x${viewport.height}.png` });
    await page.evaluate(() => fixture.switchTo(null));
    assert.equal(await page.locator('#chat-toggle').getAttribute('aria-disabled'), 'true');
    assert.equal(await page.locator('#friends-panel').isVisible(), false);
    await page.evaluate(() => fixture.dispose());
    console.log(`PASS account UI ${viewport.width}x${viewport.height} (synthetic Auth/RPC)`);
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally { await smoke.close(); }
