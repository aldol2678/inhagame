import { getIncomeQuestCandidate } from '../src/income/income-catalog.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class IncomeError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}
function exact(input, keys) {
  if (Object.keys(input).some(key => !keys.includes(key))) throw new Error('Unknown field');
}
function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Invalid ID');
  return value.toLowerCase();
}
// The local-only candidate HTTP route supplies verified authentication. A future
// production runtime still needs approved exposure/position checks. Neither a client actor nor a completion flag is accepted.
export function createIncomeService({ verifyUser, rpc, enabled = false }) {
  return async (authorization, body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new IncomeError('INVALID_REQUEST', 400);
    const { op, ...input } = body;
    let name, args;
    try {
      if (op === 'start') {
        exact(input, ['questId', 'requestId']);
        const definition = getIncomeQuestCandidate(input.questId);
        if (!definition) throw new Error('Unknown definition');
        name = 'world_income_start_v1';
        args = { p_quest_id: definition.questId, p_giver_id: definition.giverId, p_request_id: uuid(input.requestId) };
      } else if (op === 'status') {
        exact(input, ['sessionId', 'questId']);
        if (input.questId != null && !getIncomeQuestCandidate(input.questId)) throw new Error('Unknown definition');
        name = 'world_income_status_v1';
        args = { p_session_id: input.sessionId == null ? null : uuid(input.sessionId), p_quest_id: input.questId ?? null };
      } else if (op === 'step') {
        exact(input, ['sessionId', 'stepId', 'choiceId', 'requestId', 'revision']);
        const sessionId = uuid(input.sessionId);
        if (!Number.isInteger(input.revision) || input.revision < 0 || input.revision > 2 ||
            input.stepId !== `${sessionId}:${input.revision}` ||
            typeof input.choiceId !== 'string' || !/^[a-zA-Z0-9_.-]{1,80}$/.test(input.choiceId)) throw new Error('Invalid step');
        name = 'world_income_action_v1';
        args = { p_session_id: sessionId, p_request_id: uuid(input.requestId), p_revision: input.revision,
          p_action: ['stock', 'checkout', 'tidy'][input.revision], p_value: input.choiceId };
      } else if (op === 'complete') {
        exact(input, ['sessionId', 'requestId']);
        name = 'world_income_finish_v1';
        args = { p_session_id: uuid(input.sessionId), p_request_id: uuid(input.requestId) };
      } else throw new Error('Unknown operation');
    } catch { throw new IncomeError('INVALID_REQUEST', 400); }
    if (op !== 'status' && !enabled) throw new IncomeError('INCOME_UNAVAILABLE', 409);
    let actor;
    try { actor = await verifyUser(authorization); }
    catch { throw new IncomeError('AUTH_UNAVAILABLE', 503); }
    if (typeof actor !== 'string' || !UUID.test(actor)) throw new IncomeError('AUTH_REQUIRED', 401);
    return rpc(name, { p_user: actor.toLowerCase(), ...args });
  };
}

// Mutations are never automatically retried. All errors are sanitized at the boundary.
export function createIncomeRpc({ url, serviceKey, fetcher = fetch }) {
  return async (name, args) => {
    if (!/^https?:\/\//.test(url ?? '') || !serviceKey ||
        !/^world_income_(start|status|action|finish)_v1$/.test(name)) throw new IncomeError('INCOME_UNAVAILABLE', 503);
    try {
      const response = await fetcher(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      });
      const result = await response.json();
      if (!response.ok) {
        if (typeof result?.message === 'string' && /^INCOME_[A-Z_]+$/.test(result.message)) {
          throw new IncomeError(result.message, 409);
        }
        if (['INSUFFICIENT_QUANTITY', 'ITEM_NOT_OWNED'].includes(result?.message)) throw new IncomeError('INCOME_INSUFFICIENT_MATERIAL', 409);
        if (['INPUT_UNAVAILABLE', 'ITEM_UNAVAILABLE', 'CONSUME_POLICY_UNSUPPORTED'].includes(result?.message)) throw new IncomeError('INCOME_MATERIAL_UNAVAILABLE', 409);
        if (result?.message === 'ACCOUNT_UNAVAILABLE') throw new IncomeError('ACCOUNT_UNAVAILABLE', 403);
        if (result?.message === 'IDEMPOTENCY_CONFLICT') throw new IncomeError('IDEMPOTENCY_CONFLICT', 409);
        throw new IncomeError('INCOME_UNAVAILABLE', 503);
      }
      return result;
    } catch (error) {
      if (error instanceof IncomeError) throw error;
      throw new IncomeError('INCOME_UNAVAILABLE', 503);
    }
  };
}
