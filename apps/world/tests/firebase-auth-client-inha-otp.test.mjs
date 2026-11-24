// INHA WORLD — 인하대 이메일 OTP 클라이언트 단위 테스트 (INHA-OTP.md).
// Run: node --test tests/firebase-auth-client-inha-otp.test.mjs
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

async function loggedInClient(fetchImpl) {
  const client = createFirebaseAuthClient({
    baseUrl: 'https://example.test',
    fetchImpl,
  });
  await client.login('fake-id-token');
  return client;
}

const LOGIN = (url) => url.endsWith('/api/auth/firebase/login');

test('requestInhaOtp posts the email with the device session', async () => {
  const { calls, fetchImpl } = stubFetch(async (url) => {
    if (LOGIN(url)) {
      return jsonResponse(200, { deviceSessionId: '11111111-2222-4333-8444-555555555555', userId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
    }
    return jsonResponse(200, { requestId: '22222222-3333-4444-8555-666666666666', email: 'aldol@inha.edu', status: 'PENDING', expiresInSeconds: 600 });
  });
  const client = await loggedInClient(fetchImpl);
  const result = await client.requestInhaOtp('aldol@inha.edu');
  assert.equal(result.email, 'aldol@inha.edu');
  assert.equal(result.expiresInSeconds, 600);
  const req = calls.find((c) => c.url.endsWith('/api/auth/firebase/inha-otp-request'));
  assert.equal(req.init.method, 'POST');
  assert.equal(req.init.headers['X-Session-Id'], '11111111-2222-4333-8444-555555555555');
  assert.deepEqual(JSON.parse(req.init.body), { email: 'aldol@inha.edu' });
});

test('verifyInhaOtp posts email + code and returns the verification', async () => {
  const { calls, fetchImpl } = stubFetch(async (url) => {
    if (LOGIN(url)) {
      return jsonResponse(200, { deviceSessionId: '11111111-2222-4333-8444-555555555555', userId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
    }
    return jsonResponse(200, { verified: true, userId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', email: 'aldol@inha.edu', achievementGranted: true });
  });
  const client = await loggedInClient(fetchImpl);
  const result = await client.verifyInhaOtp('aldol@inha.edu', '123456');
  assert.equal(result.verified, true);
  assert.equal(result.achievementGranted, true);
  const req = calls.find((c) => c.url.endsWith('/api/auth/firebase/inha-otp-verify'));
  assert.deepEqual(JSON.parse(req.init.body), { email: 'aldol@inha.edu', code: '123456' });
});

test('OTP errors keep their server codes', async () => {
  for (const [path, status, code] of [
    ['/api/auth/firebase/inha-otp-request', 429, 'RATE_LIMITED'],
    ['/api/auth/firebase/inha-otp-request', 503, 'MAIL_SEND_FAILED'],
    ['/api/auth/firebase/inha-otp-verify', 400, 'INVALID_CODE'],
    ['/api/auth/firebase/inha-otp-verify', 429, 'CODE_LOCKED'],
  ]) {
    const { fetchImpl } = stubFetch(async (url) => {
      if (LOGIN(url)) {
        return jsonResponse(200, { deviceSessionId: '11111111-2222-4333-8444-555555555555', userId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
      }
      return jsonResponse(status, { error: code });
    });
    const client = await loggedInClient(fetchImpl);
    const fn = path.endsWith('request')
      ? () => client.requestInhaOtp('aldol@inha.edu')
      : () => client.verifyInhaOtp('aldol@inha.edu', '123456');
    await assert.rejects(fn, (error) => {
      assert.ok(error instanceof FirebaseAuthError);
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      return true;
    });
  }
});

test('OTP calls without a session throw AUTH_REQUIRED and send nothing', async () => {
  const { calls, fetchImpl } = stubFetch(async () => {
    throw new Error('must not fetch');
  });
  const client = createFirebaseAuthClient({
    baseUrl: 'https://example.test',
    fetchImpl,
  });
  await assert.rejects(() => client.requestInhaOtp('aldol@inha.edu'), (error) => {
    assert.equal(error.code, 'AUTH_REQUIRED');
    return true;
  });
  await assert.rejects(() => client.verifyInhaOtp('aldol@inha.edu', '123456'), (error) => {
    assert.equal(error.code, 'AUTH_REQUIRED');
    return true;
  });
  assert.equal(calls.length, 0);
});
