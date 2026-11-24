// INHA WORLD — 계정 삭제 클라이언트 단위 테스트 (DELETE-ACCOUNT.md §2).
// Run: node --test tests/firebase-auth-client-delete.test.mjs
// (Node, no dependencies, no network — fetchImpl 스텁만 쓴다.)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFirebaseAuthClient,
  FirebaseAuthError,
} from '../src/auth/firebase-auth-client.js';

function stubFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, fetchImpl };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

async function seedSession(fetchImpl) {
  const client = createFirebaseAuthClient({
    baseUrl: 'https://example.test',
    fetchImpl,
  });
  return client;
}

test('deleteAccount posts 탈퇴 with the device session and clears stored keys', async () => {
  const { calls, fetchImpl } = stubFetch(async (url, init) => {
    if (url.endsWith('/api/auth/firebase/login')) {
      return jsonResponse(200, { deviceSessionId: '11111111-2222-4333-8444-555555555555', userId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
    }
    if (url.endsWith('/api/auth/firebase/delete-account')) {
      return jsonResponse(200, { deleted: true, firebaseUid: 'firebase-uid-1' });
    }
    throw new Error(`unexpected url ${url}`);
  });
  const client = await seedSession(fetchImpl);
  await client.login('fake-id-token');
  assert.equal(client.getSessionId(), '11111111-2222-4333-8444-555555555555');

  const result = await client.deleteAccount();
  assert.deepEqual(result, { deleted: true, firebaseUid: 'firebase-uid-1' });
  assert.equal(client.getSessionId(), null);
  assert.equal(client.getProfileUserId(), null);

  const del = calls.find((c) => c.url.endsWith('/api/auth/firebase/delete-account'));
  assert.equal(del.init.method, 'POST');
  assert.equal(del.init.headers['X-Session-Id'], '11111111-2222-4333-8444-555555555555');
  assert.deepEqual(JSON.parse(del.init.body), { confirmation: '탈퇴' });
});

test('deleteAccount without a session throws AUTH_REQUIRED and sends nothing', async () => {
  const { calls, fetchImpl } = stubFetch(async () => {
    throw new Error('must not fetch');
  });
  const client = await seedSession(fetchImpl);
  await assert.rejects(() => client.deleteAccount(), (error) => {
    assert.ok(error instanceof FirebaseAuthError);
    assert.equal(error.code, 'AUTH_REQUIRED');
    assert.equal(error.status, 401);
    return true;
  });
  assert.equal(calls.length, 0);
});

test('server refusals keep their codes (re-auth, staff block)', async () => {
  for (const [status, code] of [[401, 'ACCOUNT_REAUTH_REQUIRED'], [403, 'STAFF_ACCOUNT_DELETION_BLOCKED']]) {
    const { fetchImpl } = stubFetch(async (url) => {
      if (url.endsWith('/api/auth/firebase/login')) {
        return jsonResponse(200, { deviceSessionId: '11111111-2222-4333-8444-555555555555', userId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
      }
      return jsonResponse(status, { error: code });
    });
    const client = await seedSession(fetchImpl);
    await client.login('fake-id-token');
    await assert.rejects(() => client.deleteAccount(), (error) => {
      assert.ok(error instanceof FirebaseAuthError);
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      return true;
    });
    // 거부됐으면 세션 키가 남아 있어야 한다 (재로그인·재시도 가능).
    assert.equal(client.getSessionId(), '11111111-2222-4333-8444-555555555555');
  }
});

test('200 without deleted:true throws FIREBASE_DELETE_FAILED', async () => {
  const { fetchImpl } = stubFetch(async (url) => {
    if (url.endsWith('/api/auth/firebase/login')) {
      return jsonResponse(200, { deviceSessionId: '11111111-2222-4333-8444-555555555555', userId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
    }
    return jsonResponse(200, { deleted: false });
  });
  const client = await seedSession(fetchImpl);
  await client.login('fake-id-token');
  await assert.rejects(() => client.deleteAccount(), (error) => {
    assert.ok(error instanceof FirebaseAuthError);
    assert.equal(error.code, 'FIREBASE_DELETE_FAILED');
    return true;
  });
});
