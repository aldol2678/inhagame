// Model conversion proxy gate: Supabase-verified member + per-user/per-IP limits (plus a
// pre-auth limit on rejected logins per IP) before any
// paid converter call. The Vercel entry (api/model-convert.js) keeps the enabled flag check first.
//
// Rate limits are an in-memory sliding window per serverless instance. There is no shared
// store, so N warm instances allow up to N times the configured limit; keep Cloud Run
// max-instances / concurrency caps as the hard cost ceiling.
export const MAX_MODEL_BYTES = 25 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const UPSTREAM_STATUSES = new Set([400, 413, 415, 422, 503]);
// ipMax counts authenticated requests per IP (a campus NAT shares one IP, so it sits well above
// userMax). authFailIpMax counts only unsuccessful logins (401/403/auth 503) per IP in its own shorter window,
// so a guest looping bad tokens neither burns members' IP quota nor hammers Supabase Auth.
const DEFAULT_LIMITS = Object.freeze({
  userMax: 5, ipMax: 60, windowSec: 3600, authFailIpMax: 30, authFailWindowSec: 600, maxKeys: 10000
});
const BEARER = /^Bearer [A-Za-z0-9._~-]{20,4096}$/u;

function boundedInt(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback;
}

// Invalid values fall back to defaults instead of disabling the limit.
export function modelConvertLimitsFromEnv(env = process.env) {
  return {
    userMax: boundedInt(env.MODEL_CONVERT_RATE_USER_MAX, DEFAULT_LIMITS.userMax, 1, 1000),
    ipMax: boundedInt(env.MODEL_CONVERT_RATE_IP_MAX, DEFAULT_LIMITS.ipMax, 1, 10000),
    windowSec: boundedInt(env.MODEL_CONVERT_RATE_WINDOW_SEC, DEFAULT_LIMITS.windowSec, 1, 86400),
    authFailIpMax: boundedInt(env.MODEL_CONVERT_RATE_AUTH_FAIL_IP_MAX, DEFAULT_LIMITS.authFailIpMax, 1, 10000),
    authFailWindowSec: boundedInt(env.MODEL_CONVERT_RATE_AUTH_FAIL_WINDOW_SEC, DEFAULT_LIMITS.authFailWindowSec, 1, 86400),
    maxKeys: DEFAULT_LIMITS.maxKeys
  };
}

// Unset/empty = any signed-in member. Set but containing no valid UUID = nobody (fail closed).
export function modelConvertAllowlistFromEnv(env = process.env) {
  const raw = String(env.MODEL_CONVERT_ALLOWED_USER_IDS ?? '').trim();
  if (!raw) return null;
  return new Set(raw.split(',').map(value => value.trim().toLowerCase()).filter(value => UUID.test(value)));
}

// evictWhenFull: a key absent from the table has zero hits, so check() always passes it and a
// full table makes room by dropping the oldest-inserted key instead of refusing. Used for the
// failed-login limiter, where refusing unknown keys would lock out members on fresh IPs.
export function createSlidingWindowLimiter({ max, windowMs, maxKeys = DEFAULT_LIMITS.maxKeys, evictWhenFull = false, now = Date.now }) {
  const hits = new Map();
  // While the table is full, the earliest time any key fully expires; avoids rescanning per request.
  let fullUntil = 0;
  const prune = (key, t) => {
    const list = hits.get(key);
    if (!list) return [];
    while (list.length && list[0] <= t - windowMs) list.shift();
    if (!list.length) hits.delete(key);
    return list;
  };
  const retry = (ms) => ({ ok: false, retryAfterSec: Math.max(1, Math.ceil(ms / 1000)) });
  const check = (key, t) => {
    const list = prune(key, t);
    if (list.length >= max) return retry(list[0] + windowMs - t);
    if (!evictWhenFull && !hits.has(key) && hits.size >= maxKeys) {
      if (t < fullUntil) return retry(fullUntil - t);
      // Evict expired entries first; never drop a key that still has hits in the window.
      let soonest = Infinity;
      for (const other of [...hits.keys()]) {
        const rest = prune(other, t);
        if (rest.length) soonest = Math.min(soonest, rest[rest.length - 1] + windowMs);
      }
      // Still full: refuse only until the first key frees up, not for a whole window.
      if (hits.size >= maxKeys) { fullUntil = soonest; return retry(soonest - t); }
    }
    return { ok: true };
  };
  const record = (key, t) => {
    const list = hits.get(key);
    if (list) return list.push(t);
    if (evictWhenFull && hits.size >= maxKeys) hits.delete(hits.keys().next().value);
    hits.set(key, [t]);
  };
  const unrecord = (key, t) => {
    const list = hits.get(key);
    const index = list ? list.indexOf(t) : -1;
    if (index < 0) return;
    list.splice(index, 1);
    if (!list.length) hits.delete(key);
  };
  return {
    // Returns { ok: true } or { ok: false, retryAfterSec } without recording anything.
    check(key) { return check(key, now()); },
    // Like check, but records the hit when allowed.
    take(key) {
      const t = now();
      const result = check(key, t);
      if (result.ok) record(key, t);
      return result;
    },
    // Like take, but the allowed result carries release() to remove that hit again, so a hit
    // can be counted while an outcome is pending and dropped if it turns out not to count.
    reserve(key) {
      const t = now();
      const result = check(key, t);
      if (!result.ok) return result;
      record(key, t);
      let released = false;
      return { ok: true, release() { if (!released) { released = true; unrecord(key, t); } } };
    },
    size: () => hits.size
  };
}

// IPv6 clients usually control a whole /64, so key them by that prefix; IPv4-mapped IPv6 is
// treated as IPv4. Anything unparsable is used as-is.
export function modelConvertIpKey(ip) {
  const value = String(ip ?? '').toLowerCase().replace(/%.*$/u, '');
  const mapped = /^(?:(?:0{1,4}:){5}|::(?:0{1,4}:)?)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(value);
  if (mapped) return mapped[1];
  if (!value.includes(':')) return value || 'unknown';
  let text = value;
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    text = text.slice(0, v4.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return value;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return value;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (!groups.every(g => /^[0-9a-f]{1,4}$/u.test(g))) return value;
  return groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/u, '')).join(':') + '::/64';
}

// Only trust proxy headers when the platform overwrites them. On Vercel, x-vercel-forwarded-for
// and x-real-ip are set by the edge from the TCP peer, so a client cannot spoof them; a raw
// x-forwarded-for chain is client-appendable and is never used.
export function modelConvertClientIp(req, { trustProxyHeaders = false } = {}) {
  if (trustProxyHeaders) {
    for (const name of ['x-vercel-forwarded-for', 'x-real-ip']) {
      const value = String(req.headers?.[name] ?? '').split(',')[0].trim();
      if (value && value.length <= 64 && /^[0-9a-f:.]+$/iu.test(value)) return value.toLowerCase();
    }
  }
  return req.socket?.remoteAddress || 'unknown';
}

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'binary');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_MODEL_BYTES) throw new Error('E_MODEL_FILE_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function limited(res, code, retryAfterSec) {
  res.setHeader('Retry-After', String(retryAfterSec));
  return res.status(429).json({ error: code, retryAfterSec });
}

export function createModelConvertHandler({
  enabled, upstreamUrl, proxySecret = '', verifyUser, allowedUserIds = null,
  limits = DEFAULT_LIMITS, trustProxyHeaders = false, fetcher = fetch, now = Date.now
}) {
  limits = { ...DEFAULT_LIMITS, ...limits };
  const windowMs = limits.windowSec * 1000;
  const userLimiter = createSlidingWindowLimiter({ max: limits.userMax, windowMs, maxKeys: limits.maxKeys, now });
  const ipLimiter = createSlidingWindowLimiter({ max: limits.ipMax, windowMs, maxKeys: limits.maxKeys, now });
  const authFailLimiter = createSlidingWindowLimiter({
    max: limits.authFailIpMax, windowMs: limits.authFailWindowSec * 1000, maxKeys: limits.maxKeys, evictWhenFull: true, now
  });
  return async function modelConvertHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') return res.status(200).json({ enabled });
    if (!enabled) return res.status(404).json({ error: 'E_MODEL_CONVERT_DISABLED' });
    if (req.method !== 'POST') return res.status(405).end();

    const origin = req.headers.origin;
    if (origin) {
      try { if (new URL(origin).host !== req.headers.host) return res.status(403).end(); }
      catch { return res.status(403).end(); }
    }
    const filename = String(req.headers['x-model-filename'] || req.query?.filename || '');
    if (!/^[^\x00-\x1f\x7f/\\]{1,180}\.fbx$/iu.test(filename)) return res.status(400).json({ error: 'E_MODEL_FBX_FILENAME_REQUIRED' });
    const contentLength = req.headers['content-length'];
    if (contentLength !== undefined && (!/^\d+$/u.test(String(contentLength)) || Number(contentLength) > MAX_MODEL_BYTES))
      return res.status(413).json({ error: 'E_MODEL_FILE_TOO_LARGE' });

    const ipKey = `ip:${modelConvertIpKey(modelConvertClientIp(req, { trustProxyHeaders }))}`;
    const loginRequired = () => {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return res.status(401).json({ error: 'E_MODEL_CONVERT_LOGIN_REQUIRED' });
    };
    // A missing or malformed token costs nothing to reject, so it is not counted against the IP.
    if (!BEARER.test(req.headers.authorization ?? '')) return loginRequired();
    // Pre-auth guard: only IPs with too many rejected logins are stopped before Supabase Auth.
    // The attempt is counted before the await, so concurrent bad tokens cannot all slip past the
    // check, and released only once the login succeeds. Auth errors (503) stay counted: a token
    // Supabase answers with 400/429/5xx is no evidence of a member, and real outages are short.
    const attempt = authFailLimiter.reserve(ipKey);
    if (!attempt.ok) return limited(res, 'E_MODEL_CONVERT_RATE_LIMITED', attempt.retryAfterSec);

    // Auth must succeed before reading the upload or calling the paid converter.
    let userId;
    try { userId = await verifyUser(req.headers.authorization); }
    catch { return res.status(503).json({ error: 'E_MODEL_AUTH_UNAVAILABLE' }); }
    if (typeof userId !== 'string' || !UUID.test(userId)) return loginRequired();
    userId = userId.toLowerCase();
    if (allowedUserIds && !allowedUserIds.has(userId)) return res.status(403).json({ error: 'E_MODEL_CONVERT_FORBIDDEN' });
    attempt.release();

    // Authenticated traffic: per-user limit plus a higher per-IP ceiling. Check both before
    // recording either, so a request refused by one does not consume the other's quota.
    const userKey = `user:${userId}`;
    for (const [limiter, key] of [[userLimiter, userKey], [ipLimiter, ipKey]]) {
      const result = limiter.check(key);
      if (!result.ok) return limited(res, 'E_MODEL_CONVERT_RATE_LIMITED', result.retryAfterSec);
    }
    userLimiter.take(userKey);
    ipLimiter.take(ipKey);

    try {
      const body = await readBody(req);
      if (!body.length) return res.status(400).json({ error: 'E_MODEL_FILE_REQUIRED' });
      if (body.length > MAX_MODEL_BYTES) return res.status(413).json({ error: 'E_MODEL_FILE_TOO_LARGE' });
      const response = await fetcher(upstreamUrl, {
        method: 'POST',
        signal: AbortSignal.timeout(55000),
        headers: { 'Content-Type': 'application/octet-stream', 'X-Model-Filename': filename, 'X-Converter-Key': proxySecret },
        body
      });
      if (!response.ok) {
        // Upstream 401/429 are proxy-side problems; never let them look like the caller's session or quota.
        let error = 'E_MODEL_CONVERT_FAILED';
        try { const code = (await response.json())?.error; if (/^E_[A-Z0-9_]{1,64}$/u.test(code ?? '')) error = code; } catch {}
        return res.status(UPSTREAM_STATUSES.has(response.status) ? response.status : 502).json({ error });
      }
      const result = Buffer.from(await response.arrayBuffer());
      if (result.length < 20 || result.length > MAX_MODEL_BYTES || result.subarray(0, 4).toString('ascii') !== 'glTF')
        return res.status(502).json({ error: 'E_MODEL_CONVERT_INVALID_GLB' });
      res.setHeader('Content-Type', 'model/gltf-binary');
      res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(filename.replace(/\.fbx$/iu, '.glb')));
      return res.status(200).send(result);
    } catch (error) {
      if (error.message === 'E_MODEL_FILE_TOO_LARGE') return res.status(413).json({ error: error.message });
      return res.status(503).json({ error: 'E_MODEL_CONVERT_UNAVAILABLE' });
    }
  };
}
