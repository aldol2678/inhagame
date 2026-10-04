import { validateFishingStartRequest, validateFishingInputRequest } from '../src/activity/fishing-core.js';
import { ACTIVITY_CLIENT_ATTEMPT_KEY_PATTERN } from '../src/activity/activity-contract.js';

const ERRORS = new Map([
  ...['FISHING_POSITION_UNAVAILABLE','FISHING_POSITION_STALE','FISHING_POSITION_INELIGIBLE',
    'FISHING_OUT_OF_RANGE','FISHING_SPOT_OCCUPIED','FISHING_LEASE_LOST','FISHING_SESSION_CHANGED'].map(code => [code, 409]),
  ['ACCOUNT_UNAVAILABLE', 403], ['FISHING_UNAVAILABLE', 409], ['FISHING_RATE_LIMITED', 429],
  ['ATTEMPT_NOT_FOUND', 404], ['ATTEMPT_ALREADY_ACTIVE', 409], ['IDEMPOTENCY_CONFLICT', 409],
  ['TERMINAL_COMMAND_CONFLICT', 409], ['ACTIVITY_OUTCOME_CONFLICT', 409],
  ['FISHING_NOT_SUCCEEDED', 409], ['FISHING_IDENTITY_MISMATCH', 400],
  ['OUTPUT_UNAVAILABLE', 409], ['MAX_STACK_EXCEEDED', 409],
  ['COLLECTION_ENTRY_INACTIVE', 409], ['LIFE_SKILL_INACTIVE', 409], ['SETTLEMENT_PLAN_CONFLICT', 409]
]);
export class FishingError extends Error {
  constructor(code, status) { super(code); this.status = status; }
}
function identity(body, optional = false) {
  if (Object.keys(body).some(key => key !== 'attemptId') ||
      (!optional || body.attemptId !== undefined) &&
      (typeof body.attemptId !== 'string' || !ACTIVITY_CLIENT_ATTEMPT_KEY_PATTERN.test(body.attemptId))) {
    throw new TypeError('Invalid fishing attempt');
  }
  return body.attemptId?.toLowerCase() ?? null;
}

// The caller cannot supply actor, clock, policy, roll, quantity, discovery or XP.
export function createFishingService({ verifyUser, rpc }) {
  return async (authorization, body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new FishingError('INVALID_REQUEST', 400);
    const { op, ...input } = body;
    let name, args;
    try {
      if (op === 'start') {
        const request = validateFishingStartRequest(input);
        name = 'world_fishing_start_v1';
        args = { p_source_ref: request.sourceRef, p_client_attempt_key: request.clientAttemptKey };
      } else if (op === 'input') {
        const request = validateFishingInputRequest(input);
        name = 'world_fishing_input_v1';
        args = { p_attempt_id: request.attemptId, p_source_ref: request.sourceRef,
          p_nonce: request.nonce, p_action: request.action };
      } else if (op === 'settle' || op === 'read') {
        name = `world_fishing_${op}_v1`;
        args = { p_attempt_id: identity(input, op === 'read') };
      } else throw new TypeError('Unknown operation');
    } catch { throw new FishingError('INVALID_REQUEST', 400); }
    let actor;
    try { actor = await verifyUser(authorization); }
    catch { throw new FishingError('AUTH_UNAVAILABLE', 503); }
    if (typeof actor !== 'string' || !ACTIVITY_CLIENT_ATTEMPT_KEY_PATTERN.test(actor)) {
      throw new FishingError('AUTH_REQUIRED', 401);
    }
    return rpc(name, { p_user: actor.toLowerCase(), ...args });
  };
}

// URL and service key come only from server configuration. Never retry mutations automatically.
export function createFishingRpc({ url, serviceKey, fetcher = fetch }) {
  return async (name, args) => {
    if (!/^https?:\/\//u.test(url ?? '') || !serviceKey) throw new FishingError('FISHING_UNAVAILABLE', 503);
    try {
      const response = await fetcher(`${url.replace(/\/$/u, '')}/rest/v1/rpc/${name}`, {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      });
      const payload = await response.json();
      if (!response.ok) {
        if (ERRORS.has(payload?.message)) throw new FishingError(payload.message, ERRORS.get(payload.message));
        throw new FishingError('FISHING_UNAVAILABLE', 503);
      }
      return payload;
    } catch (error) {
      if (error instanceof FishingError) throw error;
      throw new FishingError('FISHING_UNAVAILABLE', 503);
    }
  };
}

export function createFishingApiHandler({ enabled, service }) {
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
        if (Buffer.byteLength(body) > 8192) return res.status(413).end();
        body = JSON.parse(body);
      }
      if (Buffer.byteLength(JSON.stringify(body) ?? '') > 8192) return res.status(413).end();
    } catch { return res.status(400).json({ error: 'INVALID_REQUEST' }); }
    try {
      return res.status(200).json(await service(req.headers.authorization, body));
    } catch (error) {
      return res.status(error instanceof FishingError ? error.status : 503).json({
        error: error instanceof FishingError ? error.message : 'FISHING_UNAVAILABLE'
      });
    }
  };
}
