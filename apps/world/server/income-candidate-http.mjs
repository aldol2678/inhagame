import { createIncomeService, createIncomeRpc, IncomeError } from './income-service.mjs';

export function incomeCandidateConfig(env = {}) {
  const url = env.WORLD_INCOME_CANDIDATE_SUPABASE_URL;
  // There is deliberately no hosted/Production override. This uses only a disposable loopback stack.
  const enabled = env.WORLD_INCOME_CANDIDATE_ENABLED === '1' && env.NODE_ENV !== 'production' &&
    env.VERCEL_ENV !== 'production' && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url ?? '') &&
    Boolean(env.WORLD_INCOME_CANDIDATE_ANON_KEY) && Boolean(env.WORLD_INCOME_CANDIDATE_SERVICE_ROLE_KEY);
  return { enabled, url, anonKey: env.WORLD_INCOME_CANDIDATE_ANON_KEY, serviceKey: env.WORLD_INCOME_CANDIDATE_SERVICE_ROLE_KEY };
}
export function createIncomeCandidateVerifier({ url, anonKey, fetcher = fetch }) {
  return async authorization => {
    const match = /^Bearer ([A-Za-z0-9._~-]{20,4096})$/.exec(authorization ?? '');
    if (!match) return null;
    const response = await fetcher(`${url}/auth/v1/user`, {
      redirect: 'error', headers: { apikey: anonKey, Authorization: `Bearer ${match[1]}` }, signal: AbortSignal.timeout(5000)
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error('AUTH_UNAVAILABLE');
    const user = await response.json();
    return user?.is_anonymous === false && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user?.id ?? '') ? user.id : null;
  };
}
async function requestBody(req) {
  let body = req.body;
  if (body === undefined) {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += Buffer.byteLength(chunk);
      if (size > 8192) throw new IncomeError('REQUEST_TOO_LARGE', 413);
      chunks.push(Buffer.from(chunk));
    }
    body = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > 8192) throw new IncomeError('REQUEST_TOO_LARGE', 413);
    try { body = JSON.parse(body); } catch { throw new IncomeError('INVALID_REQUEST', 400); }
  }
  if (Buffer.byteLength(JSON.stringify(body) ?? '') > 8192) throw new IncomeError('REQUEST_TOO_LARGE', 413);
  return body;
}
export function createIncomeCandidateHttpHandler({ enabled = false, service }) {
  return async (req, res) => {
    const send = (status, payload) => {
      res.statusCode = status;
      if (payload) res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(payload ? JSON.stringify(payload) : '');
    };
    res.setHeader('Cache-Control', 'no-store');
    if (!enabled) return send(404);
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(405); }
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return send(415);
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return send(403); }
      catch { return send(403); }
    }
    try { return send(200, await service(req.headers.authorization, await requestBody(req))); }
    catch (error) {
      return send(error instanceof IncomeError ? error.status : 503,
        { error: error instanceof IncomeError ? error.message : 'INCOME_UNAVAILABLE' });
    }
  };
}
export function createConfiguredIncomeCandidateHandler(env = process.env, fetcher = fetch) {
  const config = incomeCandidateConfig(env);
  if (!config.enabled) return createIncomeCandidateHttpHandler({ enabled: false });
  return createIncomeCandidateHttpHandler({ enabled: true, service: createIncomeService({ enabled: true,
    verifyUser: createIncomeCandidateVerifier({ ...config, fetcher }),
    rpc: createIncomeRpc({ ...config, fetcher })
  }) });
}
