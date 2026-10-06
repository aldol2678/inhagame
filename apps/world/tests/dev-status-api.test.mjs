import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const handler = require('../api/dev-status.js');

function response() {
  return {
    statusCode: 0, headers: {}, body: null, ended: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; this.ended = true; return this; },
    end() { this.ended = true; return this; }
  };
}

async function call(method = 'GET') {
  const res = response();
  await handler({ method }, res);
  return res;
}

test('dev status uses current inhagame repository and resolves main vs production', async () => {
  const previousSha = process.env.VERCEL_GIT_COMMIT_SHA;
  const previousEnv = process.env.VERCEL_ENV;
  process.env.VERCEL_GIT_COMMIT_SHA = 'a'.repeat(40);
  process.env.VERCEL_ENV = 'production';
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.github.com/repos/aldol2678/inhagame/commits/main');
    assert.equal(init.method, 'GET');
    assert.match(init.headers['User-Agent'], /INHAGAME-Status-Service/);
    return new Response(JSON.stringify({ sha: 'a'.repeat(40) }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  };
  try {
    const res = await call();
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.repository, 'aldol2678/inhagame');
    assert.equal(res.body.source_mode, 'LIVE');
    assert.equal(res.body.read_only, true);
    assert.equal(res.body.github.status, 'READY');
    assert.equal(res.body.current.main_matches_production, true);
    assert.equal(res.body.comparison_status, 'RESOLVED');
    assert.doesNotMatch(JSON.stringify(res.body), /inha-duck/);
  } finally {
    if (previousSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = previousSha;
    if (previousEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousEnv;
  }
});

test('dev status preserves deployment provenance when GitHub live read is unavailable', async () => {
  const previousSha = process.env.VERCEL_GIT_COMMIT_SHA;
  const previousEnv = process.env.VERCEL_ENV;
  process.env.VERCEL_GIT_COMMIT_SHA = 'b'.repeat(40);
  process.env.VERCEL_ENV = 'production';
  globalThis.fetch = async () => new Response('{}', { status: 503 });
  try {
    const res = await call();
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.github.status, 'UNAVAILABLE');
    assert.equal(res.body.github.main_sha, null);
    assert.equal(res.body.deployment.commit_sha, 'b'.repeat(40));
    assert.equal(res.body.current.main_matches_production, null);
    assert.equal(res.body.comparison_status, 'UNAVAILABLE');
  } finally {
    if (previousSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = previousSha;
    if (previousEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousEnv;
  }
});

test('dev status is GET-only and read-only', async () => {
  globalThis.fetch = async () => { throw new Error('must not fetch'); };
  const res = await call('POST');
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET');
  assert.match(res.headers['cache-control'], /no-store/);
});
