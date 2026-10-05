import { ACTIVITY_CLIENT_ATTEMPT_KEY_PATTERN } from '../src/activity/activity-contract.js';

const SOURCE_REF = 'gathering.campus.leaf_pile_01';
const ERRORS = new Map([
  ['ACCOUNT_UNAVAILABLE', 403],
  ['GATHERING_UNAVAILABLE', 409],
  ['GATHERING_SOURCE_UNAVAILABLE', 409],
  ['GATHERING_POSITION_UNAVAILABLE', 409],
  ['GATHERING_POSITION_STALE', 409],
  ['GATHERING_POSITION_INELIGIBLE', 409],
  ['GATHERING_OUT_OF_RANGE', 409],
  ['GATHERING_RATE_LIMITED', 429],
  ['IDEMPOTENCY_CONFLICT', 409],
  ['GATHERING_COMMITTED_STATE_INVALID', 409],
  ['OUTPUT_UNAVAILABLE', 409],
  ['MAX_STACK_EXCEEDED', 409],
  ['COLLECTION_ENTRY_INACTIVE', 409],
  ['LIFE_SKILL_INACTIVE', 409],
  ['SETTLEMENT_PLAN_CONFLICT', 409]
]);

export class GatheringError extends Error {
  constructor(code, status) { super(code); this.status = status; }
}

function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('Invalid request');
  const keys = Object.keys(body).sort();
  if (body.op === 'read') {
    if (keys.length !== 1) throw new TypeError('Invalid read');
    return { op: 'read' };
  }
  if (body.op === 'harvest') {
    if (keys.join(',') !== 'clientAttemptKey,op,sourceRef' ||
        body.sourceRef !== SOURCE_REF ||
        typeof body.clientAttemptKey !== 'string' ||
        !ACTIVITY_CLIENT_ATTEMPT_KEY_PATTERN.test(body.clientAttemptKey)) {
      throw new TypeError('Invalid harvest');
    }
    return { op: 'harvest', sourceRef: body.sourceRef, clientAttemptKey: body.clientAttemptKey.toLowerCase() };
  }
  throw new TypeError('Unknown operation');
}

export function createGatheringService({ verifyUser, rpc }) {
  return async (authorization, body) => {
    let request;
    try { request = validateBody(body); }
    catch { throw new GatheringError('INVALID_REQUEST', 400); }

    let actor;
    try { actor = await verifyUser(authorization); }
    catch { throw new GatheringError('AUTH_UNAVAILABLE', 503); }
    if (typeof actor !== 'string' || !ACTIVITY_CLIENT_ATTEMPT_KEY_PATTERN.test(actor)) {
      throw new GatheringError('AUTH_REQUIRED', 401);
    }

    if (request.op === 'read') {
      return rpc('world_gathering_read_v1', { p_user: actor.toLowerCase() });
    }
    return rpc('world_gathering_harvest_v1', {
      p_user: actor.toLowerCase(),
      p_source_ref: request.sourceRef,
      p_client_attempt_key: request.clientAttemptKey
    });
  };
}

export function createGatheringRpc({ url, serviceKey, fetcher = fetch }) {
  return async (name, args) => {
    if (!/^https?:\/\//u.test(url ?? '') || !serviceKey) {
      throw new GatheringError('GATHERING_UNAVAILABLE', 503);
    }
    try {
      const response = await fetcher(`${url.replace(/\/$/u, '')}/rest/v1/rpc/${name}`, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      });
      const payload = await response.json();
      if (!response.ok) {
        if (ERRORS.has(payload?.message)) throw new GatheringError(payload.message, ERRORS.get(payload.message));
        throw new GatheringError('GATHERING_UNAVAILABLE', 503);
      }
      return payload;
    } catch (error) {
      if (error instanceof GatheringError) throw error;
      throw new GatheringError('GATHERING_UNAVAILABLE', 503);
    }
  };
}

export function createGatheringApiHandler({ enabled, service }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!enabled) return res.status(404).end();
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).end(); }
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return res.status(415).end();
    }
    if (req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).end();
      } catch { return res.status(403).end(); }
    }
    let body = req.body;
    try {
      if (Buffer.isBuffer(body)) body = body.toString('utf8');
      if (typeof body === 'string') {
        if (Buffer.byteLength(body) > 4096) return res.status(413).end();
        body = JSON.parse(body);
      }
      if (Buffer.byteLength(JSON.stringify(body) ?? '') > 4096) return res.status(413).end();
    } catch { return res.status(400).json({ error: 'INVALID_REQUEST' }); }
    try {
      return res.status(200).json(await service(req.headers.authorization, body));
    } catch (error) {
      return res.status(error instanceof GatheringError ? error.status : 503).json({
        error: error instanceof GatheringError ? error.message : 'GATHERING_UNAVAILABLE'
      });
    }
  };
}
