import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the submit handler copied verbatim from the currently checked-out Hub.
const source = readFileSync(new URL('../hub-account.js', import.meta.url), 'utf8');
const handler = source.match(/  loginForm\.addEventListener\('submit', async event => \{([\s\S]*?)\n  \}\);/);
assert.ok(handler, 'actual Hub login submit handler must be present');

function fixture(signInWithPassword) {
  let submit;
  let requests = 0;
  const button = { disabled: false };
  const status = { textContent: '' };
  const loginForm = {
    elements: { email: { value: ' A@EXAMPLE.TEST ' }, password: { value: 'temporary-test-secret' } },
    querySelector: () => button,
    addEventListener: (_type, fn) => { submit = fn; }
  };
  const state = {
    epoch: 0, loginAttempt: 0, loginForm, status,
    client: { auth: { signInWithPassword: args => { requests++; return signInWithPassword(args); } } },
    refreshCount: 0,
    refresh() { state.refreshCount++; }
  };
  runInNewContext("loginForm.addEventListener('submit', async event => {" + handler[1] + "\n});", state);
  const fire = () => submit({ preventDefault() {} });
  return { fire, state, button, status, loginForm, get requests() { return requests; } };
}

test('SDK rejection restores submit button and clears the password', async () => {
  const f = fixture(async () => { throw Error('synthetic network rejection'); });
  await f.fire();
  assert.equal(f.button.disabled, false);
  assert.equal(f.loginForm.elements.password.value, '');
  assert.match(f.status.textContent, /다시 시도/);
  assert.equal(f.state.refreshCount, 0);
});

test('ordinary Auth error keeps its existing recovery and does not refresh', async () => {
  const f = fixture(async () => ({ error: { message: 'Email not confirmed' } }));
  await f.fire();
  assert.match(f.status.textContent, /이메일 인증/);
  assert.equal(f.button.disabled, false);
  assert.equal(f.state.refreshCount, 0);
});

test('successful sign-in preserves the normal refresh path', async () => {
  const f = fixture(async args => {
    assert.equal(args.email, 'a@example.test');
    return { error: null };
  });
  await f.fire();
  assert.equal(f.state.refreshCount, 1);
  assert.equal(f.button.disabled, false);
  assert.equal(f.loginForm.elements.password.value, '');
});

test('second submit does not start another pending sign-in', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  const first = f.fire();
  await f.fire();
  assert.equal(f.requests, 1);
  finish({ error: { message: 'wrong password' } });
  await first;
  assert.equal(f.button.disabled, false);
});

test('old success and rejection cannot overwrite another auth epoch', async () => {
  for (const result of [{ error: null }, new Error('offline')]) {
    let resolve, reject;
    const f = fixture(() => new Promise((ok, fail) => { resolve = ok; reject = fail; }));
    const old = f.fire();
    f.state.epoch++;
    f.state.loginAttempt++;
    f.status.textContent = 'new account status';
    if (result instanceof Error) reject(result);
    else resolve(result);
    await old;
    assert.equal(f.status.textContent, 'new account status');
    assert.equal(f.state.refreshCount, 0);
    assert.equal(f.button.disabled, false);
  }
});

test('Hub asynchronous refresh and linked identities are generation-guarded', () => {
  assert.match(source, /refreshLinkedIdentities\(true, current\)/);
  assert.match(source, /if \(expectedEpoch !== epoch\) return;/);
  assert.match(source, /if \(current !== epoch\) return;\s*status\.textContent = \(profileState\.profile/);
  assert.match(source, /client\.auth\.onAuthStateChange\(\(\) => \{\s*epoch\+\+;\s*loginAttempt\+\+;/);
});
